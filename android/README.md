# OpenInkBridge Android SDK

A low-latency E-Ink drawing library for Android with dynamic EPD updates, raw stylus interception where supported, deterministic Kotlin stroke smoothing, and optional Rust/JNI acceleration.

## Directory Structure

* **[`openinkbridge-sdk/`](./openinkbridge-sdk)**: The main Android Archive (AAR) library module containing drawing views, WebView wrappers, and JNI bridges.
* **`build.gradle` & `settings.gradle`**: Standard root Gradle configuration to import the SDK.

---

## 1. Quick Integration

Onyx acceleration is opt-in so generic Android consumers do not inherit the proprietary vendor
dependency or its transitive networking stack. Add the HTTPS repository with a narrow content
filter and the runtime dependency only in applications that target BOOX hardware:

```groovy
repositories {
    maven {
        url "https://repo.boox.com/repository/maven-public/"
        content {
            includeGroup "com.onyx.android.sdk"
            includeGroup "pub.devrel"
            includeGroup "com.tencent"
            includeGroup "com.jakewharton.hugo.fix"
        }
    }
}

dependencies {
    runtimeOnly "com.onyx.android.sdk:onyxsdk-pen:1.5.4"
}
```

Without this optional runtime, capability probing selects Jetpack motion prediction or the Canvas
fallback. Review the vendor SDK terms and security posture before shipping it.

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
        super.onCreate(savedInstanceState)
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
webViewContainer.addTrustedOrigin("https://my-drawing-webapp.com")
webViewContainer.webView.loadUrl("https://my-drawing-webapp.com")
```

`OpenInkBridgeWebView` blocks untrusted top-level navigation by default and exposes its native
JavaScript bridge only to HTTPS origins configured before navigation. The bridge uses AndroidX's
origin-scoped message listener and accepts main-frame messages only; older WebView builds without
that feature safely use the browser pointer-event fallback. Local `file:///android_asset/` pages
and `https://appassets.androidplatform.net` are trusted by default. If an application intentionally
needs to show other content without native bridge access, set
`untrustedNavigationPolicy = UntrustedNavigationPolicy.ALLOW_WITHOUT_NATIVE_BRIDGE`.
The exposed `webView` property is a restricted navigation/evaluation facade, so applications
cannot accidentally replace the mandatory security client. `release()` frees hardware resources
and permits later reattachment; call terminal `destroy()` from the owning Activity or Fragment's
final teardown. Ordinary detach/reattach cycles are handled automatically.

---

## 2. Optional Rust Core for Android (JNI)

A clean checkout contains no packaged `.so`, so the SDK uses its Kotlin implementation of the
shared `0.25 / 0.50 / 0.25` smoothing contract by default. If an application supplies a generated
library for the current ABI, `CoreBridge` attempts JNI first and falls back to Kotlin on missing,
load, or execution failures. The JNI binding accelerates smoothing only; RDP simplification remains
a separate Rust API.

### Prerequisites

1. Install the Rust compiler:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
2. Install the arm64 Android target:
   ```bash
   rustup target add aarch64-linux-android
   ```
3. Install the compilation helper tool:
   ```bash
   cargo install cargo-ndk
   ```

### Compilation

From the repository root, build the optional arm64 library and copy it into the AAR source tree:

```bash
cd core

# Compile arm64 binary
cargo ndk -t arm64-v8a -p 21 -- build --release --features android

# Create JNI directory in Android SDK if it doesn't exist
mkdir -p ../android/openinkbridge-sdk/src/main/jniLibs/arm64-v8a

# Copy output binary
cp ../target/aarch64-linux-android/release/libopeninkbridge_core.so ../android/openinkbridge-sdk/src/main/jniLibs/arm64-v8a/
```

This artifact is generated locally; the repository and its normal verification scripts do not ship
or build it.

---

## 3. Build and Test

With JDK 17 and an Android SDK configured, run from the repository root:

```bash
cd android
./gradlew --no-daemon testDebugUnitTest lintDebug assembleDebug
```

---

## 4. Sample Application (`app`)

We provide a fully functional sample application inside the [`app/`](./app) folder. It showcases:
* **Dual canvas rendering**: instantly toggle between the native drawing canvas (`OpenInkBridgeView`) and the hybrid webview canvas (`OpenInkBridgeWebView`).
* **Interactive brush styling**: change color (Black, Red, Blue) and width (Thin, Medium, Thick).
* **E-Ink direct-draw safety**: releases display locks on detach and performs final WebView teardown when the Activity is destroyed.

To compile and run the sample application on your device:
1. Open the `android/` directory in Android Studio.
2. Select the `app` run configuration.
3. Deploy to your connected Android tablet or Onyx Boox device. Bigme currently uses the Android
   software fallback because vendor acceleration is not implemented yet.
