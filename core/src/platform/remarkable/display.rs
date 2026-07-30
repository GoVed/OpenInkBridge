use crate::models::Point;
use crate::platform::RefreshMode;

pub struct DisplayRenderer {
    pub width: i32,
    pub height: i32,
    pub bytes_per_pixel: usize,
    buffer: Vec<u8>,
    mapped_fb_ptr: Option<*mut u8>,
    #[allow(dead_code)]
    fb_file_descriptor: Option<i32>,
    active_bounding_box: Option<(i32, i32, i32, i32)>,
}

unsafe impl Send for DisplayRenderer {}
unsafe impl Sync for DisplayRenderer {}

impl DisplayRenderer {
    pub fn new(width: i32, height: i32) -> Self {
        let bytes_per_pixel = 4; // 32-bit RGBA default
        let buffer_size = (width * height * bytes_per_pixel as i32) as usize;
        Self {
            width,
            height,
            bytes_per_pixel,
            buffer: vec![255; buffer_size], // White canvas by default
            mapped_fb_ptr: None,
            fb_file_descriptor: None,
            active_bounding_box: None,
        }
    }

    pub fn remarkables_default() -> Self {
        Self::new(1404, 1872)
    }

    /// Initialize the display renderer and attempt framebuffer memory mapping.
    pub fn initialize(&mut self) -> Result<(), String> {
        #[cfg(all(feature = "remarkable", target_os = "linux"))]
        {
            use std::fs::OpenOptions;
            use std::os::unix::io::AsRawFd;

            if let Ok(file) = OpenOptions::new().read(true).write(true).open("/dev/fb0") {
                let fd = file.as_raw_fd();
                let size = (self.width * self.height * self.bytes_per_pixel as i32) as usize;
                let addr = unsafe {
                    libc::mmap(
                        std::ptr::null_mut(),
                        size,
                        libc::PROT_READ | libc::PROT_WRITE,
                        libc::MAP_SHARED,
                        fd,
                        0,
                    )
                };
                if addr != libc::MAP_FAILED {
                    self.mapped_fb_ptr = Some(addr as *mut u8);
                    self.fb_file_descriptor = Some(fd);
                    std::mem::forget(file); // Keep file descriptor open
                    return Ok(());
                }
            }
        }

        // In virtual/host environment, memory rendering buffer is initialized cleanly
        Ok(())
    }

    /// Release framebuffer memory mapping.
    pub fn shutdown(&mut self) -> Result<(), String> {
        #[cfg(all(feature = "remarkable", target_os = "linux"))]
        {
            if let Some(ptr) = self.mapped_fb_ptr.take() {
                let size = (self.width * self.height * self.bytes_per_pixel as i32) as usize;
                unsafe {
                    libc::munmap(ptr as *mut libc::c_void, size);
                }
            }
        }
        self.mapped_fb_ptr = None;
        Ok(())
    }

    /// Set pixel color at (x, y) on both internal buffer and mapped framebuffer.
    pub fn draw_pixel(&mut self, x: i32, y: i32, color: u32) {
        if x < 0 || x >= self.width || y < 0 || y >= self.height {
            return;
        }

        let offset = ((y * self.width + x) as usize) * self.bytes_per_pixel;
        if offset + 3 < self.buffer.len() {
            let r = ((color >> 16) & 0xFF) as u8;
            let g = ((color >> 8) & 0xFF) as u8;
            let b = (color & 0xFF) as u8;
            let a = ((color >> 24) & 0xFF) as u8;

            self.buffer[offset] = r;
            self.buffer[offset + 1] = g;
            self.buffer[offset + 2] = b;
            self.buffer[offset + 3] = if a == 0 { 255 } else { a };

            if let Some(fb_ptr) = self.mapped_fb_ptr {
                unsafe {
                    let pixel_ptr = fb_ptr.add(offset) as *mut u32;
                    *pixel_ptr = color;
                }
            }

            self.update_bounding_box(x, y);
        }
    }

