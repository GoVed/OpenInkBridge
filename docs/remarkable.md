# reMarkable Integration Guide (OpenInkBridge)

This document provides a guide for integrating, building, and deploying OpenInkBridge on reMarkable E-Ink tablets.

---

## 1. Supported Devices & Hardware Compatibility

| Device Model | Processor / Architecture | Display Resolution | Hardware Support Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **reMarkable 1** | NXP i.MX6SL (ARMv7-A / `armv7`) | 1404 × 1872 (226 DPI) | **Experimental** | Linux framebuffer, evdev digitizer, and `libremarkable` refresh path; validate against the target OS before deployment. |
| **reMarkable 2** | NXP i.MX7Dual (ARMv7-A / `armv7`) | 1404 × 1872 (226 DPI) | **Experimental** | Uses the same configurable Linux backend; hardware regression coverage is still required. |
| **reMarkable Paper Pro** | NXP i.MX8M (ARMv8 / `aarch64`) | 1620 × 2160 (Color Canvas) | **Experimental / Partial** | Uses custom color EPD driver and 64-bit ARM architecture. Touch/stylus input works via evdev; direct framebuffer rendering requires Paper Pro kernel headers and color palette matching. |

---

## 2. Supported Firmware Versions

Firmware compatibility depends on the framebuffer and input-device ABI exposed by the installed OS. Treat the backend as experimental and validate input, pixel format, refresh behavior, shutdown, and coexistence with the stock UI on each supported firmware image.

---

## 3. Architecture Overview

OpenInkBridge bypasses standard desktop UI frameworks to minimize input-to-preview latency. No latency threshold is guaranteed without a device-specific benchmark.

```
                      +-----------------------------+
                      |  OpenInkBridge Application  |
                      +--------------+--------------+
                                     |
                                     v
                       +-------------+-------------+
                       |    EpdBackend Interface   |
                       +-------------+-------------+
                                     |
                                     v
                       +-------------+-------------+
                       |      RemarkableBackend    |
                       +-------------+-------------+
                                     |
             +-----------------------+-----------------------+
             |                                               |
             v                                               v
     [InputParser]                                  [DisplayRenderer]
     Reads `/dev/input/event0`                      Bresenham direct painting
     Wacom coordinate scaling (20967x15725)         Memory-mapped `/dev/fb0`
     Normalizes pressure (0..4095)                  Partial E-Ink refresh via
     PenState transitions                           `libremarkable` (Waveform DU)
```

---

## 4. Build Instructions

### Prerequisites

1. Install Rust (`rustup`):
   ```bash
   rustup target add armv7-unknown-linux-gnueabihf
   ```

2. Install the ARM cross-compiler toolchain (Ubuntu/Debian):
   ```bash
   sudo apt-get install gcc-arm-linux-gnueabihf
   ```

### Cargo Feature Flags

OpenInkBridge uses Cargo features to isolate hardware dependencies:

* `default`: Standard host build (for unit testing and simulation on Linux/macOS/Windows).
* `remarkable`: Includes `libremarkable` hardware framebuffer refresh controllers and Linux `libc` bindings.

### Building for Host System (Testing / Development)

```bash
cd core
cargo test --features remarkable
```

### Cross-Compiling for reMarkable 1 & 2 (`armv7`)

Create or configure `.cargo/config.toml` inside the repository:

```toml
[target.armv7-unknown-linux-gnueabihf]
linker = "arm-linux-gnueabihf-gcc"
```

Compile release binaries:

```bash
# Build the reMarkable driver daemon
cargo build --manifest-path linux/Cargo.toml --release --target armv7-unknown-linux-gnueabihf --features remarkable

# Build the hardware demo executable
cargo build --manifest-path linux/Cargo.toml --bin remarkable_demo --release --target armv7-unknown-linux-gnueabihf --features remarkable
```

---

## 5. Installation & Deployment

1. Ensure SSH access is enabled on your reMarkable tablet (**Settings -> Help -> About -> Copyright and licenses** for root password and IP address).

2. Copy the binary to your tablet via SCP:
   ```bash
   scp target/armv7-unknown-linux-gnueabihf/release/remarkable_demo root@10.11.99.1:/usr/bin/
   ```

3. Run the hardware demo on the device:
   ```bash
   ssh root@10.11.99.1 "remarkable_demo"
   ```

---

## 6. Hardware Demo ("OpenInkBridge reMarkable Demo")

The `remarkable_demo` executable validates all hardware acceleration capabilities:

* **Low-Latency Pen Drawing:** Renders stylus movements directly onto the display framebuffer.
* **Pressure Sensitivity:** Dynamically scales stroke width according to stylus pressure (0.0 to 1.0).
* **Partial Refresh:** Triggers fast E-Ink DU updates specifically for stroke bounding boxes to eliminate screen latency.
* **Latency Measurements:** Logs real-time input-to-render millisecond latency.
* **Vector Vector Stream:** Emits JSON-serialized smoothed stroke data (`STROKE_FINISHED`) upon pen lift.

---

## 7. Known Limitations & Future Improvements

1. **reMarkable Paper Pro Color Palette:** The Paper Pro utilizes a Gallery Palette E-Ink panel. Standard 32-bit RGB direct framebuffer writes require color mapping for the 6-color EPD filter.
2. **Concurrent Compositor Refresh:** Running alongside the stock `xochitl` launcher while scribbling requires pausing xochitl or drawing into dedicated screen regions to avoid display flicker.
3. **Multi-Touch Finger Gestures:** Finger touch input currently uses standard evdev event handling; full palm rejection gesture handling is available via `InputParser` state logic.

---

## 8. Summary of API Abstractions

| Interface / Type | Purpose |
| :--- | :--- |
| `EpdBackend` | Generic trait for all platform backends (`initialize`, `shutdown`, `receive_pen_events`, `render_strokes`, `request_refresh`). |
| `PenEvent` | Hardware-agnostic pen event containing `(x, y, pressure, tilt_x, tilt_y, state, timestamp)`. |
| `PenState` | `Down`, `Move`, `Up`, `Hover`. |
| `RefreshMode` | `Fast`, `Partial`, `Full`, `Clear`. |
| `DisplayTransform` | Converts raw sensor digitizer extents (e.g. 20967x15725) to screen coordinates (1404x1872). |
