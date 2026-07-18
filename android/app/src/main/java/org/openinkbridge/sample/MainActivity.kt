package org.openinkbridge.sample

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.os.Bundle
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.openinkbridge.sdk.OpenInkBridgeView
import org.openinkbridge.sdk.OpenInkBridgeWebView
import org.openinkbridge.sdk.PenPoint

class MainActivity : AppCompatActivity() {

    private lateinit var container: FrameLayout
    private var nativeViewOpt: OpenInkBridgeView? = null
    private var nativeViewTrad: TraditionalDrawingView? = null
    private var webView: OpenInkBridgeWebView? = null
    
    private var isWebViewMode = false
    private var currentColor = Color.BLACK
    private var currentWidth = 5f
    private var isStylusOnlyMode = true

    override fun onCreate(savedInstanceState: Bundle?) {
        // Bypass Android's non-SDK/hidden API restrictions so Onyx SDK reflection succeeds.
        // Uses double-reflection: ask Class.getDeclaredMethod for VMRuntime via Class itself
        // (the JVM sees the caller as java.lang.Class, which is exempt from hidden-api checks).
        try {
            // Step 1: get getDeclaredMethod itself via a Class object so the caller is java.lang.Class
            val classClass = Class::class.java
            val getDeclaredMethod = classClass.getMethod(
                "getDeclaredMethod", String::class.java, arrayOf<Class<*>>()::class.java
            )
            // Step 2: use it to look up VMRuntime.getRuntime() without triggering hidden-api check
            val vmRuntimeClass = Class.forName("dalvik.system.VMRuntime")
            val getRuntime = getDeclaredMethod.invoke(
                vmRuntimeClass, "getRuntime", emptyArray<Class<*>>()
            ) as java.lang.reflect.Method
            getRuntime.isAccessible = true
            val vmRuntime = getRuntime.invoke(null)
            // Step 3: look up setHiddenApiExemptions(String[]) and invoke it
            val setExemptions = getDeclaredMethod.invoke(
                vmRuntimeClass, "setHiddenApiExemptions", arrayOf(Array<String>::class.java)
            ) as java.lang.reflect.Method
            setExemptions.isAccessible = true
            // setHiddenApiExemptions takes a single String[] argument.
            // Kotlin spreads arrays in varargs, so we explicitly box it as Any? to prevent that.
            val prefixes: Array<String> = arrayOf("L")
            setExemptions.invoke(vmRuntime, prefixes as Any?)
            android.util.Log.i("OpenInkBridge", "Hidden API bypass succeeded")
        } catch (e: Exception) {
            android.util.Log.w("OpenInkBridge", "Hidden API bypass failed: ${e.message}")
        }

        super.onCreate(savedInstanceState)
        
        // Force window boundaries to match the physical screen permanently, preventing E-Ink scribble bar toggles from resizing the window
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS)

        setContentView(R.layout.activity_main)

        container = findViewById(R.id.canvasContainer)

        setupToolbar()
        showNativeCanvas()
        
        // Inspect TouchHelper
        inspectOnyxClassesViaReflection()
        
