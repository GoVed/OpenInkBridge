# OpenInkBridge

OpenInkBridge is an open-source, unified SDK designed to abstract proprietary low-latency drawing APIs across various E-Ink devices (such as reMarkable, Onyx Boox, Bigme, and Supernote). 

Its main goal is to empower developers to build **both native standalone apps and cross-platform WebApps** that run with near-zero latency on E-Ink hardware.

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
   [Onyx Boox Adapter]        [Bigme Adapter]       [libremarkable (Linux)]
             |                       |                       |
             v                       v                       v
     Onyx Pen SDK / EPDC      Bigme Low-Latency API      Linux Framebuffer /dev/fb0
```

## Repository Structure

* **[`core/`](./core)** - Shared Rust engine for stroke smoothing, pressure normalization, and Bezier calculations. Cross-compiles to WebAssembly (Wasm) and C/JNI libraries.
* **[`android/`](./android)** - Android SDK (Kotlin library) providing `OpenInkBridgeView` and the low-latency hybrid `OpenInkBridgeWebView`.
* **[`web/`](./web)** - Web Integration package (`@openinkbridge/web`) for HTML5 Canvas/SVG synchronization.
* **[`linux/`](./linux)** - Linux native drivers (for reMarkable and Kobo tablets).

## Features & Highlights

* **Multi-Vendor Hardware Acceleration:** Automatic reflection-based hardware binding for Onyx Boox Pen SDK (TouchHelper / EpdController), Bigme Low-Latency API, and Android Jetpack Ink / MotionEventPredictor.
* **Hybrid Touch Routing & Focus Handoff:** Seamlessly toggles hardware raw drawing scribbles when drawing inside low-latency regions, while instantly yielding display refresh control for standard/traditional views and UI components.
* **Vector Path & Style Persistence:** Supports per-stroke color, width, and pressure-aware vector rendering with export options to Bitmap and SVG.
* **Cross-Platform Math Core:** Double Exponential Smoothing and Ramer-Douglas-Peucker path simplification powered by shared Rust/Wasm/JNI algorithms.

## Documentation

Refer to the integration guides for instructions on how to compile, build, and run OpenInkBridge for each platform:
* **[Documentation Index](./docs/INDEX.md)**
* **[Web & WebApp Integration Guide](./docs/WEB_INTEGRATION.md)**
* **[Android SDK Integration Guide](./docs/ANDROID_INTEGRATION.md)**
* **[Linux Native Client Integration Guide](./docs/LINUX_INTEGRATION.md)**

## License

OpenInkBridge is licensed under the **[Apache License, Version 2.0](./LICENSE)**. You are free to use, modify, sublicense, and distribute this SDK for both open-source and commercial applications.

