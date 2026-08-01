package org.openinkbridge.sdk

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.util.AttributeSet
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject

enum class UntrustedNavigationPolicy {
    /** Reject top-level navigation outside the configured trusted origins. */
    BLOCK,

    /** Permit navigation, but remove and disable the native JavaScript bridge. */
    ALLOW_WITHOUT_NATIVE_BRIDGE
}

/** Narrow WebView facade that keeps OpenInkBridge's mandatory navigation policy installed. */
class OpenInkBridgeWebViewController internal constructor(private val delegate: WebView) {
    val url: String?
        get() = delegate.url

    fun loadUrl(url: String) {
        delegate.loadUrl(url)
    }

    fun reload() {
        delegate.reload()
    }

    fun stopLoading() {
        delegate.stopLoading()
    }

    fun canGoBack(): Boolean = delegate.canGoBack()

    fun goBack() {
        delegate.goBack()
    }

    fun evaluateJavascript(script: String, callback: ((String?) -> Unit)? = null) {
        delegate.evaluateJavascript(script) { result -> callback?.invoke(result) }
    }
}

class OpenInkBridgeWebView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : FrameLayout(context, attrs, defStyleAttr) {

    private inner class PolicyAwareWebView(context: Context) : WebView(context) {
        override fun loadUrl(url: String) {
            if (prepareMainFrameNavigation(url, "application loadUrl")) {
                super.loadUrl(url)
            }
        }

        override fun postUrl(url: String, postData: ByteArray) {
            if (prepareMainFrameNavigation(url, "application postUrl")) {
                super.postUrl(url, postData)
            }
        }
    }

    private val platformWebView: WebView = PolicyAwareWebView(context)
    val webView = OpenInkBridgeWebViewController(platformWebView)
    private var overlayCanvas: OpenInkBridgeOverlayCanvas? = null
    private val epdAdapterManager: EpdAdapterManager
    private val trustedOrigins = linkedSetOf(
        LOCAL_ASSET_ORIGIN,
        "https://appassets.androidplatform.net"
    )

    @Volatile
    private var currentDocumentTrusted = false
    private var bridgeTransportRegistered = false
    private var onTrustedPageFinished: ((OpenInkBridgeWebViewController, String?) -> Unit)? = null
    private var activeRoute: BridgeSessionRoute? = null
    private var destroyed = false

    var untrustedNavigationPolicy: UntrustedNavigationPolicy = UntrustedNavigationPolicy.BLOCK

    private var overlayLeftPx = 0f
    private var overlayTopPx = 0f

    init {
        addView(platformWebView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        epdAdapterManager = EpdAdapterManager(this)

        configureSafeWebSettings()
        platformWebView.webViewClient = createTrustEnforcingWebViewClient()
        configureBridgeTransport()
        platformWebView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                consoleMessage?.let {
                    OpenInkBridgeLogger.d(
                        Subsystem.JsBridge,
                        "WebView",
                        "JS_CONSOLE",
                        "${it.message()} -- From line ${it.lineNumber()} of ${it.sourceId()}"
                    )
                }
                return true
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureSafeWebSettings() {
        platformWebView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = false
            useWideViewPort = true
            loadWithOverviewMode = true
            cacheMode = WebSettings.LOAD_NO_CACHE
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            allowContentAccess = false

            // Existing SDK samples use file:///android_asset. Top-level navigation is restricted
            // to that directory and cross-origin access from file pages remains disabled.
            allowFileAccess = true
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = false
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = false

            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = true
            setGeolocationEnabled(false)
            @Suppress("DEPRECATION")
            saveFormData = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                safeBrowsingEnabled = true
            }

            userAgentString = "$userAgentString OpenInkBridge/${BuildConfig.SDK_VERSION} ${Build.BRAND} ${Build.MANUFACTURER}"
        }
    }