        // Inspect TouchPoint class to see all available coordinate methods
        try {
            val touchPointClass = Class.forName("com.onyx.android.sdk.data.note.TouchPoint")
            android.util.Log.i("OpenInkBridge", "--- TouchPoint Class Inspection ---")
            for (field in touchPointClass.declaredFields) {
                android.util.Log.i("OpenInkBridge", "Field: $field")
            }
            for (method in touchPointClass.declaredMethods) {
                android.util.Log.i("OpenInkBridge", "Method: $method")
            }
        } catch (e: Exception) {
            android.util.Log.w("OpenInkBridge", "Failed to inspect TouchPoint: ${e.message}")
        }
    }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.action == MotionEvent.ACTION_DOWN) {
            nativeViewOpt?.let { optView ->
                val loc = IntArray(2)
                optView.getLocationOnScreen(loc)
                val rect = android.graphics.Rect(loc[0], loc[1], loc[0] + optView.width, loc[1] + optView.height)
                val isInsideOpt = rect.contains(ev.rawX.toInt(), ev.rawY.toInt())
                
                android.util.Log.d("OpenInkBridge", "[MAIN_DISPATCH] ACTION_DOWN raw(${ev.rawX}, ${ev.rawY}) isInsideOpt=$isInsideOpt rect=$rect")
                if (isInsideOpt) {
                    optView.setRawDrawingEnabled(true)
                } else {
                    optView.setRawDrawingEnabled(false)
                }
            }
        }
        return super.dispatchTouchEvent(ev)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            logGeometry()
            container.postDelayed({ logGeometry() }, 2000)
        }
    }

    private fun logGeometry() {
        val displayMetrics = resources.displayMetrics
        val screenWidth = displayMetrics.widthPixels
        val screenHeight = displayMetrics.heightPixels
        
        val decorView = window.decorView
        val decorLoc = IntArray(2)
        decorView.getLocationOnScreen(decorLoc)
        
        val contentView = findViewById<View>(android.R.id.content)
        val contentLoc = IntArray(2)
        contentView.getLocationOnScreen(contentLoc)
        
        val containerLoc = IntArray(2)
        container.getLocationOnScreen(containerLoc)
        
        val viewLocScreen = IntArray(2)
        val viewLocWindow = IntArray(2)
        nativeViewOpt?.getLocationOnScreen(viewLocScreen)
        nativeViewOpt?.getLocationInWindow(viewLocWindow)
        
        val resourceId = resources.getIdentifier("status_bar_height", "dimen", "android")
        val statusBarHeight = if (resourceId > 0) resources.getDimensionPixelSize(resourceId) else 0
        
        val navResourceId = resources.getIdentifier("navigation_bar_height", "dimen", "android")
        val navBarHeight = if (navResourceId > 0) resources.getDimensionPixelSize(navResourceId) else 0
        
        android.util.Log.i("OpenInkBridge", "=== GEOMETRY LOG ===")
        android.util.Log.i("OpenInkBridge", "Screen: ${screenWidth}x${screenHeight}")
        android.util.Log.i("OpenInkBridge", "StatusBar Height: $statusBarHeight")
        android.util.Log.i("OpenInkBridge", "NavigationBar Height: $navBarHeight")
        android.util.Log.i("OpenInkBridge", "DecorView: ${decorView.width}x${decorView.height} at Screen(${decorLoc[0]}, ${decorLoc[1]})")
        android.util.Log.i("OpenInkBridge", "ContentView: ${contentView.width}x${contentView.height} at Screen(${contentLoc[0]}, ${contentLoc[1]})")
        android.util.Log.i("OpenInkBridge", "Container: ${container.width}x${container.height} at Screen(${containerLoc[0]}, ${containerLoc[1]})")
        android.util.Log.i("OpenInkBridge", "OpenInkBridgeView: ${nativeViewOpt?.width}x${nativeViewOpt?.height} at Screen(${viewLocScreen[0]}, ${viewLocScreen[1]}) Window(${viewLocWindow[0]}, ${viewLocWindow[1]})")
        android.util.Log.i("OpenInkBridge", "====================")
    }

    private fun setupToolbar() {
        val btnToggle = findViewById<Button>(R.id.btnToggleMode)
        val btnClear = findViewById<Button>(R.id.btnClear)
        
        val colorBlack = findViewById<View>(R.id.btnColorBlack)
        val colorRed = findViewById<View>(R.id.btnColorRed)
        val colorBlue = findViewById<View>(R.id.btnColorBlue)
        
        val widthThin = findViewById<Button>(R.id.btnWidthThin)
        val widthMedium = findViewById<Button>(R.id.btnWidthMedium)
        val widthThick = findViewById<Button>(R.id.btnWidthThick)
        val chkStylusOnly = findViewById<CheckBox>(R.id.chkStylusOnly)

        // Set default value based on e-ink device compatibility
        val manufacturer = android.os.Build.MANUFACTURER.lowercase()
        val brand = android.os.Build.BRAND.lowercase()
        val isCompatibleDevice = manufacturer.contains("onyx") || brand.contains("onyx") ||
                                 manufacturer.contains("bigme") || brand.contains("bigme")
        
        isStylusOnlyMode = isCompatibleDevice
        chkStylusOnly.isChecked = isStylusOnlyMode

        chkStylusOnly.setOnCheckedChangeListener { _, isChecked ->
            isStylusOnlyMode = isChecked
            nativeViewOpt?.setStylusOnly(isStylusOnlyMode)
            if (isWebViewMode) {
                // If in WebView mode, inject JS to toggle the web toggle checkbox
                webView?.webView?.evaluateJavascript(
                    "const chk = document.getElementById('chk-stylus-only'); if (chk && chk.checked !== $isChecked) { chk.checked = $isChecked; chk.dispatchEvent(new Event('change')); }",
                    null
                )
            }
        }

        btnToggle.setOnClickListener {
            isWebViewMode = !isWebViewMode
            if (isWebViewMode) {
                btnToggle.text = "Switch to Native Mode"
                showWebViewCanvas()
            } else {
                btnToggle.text = "Switch to WebView Mode"
                showNativeCanvas()
            }
        }

        btnClear.setOnClickListener {
            nativeViewOpt?.clear()
            nativeViewTrad?.clear()
            if (isWebViewMode) {
                webView?.webView?.evaluateJavascript("if (window.onClearCanvas) { window.onClearCanvas(); }", null)
            }
        }

        colorBlack.setOnClickListener { updateColor(Color.BLACK) }
        colorRed.setOnClickListener { updateColor(Color.RED) }
        colorBlue.setOnClickListener { updateColor(Color.BLUE) }

        widthThin.setOnClickListener { updateWidth(2f) }
        widthMedium.setOnClickListener { updateWidth(5f) }
        widthThick.setOnClickListener { updateWidth(12f) }
    }

    private fun updateColor(color: Int) {
        currentColor = color
        nativeViewOpt?.setBrushStyle(currentColor, currentWidth)
        nativeViewTrad?.setBrushStyle(currentColor, currentWidth)
    }

    private fun updateWidth(width: Float) {
        currentWidth = width
        nativeViewOpt?.setBrushStyle(currentColor, currentWidth)
        nativeViewTrad?.setBrushStyle(currentColor, currentWidth)
        if (isWebViewMode) {
            webView?.webView?.evaluateJavascript(
                "if (window.setStrokeWidth) { window.setStrokeWidth($currentWidth); }",
                null
            )
        }
    }

    private fun showNativeCanvas() {
        container.removeAllViews()
        webView = null
        
        val horizontalLayout = LinearLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
            setPadding(8, 8, 8, 8)
        }

        // 1. Optimized Panel
        val optPanel = LinearLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
                rightMargin = 8
            }
            orientation = LinearLayout.VERTICAL
        }
        val optTitle = TextView(this).apply {
            text = "Native Canvas (Low-Latency)"
            setTextColor(Color.parseColor("#28a745"))
            textSize = 14f
            gravity = Gravity.CENTER
            setPadding(8, 8, 8, 8)
        }
        nativeViewOpt = OpenInkBridgeView(this).apply {
            setBrushStyle(currentColor, currentWidth)
            setStylusOnly(isStylusOnlyMode)
        }
        optPanel.addView(optTitle)
        optPanel.addView(nativeViewOpt, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT))

        // 2. Traditional Panel
        val tradPanel = LinearLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
                leftMargin = 8
            }
            orientation = LinearLayout.VERTICAL
        }
        val tradTitle = TextView(this).apply {
            text = "Traditional Canvas (Standard)"
            setTextColor(Color.parseColor("#dc3545"))
            textSize = 14f
            gravity = Gravity.CENTER
            setPadding(8, 8, 8, 8)
        }
        nativeViewTrad = TraditionalDrawingView(this).apply {
            setBrushStyle(currentColor, currentWidth)
        }
        tradPanel.addView(tradTitle)
        tradPanel.addView(nativeViewTrad, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT))

        horizontalLayout.addView(optPanel)
        horizontalLayout.addView(tradPanel)
        
        container.addView(horizontalLayout)
    }

    private fun showWebViewCanvas() {
        container.removeAllViews()
        nativeViewOpt = null
        nativeViewTrad = null
        
        webView = OpenInkBridgeWebView(this)
        container.addView(webView)
        
        webView?.webView?.webViewClient = object : android.webkit.WebViewClient() {
            override fun onPageFinished(view: android.webkit.WebView?, url: String?) {
                super.onPageFinished(view, url)
                webView?.webView?.evaluateJavascript(
                    "if (window.setStrokeWidth) { window.setStrokeWidth($currentWidth); }",
                    null
                )
                webView?.webView?.evaluateJavascript(
                    "const chk = document.getElementById('chk-stylus-only'); if (chk && chk.checked !== $isStylusOnlyMode) { chk.checked = $isStylusOnlyMode; chk.dispatchEvent(new Event('change')); }",
                    null
                )
            }
        }
        
        webView?.webView?.loadUrl("file:///android_asset/sample_web_app.html")
    }

    override fun onDestroy() {
        nativeViewOpt?.release()
        webView?.release()
        super.onDestroy()
    }

    private fun inspectOnyxClassesViaReflection() {
        try {
            val helperClass = Class.forName("com.onyx.android.sdk.pen.TouchHelper")
            android.util.Log.i("OpenInkBridge", "=== Fields of TouchHelper ===")
            for (field in helperClass.declaredFields) {
                android.util.Log.i("OpenInkBridge", field.toString())
            }
            android.util.Log.i("OpenInkBridge", "=== Methods of TouchHelper ===")
            for (method in helperClass.declaredMethods) {
                android.util.Log.i("OpenInkBridge", method.toString())
            }
        } catch (e: java.lang.Exception) {
            android.util.Log.e("OpenInkBridge", "Failed to inspect Onyx classes", e)
        }
    }
}

