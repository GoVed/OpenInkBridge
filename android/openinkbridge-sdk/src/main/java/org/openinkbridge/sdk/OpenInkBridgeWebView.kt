package org.openinkbridge.sdk

import android.content.Context
import android.graphics.Color
import android.util.AttributeSet
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import org.json.JSONArray
import org.json.JSONObject

class OpenInkBridgeWebView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : FrameLayout(context, attrs, defStyleAttr) {

    val webView = WebView(context)
    private var overlayCanvas: OpenInkBridgeOverlayCanvas? = null
    private val epdAdapterManager: EpdAdapterManager

    init {
        addView(webView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        epdAdapterManager = EpdAdapterManager(this)

        webView.settings.javaScriptEnabled = true
        webView.settings.cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
        webView.settings.userAgentString = webView.settings.userAgentString + " OpenInkBridge/" + android.os.Build.BRAND + " " + android.os.Build.MANUFACTURER
        webView.addJavascriptInterface(OpenInkBridgeJSInterface(), "OpenInkBridgeNative")
        
        webView.webChromeClient = object : android.webkit.WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: android.webkit.ConsoleMessage?): Boolean {
                consoleMessage?.let {
                    android.util.Log.d("OpenInkBridge", "[JS CONSOLE] ${it.message()} -- From line ${it.lineNumber()} of ${it.sourceId()}")
                }
                return true
            }
        }
    }

    inner class OpenInkBridgeJSInterface {
        @JavascriptInterface
        fun setWritingMode(enabled: Boolean, optionsJson: String) {
            post {
                if (enabled) {
                    val color = parseColor(optionsJson)
                    val width = parseWidth(optionsJson)
                    
                    var rectObj: JSONObject? = null
                    var stylusOnly = true
                    try {
                        val obj = JSONObject(optionsJson)
                        rectObj = obj.optJSONObject("rect")
                        stylusOnly = obj.optBoolean("stylusOnly", true)
                    } catch (e: Exception) {}
                    
                    enableOverlay(color, width, rectObj, stylusOnly)
                } else {
                    disableOverlay()
                }
            }
        }

        @JavascriptInterface
        fun onStrokeDrawn() {
            post {
                epdAdapterManager.activeAdapter.clearHardwareScribble()
            }
        }
    }

    private fun enableOverlay(color: Int, width: Float, rectObj: JSONObject?, stylusOnly: Boolean) {
        if (overlayCanvas == null) {
            overlayCanvas = OpenInkBridgeOverlayCanvas(context, epdAdapterManager).apply {
                onStrokeCompleted = { strokePoints ->
                    val jsonStr = strokePointsToJson(strokePoints)
                    // Call the global web app hook with the stroke points JSON
                    webView.evaluateJavascript("if (window.onOpenInkBridgeStrokeFinished) { window.onOpenInkBridgeStrokeFinished('$jsonStr'); }", null)
                    
                    // Clear overlay after handing points off to the WebView
                    post {
                        overlayCanvas?.invalidate()
                    }
                }
            }
            addView(overlayCanvas)
        }
        
        // Size and position native overlay to match target web element bounding client rect
        if (rectObj != null) {
            val left = rectObj.optDouble("left", 0.0).toFloat()
            val top = rectObj.optDouble("top", 0.0).toFloat()
            val w = rectObj.optDouble("width", 0.0).toFloat()
            val h = rectObj.optDouble("height", 0.0).toFloat()
            
            val density = context.resources.displayMetrics.density
            val lp = LayoutParams((w * density).toInt(), (h * density).toInt()).apply {
                leftMargin = (left * density).toInt()
                topMargin = (top * density).toInt()
            }
            overlayCanvas?.layoutParams = lp
            
            val limitRect = android.graphics.Rect(
                lp.leftMargin,
                lp.topMargin,
                lp.leftMargin + lp.width,
                lp.topMargin + lp.height
            )
            epdAdapterManager.activeAdapter.setDrawingLimit(limitRect)
        } else {
            overlayCanvas?.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
            epdAdapterManager.activeAdapter.setDrawingLimit(null)
        }
        
        overlayCanvas?.setStylusOnly(stylusOnly)
        overlayCanvas?.configureStroke(color, width)
        overlayCanvas?.visibility = VISIBLE
        overlayCanvas?.bringToFront()
    }

    private fun disableOverlay() {
        overlayCanvas?.visibility = GONE
        epdAdapterManager.activeAdapter.setDrawingLimit(null)
    }

    private fun parseColor(optionsJson: String): Int {
        return try {
            val obj = JSONObject(optionsJson)
            val colorStr = obj.optString("color", "#000000")
            Color.parseColor(colorStr)
        } catch (e: Exception) {
            Color.BLACK
        }
    }

    private fun parseWidth(optionsJson: String): Float {
        return try {
            val obj = JSONObject(optionsJson)
            obj.optDouble("width", 5.0).toFloat()
        } catch (e: Exception) {
            5f
        }
    }

    private fun strokePointsToJson(points: List<PenPoint>): String {
        val density = context.resources.displayMetrics.density
        val lp = overlayCanvas?.layoutParams as? FrameLayout.LayoutParams
        val leftMargin = lp?.leftMargin ?: 0
        val topMargin = lp?.topMargin ?: 0

        val array = JSONArray()
        for (p in points) {
            // Convert WebView-relative physical coordinates to canvas-local coordinates (in CSS pixels)
            val localX = p.x - leftMargin
            val localY = p.y - topMargin

            // Apply a minor 2.0 CSS pixels (approx. 4 physical pixels) calibration offset
            // to correct for the WebView layout/scrollbar viewport rendering shift.
            val docX = (localX / density) - 2.0f
            val docY = (localY / density) - 2.0f

            val obj = JSONObject().apply {
                put("x", docX.toDouble())
                put("y", docY.toDouble())
                put("pressure", p.pressure.toDouble())
                put("tilt", p.tilt.toDouble())
                put("timestamp", p.timestamp)
            }
            array.put(obj)
        }
        return array.toString()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
    }

    override fun onDetachedFromWindow() {
        // Auto-release E-Ink screen direct rendering updates on detaching
        epdAdapterManager.activeAdapter.endStroke()
        epdAdapterManager.release()
        super.onDetachedFromWindow()
    }

    fun release() {
        epdAdapterManager.release()
    }
}