    private fun createTrustEnforcingWebViewClient(): WebViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame) return false
            return !prepareMainFrameNavigation(request.url.toString(), "WebView navigation")
        }

        @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
        override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
            return !prepareMainFrameNavigation(url, "WebView navigation")
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            super.onPageStarted(view, url, favicon)
            val trusted = url?.let(::isTrustedUrl) == true
            currentDocumentTrusted = trusted

            if (!trusted && untrustedNavigationPolicy == UntrustedNavigationPolicy.BLOCK) {
                view.stopLoading()
                OpenInkBridgeLogger.w(
                    Subsystem.JsBridge,
                    "WebView",
                    "UNTRUSTED_NAVIGATION_STOPPED",
                    "Stopped an untrusted top-level navigation to ${url ?: "unknown URL"}"
                )
            }
        }

        override fun onPageFinished(view: WebView, url: String?) {
            super.onPageFinished(view, url)
            currentDocumentTrusted = url?.let(::isTrustedUrl) == true
            if (currentDocumentTrusted) {
                onTrustedPageFinished?.invoke(webView, url)
            }
        }
    }

    /** Replace the complete set of origins allowed to use the native bridge. */
    fun setTrustedOrigins(origins: Collection<String>) {
        val normalized = origins.map(::normalizeTrustedOrigin).toCollection(linkedSetOf())
        trustedOrigins.clear()
        trustedOrigins.addAll(normalized)
        configureBridgeTransport()
        enforceTrustForCurrentDocument()
    }

    /** Add an HTTP(S) origin or the special file:///android_asset origin. */
    fun addTrustedOrigin(origin: String) {
        trustedOrigins.add(normalizeTrustedOrigin(origin))
        configureBridgeTransport()
        enforceTrustForCurrentDocument()
    }

    fun removeTrustedOrigin(origin: String) {
        trustedOrigins.remove(normalizeTrustedOrigin(origin))
        configureBridgeTransport()
        enforceTrustForCurrentDocument()
    }

    fun getTrustedOrigins(): Set<String> = trustedOrigins.toSet()

    /** DOM storage is disabled by default; applications can opt in for trusted content that needs it. */
    fun setDomStorageEnabled(enabled: Boolean) {
        platformWebView.settings.domStorageEnabled = enabled
    }

    /** Observe trusted page completion without replacing the trust-enforcing WebViewClient. */
    fun setOnTrustedPageFinishedListener(listener: ((OpenInkBridgeWebViewController, String?) -> Unit)?) {
        onTrustedPageFinished = listener
    }

    private fun enforceTrustForCurrentDocument() {
        val trusted = platformWebView.url?.let(::isTrustedUrl) == true
        currentDocumentTrusted = trusted
    }

    private fun prepareMainFrameNavigation(url: String, source: String): Boolean {
        if (isTrustedUrl(url)) {
            return true
        }

        if (untrustedNavigationPolicy == UntrustedNavigationPolicy.ALLOW_WITHOUT_NATIVE_BRIDGE) {
            currentDocumentTrusted = false
            OpenInkBridgeLogger.w(
                Subsystem.JsBridge,
                "WebView",
                "UNTRUSTED_NAVIGATION_WITHOUT_BRIDGE",
                "Allowing untrusted navigation without the native bridge: $url",
                mapOf("source" to source)
            )
            return true
        }

        OpenInkBridgeLogger.w(
            Subsystem.JsBridge,
            "WebView",
            "UNTRUSTED_NAVIGATION_BLOCKED",
            "Blocked untrusted top-level navigation to $url",
            mapOf("source" to source)
        )
        return false
    }

    private fun normalizeTrustedOrigin(value: String): String {
        val raw = value.trim()
        val uri = Uri.parse(raw)
        val scheme = uri.scheme?.lowercase()

        if ((scheme == "file" && uri.path?.startsWith("/android_asset/") == true) || raw == LOCAL_ASSET_ORIGIN) {
            return LOCAL_ASSET_ORIGIN
        }
        require(scheme == "https") {
            "Trusted origins must use HTTPS or file:///android_asset"
        }
        val host = requireNotNull(uri.host) { "Trusted origin must include a host" }.lowercase()
        val defaultPort = scheme == "https" && uri.port == 443
        val port = if (uri.port == -1 || defaultPort) "" else ":${uri.port}"
        return "$scheme://$host$port"
    }

    private fun isTrustedUrl(value: String): Boolean {
        val uri = runCatching { Uri.parse(value) }.getOrNull() ?: return false
        return when (uri.scheme?.lowercase()) {
            "file" -> uri.path?.startsWith("/android_asset/") == true && LOCAL_ASSET_ORIGIN in trustedOrigins
            "https" -> runCatching { normalizeTrustedOrigin(value) }
                .getOrNull()
                ?.let(trustedOrigins::contains) == true
            else -> false
        }
    }

    @SuppressLint("RequiresFeature")
    private fun configureBridgeTransport() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            OpenInkBridgeLogger.w(
                Subsystem.JsBridge,
                "WebView",
                "ORIGIN_SCOPED_BRIDGE_UNAVAILABLE",
                "This WebView does not support origin-scoped messaging; native bridging is disabled"
            )
            return
        }

        if (bridgeTransportRegistered) {
            WebViewCompat.removeWebMessageListener(platformWebView, JS_INTERFACE_NAME)
        }
        val allowedRules = trustedOrigins.mapTo(linkedSetOf()) { origin ->
            if (origin == LOCAL_ASSET_ORIGIN) "file://" else origin
        }
        WebViewCompat.addWebMessageListener(
            platformWebView,
            JS_INTERFACE_NAME,
            allowedRules
        ) { _, message, sourceOrigin, isMainFrame, _ ->
            handleBridgeMessage(message.data, sourceOrigin, isMainFrame)
        }
        bridgeTransportRegistered = true
    }

    private fun handleBridgeMessage(message: String?, sourceOrigin: Uri, isMainFrame: Boolean) {
        if (!isMainFrame || !isTrustedMessageOrigin(sourceOrigin)) {
            OpenInkBridgeLogger.w(
                Subsystem.JsBridge,
                "WebView",
                "BRIDGE_MESSAGE_REJECTED",
                "Rejected bridge message from origin=$sourceOrigin mainFrame=$isMainFrame"
            )
            return
        }

        val command = message?.let(BridgeProtocol::parseCommand)
        if (command == null) {
            OpenInkBridgeLogger.w(
                Subsystem.JsBridge,
                "WebView",
                "INVALID_BRIDGE_MESSAGE",
                "Rejected malformed or unsupported bridge protocol message"
            )
            return
        }

        when (command) {
            is SetWritingModeCommand -> {
                if (command.enabled) {
                    activeRoute = command.route
                    val color = runCatching { Color.parseColor(command.color) }.getOrDefault(Color.BLACK)
                    enableOverlay(color, command.width, command.rect, command.stylusOnly, command.route)
                } else if (activeRoute == command.route) {
                    activeRoute = null
                    disableOverlay()
                }
            }
            is StrokeDrawnCommand -> epdAdapterManager.activeAdapter.clearHardwareScribble()
        }
    }

    private fun isTrustedMessageOrigin(origin: Uri): Boolean {
        val raw = origin.toString()
        val scheme = origin.scheme?.lowercase()
        if (raw == "null" || raw.isEmpty() || scheme == "file" || scheme == null) {
            return LOCAL_ASSET_ORIGIN in trustedOrigins
        }
        return when (scheme) {
            "https" -> runCatching { normalizeTrustedOrigin(raw) }
                .getOrNull()
                ?.let(trustedOrigins::contains) == true
            else -> false
        }
    }

    private fun enableOverlay(
        color: Int,
        width: Float,
        rect: BridgeRect?,
        stylusOnly: Boolean,
        route: BridgeSessionRoute
    ) {
        if (overlayCanvas == null) {
            overlayCanvas = OpenInkBridgeOverlayCanvas(context, epdAdapterManager).apply {
                onStrokeCaptured = strokeCaptured@ { strokePoints, coordinateSpace, capturedRoute ->
                    if (capturedRoute == null) return@strokeCaptured
                    val envelope = BridgeProtocol.strokeFinished(
                        capturedRoute,
                        strokePointsToJson(strokePoints, coordinateSpace)
                    )
                    val quotedEnvelope = JSONObject.quote(envelope)
                    platformWebView.evaluateJavascript(
                        "if (window.onOpenInkBridgeStrokeFinished) { window.onOpenInkBridgeStrokeFinished($quotedEnvelope); }",
                        null
                    )
                    post { overlayCanvas?.invalidate() }
                }
            }
            addView(overlayCanvas)
        }
        overlayCanvas?.configureSessionRoute(route)

        if (rect != null) {
            val density = context.resources.displayMetrics.density
            overlayLeftPx = rect.left * density
            overlayTopPx = rect.top * density

            overlayCanvas?.layoutParams = LayoutParams(
                Math.round(rect.width * density),
                Math.round(rect.height * density)
            ).apply {
                leftMargin = Math.round(overlayLeftPx)
                topMargin = Math.round(overlayTopPx)
            }
        } else {
            overlayLeftPx = 0f
            overlayTopPx = 0f
            overlayCanvas?.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
        }

        overlayCanvas?.setStylusOnly(stylusOnly)
        overlayCanvas?.configureStroke(color, width)
        applyDrawingLimit()
        overlayCanvas?.visibility = VISIBLE
        overlayCanvas?.bringToFront()
    }

    private fun applyDrawingLimit() {
        val params = overlayCanvas?.layoutParams as? LayoutParams
        if (params != null && params.width > 0 && params.height > 0) {
            epdAdapterManager.activeAdapter.setDrawingLimit(
                android.graphics.Rect(
                    params.leftMargin,
                    params.topMargin,
                    params.leftMargin + params.width,
                    params.topMargin + params.height
                )
            )
        } else {
            epdAdapterManager.activeAdapter.setDrawingLimit(null)
        }
    }

    private fun disableOverlay() {
        overlayCanvas?.cancelCurrentStroke()
        overlayCanvas?.configureSessionRoute(null)
        overlayCanvas?.visibility = GONE
        epdAdapterManager.activeAdapter.setRawDrawingEnabled(false)
        epdAdapterManager.activeAdapter.setDrawingLimit(null)
    }

    private fun strokePointsToJson(
        points: List<PenPoint>,
        coordinateSpace: PenPointCoordinateSpace
    ): JSONArray {
        val coordinateContext = OverlayCoordinateContext(
            overlayLeftPx = overlayLeftPx,
            overlayTopPx = overlayTopPx,
            density = context.resources.displayMetrics.density
        )
        val array = JSONArray()
        for (point in points) {
            val webPoint = OverlayCoordinateMapper.toWebCssPoint(point, coordinateSpace, coordinateContext)
            array.put(JSONObject().apply {
                put("x", webPoint.x.toDouble())
                put("y", webPoint.y.toDouble())
                put("pressure", webPoint.pressure.toDouble())
                put("tilt", webPoint.tilt.toDouble())
                put("timestamp", webPoint.timestamp)
            })
        }
        return array
    }

    override fun dispatchTouchEvent(event: android.view.MotionEvent): Boolean {
        if (event.action == android.view.MotionEvent.ACTION_DOWN) {
            overlayCanvas?.let { overlay ->
                if (overlay.visibility == VISIBLE) {
                    val location = IntArray(2)
                    overlay.getLocationOnScreen(location)
                    val rect = android.graphics.Rect(
                        location[0],
                        location[1],
                        location[0] + overlay.width,
                        location[1] + overlay.height
                    )
                    val insideOverlay = rect.contains(event.rawX.toInt(), event.rawY.toInt())
                    epdAdapterManager.activeAdapter.setRawDrawingEnabled(insideOverlay)
                    if (!insideOverlay) {
                        epdAdapterManager.activeAdapter.clearHardwareScribble()
                    }
                }
            }
        }
        return super.dispatchTouchEvent(event)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (destroyed) return
        if (epdAdapterManager.bind()) {
            overlayCanvas?.rebindAdapter()
            if (overlayCanvas?.visibility == VISIBLE) {
                applyDrawingLimit()
            } else {
                epdAdapterManager.activeAdapter.setRawDrawingEnabled(false)
                epdAdapterManager.activeAdapter.setDrawingLimit(null)
            }
        }
    }

    override fun onDetachedFromWindow() {
        overlayCanvas?.cancelCurrentStroke()
        epdAdapterManager.activeAdapter.setRawDrawingEnabled(false)
        epdAdapterManager.activeAdapter.setDrawingLimit(null)
        epdAdapterManager.release()
        super.onDetachedFromWindow()
    }

    /** Release hardware resources. The view can bind again if it is reattached. */
    fun release() {
        epdAdapterManager.release()
    }

    /** Permanently tear down the embedded WebView and all native resources. */
    @SuppressLint("RequiresFeature")
    fun destroy() {
        if (destroyed) return
        destroyed = true
        activeRoute = null
        disableOverlay()
        epdAdapterManager.release()
        onTrustedPageFinished = null
        if (bridgeTransportRegistered &&
            WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
        ) {
            WebViewCompat.removeWebMessageListener(platformWebView, JS_INTERFACE_NAME)
            bridgeTransportRegistered = false
        }
        platformWebView.stopLoading()
        platformWebView.webChromeClient = null
        platformWebView.webViewClient = WebViewClient()
        platformWebView.destroy()
        removeAllViews()
    }

    companion object {
        private const val JS_INTERFACE_NAME = "OpenInkBridgeNative"
        private const val LOCAL_ASSET_ORIGIN = "file:///android_asset"
    }
}
