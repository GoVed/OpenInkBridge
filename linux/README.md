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

## Build and run

Build the driver with hardware support enabled:

```sh
cargo build --release --features remarkable
```

Device paths are strict by default: startup fails if either device cannot be opened or mapped. Override paths and the bounded input batch size when a device exposes different nodes:

```sh
OPENINKBRIDGE_INPUT_DEVICE=/dev/input/event1 \
OPENINKBRIDGE_FRAMEBUFFER_DEVICE=/dev/fb0 \
OPENINKBRIDGE_MAX_EVENTS_PER_POLL=128 \
./target/release/openinkbridge-linux
```

For host-side development only, set `OPENINKBRIDGE_REQUIRE_HARDWARE=false` to use the in-memory renderer and injected input events.

## Quick-start API

The SDK opens evdev with `O_NONBLOCK`, decodes the target-native `libc::input_event` layout, preserves split records between polls, and caps work per poll. Applications should use the fallible polling API so disconnects and permission errors remain visible:

```rust
use openinkbridge_core::platform::remarkable::{RemarkableBackend, RemarkableConfig};
use openinkbridge_core::platform::{DisplayTransform, EpdBackend};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = RemarkableConfig::default()
        .with_input_device_path("/dev/input/event1")
        .with_framebuffer_device_path("/dev/fb0")
        .with_max_input_events_per_poll(128);
    let mut backend = RemarkableBackend::with_config(
        config,
        DisplayTransform::remarkables_default(),
    );
    backend.initialize().map_err(std::io::Error::other)?;

    loop {
        for event in backend
            .try_receive_pen_events()
            .map_err(std::io::Error::other)?
        {
            println!("{event:?}");
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
}
```

## Community References

Instead of re-inventing the low-level framebuffer rendering drivers from scratch, OpenInkBridge wrappers on Linux should link to:
* **[libremarkable](https://github.com/reHackable/libremarkable):** A Rust library providing a full framework for reMarkable rendering and input handling.
* **[rmkit](https://github.com/isky/rmkit):** A C++ app development kit for the reMarkable paper tablet.
