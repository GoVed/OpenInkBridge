# Developer Diagnostics & Logging System

OpenInkBridge includes a comprehensive, cross-platform developer diagnostics and logging system across the **Rust Core**, **Android SDK**, and **Web SDK**.

This system is designed specifically for **developers** integrating OpenInkBridge into their applications and for **debugging user bug reports**.

---

## Key Questions Answered by Diagnostics

- **Why isn't handwriting working?**  
  Logs indicate backend selection, touch event routing, surface binding, and overlay state.
- **Which backend was selected?**  
  Initialization logs clearly report the selected backend (e.g. `[BOOX]`, `[REMARKABLE]`, `[JETPACK_INK]`, `[FALLBACK_CANVAS]`, `[BROWSER]`).
- **Was hardware acceleration enabled?**  
  Capabilities and initialization logs report whether direct vendor hardware drawing (e.g. Onyx `TouchHelper` SF_TOUCH_RENDER or `libremarkable` direct framebuffer mapping) is active.
- **Is the pen being detected?**  
  Stylus events (`PenDown`, `PenMove`, `PenUp`) are logged with coordinate, pressure, and tool type information.
- **Is pressure supported?**  
  Normalized pressure (0.0..1.0) and raw pressure sensor mapping status are detailed.
- **Why did rendering fall back?**  
  Clear `WARN` entries explain fallback triggers (e.g., missing JNI native binary, missing vendor EPD classes, standard non-EInk hardware).
- **Why is latency high?**  
  Performance logs measure JNI stroke smoothing time, render latency, and refresh latency.
- **Why is synchronization failing?**  
  `JsBridge` and `Synchronization` logs track native-to-web event handoffs and JSON payload parsing.
- **Which API is being used internally?**  
  Reports reflect exact internal mechanisms (e.g. Reflection hooks, `/dev/input/event0`, `MotionEventPredictor`).
- **Which refresh mode is active?**  
  Refresh requests (`SPEED`/`DU`, `QUALITY`/`GC`, `PARTIAL`, `CLEAR`) are logged with bounding box rectangles.

---

## Log Format & Categories

Log entries use structured tagging:

```text
[LEVEL][Subsystem][Backend] Event: Description...
```

### Log Levels

- **`ERROR`**: Critical errors (backend initialization failure, missing hardware handles, API failures).
- **`WARN`**: Warnings (falling back to software rendering, unsupported pen features, missing native libraries).
- **`INFO`**: High-level events (backend selected, initialization complete, device detected, writing mode toggling).
- **`DEBUG`**: Detailed operations (refresh requests, stroke commit, renderer state changes, bounding box updates).
- **`TRACE`**: High-frequency telemetry (pen events, coordinates, pressure values, timing). *Rate-limited to prevent log spamming.*

### Subsystems

- `Core`: Stroke math engine, algorithm execution, JNI/WASM exports.
- `Backend`: Hardware EPD adapter selection, binding, and release.
- `Renderer`: Stroke vector rendering, surface canvas operations.
- `PenInput`: Stylus events, coordinate mapping, pressure normalization.
- `Refresh`: E-Ink screen refresh mode changes and region updates.
- `Synchronization`: Hand-off between native SDK and web software canvas.
- `JsBridge`: JavaScript bridge notifications and options parsing.
- `Android`: Android OS events, view lifecycles, surface creation.
- `Linux`: Linux daemon loops, evdev input parsing, framebuffer mmap.
- `Performance`: Timing and latency measurements.
- `Configuration`: Environment parameters and capabilities detection.

---

## Using Logging in Your Project

### Rust Core & Linux

```rust
use openinkbridge_core::logging::{set_log_level, LogLevel, Subsystem};
use openinkbridge_core::{openink_info, openink_debug, openink_warn};

// Set logging threshold (ERROR, WARN, INFO, DEBUG, TRACE)
set_log_level(LogLevel::Debug);

// Emit structured log entries
openink_info!(Subsystem::Backend, "BOOX", "INIT", "Initializing hardware adapter");
```

### Android SDK (Kotlin)

```kotlin
import org.openinkbridge.sdk.OpenInkBridgeLogger
import org.openinkbridge.sdk.LogLevel
import org.openinkbridge.sdk.Subsystem

// Set log level
OpenInkBridgeLogger.logLevel = LogLevel.DEBUG

// Read recent logs from in-memory ring buffer (last 500 entries)
val recentLogs = OpenInkBridgeLogger.getRingBufferLogs()
```

### Web SDK (TypeScript)

```typescript
import { openInkBridge, logger, LogLevel, Subsystem } from '@openinkbridge/web';

// Set log level
openInkBridge.setLogLevel(LogLevel.DEBUG);

// Log custom diagnostic event
logger.info(Subsystem.JsBridge, 'WebApp', 'CANVAS_READY', 'Interactive canvas initialized');
```

---

## Collecting Diagnostics & Bug Reports

OpenInkBridge includes built-in functions that produce structured diagnostic data and GitHub issue-ready Markdown reports:

### Formatted Diagnostics Dump (`dumpConfiguration`)

Outputs a formatted block containing system version, platform, device model, selected backend, capabilities, refresh modes, and feature flags.

```typescript
// Web JS
console.log(openInkBridge.dumpConfiguration());
```

```kotlin
// Android Kotlin
val configDump = OpenInkBridgeDiagnostics.dumpConfiguration(epdAdapterManager)
Log.i("OpenInkBridge", configDump)
```

```rust
// Rust
let report = collect_diagnostics(selected_backend, available_backends, fallback_reason, capabilities, refresh_mode);
println!("{}", dump_configuration(&report));
```

#### Example Output

```text
========== OpenInkBridge Diagnostics ==========
Version: 0.1.1
Platform: Android SDK (Android 14, API 34)
Device: Onyx Tab Ultra C Pro (Onyx / boox)
Selected Backend: OnyxBooxEpdAdapter
Available Backends: OnyxBooxEpdAdapter, BigmeEpdAdapter, JetpackInkAdapter, FallbackCanvasAdapter
Capabilities:
  - Pressure: Supported
  - Tilt: Supported
  - Hover: Supported
  - Eraser: Supported
  - Refresh Modes: [SPEED, BALANCED, QUALITY, REGAL, DU]
  - Hardware Acceleration: Enabled
Refresh Mode: SPEED
Direct Drawing Active: true
===============================================
```

### Generating Bug Reports (`createBugReport`)

Generates a complete bug report containing the diagnostic configuration dump plus all recent `WARN` and `ERROR` entries from the in-memory circular Ring Buffer.

```typescript
const bugReport = openInkBridge.createBugReport();
// Attach this output to your GitHub Issue report!
```

---

## In-Memory Ring Buffer

OpenInkBridge maintains a thread-safe circular log buffer of the **last 500 log entries** in memory across Rust, Android, and Web SDKs.

This allows developers to fetch recent debug logs **after an error occurs**, even when verbose terminal output is turned off in production release builds.
