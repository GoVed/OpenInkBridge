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
        super.onCreate(savedInstanceState)
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

// Local packaged content:
bridgeWebView.webView.loadUrl("file:///android_asset/my_app/index.html")

// Or, for remote content, allowlist the HTTPS origin before navigation:
bridgeWebView.addTrustedOrigin("https://drawing.example.com")
bridgeWebView.webView.loadUrl("https://drawing.example.com/editor")
```

Inside the WebApp, developers use the `@openinkbridge/web` npm package to activate the writing mode.
Remote origins in the native bridge allowlist must use HTTPS; the local Android asset origin is the
only file exception. The bridge is injected through an
origin-scoped AndroidX message listener and rejects iframe calls; unsupported WebView versions fall
back to ordinary web pointer events. Local `file:///android_asset/` pages and
`https://appassets.androidplatform.net` are trusted by default. DOM storage is disabled unless the
owner opts in with `setDomStorageEnabled(true)`, and the exposed `webView` is a restricted controller
that preserves the SDK's navigation policy.

---

## 4. Hardware EPD Routing

The SDK compiles against the Onyx Pen SDK for typed raw-input callbacks but declares it
`compileOnly`; BOOX applications opt into the vendor runtime as shown in the Android README.
Consumers should review that dependency's terms and security posture before distribution. Without
it, and on other manufacturers, capability probing selects the Android fallback instead of
advertising unavailable acceleration.

```gradle
dependencies {
    runtimeOnly "com.onyx.android.sdk:onyxsdk-pen:1.5.4"
}
```

`EpdAdapterManager` probes ordered candidates and keeps only an adapter that initializes
successfully. On BOOX hardware, the Onyx adapter is eligible only when the application supplies the
matching runtime dependency. Missing classes, probe failures, and initialization errors are reported
and fall through to Jetpack motion prediction or the Canvas adapter.

---

## 5. View Lifecycle & E-Ink Flicker Prevention

Both custom views bind hardware resources when attached and release active strokes, raw-drawing
state, and adapter resources when detached. Applications do not need to duplicate those window
callbacks.

`release()` releases hardware resources but does not destroy the view; it can bind again after a
later attachment. `OpenInkBridgeWebView.destroy()` is terminal: it removes the message listener,
tears down the embedded WebView, and releases all native resources. Call `destroy()` only from the
owning Activity or Fragment's final teardown, not during an ordinary detach/reattach cycle.

---

## 6. Hardware Touch Handoff & Focus Management

BOOX raw-drawing mode can interfere with normal Android updates outside the active ink region, so the SDK scopes that mode to drawing interactions.

To ensure non-direct drawing areas (such as traditional whiteboard canvases or native UI toolbars) update smoothly in real time:

1. **`dispatchTouchEvent` Auto-Handoff:** `OpenInkBridgeWebView` automatically checks `ACTION_DOWN` coordinates. When a touch begins outside the low-latency canvas, hardware raw drawing is paused (`setRawDrawingEnabled(false)`), allowing normal Android view updates and EPD screen refreshes to proceed without lag.
2. **Re-Enabling Direct Mode:** When a touch begins inside `OpenInkBridgeView` or `OpenInkBridgeOverlayCanvas`, direct hardware raw drawing is immediately re-enabled.

---

## 7. Optional Rust/JNI Smoothing

The clean checkout does not ship a native `.so`; Android therefore uses the Kotlin implementation
of the shared `0.25 / 0.50 / 0.25` smoothing contract by default. If an application packages a
generated library for the device ABI, `CoreBridge` attempts JNI first and falls back to Kotlin when
the library is absent, fails to load, or throws while processing a stroke. JNI exposes smoothing,
not the separate Rust RDP simplifier.

To generate the optional arm64 library:

1. Install the Android NDK target in Rust:
   ```bash
   rustup target add aarch64-linux-android
   ```
2. Install `cargo-ndk`:
   ```bash
   cargo install cargo-ndk
   ```
3. Build from the repository's `core/` directory:
   ```bash
   cd core
   cargo ndk -t arm64-v8a -p 21 -- build --release --features android
   ```
4. Copy `../target/aarch64-linux-android/release/libopeninkbridge_core.so` to
   `../android/openinkbridge-sdk/src/main/jniLibs/arm64-v8a/` before building the AAR.

The repository verification scripts do not generate or package this optional artifact.

---

## 8. Verification

From `android/`, with JDK 17 and an Android SDK configured:

```bash
./gradlew --no-daemon testDebugUnitTest lintDebug assembleDebug
```

