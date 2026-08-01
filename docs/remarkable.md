# reMarkable Integration Guide

OpenInkBridge contains an experimental Rust backend for direct stylus input and framebuffer drawing on reMarkable 1 and 2. It is not certified by reMarkable and must be validated against the exact device and firmware used for deployment.

## Device Status

| Device | Architecture | Status | Current scope |
| --- | --- | --- | --- |
| reMarkable 1 | ARMv7 | Experimental | evdev input, 1404 x 1872 monochrome framebuffer, partial refresh |
| reMarkable 2 | ARMv7 | Experimental | Same configurable backend; hardware regression testing is still required |
| reMarkable Paper Pro | AArch64 | Planned / unvalidated | No Paper Pro transform, color framebuffer mapping, or refresh integration is implemented |

Firmware compatibility depends on the exposed input and framebuffer ABIs. Validate coordinates, pressure, pixel format, permissions, refresh behavior, shutdown, and coexistence with the stock UI before shipping.

---

## Architecture

```text
RemarkableBackend
  |- InputParser: nonblocking Linux input_event decoding and coordinate transform
  |- DisplayRenderer: mapped framebuffer and Bresenham line preview
  `- EpdBackend: lifecycle, rendering, and refresh interface
```

The default paths are `/dev/input/event0` and `/dev/fb0`, and hardware is required by default. `OPENINKBRIDGE_INPUT_DEVICE`, `OPENINKBRIDGE_FRAMEBUFFER_DEVICE`, and `OPENINKBRIDGE_MAX_EVENTS_PER_POLL` adapt the executable to different device nodes. `OPENINKBRIDGE_REQUIRE_HARDWARE=false` is intended only for host-side virtual development.

On pen-up, the executable applies the Rust `0.25 / 0.50 / 0.25` smoothing filter and emits `STROKE_FINISHED` JSON. It does not apply the separate RDP simplifier.

---

## Build and Test

Run host-side tests from the repository root:

```bash
cargo test --locked --workspace --all-features
```

For reMarkable 1/2, install the ARMv7 target and cross-linker:

```bash
rustup target add armv7-unknown-linux-gnueabihf
sudo apt-get install gcc-arm-linux-gnueabihf
```

Configure `.cargo/config.toml` in the repository root:

```toml
[target.armv7-unknown-linux-gnueabihf]
linker = "arm-linux-gnueabihf-gcc"
```

Build either executable with the `remarkable` refresh feature:

```bash
cargo build --manifest-path linux/Cargo.toml \
  --release \
  --target armv7-unknown-linux-gnueabihf \
  --features remarkable

cargo build --manifest-path linux/Cargo.toml \
  --bin remarkable_demo \
  --release \
  --target armv7-unknown-linux-gnueabihf \
  --features remarkable
```

---

## Deploy

With SSH enabled on the tablet, copy and run the main process:

```bash
scp target/armv7-unknown-linux-gnueabihf/release/openinkbridge-linux \
  root@10.11.99.1:/usr/bin/
ssh root@10.11.99.1 openinkbridge-linux
```

The `remarkable_demo` binary exercises the same backend while logging pen-down/pen-up events. It draws fixed-width black preview segments, includes captured pressure in the emitted stroke data, applies smoothing on pen-up, and requests a partial refresh. It is a development aid, not a device certification or latency benchmark.

---

## Current Limitations

* The built-in transform and monochrome framebuffer assumptions target reMarkable 1/2.
* Paper Pro color mapping and device-specific refresh support are not implemented.
* Running beside the stock UI may cause competing framebuffer updates; coexistence is firmware-dependent.
* Device nodes and permissions vary, and startup intentionally fails rather than silently selecting virtual hardware.

## Core Interfaces

| Type | Purpose |
| --- | --- |
| `EpdBackend` | Lifecycle, input polling, stroke rendering, and refresh abstraction |
| `RemarkableConfig` | Input path, framebuffer path, poll bound, and hardware requirement |
| `PenEvent` / `PenState` | Hardware-neutral stylus events and `Down`, `Move`, `Up`, `Hover` states |
| `RefreshMode` | `Fast`, `Partial`, `Full`, and `Clear` requests |
| `DisplayTransform` | Converts digitizer coordinates into framebuffer coordinates |
