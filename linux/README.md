# OpenInkBridge Linux Driver Interface (Experimental reMarkable 1/2)

The current Linux backend targets reMarkable 1 and 2 using evdev input and a monochrome framebuffer path. It is experimental and requires validation on each firmware image. reMarkable Paper Pro and Kobo support are planned; neither has a device-specific implementation in this repository.

## Execution Model

Because these devices do not run Android, they require native ELF binaries (written in C++ or Rust) that bypass windowing systems (such as X11 or Wayland) and read directly from touch input sensors to draw directly onto the hardware framebuffer.

```
+-------------------------------------------------------+
|                  OpenInkBridge Rust App               |
|                                                       |
|  +--------------------+       +--------------------+  |
|  | Read input events  |       | Draw on Screen     |  |
|  | /dev/input/event*  |------>| Write /dev/fb0     |  |
|  +--------------------+       +--------------------+  |
+-------------------------------------------------------+
```

## How It Works

1. **Stylus Event Capture:** Read stylus coordinates and pressure from a configurable Linux evdev device (default `/dev/input/event0`).
2. **Display Control (EPDC):** Draw pixels directly to the framebuffer (`/dev/fb0`). 
3. **EPD Refresh Trigger:** Use `ioctl` system calls on the framebuffer file descriptor to notify the hardware display controller (EPDC) to refresh the specific region where the drawing occurred, using low-latency waveform modes.

## Build and run

From the repository root, build the driver with hardware refresh support enabled:

```sh
cargo build --manifest-path linux/Cargo.toml --release --features remarkable
```

Device paths are strict by default: startup fails if either device cannot be opened or mapped. Override paths and the bounded input batch size when a device exposes different nodes:

```sh
OPENINKBRIDGE_INPUT_DEVICE=/dev/input/event1 \
OPENINKBRIDGE_FRAMEBUFFER_DEVICE=/dev/fb0 \
OPENINKBRIDGE_MAX_EVENTS_PER_POLL=128 \
./target/release/openinkbridge-linux
```

For host-side development only, set `OPENINKBRIDGE_REQUIRE_HARDWARE=false` to use the in-memory renderer and injected input events.

Verify the package with:

```sh
cargo test --locked -p openinkbridge-linux --all-features
```

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

The `remarkable` feature uses `libremarkable` framebuffer types for hardware refresh requests. Related community projects include:

* **[libremarkable](https://github.com/reHackable/libremarkable):** Rust framebuffer and device support for reMarkable hardware.
* **[rmkit](https://github.com/isky/rmkit):** A C++ app development kit for the reMarkable paper tablet.
