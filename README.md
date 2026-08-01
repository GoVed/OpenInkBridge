# OpenInkBridge

OpenInkBridge is an open-source SDK for presenting a consistent stylus and drawing API across E-Ink devices. Hardware integrations are enabled only after a backend successfully probes the current device; unsupported devices use an explicit software fallback.

Its main goal is to help developers build **both native standalone apps and cross-platform WebApps** with low-latency ink previews on E-Ink hardware. Actual latency depends on the device, firmware, and selected rendering path.

## Architecture Overview

To achieve low-latency drawing on E-Ink displays, OpenInkBridge uses a **Hybrid Overlay Bridge** pattern:

* **For Native Apps:** Use native UI components (`OpenInkBridgeView`) which auto-detect the manufacturer and route touch events through the device's Electrophoretic Display Controller (EPDC).
* **For Web Apps:** Use `OpenInkBridgeWebView`. It overlays a native transparent canvas on top of the web content. When the stylus touches the screen, the native overlay renders the stroke immediately at hardware level, then passes the completed stroke points back to JavaScript/HTML5 Canvas via a JS Bridge.

```
                      +-----------------------------+
                      |   Third-Party App / WebApp  |
                      +--------------+--------------+
                                     |
                                     v
                       +-------------+-------------+
                       |   OpenInkBridge SDK Core  |
                       +-------------+-------------+
                                     |
             +-----------------------+-----------------------+
             |                       |                       |
             v                       v                       v
   [Onyx Boox Adapter]      [Android Fallback]      [reMarkable (Linux)]
             |                       |                       |
             v                       v                       v
     Onyx Pen SDK / EPDC       Canvas / Prediction       Linux Framebuffer / evdev
```

## Repository Structure

* **[`core/`](./core)** - Shared Rust engine for stroke smoothing, optional Ramer-Douglas-Peucker simplification, models, diagnostics, and platform abstractions. Its smoothing API can be built for WebAssembly (Wasm) or JNI.
* **[`android/`](./android)** - Android SDK (Kotlin library) providing `OpenInkBridgeView` and the low-latency hybrid `OpenInkBridgeWebView`.
* **[`web/`](./web)** - Web Integration package (`@openinkbridge/web`) for HTML5 Canvas/SVG synchronization.
* **[`linux/`](./linux)** - Linux native backend for reMarkable tablets. Kobo support is planned but not currently implemented.

## Features & Highlights

* **Capability-Probed Rendering:** Onyx Boox Pen SDK acceleration where available, Android MotionEvent prediction or Canvas fallback elsewhere, and explicit degraded-mode diagnostics.
* **Hybrid Touch Routing & Focus Handoff:** Seamlessly toggles hardware raw drawing scribbles when drawing inside low-latency regions, while instantly yielding display refresh control for standard/traditional views and UI components.
* **Vector Path & Style Persistence:** Supports per-stroke color, width, and pressure-aware vector rendering with export options to Bitmap and SVG.
* **Consistent Stroke Smoothing:** Rust, JavaScript, and Kotlin use the same zero-phase `0.25 / 0.50 / 0.25` smoothing contract. Ramer-Douglas-Peucker simplification is a separate, opt-in Rust API and is not part of the Wasm or JNI smoothing surface.

## Implementation Status

| Platform | Status | Rendering path |
| --- | --- | --- |
| Onyx BOOX (Android) | Implemented, optional acceleration | Onyx Pen SDK when the app supplies the optional runtime; Android fallback otherwise |
| Generic Android | Implemented | MotionEvent prediction / Canvas fallback |
| Bigme and Supernote | Software fallback only | Generic Android path; vendor acceleration is not implemented |
| reMarkable 1/2 | Experimental hardware backend | Linux evdev and framebuffer |
| reMarkable Paper Pro | Planned / unvalidated | Current backend assumes reMarkable 1/2 input and monochrome framebuffer geometry |
| Kobo | Planned | No backend in this repository yet |
| Browser | Implemented | Pointer Events and HTML Canvas; native overlay when hosted by the Android bridge |

"Implemented" describes a code path in this repository, not certification by a device manufacturer. See the platform integration guides for current limitations.

## Development

The repository pins its Rust and Node toolchains and provides one verification entry point per shell:

```powershell
.\scripts\verify.ps1
```

```sh
./scripts/verify.sh
```

Verification formats, lints, tests, builds, and package-checks the Rust, Web, and Android projects. The Android checks require JDK 17 and an Android SDK; use `-SkipAndroid` in PowerShell or `SKIP_ANDROID=1` with the shell script when those tools are unavailable.

The main verifier exercises the clean-checkout JavaScript and Kotlin smoothing fallbacks. Optional Wasm (`cd web && npm run build:wasm`) and JNI artifacts are generated separately and are not shipped or built by the repository verification scripts.

## Documentation

Refer to the integration guides for instructions on how to compile, build, and run OpenInkBridge for each platform:
* **[Documentation Index](./docs/INDEX.md)**
* **[Developer Diagnostics & Logging Guide](./docs/DEVELOPER_DIAGNOSTICS.md)**
* **[Web & WebApp Integration Guide](./docs/WEB_INTEGRATION.md)**
* **[Android SDK Integration Guide](./docs/ANDROID_INTEGRATION.md)**
* **[Linux Native Client Integration Guide](./docs/LINUX_INTEGRATION.md)**


## License

OpenInkBridge is licensed under the **[Apache License, Version 2.0](./LICENSE)**. You are free to use, modify, sublicense, and distribute this SDK for both open-source and commercial applications.

## Trademark Disclaimer

All product names, logos, brands, trademarks, and registered trademarks mentioned in this repository (including *reMarkable*, *Onyx Boox*, *Bigme*, *Supernote*, *Kobo*, and *E Ink*) are the property of their respective owners. 

All company, product, and service names used in this project are for identification and hardware compatibility reference purposes only. Use of these names, logos, and brands does not imply endorsement, affiliation, sponsorship, or certification by their respective owners. OpenInkBridge is an independent open-source software project.

