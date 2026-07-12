# OpenInkBridge Android SDK

A unified, low-latency E-Ink drawing library for Android, featuring dynamic EPD display updates, raw stylus event intercepting, and optimized native stroke smoothing via JNI.

## Directory Structure

* **[`openinkbridge-sdk/`](./openinkbridge-sdk)**: The main Android Archive (AAR) library module containing drawing views, WebView wrappers, and JNI bridges.
* **`build.gradle` & `settings.gradle`**: Standard root Gradle configuration to import the SDK.

---

## 1. Quick Integration

### Standalone Native Canvas View

To add a low-latency drawing canvas to a native Android app, simply add `OpenInkBridgeView` to your layout:

```xml
<org.openinkbridge.sdk.OpenInkBridgeView
    android:id="@+id/openInkBridgeCanvas"
    android:layout_width="match_parent"
    android:layout_height="match_parent" />
```

Then configure the drawing callback and brush style inside your Activity:

```kotlin
import org.openinkbridge.sdk.OpenInkBridgeView
import android.graphics.Color

class DrawingActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState: Bundle?)
        setContentView(R.layout.activity_drawing)

        val canvasView = findViewById<OpenInkBridgeView>(R.id.openInkBridgeCanvas)
        
        // 1. Setup brush size (width in pixels) and color
        canvasView.setBrushStyle(Color.BLACK, 6.0f)

        // 2. Receive finalized vector strokes (e.g. to save to a database)
        canvasView.setOnStrokeListener { strokePoints ->
            Log.d("OpenInkBridge", "User drew a stroke containing ${strokePoints.size} coordinates.")
        }
    }
}
```

### Hybrid WebView Container

If you are loading a WebApp (written in React/Vue/HTML5 Canvas) and want E-Ink low-latency drawing, use `OpenInkBridgeWebView`:

```xml
<org.openinkbridge.sdk.OpenInkBridgeWebView
    android:id="@+id/openInkBridgeWebView"
    android:layout_width="match_parent"
    android:layout_height="match_parent" />
```

```kotlin
val webViewContainer = findViewById<OpenInkBridgeWebView>(R.id.openInkBridgeWebView)

// Load your local or remote WebApp
webViewContainer.webView.loadUrl("https://my-drawing-webapp.com")
```

---

## 2. Compiling the Rust Core for Android (JNI)

The library relies on an optimized Rust library for stroke smoothing. JNI libraries can be compiled for Android using `cargo-ndk`.

### Prerequisites

1. Install the Rust compiler:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
2. Install the Android NDK compile targets:
   ```bash
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```
3. Install the compilation helper tool:
   ```bash
   cargo install cargo-ndk
   ```

### Compilation

From the repository root, run the compile script to build and copy the compiled `.so` binaries directly into the Android library module's `jniLibs` folder:

```bash
# Navigate to core
cd ../core

# Compile arm64 binary
cargo ndk -t arm64-v8a -p 21 -- build --release --features android

# Create JNI directory in Android SDK if it doesn't exist
mkdir -p ../android/openinkbridge-sdk/src/main/jniLibs/arm64-v8a

# Copy output binary
cp target/aarch64-linux-android/release/libopeninkbridge_core.so ../android/openinkbridge-sdk/src/main/jniLibs/arm64-v8a/
```

*Note: If the native shared library `.so` file is omitted, the SDK will automatically fallback to high-reliability Kotlin implementations of the stroke-smoothing algorithm, ensuring the application does not crash.*

---

## 3. Sample Application (`app`)

We provide a fully functional sample application inside the [`app/`](./app) folder. It showcases:
* **Dual canvas rendering**: instantly toggle between the native drawing canvas (`OpenInkBridgeView`) and the hybrid webview canvas (`OpenInkBridgeWebView`).
* **Interactive brush styling**: change color (Black, Red, Blue) and width (Thin, Medium, Thick).
* **E-Ink direct-draw safety**: releases display locks immediately when views are detached or hidden.

To compile and run the sample application on your device:
1. Open the `android/` directory in Android Studio.
2. Select the `app` run configuration.
3. Deploy to your connected Android tablet or Onyx Boox/Bigme device.
