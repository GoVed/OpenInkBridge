use std::fs::{File, OpenOptions};
use std::io::Read;
use std::os::unix::io::AsRawFd;
use libc::{mmap, munmap, PROT_READ, PROT_WRITE, MAP_SHARED};
use openinkbridge_core::models::Point;
use openinkbridge_core::smooth_stroke;

// Standard Linux kernel input event representation
#[repr(C)]
#[derive(Debug, Copy, Clone)]
struct InputEvent {
    sec: libc::time_t,
    usec: libc::suseconds_t,
    type_: u16,
    code: u16,
    value: i32,
}

// Framebuffer configuration constants
const FB_WIDTH: i32 = 1404;   // standard reMarkable 1/2 screen width
const FB_HEIGHT: i32 = 1872;  // standard reMarkable 1/2 screen height
const FB_SIZE: usize = (FB_WIDTH * FB_HEIGHT * 4) as usize; // 32-bit color depth

unsafe fn map_framebuffer(fb_file: &File, size: usize) -> Result<*mut u8, std::io::Error> {
    let fd = fb_file.as_raw_fd();
    let addr = unsafe {
        mmap(
            std::ptr::null_mut(),
            size,
            PROT_READ | PROT_WRITE,
            MAP_SHARED,
            fd,
            0,
        )
    };
    if addr == libc::MAP_FAILED {
        return Err(std::io::Error::last_os_error());
    }
    Ok(addr as *mut u8)
}

unsafe fn draw_pixel(fb_ptr: *mut u8, x: i32, y: i32, color: u32) {
    if x < 0 || x >= FB_WIDTH || y < 0 || y >= FB_HEIGHT {
        return;
    }
    let offset = ((y * FB_WIDTH + x) * 4) as isize;
    unsafe {
        let pixel_ptr = fb_ptr.offset(offset) as *mut u32;
        *pixel_ptr = color;
    }
}

// Bresenham's line drawing algorithm for smooth path segments
unsafe fn draw_line(fb_ptr: *mut u8, x0: i32, y0: i32, x1: i32, y1: i32, color: u32) {
    let dx = (x1 - x0).abs();
    let dy = -(y1 - y0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut err = dx + dy;
    
    let mut x = x0;
    let mut y = y0;
    
    loop {
        unsafe {
            draw_pixel(fb_ptr, x, y, color);
        }
        if x == x1 && y == y1 { break; }
        let e2 = 2 * err;
        if e2 >= dy {
            err += dy;
            x += sx;
        }
        if e2 <= dx {
            err += dx;
            y += sy;
        }
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Open the stylus input device
    // On reMarkable, event0 is typically the wacom stylus digitizer
    let mut input_device = match File::open("/dev/input/event0") {
        Ok(f) => f,
        Err(_) => {
            eprintln!("Error: Could not open /dev/input/event0. Standard E-Ink stylus event interceptor requires root permission.");
            return Ok(());
        }
    };

    // 2. Map framebuffer memory
    let fb_file = OpenOptions::new()
        .read(true)
        .write(true)
        .open("/dev/fb0")?;
    
    let fb_ptr = unsafe { map_framebuffer(&fb_file, FB_SIZE)? };
    println!("OpenInkBridge Linux Driver started. Memory mapped /dev/fb0 at: {:?}", fb_ptr);

    let mut current_stroke = Vec::new();
    let mut last_x = -1;
    let mut last_y = -1;
    let mut pen_down = false;

    let mut temp_x = 0;
    let mut temp_y = 0;
    let mut temp_pressure = 0.0;
    let mut temp_tilt = 0.0;

    let mut event_buf = [0u8; std::mem::size_of::<InputEvent>()];
    
    loop {
        input_device.read_exact(&mut event_buf)?;
        let event: InputEvent = unsafe { std::mem::transmute(event_buf) };

        // 3. Intercept input events
        if event.type_ == 1 { // EV_KEY
            if event.code == 320 { // BTN_TOOL_PEN
                pen_down = event.value == 1;
                if !pen_down {
                    // Pen Lifted: Process, smooth, and export the finished stroke
                    if !current_stroke.is_empty() {
                        let smoothed = smooth_stroke(&current_stroke);
                        let json = serde_json::to_string(&smoothed)?;
                        // Print finalized vector data to stdout (bridges to other local webapps/daemons)
                        println!("STROKE_FINISHED: {}", json);
                        current_stroke.clear();
                    }
                    last_x = -1;
                    last_y = -1;
                }
            }
        } else if event.type_ == 3 { // EV_ABS (Absolute stylus coordinate updates)
            match event.code {
                0 => temp_x = event.value, // ABS_X
                1 => temp_y = event.value, // ABS_Y
                24 => temp_pressure = event.value as f32 / 4095.0, // ABS_PRESSURE (scaled)
                26 => temp_tilt = event.value as f32, // ABS_TILT
                _ => {}
            }

            // Sync coordinate positions when coordinates report
            if pen_down && temp_x > 0 && temp_y > 0 {
                let current_point = Point {
                    x: temp_x as f32,
                    y: temp_y as f32,
                    pressure: temp_pressure,
                    tilt: temp_tilt,
                    timestamp: (event.sec as u64) * 1000 + (event.usec as u64) / 1000,
                };
                current_stroke.push(current_point);

                // Draw low-latency preview line segment on EPD screen
                if last_x != -1 && last_y != -1 {
                    unsafe {
                        draw_line(fb_ptr, last_x, last_y, temp_x, temp_y, 0xFF000000); // Draw black segment
                    }
                }
                last_x = temp_x;
                last_y = temp_y;
            }
        }
    }

    // Clean up mapping before exit (not reachable in this loop)
    #[allow(unreachable_code)]
    unsafe {
        munmap(fb_ptr as *mut libc::c_void, FB_SIZE);
    }
    Ok(())
}
