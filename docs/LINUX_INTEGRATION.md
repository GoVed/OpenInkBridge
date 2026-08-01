# Linux Native Client Integration Guide

OpenInkBridge includes an experimental native backend for reMarkable 1 and 2. It reads Linux evdev input and writes to a mapped framebuffer without an Android runtime. reMarkable Paper Pro and Kobo support are planned but are not implemented or validated by the current backend.

---

## 1. Native Execution Pipeline

The `openinkbridge-linux` process uses nonblocking, bounded input polling and direct framebuffer drawing:

```text
evdev input -> coordinate transform -> Bresenham preview -> partial refresh
                         |
                         +-> stroke buffer -> Rust smoothing -> stdout JSON
```

The default transform and framebuffer geometry target reMarkable 1/2. Actual preview latency and refresh behavior depend on the device, firmware, waveform, and workload; the project does not guarantee a latency threshold.

---

## 2. Stroke Processing

During a stroke, the daemon draws each new segment directly to the framebuffer. On pen-up it:

1. Applies `smooth_stroke`, the zero-phase `0.25 / 0.50 / 0.25` filter.
2. Serializes the smoothed points and writes a `STROKE_FINISHED` record to standard output.
3. Requests a partial display refresh.

```text
STROKE_FINISHED: [{"x":104.5,"y":200.2,"pressure":0.5,"tilt":0.0,"timestamp":162590000}]
```

Smoothing preserves the point count. Ramer-Douglas-Peucker simplification is a separate Rust `simplify_stroke` API; the Linux daemon does not call it.

---

## 3. Device Configuration

Hardware access is strict by default: startup fails when the configured input device or framebuffer cannot be opened or mapped. Override device-specific paths and the bounded poll size with:

```bash
OPENINKBRIDGE_INPUT_DEVICE=/dev/input/event1 \
OPENINKBRIDGE_FRAMEBUFFER_DEVICE=/dev/fb0 \
OPENINKBRIDGE_MAX_EVENTS_PER_POLL=128 \
./openinkbridge-linux
```

For host-side development only, `OPENINKBRIDGE_REQUIRE_HARDWARE=false` enables the in-memory renderer instead of failing on missing hardware.

---

## 4. Cross-Compiling for reMarkable 1/2

Install the ARMv7 Rust target and a compatible linker:

```bash
rustup target add armv7-unknown-linux-gnueabihf
sudo apt-get install gcc-arm-linux-gnueabihf
```

Configure the linker in the repository root's `.cargo/config.toml`:

```toml
[target.armv7-unknown-linux-gnueabihf]
linker = "arm-linux-gnueabihf-gcc"
```

Then build from the repository root with the hardware refresh feature enabled:

```bash
cargo build --manifest-path linux/Cargo.toml \
  --release \
  --target armv7-unknown-linux-gnueabihf \
  --features remarkable
```

Deploy the resulting binary from the workspace-level target directory:

```bash
scp target/armv7-unknown-linux-gnueabihf/release/openinkbridge-linux \
  root@10.11.99.1:/usr/bin/
```

Validate input coordinates, framebuffer format, refresh behavior, permissions, shutdown, and coexistence with the stock UI on every target firmware before distribution.

---

## 5. Verification

Run the Linux package tests from the repository root:

```bash
cargo test --locked -p openinkbridge-linux --all-features
```

The full repository check is `scripts/verify.sh` on POSIX or `scripts/verify.ps1` on PowerShell.