class TraditionalDrawingView(context: Context) : View(context) {
    private var epdClass: Class<*>? = null
    private var epdModeEnumClass: Class<*>? = null
    private var refreshMethod: java.lang.reflect.Method? = null
    private var duMode: Any? = null

    init {
        try {
            epdClass = Class.forName("com.onyx.android.sdk.api.device.epd.EpdController")
            epdModeEnumClass = Class.forName("com.onyx.android.sdk.api.device.epd.UpdateMode")
            @Suppress("UNCHECKED_CAST")
            duMode = java.lang.Enum.valueOf(epdModeEnumClass as Class<out Enum<*>>, "DU")
            
            val applyModeMethod = epdClass?.getMethod("setViewDefaultUpdateMode", View::class.java, epdModeEnumClass)
            applyModeMethod?.invoke(null, this, duMode)
            
            refreshMethod = epdClass?.getMethod("refreshScreen", View::class.java, epdModeEnumClass)
        } catch (e: Exception) {
            android.util.Log.w("OpenInkBridge", "TraditionalDrawingView EpdController setup failed: ${e.message}")
        }
    }

    private fun refreshEpd() {
        try {
            val applyModeMethod = epdClass?.getMethod("setViewDefaultUpdateMode", View::class.java, epdModeEnumClass)
            applyModeMethod?.invoke(null, this, duMode)
            refreshMethod?.invoke(null, this, duMode)
        } catch (e: Exception) {}
    }

