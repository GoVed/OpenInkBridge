# OpenInkBridge Documentation Index

Welcome to the documentation for **OpenInkBridge**—the open-source, unified SDK designed to abstract proprietary low-latency drawing APIs across E-Ink devices (reMarkable, Onyx Boox, Bigme, etc.) and fallback devices.

Below are the detailed integration guides:

## 1. Integration Guides

* **[Web & WebApp Integration Guide](./WEB_INTEGRATION.md)**: Integrating `@openinkbridge/web` inside HTML5 Canvas, React components, and handling browser pointer fallbacks.
* **[Android SDK Integration Guide](./ANDROID_INTEGRATION.md)**: Adding `OpenInkBridgeView` and `OpenInkBridgeWebView` in native Kotlin/Java apps, configuring reflection EPD adapters, lifecycle handling, and JNI compilation.
* **[Linux Native Client Integration Guide](./LINUX_INTEGRATION.md)**: Understanding how the Linux driver daemon mapping `/dev/fb0` and `/dev/input/event0` coordinates works on reMarkable and Kobo tablets.

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
    Reflection EPDC Hooks      Direct FB /dev/fb0      Dynamic WASM Loader
             |                         |                         |
             v                         v                         v
      Onyx / Bigme EPD         reMarkable / Kobo          HTML5 Canvas / SVG
```

## 3. Stroke Math Engine (Rust)

All platforms (Android via JNI, Web via WASM, and Linux via native crate reference) utilize the same optimized Rust math library located in the [`core/`](../core) directory. This ensures identical drawing smoothing (Double Exponential Smoothing) and path compression (Ramer-Douglas-Peucker algorithm) regardless of where the app is running.