    /// Draw a line segment with variable width and color between two points.
    pub fn draw_line_segment(&mut self, x0: i32, y0: i32, x1: i32, y1: i32, stroke_width: f32, color: u32) {
        let radius = (stroke_width / 2.0).round() as i32;
        if radius <= 1 {
            self.bresenham_line(x0, y0, x1, y1, color);
            return;
        }

        let dx = (x1 - x0).abs();
        let dy = -(y1 - y0).abs();
        let sx = if x0 < x1 { 1 } else { -1 };
        let sy = if y0 < y1 { 1 } else { -1 };
        let mut err = dx + dy;

        let mut x = x0;
        let mut y = y0;

        loop {
            self.draw_circle_filled(x, y, radius, color);
            if x == x1 && y == y1 {
                break;
            }
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

    fn draw_circle_filled(&mut self, cx: i32, cy: i32, radius: i32, color: u32) {
        for dy in -radius..=radius {
            for dx in -radius..=radius {
                if dx * dx + dy * dy <= radius * radius {
                    self.draw_pixel(cx + dx, cy + dy, color);
                }
            }
        }
    }

    fn bresenham_line(&mut self, x0: i32, y0: i32, x1: i32, y1: i32, color: u32) {
        let dx = (x1 - x0).abs();
        let dy = -(y1 - y0).abs();
        let sx = if x0 < x1 { 1 } else { -1 };
        let sy = if y0 < y1 { 1 } else { -1 };
        let mut err = dx + dy;

        let mut x = x0;
        let mut y = y0;

        loop {
            self.draw_pixel(x, y, color);
            if x == x1 && y == y1 {
                break;
            }
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

    /// Render a batch of stroke points directly to the framebuffer with pressure scaling.
    pub fn render_stroke_points(&mut self, points: &[Point], color: u32, base_width: f32) {
        if points.len() < 2 {
            if let Some(p) = points.first() {
                let width = (base_width * p.pressure.max(0.2)).max(1.0);
                self.draw_circle_filled(p.x as i32, p.y as i32, (width / 2.0) as i32, color);
            }
            return;
        }

        for i in 0..points.len() - 1 {
            let p0 = &points[i];
            let p1 = &points[i + 1];
            let avg_pressure = (p0.pressure + p1.pressure) / 2.0;
            let stroke_width = (base_width * avg_pressure.max(0.15)).max(1.0);

            self.draw_line_segment(
                p0.x as i32,
                p0.y as i32,
                p1.x as i32,
                p1.y as i32,
                stroke_width,
                color,
            );
        }
    }

    /// Track affected screen region for partial E-Ink updates.
    fn update_bounding_box(&mut self, x: i32, y: i32) {
        match self.active_bounding_box {
            Some((min_x, min_y, max_x, max_y)) => {
                self.active_bounding_box = Some((
                    min_x.min(x),
                    min_y.min(y),
                    max_x.max(x),
                    max_y.max(y),
                ));
            }
            None => {
                self.active_bounding_box = Some((x, y, x, y));
            }
        }
    }

    /// Take and clear the current partial update bounding box.
    pub fn take_bounding_box(&mut self) -> Option<(i32, i32, i32, i32)> {
        self.active_bounding_box.take()
    }

    /// Trigger screen refresh via libremarkable or EPD controller interfaces.
    pub fn refresh_screen(&mut self, mode: RefreshMode, rect: Option<(i32, i32, i32, i32)>) -> Result<(), String> {
        let refresh_region = rect.or_else(|| self.take_bounding_box());

        match mode {
            RefreshMode::Clear => {
                // Clear memory buffer to white
                self.buffer.fill(255);
                if let Some(fb_ptr) = self.mapped_fb_ptr {
                    let size = (self.width * self.height * self.bytes_per_pixel as i32) as usize;
                    unsafe {
                        std::ptr::write_bytes(fb_ptr, 0xFF, size);
                    }
                }
                self.active_bounding_box = None;
            }
            _ => {}
        }

        #[cfg(all(feature = "remarkable", target_os = "linux"))]
        {
            // Integrate with libremarkable E-Ink refresh if hardware available
            use libremarkable::framebuffer::common::*;
            use libremarkable::framebuffer::core::Framebuffer;
            use libremarkable::framebuffer::FramebufferRefresh;

            // Map OpenInkBridge refresh mode to libremarkable waveform_mode
            let waveform = match mode {
                RefreshMode::Fast => waveform_mode::WAVEFORM_MODE_DU,
                RefreshMode::Partial => waveform_mode::WAVEFORM_MODE_DU,
                RefreshMode::Full | RefreshMode::Clear => waveform_mode::WAVEFORM_MODE_GC16,
            };

            let mxc_rect = if let Some((min_x, min_y, max_x, max_y)) = refresh_region {
                mxcfb_rect {
                    top: min_y.max(0) as u32,
                    left: min_x.max(0) as u32,
                    width: (max_x - min_x + 1).max(1) as u32,
                    height: (max_y - min_y + 1).max(1) as u32,
                }
            } else {
                mxcfb_rect {
                    top: 0,
                    left: 0,
                    width: self.width as u32,
                    height: self.height as u32,
                }
            };

            // Attempt hardware refresh via libremarkable FramebufferRefresh trait if on physical reMarkable hardware
            if std::path::Path::new("/sys/devices/soc0/machine").exists() {
                let fb = Framebuffer::new();
                let _ = fb.partial_refresh(
                    &mxc_rect,
                    libremarkable::framebuffer::PartialRefreshMode::Async,
                    waveform,
                    display_temp::TEMP_USE_REMARKABLE_DRAW,
                    dither_mode::EPDC_FLAG_USE_DITHERING_PASSTHROUGH,
                    0, // quantum
                    false, // wait_completion
                );
            }
        }







        let _ = refresh_region;
        Ok(())
    }

    /// Retrieve copy of the current pixel buffer.
    pub fn get_buffer(&self) -> &[u8] {
        &self.buffer
    }
}
