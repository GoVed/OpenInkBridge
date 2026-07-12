# OpenInkBridge Linux Driver Interface (reMarkable / Kobo)

For Linux-based E-Ink devices (like the reMarkable 1/2/Paper Pro and Kobo e-readers), OpenInkBridge operates at the native system level rather than inside a virtual machine (like JVM/Android).

## Execution Model

Because these devices do not run Android, they require native ELF binaries (written in C++ or Rust) that bypass windowing systems (such as X11 or Wayland) and read directly from touch input sensors to draw directly onto the hardware framebuffer.

```
+-------------------------------------------------------+
|                OpenInkBridge C++/Rust App             |
|                                                       |
|  +--------------------+       +--------------------+  |
|  | Read input events  |       | Draw on Screen     |  |
|  | /dev/input/event*  |------>| Write /dev/fb0     |  |
|  +--------------------+       +--------------------+  |
+-------------------------------------------------------+
```

## How It Works

1. **Stylus Event Capture:** Read stylus coordinates, pressure, and tilt directly from Linux input devices (typically `/dev/input/event0` or `/dev/input/tsv`).
2. **Display Control (EPDC):** Draw pixels directly to the framebuffer (`/dev/fb0`). 
3. **EPD Refresh Trigger:** Use `ioctl` system calls on the framebuffer file descriptor to notify the hardware display controller (EPDC) to refresh the specific region where the drawing occurred, using low-latency waveform modes.

## Quick-Start Code Template (Rust)

A native application reading pen events and drawing on a reMarkable device would look like this:

```rust
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::FileExt;

// Simplified Linux input event struct
#[repr(C)]
struct InputEvent {
    tv_sec: usize,
    tv_usec: usize,
    evt_type: u16,
    code: u16,
    value: i32,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Hook the stylus input device
    let mut input_device = File::open("/dev/input/event0")?;
    
    // 2. Open the framebuffer for direct drawing
    let mut fb = OpenOptions::new()
        .read(true)
        .write(true)
        .open("/dev/fb0")?;

    println!("OpenInkBridge listening on /dev/input/event0...");

    let mut event_buf = [0u8; std::mem::size_of::<InputEvent>()];
    loop {
        input_device.read_exact(&mut event_buf)?;
        let event: InputEvent = unsafe { std::mem::transmute(event_buf) };

        // Process EV_ABS (Absolute stylus coordinates, pressure, tilt)
        if event.evt_type == 3 {
            match event.code {
                0 => println!("X: {}", event.value),
                1 => println!("Y: {}", event.value),
                24 => println!("Pressure: {}", event.value), // ABS_PRESSURE
                _ => {}
            }
        }
    }
}
```

## Community References

Instead of re-inventing the low-level framebuffer rendering drivers from scratch, OpenInkBridge wrappers on Linux should link to:
* **[libremarkable](https://github.com/reHackable/libremarkable):** A Rust library providing a full framework for reMarkable rendering and input handling.
* **[rmkit](https://github.com/isky/rmkit):** A C++ app development kit for the reMarkable paper tablet.
