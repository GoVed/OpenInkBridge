# Android SDK Integration Guide

The `openinkbridge-sdk` library provides native Kotlin views for standalone drawing or WebView packaging on Android-based E-Ink hardware.

---

## 1. Project Configuration

Add the SDK module to your Android project's `settings.gradle`:

```gradle
include ':openinkbridge-sdk'
project(':openinkbridge-sdk').projectDir = new File(rootDir, '../android/openinkbridge-sdk')
```

Then add the dependency in your application module's `build.gradle`:

```gradle
dependencies {
    implementation project(':openinkbridge-sdk')
}
```

---

## 2. Standalone Custom Canvas (`OpenInkBridgeView`)

Add the custom drawing view directly inside your XML layout:

```xml
<org.openinkbridge.sdk.OpenInkBridgeView
    android:id="@+id/openInkBridgeView"
    android:layout_width="match_parent"
    android:layout_height="match_parent" />
```

Inside your Activity or Fragment:

```kotlin
import org.openinkbridge.sdk.OpenInkBridgeView
import android.graphics.Color

class SketchActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState: Bundle?)
        setContentView(R.layout.activity_sketch)

        val drawingCanvas = findViewById<OpenInkBridgeView>(R.id.openInkBridgeView)

        // Configure brush style
        drawingCanvas.setBrushStyle(Color.BLACK, 5.0f)

        // Capture finalized vector strokes
        drawingCanvas.setOnStrokeListener { points ->
            Log.d("Sketch", "Drew stroke with ${points.size} coordinates.")
        }
    }
}
```

---

## 3. WebApp Packaging WebView (`OpenInkBridgeWebView`)

If you want to package a local or remote webapp and sync drawing coordinates with a web canvas using E-Ink low-latency hardware, use `OpenInkBridgeWebView` in XML:

```xml
<org.openinkbridge.sdk.OpenInkBridgeWebView
    android:id="@+id/openInkBridgeWebView"
    android:layout_width="match_parent"
    android:layout_height="match_parent" />
```

```kotlin
val bridgeWebView = findViewById<OpenInkBridgeWebView>(R.id.openInkBridgeWebView)
bridgeWebView.webView.loadUrl("file:///android_asset/my_app/index.html")
```

Inside the WebApp, developers use the `@openinkbridge/web` npm package to activate the writing mode.

---

## 4. Hardware EPD Reflection Routing

OpenInkBridge does not link proprietary manufacturer JAR files directly, avoiding copyright issues. 

Instead, `EpdAdapterManager` dynamically scans the device brand at runtime using `android.os.Build` metrics and binds the appropriate reflection adapter:

```kotlin
activeAdapter = when {
    manufacturer.contains("onyx") || brand.contains("onyx") -> OnyxBooxEpdAdapter()
    manufacturer.contains("bigme") || brand.contains("bigme") -> BigmeEpdAdapter()
    else -> JetpackInkAdapter() // standard Android fallback
}
```

If Onyx Boox is detected, `OnyxBooxEpdAdapter` hooks into the device's system classes (e.g. `com.onyx.android.sdk.api.device.epd.EpdController`) using Java reflection. This allows your app to bypass standard UI rendering pipelines and draw on the electrophoretic display at direct hardware level.

---

## 5. View Lifecycle & E-Ink Flicker Prevention

Direct EPD rendering updates the display in fast direct modes. When you exit an activity, these direct modes must be released. 

The custom views automatically handle this inside window attachment hooks:

```kotlin
override fun onDetachedFromWindow() {
    // Releases display locks, preventing screen flickers in background apps
    epdAdapterManager.activeAdapter.endStroke()
    epdAdapterManager.release()
    super.onDetachedFromWindow()
}
```

---

---

## 6. Hardware Touch Handoff & Focus Management

When Onyx direct hardware drawing (`TouchHelper.setRawDrawingEnabled(true)`) is active, standard Android view invalidations outside the low-latency drawing bounds are held by the vendor's EPD driver.

To ensure non-direct drawing areas (such as traditional whiteboard canvases or native UI toolbars) update smoothly in real time:

1. **`dispatchTouchEvent` Auto-Handoff:** `OpenInkBridgeWebView` automatically checks `ACTION_DOWN` coordinates. When a touch begins outside the low-latency canvas, hardware raw drawing is paused (`setRawDrawingEnabled(false)`), allowing normal Android view updates and EPD screen refreshes to proceed without lag.
2. **Re-Enabling Direct Mode:** When a touch begins inside `OpenInkBridgeView` or `OpenInkBridgeOverlayCanvas`, direct hardware raw drawing is immediately re-enabled.

---

## 7. Compiling the Rust Crate for JNI

To update the native stroke smoothing calculation library:

1. Install Android NDK targets in Rust:
   ```bash
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```
2. Install `cargo-ndk` compiler:
   ```bash
   cargo install cargo-ndk
   ```
3. Run target compilation:
   ```bash
   cd core
   cargo ndk -t arm64-v8a -p 21 -- build --release --features android
   ```
4. Copy the compiled JNI binary output (`libopeninkbridge_core.so`) into `openinkbridge-sdk/src/main/jniLibs/arm64-v8a/`.

