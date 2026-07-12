# Linux Native Client Integration Guide

For Linux-based E-Ink devices such as the reMarkable 1/2 and Kobo tablets, OpenInkBridge runs as a native background daemon rather than inside a virtual machine (like JVM/Android).

---

## 1. Native Execution Pipeline

On reMarkable tablets, application interfaces run outside standard desktop window managers. The `openinkbridge-linux` client achieves latency-free drawing by reading absolute touch coordinates directly from the hardware digitizer sensor and drawing directly onto the screen's memory-mapped framebuffer.

```
                  +--------------------------------+
                  |    openinkbridge-linux Crate   |
                  +---------------+----------------+
                                  |
            +---------------------+---------------------+
            |                                           |
            v                                           v
    Read event stream                           Direct memory draw
  `/dev/input/event0`                           `/dev/fb0` (Bresenham)
            |                                           |
            |                                           v
            v                                   Render pen lines
    Apply Rust core smoothing                     on E-Ink display
```

---

## 2. Bresenham's Direct Framebuffer Painting

Because touch screens send updates rapidly, the driver implements Bresenham's line algorithm to render solid black segments directly onto the framebuffer pixels:

```rust
unsafe fn draw_line(fb_ptr: *mut u8, x0: i32, y0: i32, x1: i32, y1: i32, color: u32) {
    let dx = (x1 - x0).abs();
    let dy = -(y1 - y0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut err = dx + dy;
    
    let mut x = x0;
    let mut y = y0;
    
    loop {
        draw_pixel(fb_ptr, x, y, color);
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
```

This writes directly to mapped EPD memory without triggering full compositor paint passes, providing near-zero lag drawing previews.

---

## 3. Stroke Processing & Event Hook

When the stylus pen lift event (`BTN_TOOL_PEN = 0`) is intercepted, the driver:
1. Gathers all recorded points in the current stroke buffer.
2. Passes them through the core library's `smooth_stroke` function (combining Double Exponential Smoothing and Ramer-Douglas-Peucker simplification).
3. Serializes the final vector coordinates into a JSON array and prints it to `stdout`:

```bash
# Output format written to stdout
STROKE_FINISHED: [{"x":104.5,"y":200.2,"pressure":0.5,"tilt":0.0,"timestamp":162590000}]
```

This JSON stream can be read and parsed by local webapps or third-party client daemons running on the tablet.

---

## 4. Cross-Compiling for reMarkable 1 & 2

The reMarkable tablet uses an ARMv7 processor. To compile the binary driver on your development machine:

1. Install the target toolchain:
   ```bash
   rustup target add armv7-unknown-linux-gnueabihf
   ```
2. Install the cross-linker (`gcc-arm-linux-gnueabihf`). On Ubuntu/Debian:
   ```bash
   sudo apt-get install gcc-arm-linux-gnueabihf
   ```
3. Configure Cargo to use the armv7 linker. Add a `.cargo/config.toml` file inside the `linux/` directory:
   ```toml
   [target.armv7-unknown-linux-gnueabihf]
   linker = "arm-linux-gnueabihf-gcc"
   ```
4. Build the binary package:
   ```bash
   cd linux
   cargo build --release --target armv7-unknown-linux-gnueabihf
   ```
5. Deploy the compiled binary to the device via SSH:
   ```bash
   scp target/armv7-unknown-linux-gnueabihf/release/openinkbridge-linux root@192.168.1.15:/usr/bin/
   ```
