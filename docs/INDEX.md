# OpenInkBridge Documentation Index

Welcome to the documentation for **OpenInkBridge**, an open-source SDK that exposes a consistent drawing API across implemented hardware backends and explicit software fallbacks.

Below are the detailed integration guides:

## 1. Integration Guides & Diagnostics

* **[Developer Diagnostics & Logging Guide](./DEVELOPER_DIAGNOSTICS.md)**: Structured logging system, log levels, categories, in-memory ring buffer, diagnostics collection, configuration dumping, and bug report generation.
* **[Web & WebApp Integration Guide](./WEB_INTEGRATION.md)**: Integrating `@openinkbridge/web` inside HTML5 Canvas, React components, and handling browser pointer fallbacks.
* **[Android SDK Integration Guide](./ANDROID_INTEGRATION.md)**: Adding `OpenInkBridgeView` and `OpenInkBridgeWebView`, opting into BOOX acceleration, handling lifecycle, and optionally generating JNI artifacts.
* **[reMarkable Integration Guide](./remarkable.md)**: Experimental reMarkable 1/2 backend design and `armv7-unknown-linux-gnueabihf` build instructions. Paper Pro support is planned but unvalidated.
* **[Linux Native Client Integration Guide](./LINUX_INTEGRATION.md)**: Understanding the experimental reMarkable backend's nonblocking evdev input and framebuffer rendering pipeline. Kobo support is planned.


---

## 2. Core Architecture Summary

OpenInkBridge coordinates drawing inputs and display controllers across platforms using a modular structure:

```
                          +-------------------------+
                          |   Your App (Web/Native) |
                          +------------+------------+
                                       |
                                       v
                         +-------------+-------------+
                         |    OpenInkBridge SDK      |
                         +-------------+-------------+
                                       |
             +-------------------------+-------------------------+
             |                         |                         |
             v                         v                         v
    [Android OS Layer]         [Linux OS Layer]         [Web/Browser Layer]
             |                         |                         |
    Optional BOOX Pen SDK      Direct FB /dev/fb0      Optional WASM Loader
             |                         |                         |
             v                         v                         v
     Onyx / Android fallback      reMarkable             HTML5 Canvas / SVG
```

## 3. Stroke Math Engine (Rust)

The canonical smoothing contract is the zero-phase `0.25 / 0.50 / 0.25` filter defined by [`contracts/stroke-processing-v1.json`](../contracts/stroke-processing-v1.json). Rust and the JavaScript and Kotlin fallbacks are checked against those vectors; optional Wasm and JNI smoothing artifacts call the Rust implementation when supplied. Ramer-Douglas-Peucker simplification is available separately as Rust's `simplify_stroke` API and is not bundled into smoothing or exposed by the current Wasm/JNI bindings.

Run `scripts/verify.ps1` on PowerShell or `scripts/verify.sh` on POSIX shells for the repository checks. These scripts verify the clean-checkout fallback paths; optional Wasm and JNI generation are separate release steps.

---

## 4. Trademark Disclaimer

All product names, logos, brands, trademarks, and registered trademarks mentioned in this documentation (including *reMarkable*, *Onyx Boox*, *Bigme*, *Supernote*, *Kobo*, and *E Ink*) are the property of their respective owners. 

All company, product, and service names used in this documentation are for identification and hardware compatibility reference purposes only. Use of these names, logos, and brands does not imply endorsement, affiliation, sponsorship, or certification by their respective owners. OpenInkBridge is an independent open-source software project.