    private val strokes = mutableListOf<MutableList<PenPoint>>()
    private var currentStroke = mutableListOf<PenPoint>()
    private var baseWidth = 5f
    private val paint = Paint().apply {
        color = Color.RED
        strokeWidth = 5f
        style = Paint.Style.STROKE
        strokeJoin = Paint.Join.ROUND
        strokeCap = Paint.Cap.ROUND
        isAntiAlias = true
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val pt = PenPoint(
            x = event.x,
            y = event.y,
            pressure = event.pressure,
            tilt = event.getAxisValue(MotionEvent.AXIS_TILT),
            timestamp = event.eventTime
        )
        when (event.action) {
            MotionEvent.ACTION_DOWN -> {
                currentStroke = mutableListOf()
                currentStroke.add(pt)
                strokes.add(currentStroke)
            }
            MotionEvent.ACTION_MOVE -> {
                currentStroke.add(pt)
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                currentStroke.add(pt)
            }
        }
        invalidate()
        refreshEpd()
        return true
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        for (stroke in strokes) {
            if (stroke.size < 2) continue
            for (i in 0 until stroke.size - 1) {
                val p1 = stroke[i]
                val p2 = stroke[i + 1]
                val avgPressure = (p1.pressure + p2.pressure) / 2f
                val width = baseWidth * (0.6f + 0.8f * avgPressure)
                paint.strokeWidth = width
                canvas.drawLine(p1.x, p1.y, p2.x, p2.y, paint)
            }
        }
    }

    fun clear() {
        strokes.clear()
        currentStroke.clear()
        invalidate()
        refreshEpd()
    }
    
    fun setBrushStyle(color: Int, width: Float) {
        paint.color = color
        baseWidth = width
        invalidate()
        refreshEpd()
    }
}
