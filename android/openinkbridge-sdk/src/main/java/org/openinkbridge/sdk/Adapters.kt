package org.openinkbridge.sdk

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.View
import android.view.MotionEvent
import android.view.SurfaceView
import android.view.SurfaceHolder
import androidx.input.motionprediction.MotionEventPredictor
import com.onyx.android.sdk.pen.RawInputCallback
import com.onyx.android.sdk.pen.TouchHelper
import com.onyx.android.sdk.data.note.TouchPoint as OnyxTouchPoint
import com.onyx.android.sdk.pen.data.TouchPointList as OnyxTouchPointList
import java.lang.reflect.Method

/**
 * Standard Android drawing fallback using standard views and Canvas invalidation.
 */
class FallbackCanvasAdapter : EpdAdapter, EpdAdapterIntrospection {
    private var view: View? = null
    private var adapterState = EpdAdapterState.UNINITIALIZED
    private val paint = Paint().apply {
        color = Color.BLACK
        strokeWidth = 5f
        style = Paint.Style.STROKE
        strokeJoin = Paint.Join.ROUND
        strokeCap = Paint.Cap.ROUND
        isAntiAlias = true
    }
    private val points = mutableListOf<PenPoint>()
    private var baseWidth = 5f

    override fun init(view: View) {
        this.view = view
        adapterState = EpdAdapterState.OPERATIONAL
        OpenInkBridgeLogger.i(
            Subsystem.Backend,
            "FallbackCanvas",
            "INITIALIZED",
            "FallbackCanvasAdapter initialized"
        )
    }

    override fun startStroke(tool: StylusTool, color: Int, width: Float) {
        paint.color = color
        baseWidth = width
        points.clear()
        OpenInkBridgeLogger.d(
            Subsystem.Renderer,
            "FallbackCanvas",
            "START_STROKE",
            "Fallback start stroke tool=$tool width=$width"
        )
    }

    override fun drawPoint(point: PenPoint) {
        points.add(point)
        view?.invalidate()
    }

    override fun endStroke() {
        OpenInkBridgeLogger.d(
            Subsystem.Renderer,
            "FallbackCanvas",
            "END_STROKE",
            "Fallback end stroke points=${points.size}"
        )
    }

    override fun clear() {
        points.clear()
        view?.invalidate()
    }

    override fun triggerFullRefresh() {
        // No-op for standard screens
    }

    override fun setRefreshMode(mode: EInkRefreshMode) {
        // No-op
    }

    override fun release() {
        view = null
        points.clear()
        adapterState = EpdAdapterState.RELEASED
    }

    override fun probe(view: View): EpdAdapterProbeResult = EpdAdapterProbeResult(supported = true)

    override fun status(): EpdAdapterStatus = EpdAdapterStatus(
        state = adapterState,
        reason = "Software Canvas rendering; hardware E-Ink operations are unavailable",
        capabilities = EpdAdapterCapabilities()
    )

    override fun setBrushStyle(color: Int, width: Float) {
        paint.color = color
        baseWidth = width
    }

    override fun draw(canvas: Canvas) {
        if (points.size < 2) return
        val density = view?.resources?.displayMetrics?.density ?: 1.0f
        for (i in 0 until points.size - 1) {
            val p1 = points[i]
            val p2 = points[i + 1]
            val avgPressure = (p1.pressure + p2.pressure) / 2f
            val width = (baseWidth * density * avgPressure).coerceAtLeast(0.5f)
            paint.strokeWidth = width
            canvas.drawLine(p1.x, p1.y, p2.x, p2.y, paint)
        }
    }
}

/**
 * Android Jetpack Ink API / Front-buffered rendering wrapper.
 * Uses MotionEventPredictor to predict future stylus touch inputs and draw predicted lines ahead,
 * minimizing latency to ~10-15ms on supported Android hardware (Samsung, Pixel, foldables).
 */
class JetpackInkAdapter : EpdAdapter, EpdAdapterIntrospection {
    private var view: View? = null
    private var predictor: MotionEventPredictor? = null
    private var adapterState = EpdAdapterState.UNINITIALIZED
    private var statusReason: String? = null
    private val currentPath = Path()
    private val paint = Paint().apply {
        color = Color.BLACK
        strokeWidth = 5f
        style = Paint.Style.STROKE
        strokeJoin = Paint.Join.ROUND
        strokeCap = Paint.Cap.ROUND
        isAntiAlias = true
    }

    // Predictive brush segment paint (drawn semi-transparently)
    private val predictivePaint = Paint().apply {
        color = Color.BLACK
        alpha = 100 // 40% opacity
        strokeWidth = 5f
        style = Paint.Style.STROKE
        strokeJoin = Paint.Join.ROUND
        strokeCap = Paint.Cap.ROUND
        isAntiAlias = true
    }

    override fun init(view: View) {
        this.view = view
        try {
            predictor = MotionEventPredictor.newInstance(view)
            adapterState = EpdAdapterState.OPERATIONAL
            statusReason = null
            OpenInkBridgeLogger.i(
                Subsystem.Backend,
                "JETPACK_INK",
                "PREDICTOR_INITIALIZED",
                "Successfully initialized MotionEventPredictor for JetpackInkAdapter"
            )
        } catch (e: Exception) {
            adapterState = EpdAdapterState.DEGRADED
            statusReason = "Motion prediction unavailable; software path rendering remains operational: ${e.message}"
            OpenInkBridgeLogger.w(
                Subsystem.Backend,
                "JETPACK_INK",
                "PREDICTOR_UNSUPPORTED",
                "MotionEventPredictor not supported on this Android system build: ${e.message}"
            )
        }
    }


    override fun draw(canvas: Canvas) {
        // Draw the standard touch path
        canvas.drawPath(currentPath, paint)

        // Draw predicted points if available
        predictor?.predict()?.let { predictedEvent ->
            val historySize = predictedEvent.historySize
            if (historySize > 0) {
                val predPath = Path()
                predPath.moveTo(predictedEvent.getHistoricalX(0, 0), predictedEvent.getHistoricalY(0, 0))
                for (i in 1 until historySize) {
                    predPath.lineTo(predictedEvent.getHistoricalX(0, i), predictedEvent.getHistoricalY(0, i))
                }
                predPath.lineTo(predictedEvent.x, predictedEvent.y)
                canvas.drawPath(predPath, predictivePaint)
            }
        }
    }

    override fun startStroke(tool: StylusTool, color: Int, width: Float) {
        paint.color = color
        paint.strokeWidth = width
        predictivePaint.color = color
        predictivePaint.alpha = 100
        predictivePaint.strokeWidth = width

        currentPath.reset()
    }

    override fun drawPoint(point: PenPoint) {
        if (currentPath.isEmpty) {
            currentPath.moveTo(point.x, point.y)
        } else {
            currentPath.lineTo(point.x, point.y)
        }
        view?.invalidate()
    }

    override fun onTouchEvent(event: MotionEvent) {
        predictor?.record(event)
    }

    override fun endStroke() {
        // Commit stroke preview
    }

    override fun clear() {
        currentPath.reset()
        view?.invalidate()
    }

    override fun triggerFullRefresh() {}

    override fun setRefreshMode(mode: EInkRefreshMode) {}

    override fun release() {
        view = null
        predictor = null
        adapterState = EpdAdapterState.RELEASED
    }


    override fun probe(view: View): EpdAdapterProbeResult = EpdAdapterProbeResult(supported = true)

    override fun status(): EpdAdapterStatus = EpdAdapterStatus(
        state = adapterState,
        reason = statusReason,
        capabilities = EpdAdapterCapabilities(motionPrediction = predictor != null)
    )

    override fun setBrushStyle(color: Int, width: Float) {
        paint.color = color
        paint.strokeWidth = width
        predictivePaint.color = color
        predictivePaint.strokeWidth = width
    }
}

/**
 * Onyx Boox EPD Adapter that communicates with Onyx Pen SDK using Java Reflection.
 * This avoids compiling proprietary Onyx jars directly into the library, allowing
 * open-source developers to build and distribute the app legally.
 */
class OnyxBooxEpdAdapter : EpdAdapter, EpdAdapterIntrospection {
    private var view: View? = null
    private var adapterState = EpdAdapterState.UNINITIALIZED
    private var statusReason: String? = null
    private var epdControllerOperational = false
    private var surfaceCallback: SurfaceHolder.Callback? = null
    private var epdControllerClass: Class<*>? = null
    private var applyModeMethod: Method? = null
    private var epdModeEnumClass: Class<*>? = null
    private var enterScribbleModeMethod: Method? = null
    private var leaveScribbleModeMethod: Method? = null

    // TouchHelper direct-drawing Pen SDK (direct imports!)
    private var touchHelper: TouchHelper? = null
    
    // Collected points and status
    private val collectedPoints = mutableListOf<PenPoint>()
    private val processedPoints = mutableSetOf<String>()
    private var strokeActive = false
    private var isEraser = false
    private var maxObservedPressure = 1f
    private var stylusOnly = true
    private var drawingLimitRect: android.graphics.Rect? = null

    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())

    override fun probe(view: View): EpdAdapterProbeResult {
        return try {
            Class.forName("com.onyx.android.sdk.pen.TouchHelper")
            Class.forName("com.onyx.android.sdk.pen.RawInputCallback")
            EpdAdapterProbeResult(supported = true)
        } catch (error: Throwable) {
            EpdAdapterProbeResult(
                supported = false,
                reason = "Onyx Pen SDK classes are unavailable: ${error.message ?: error.javaClass.simpleName}"
            )
        }
    }

    private fun keepRawDrawingActive() {
        try {
            touchHelper?.setRawDrawingEnabled(true)
        } catch (e: Exception) {}
    }

    // Fallback path drawing when TouchHelper is NOT available (should always be available on Onyx Boox, but good for safety)
    private val fallbackPoints = mutableListOf<PenPoint>()
    private var baseWidth = 5f
    private val paint = Paint().apply {
        color = Color.BLACK
        strokeWidth = 5f
        style = Paint.Style.STROKE
        strokeJoin = Paint.Join.ROUND
        strokeCap = Paint.Cap.ROUND
        isAntiAlias = true
    }

    override fun init(view: View) {
        this.view = view
        adapterState = EpdAdapterState.UNINITIALIZED
        statusReason = null
        epdControllerOperational = false
        
        // 1. Hook standard EpdController for refresh mode changes
        try {
            epdControllerClass = Class.forName("com.onyx.android.sdk.api.device.epd.EpdController")
            epdModeEnumClass = Class.forName("com.onyx.android.sdk.api.device.epd.UpdateMode")
            
            applyModeMethod = epdControllerClass?.getMethod(
                "setViewDefaultUpdateMode", 
                View::class.java, 
                epdModeEnumClass
            )
            enterScribbleModeMethod = epdControllerClass?.getMethod("enterScribbleMode", View::class.java)
            leaveScribbleModeMethod = epdControllerClass?.getMethod("leaveScribbleMode", View::class.java)
            epdControllerOperational = true
            
            OpenInkBridgeLogger.i(Subsystem.Backend, "BOOX", "REFLECTION_SUCCESS", "Successfully hooked Onyx Boox EpdController setViewDefaultUpdateMode and scribble modes via reflection")
            setBooxRefreshMode("DU")
        } catch (e: Exception) {
            statusReason = "Onyx EPD refresh controller unavailable: ${e.message}"
            OpenInkBridgeLogger.w(Subsystem.Backend, "BOOX", "REFLECTION_WARN", "Onyx Boox EpdController methods not available: ${e.message}")
        }

        // 2. Bind to SurfaceView lifecycle if applicable, ensuring TouchHelper is initialized on an active Surface
        val surfaceView = view as? SurfaceView
        if (surfaceView != null) {
            val callback = object : SurfaceHolder.Callback {
                override fun surfaceCreated(holder: SurfaceHolder) {
                    OpenInkBridgeLogger.i(Subsystem.Android, "BOOX", "SURFACE_CREATED", "SurfaceView surface created! Initializing TouchHelper...")
                    clearSurfaceWithWhite(holder)
                    initTouchHelper(surfaceView)
                }

                override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
                    OpenInkBridgeLogger.i(Subsystem.Android, "BOOX", "SURFACE_CHANGED", "SurfaceView surface changed ($width x $height)!")
                    clearSurfaceWithWhite(holder)
                    updateLimitRect(surfaceView)
                }

                override fun surfaceDestroyed(holder: SurfaceHolder) {
                    OpenInkBridgeLogger.i(Subsystem.Android, "BOOX", "SURFACE_DESTROYED", "SurfaceView surface destroyed! Releasing TouchHelper...")
                    releaseTouchHelper()
                    adapterState = EpdAdapterState.DEGRADED
                    statusReason = "Waiting for the drawing surface to be recreated"
                }
            }
            surfaceCallback = callback
            surfaceView.holder.addCallback(callback)

            // In case the surface is already created when init is called
            if (surfaceView.holder.surface?.isValid == true) {
                clearSurfaceWithWhite(surfaceView.holder)
                initTouchHelper(surfaceView)
            } else {
                adapterState = EpdAdapterState.DEGRADED
                statusReason = "Waiting for the drawing surface; software preview remains available"
            }
        } else {
            // Fallback for standard Views
            initTouchHelper(view)
        }
    }

    private fun getPhysicalHardwareStrokeWidth(logicalWidth: Float): Float {
        val density = view?.resources?.displayMetrics?.density ?: 1.0f
        return logicalWidth * density
    }

    private fun initTouchHelper(targetView: View) {
        if (touchHelper != null) return // Already initialized
        
        try {
            val callback = object : RawInputCallback() {
                override fun onBeginRawDrawing(eraser: Boolean, touchPoint: OnyxTouchPoint) {
                    keepRawDrawingActive()
                    OpenInkBridgeLogger.d(Subsystem.PenInput, "BOOX", "RAW_BEGIN", "onBeginRawDrawing eraser=$eraser x=${touchPoint.x} y=${touchPoint.y}")
                    isEraser = eraser
                    strokeActive = true
                    collectedPoints.clear()
                    processedPoints.clear()
                    findOverlayCanvas()?.beginVendorStroke()
                    addOnyxPoint(touchPoint)
                    
                    try {
                        val hwWidth = getPhysicalHardwareStrokeWidth(baseWidth)
                        OpenInkBridgeLogger.d(Subsystem.Renderer, "BOOX", "APPLY_STROKE", "applying baseWidth=$baseWidth (hwWidth=$hwWidth), color=${paint.color}")
                        touchHelper?.setStrokeStyle(TouchHelper.STROKE_STYLE_FOUNTAIN)
                        touchHelper?.setStrokeWidth(hwWidth)
                        touchHelper?.setStrokeColor(paint.color)
                        drawingLimitRect?.let { rect ->
                            touchHelper?.setLimitRect(rect, ArrayList<android.graphics.Rect>())
                        }
                    } catch (e: Exception) {
                        OpenInkBridgeLogger.w(Subsystem.Renderer, "BOOX", "STROKE_PROP_FAILED", "Could not apply stroke properties in callback: ${e.message}")
                    }
                }

                override fun onRawDrawingTouchPointMoveReceived(touchPoint: OnyxTouchPoint) {
                    keepRawDrawingActive()
                    if (OpenInkBridgeLogger.shouldLogTrace(30)) {
                        OpenInkBridgeLogger.t(Subsystem.PenInput, "BOOX", "RAW_MOVE", "onRawMove x=${touchPoint.x} y=${touchPoint.y} pressure=${touchPoint.pressure}")
                    }
                    if (strokeActive) {
                        addOnyxPoint(touchPoint)
                    }
                }

                override fun onRawDrawingTouchPointListReceived(touchPointList: OnyxTouchPointList) {
                    keepRawDrawingActive()
                    if (strokeActive) {
                        for (i in 0 until touchPointList.size()) {
                            val pt = touchPointList.get(i)
                            if (pt != null) addOnyxPoint(pt)
                        }
                    }
                }

                override fun onEndRawDrawing(eraser: Boolean, touchPoint: OnyxTouchPoint) {
                    if (strokeActive) {
                        addOnyxPoint(touchPoint)
                        strokeActive = false
                        val finishedStroke = collectedPoints.toMutableList()
                        
                        // Fix fake pressure spikes at the beginning and end of the stroke
                        if (finishedStroke.size >= 3) {
                            if (finishedStroke[0].pressure > finishedStroke[1].pressure + 0.2f) {
                                finishedStroke[0] = finishedStroke[0].copy(pressure = finishedStroke[1].pressure)
                            }
                            
                            // Fade out/decay pressure at the end of the stroke to prevent big dots
                            val lastIdx = finishedStroke.size - 1
                            finishedStroke[lastIdx] = finishedStroke[lastIdx].copy(pressure = 0.1f)
                            finishedStroke[lastIdx - 1] = finishedStroke[lastIdx - 1].copy(
                                pressure = (finishedStroke[lastIdx - 2].pressure + 0.1f) / 2f
                            )
                        }
                        
                        collectedPoints.clear()  // clear live buffer before dispatching
                        processedPoints.clear()
                        
                        // Dispatch finalized stroke points to overlay canvas or native standalone view
                        val overlay = findOverlayCanvas()

                        if (overlay != null) {
                            overlay.post {
                                overlay.dispatchCompletedStroke(
                                    finishedStroke,
                                    PenPointCoordinateSpace.HOST_VIEW_LOCAL_PHYSICAL_PIXELS
                                )
                            }
                        }

                        (view as? OpenInkBridgeView)?.let { canvas ->
                            canvas.post {
                                canvas.addCompletedStroke(finishedStroke)
                                clearHardwareScribble()
                            }
                        }
                    }
                }

                override fun onBeginRawErasing(eraser: Boolean, touchPoint: OnyxTouchPoint) {}
                override fun onEndRawErasing(eraser: Boolean, touchPoint: OnyxTouchPoint) {}
                override fun onRawErasingTouchPointMoveReceived(touchPoint: OnyxTouchPoint) {}
                override fun onRawErasingTouchPointListReceived(touchPointList: OnyxTouchPointList) {}
            }

            // Use 2-param create (pen-only capture) so finger touches to toolbar buttons
            // and the traditional canvas are NOT intercepted by TouchHelper.
            touchHelper = TouchHelper.create(targetView, callback)
            touchHelper!!.enableFingerTouch(!stylusOnly)

            try {
                // Disable Onyx auto pen-up refresh so OUR software refresh handles handoff
                val method = touchHelper?.javaClass?.getMethod("setPenUpRefreshEnabled", Boolean::class.javaPrimitiveType)
                method?.invoke(touchHelper, false)
            } catch (e: Exception) {}

            updateLimitRect(targetView)
            adapterState = EpdAdapterState.OPERATIONAL
            statusReason = if (epdControllerOperational) {
                null
            } else {
                "Direct drawing is active, but E-Ink refresh-mode control is unavailable"
            }
            OpenInkBridgeLogger.i(Subsystem.Backend, "BOOX", "TOUCH_HELPER_BOUND", "Successfully initialized Onyx Pen SDK TouchHelper directly!")
        } catch (e: Exception) {
            adapterState = EpdAdapterState.UNAVAILABLE
            statusReason = "Onyx TouchHelper could not be initialized: ${e.message}"
            OpenInkBridgeLogger.e(Subsystem.Backend, "BOOX", "TOUCH_HELPER_ERROR", "Failed to initialize Onyx Pen SDK TouchHelper: ${e.message}")
        }
    }

    private fun getActiveLimitRect(targetView: View): android.graphics.Rect {
        val limitRect = android.graphics.Rect()
        val customLimit = drawingLimitRect
        if (customLimit != null) {
            limitRect.set(customLimit)
        } else {
            targetView.getLocalVisibleRect(limitRect)
        }
        return limitRect
    }

    private fun updateLimitRect(targetView: View) {
        // Configure the drawing region once the view is laid out
        targetView.post {
            val limitRect = getActiveLimitRect(targetView)
            if (limitRect.width() > 0 && limitRect.height() > 0) {
                try {
                    // Correct Onyx setup sequence:
                    // openRawDrawing() resets limitRect, strokeWidth, strokeColor, and strokeStyle,
                    // so ALL configuration must happen AFTER it.
                    // 1. Open Raw Drawing first
                    touchHelper?.openRawDrawing()
                    // 2. Limit Rect (must be after openRawDrawing or it gets wiped)
                    touchHelper?.setLimitRect(limitRect, emptyList())
                    // 3. Style
                    touchHelper?.setStrokeStyle(TouchHelper.STROKE_STYLE_FOUNTAIN)
                    // 4. Width
                    val hwWidth = getPhysicalHardwareStrokeWidth(baseWidth)
                    touchHelper?.setStrokeWidth(hwWidth)
                    // 5. Color
                    touchHelper?.setStrokeColor(paint.color)
                    // 6. Enable Finger Touch setting
                    touchHelper?.enableFingerTouch(!stylusOnly)
                    // 7. Enable hardware E-Ink preview rendering
                    touchHelper?.setRawDrawingRenderEnabled(true)
                    // 7. Enable Raw Drawing so hardware stylus stroke preview is ready for input immediately
                    touchHelper?.setRawDrawingEnabled(true)

                    OpenInkBridgeLogger.i(Subsystem.Backend, "BOOX", "LIMIT_RECT_CONFIGURED", "TouchHelper configured: limitRect=$limitRect stylusOnly=$stylusOnly hwWidth=$hwWidth")
                } catch (e: Exception) {
                    OpenInkBridgeLogger.w(Subsystem.Backend, "BOOX", "LIMIT_RECT_FAILED", "Failed to open/configure TouchHelper raw drawing: ${e.message}")
                }
            }
        }
    }

    private fun releaseTouchHelper() {
        try {
            touchHelper?.setRawDrawingEnabled(false)
            touchHelper?.closeRawDrawing()
        } catch (e: Exception) {}
        touchHelper = null
    }

    private fun addOnyxPoint(touchPoint: OnyxTouchPoint) {
        val localX = touchPoint.x
        val localY = touchPoint.y

        // Scale pressure: dynamically detect raw integer values (typically 0-4095) vs normalized floats
        val rawPressure = touchPoint.pressure
        val normalizedPressure = if (rawPressure > 1.0f) {
            (rawPressure / 4095.0f).coerceIn(0f, 1f)
        } else {
            rawPressure.coerceIn(0f, 1f)
        }

        // Unique composite key to deduplicate point callbacks (Move vs List vs Begin/End overlaps)
        val key = "${touchPoint.timestamp}_${localX}_${localY}"
        if (processedPoints.add(key)) {
            collectedPoints.add(PenPoint(
                x = localX,
                y = localY,
                pressure = normalizedPressure,
                tilt = 0f,
                timestamp = touchPoint.timestamp
            ))
        }
    }

    private fun findOverlayCanvas(): OpenInkBridgeOverlayCanvas? {
        (view as? OpenInkBridgeOverlayCanvas)?.let { return it }
        val viewGroup = view as? android.view.ViewGroup ?: return null
        for (index in 0 until viewGroup.childCount) {
            (viewGroup.getChildAt(index) as? OpenInkBridgeOverlayCanvas)?.let { return it }
        }
        return null
    }

    override fun setStylusOnly(enabled: Boolean) {
        this.stylusOnly = enabled
        try {
            touchHelper?.enableFingerTouch(!enabled)
            OpenInkBridgeLogger.d(Subsystem.Backend, "BOOX", "FINGER_TOUCH_TOGGLE", "Onyx hardware finger touch: ${!enabled}")
        } catch (e: Exception) {
            OpenInkBridgeLogger.w(Subsystem.Backend, "BOOX", "FINGER_TOUCH_FAILED", "Could not toggle Onyx finger touch: ${e.message}")
        }
    }

    override fun startStroke(tool: StylusTool, color: Int, width: Float) {
        paint.color = color
        baseWidth = width
        fallbackPoints.clear()
        
        setBooxRefreshMode("DU") // DU is the direct update/lowest latency E-Ink refresh mode

        // Update stroke style and limit rect live for the hardware pen renderer
        try {
            val hwWidth = getPhysicalHardwareStrokeWidth(width)
            touchHelper?.setStrokeWidth(hwWidth)
            touchHelper?.setStrokeColor(color)

            // Find overlay canvas to dynamically set drawing limit rect
            val overlay = findOverlayCanvas()
            if (overlay != null) {
                val lp = overlay.layoutParams as? android.widget.FrameLayout.LayoutParams
                if (lp != null) {
                    val left = lp.leftMargin
                    val top = lp.topMargin
                    val w = lp.width
                    val h = lp.height
                    if (w > 0 && h > 0) {
                        val limitRect = android.graphics.Rect(left, top, left + w, top + h)
                        touchHelper?.setLimitRect(limitRect, ArrayList<android.graphics.Rect>())
                    }
                }
            }
        } catch (e: Exception) {
            OpenInkBridgeLogger.w(Subsystem.Backend, "BOOX", "UPDATE_STYLE_FAILED", "Could not update Onyx Pen style or limit rect: ${e.message}")
        }
        view?.invalidate()
    }

    override fun drawPoint(point: PenPoint) {
        if (touchHelper == null) {
            fallbackPoints.add(point)
            view?.invalidate()
        }
    }

    override fun draw(canvas: Canvas) {
        // In SF_TOUCH_RENDER, hardware renders preview, so software doesn't render live points.
        // In fallback mode, render fallbackPoints.
        if (touchHelper == null) {
            if (fallbackPoints.size < 2) return
            val density = view?.resources?.displayMetrics?.density ?: 1.0f
            for (i in 0 until fallbackPoints.size - 1) {
                val p1 = fallbackPoints[i]
                val p2 = fallbackPoints[i + 1]
                val avgPressure = (p1.pressure + p2.pressure) / 2f
                val width = (baseWidth * density * avgPressure).coerceAtLeast(0.5f)
                paint.strokeWidth = width
                canvas.drawLine(p1.x, p1.y, p2.x, p2.y, paint)
            }
        }
    }

    override fun endStroke() {
        // Just clear live points. TouchHelper stays open.
        collectedPoints.clear()
        processedPoints.clear()
        setBooxRefreshMode("DU")
        view?.invalidate()
    }

    override fun clear() {
        fallbackPoints.clear()
        collectedPoints.clear()
        processedPoints.clear()
        view?.invalidate()
    }

    @Suppress("UNCHECKED_CAST")
    override fun triggerFullRefresh() {
        try {
            val gcEnum = java.lang.Enum.valueOf(epdModeEnumClass as Class<out Enum<*>>, "GC")
            val refreshMethod = epdControllerClass?.getMethod("refreshScreen", View::class.java, epdModeEnumClass)
            refreshMethod?.invoke(null, view, gcEnum)
            OpenInkBridgeLogger.d(Subsystem.Refresh, "BOOX", "FULL_REFRESH", "Triggered Onyx full screen refresh (GC)")
        } catch (e: Exception) {
            OpenInkBridgeLogger.e(Subsystem.Refresh, "BOOX", "FULL_REFRESH_FAILED", "Failed to trigger Onyx full screen refresh: ${e.message}")
        }
    }

    override fun onTouchEvent(event: MotionEvent) {
        try {
            keepRawDrawingActive()
            touchHelper?.onTouchEvent(event)
        } catch (e: Exception) {
            OpenInkBridgeLogger.w(Subsystem.Backend, "BOOX", "TOUCH_EVENT_FAILED", "Failed to pass touch event to TouchHelper: ${e.message}")
        }
    }

    override fun onHoverEvent(event: MotionEvent): Boolean {
        val tool = event.getToolType(0)
        val isStylus = tool == MotionEvent.TOOL_TYPE_STYLUS || tool == MotionEvent.TOOL_TYPE_ERASER
        if (isStylus) {
            keepRawDrawingActive()
            return true
        }
        return false
    }

    override fun setRefreshMode(mode: EInkRefreshMode) {
        val onyxModeString = when (mode) {
            EInkRefreshMode.SPEED -> "ANIMATION"
            EInkRefreshMode.QUALITY -> "REGAL"
            EInkRefreshMode.BALANCED -> "DU"
        }
        setBooxRefreshMode(onyxModeString)
    }

    override fun release() {
        releaseTouchHelper()
        (view as? SurfaceView)?.let { surfaceView ->
            surfaceCallback?.let(surfaceView.holder::removeCallback)
        }
        surfaceCallback = null
        view = null
        adapterState = EpdAdapterState.RELEASED
        statusReason = "Onyx backend resources were released"
    }

    override fun status(): EpdAdapterStatus = EpdAdapterStatus(
        state = adapterState,
        reason = statusReason,
        capabilities = EpdAdapterCapabilities(
            directDrawing = touchHelper != null,
            refreshModeControl = epdControllerOperational,
            fullRefresh = epdControllerOperational,
            drawingLimit = touchHelper != null,
            rawDrawingToggle = touchHelper != null,
            hardwareScribbleHandoff = touchHelper != null && epdControllerOperational
        )
    )

    override fun setBrushStyle(color: Int, width: Float) {
        paint.color = color
        baseWidth = width
        OpenInkBridgeLogger.d(Subsystem.Renderer, "BOOX", "SET_BRUSH_STYLE", "OnyxBooxEpdAdapter.setBrushStyle: color=$color, width=$width, touchHelper=${touchHelper != null}")
        try {
            if (touchHelper != null && view != null) {
                val targetView = view!!
                val limitRect = getActiveLimitRect(targetView)
                
                touchHelper?.closeRawDrawing()
                touchHelper?.openRawDrawing()
                
                if (limitRect.width() > 0 && limitRect.height() > 0) {
                    touchHelper?.setLimitRect(limitRect, emptyList())
                }
                
                val hwWidth = getPhysicalHardwareStrokeWidth(width)
                touchHelper?.setStrokeStyle(TouchHelper.STROKE_STYLE_FOUNTAIN)
                touchHelper?.setStrokeWidth(hwWidth)
                touchHelper?.setStrokeColor(color)
                touchHelper?.enableFingerTouch(!stylusOnly)
                touchHelper?.setRawDrawingRenderEnabled(true)
                touchHelper?.setRawDrawingEnabled(true)
                
                OpenInkBridgeLogger.d(Subsystem.Backend, "BOOX", "TOUCH_HELPER_RECONFIGURED", "TouchHelper reconfigured with width=$width (hwWidth=$hwWidth), color=$color, limitRect=$limitRect")
            }
        } catch (e: Exception) {
            OpenInkBridgeLogger.w(Subsystem.Backend, "BOOX", "TOUCH_HELPER_RECONFIG_FAILED", "Failed to update touchHelper stroke properties: ${e.message}")
        }
    }

    override fun isDirectDrawingActive(): Boolean = touchHelper != null

    override fun setRawDrawingEnabled(enabled: Boolean) {
        try {
            touchHelper?.setRawDrawingEnabled(enabled)
            OpenInkBridgeLogger.d(Subsystem.Backend, "BOOX", "RAW_DRAWING_TOGGLE", "Onyx hardware raw drawing enabled: $enabled")
        } catch (e: Exception) {
            OpenInkBridgeLogger.w(Subsystem.Backend, "BOOX", "RAW_DRAWING_TOGGLE_FAILED", "Failed to set Onyx raw drawing enabled ($enabled): ${e.message}")
        }
    }

    @Suppress("UNCHECKED_CAST")
    override fun clearHardwareScribble() {
        mainHandler.post {
            try {
                val targetView = view ?: return@post
                // Trigger fast E-Ink refresh to display the rendered software canvas frame
                val duEnum = java.lang.Enum.valueOf(epdModeEnumClass as Class<out Enum<*>>, "DU")
                applyModeMethod?.invoke(null, targetView, duEnum)

                val refreshMethod = epdControllerClass?.getMethod("refreshScreen", View::class.java, epdModeEnumClass)
                refreshMethod?.invoke(null, targetView, duEnum)

                targetView.invalidate()
                OpenInkBridgeLogger.d(Subsystem.Refresh, "BOOX", "HANDOFF_REFRESH", "Onyx hardware scribble handoff: triggered EPD refresh and view invalidation")
            } catch (e: Exception) {
                OpenInkBridgeLogger.w(Subsystem.Refresh, "BOOX", "HANDOFF_REFRESH_FAILED", "Failed to refresh EPD in clearHardwareScribble: ${e.message}")
            }
        }
    }

    override fun setDrawingLimit(rect: android.graphics.Rect?) {
        drawingLimitRect = rect
        try {
            if (touchHelper != null) {
                touchHelper?.closeRawDrawing()
                touchHelper?.openRawDrawing()
                if (rect != null) {
                    touchHelper?.setLimitRect(rect, ArrayList<android.graphics.Rect>())
                } else {
                    touchHelper?.setLimitRect(null as android.graphics.Rect?, null)
                }
                val hwWidth = getPhysicalHardwareStrokeWidth(baseWidth)
                touchHelper?.setStrokeStyle(TouchHelper.STROKE_STYLE_FOUNTAIN)
                touchHelper?.setStrokeWidth(hwWidth)
                touchHelper?.setStrokeColor(paint.color)
                touchHelper?.enableFingerTouch(!stylusOnly)
                touchHelper?.setRawDrawingRenderEnabled(true)
                touchHelper?.setRawDrawingEnabled(true)
                OpenInkBridgeLogger.d(Subsystem.Backend, "BOOX", "LIMIT_RECT_UPDATED", "TouchHelper reconfigured with new drawing limit: $rect")
            }
        } catch (e: Exception) {
            OpenInkBridgeLogger.w(Subsystem.Backend, "BOOX", "LIMIT_RECT_UPDATE_FAILED", "Failed to set Onyx drawing limit: ${e.message}")
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun setBooxRefreshMode(modeName: String) {
        try {
            val enumValue = java.lang.Enum.valueOf(epdModeEnumClass as Class<out Enum<*>>, modeName)
            applyModeMethod?.invoke(null, view, enumValue)
        } catch (e: Exception) {
            OpenInkBridgeLogger.w(Subsystem.Refresh, "BOOX", "SET_REFRESH_MODE_FAILED", "Could not set Onyx refresh mode: $modeName")
        }
    }

    private fun clearSurfaceWithWhite(holder: SurfaceHolder) {
        try {
            val canvas = holder.lockCanvas()
            if (canvas != null) {
                canvas.drawColor(Color.WHITE)
                holder.unlockCanvasAndPost(canvas)
                OpenInkBridgeLogger.i(Subsystem.Android, "BOOX", "SURFACE_CLEARED", "Cleared SurfaceView surface with solid white background")
            }
        } catch (e: Exception) {
            OpenInkBridgeLogger.w(Subsystem.Android, "BOOX", "SURFACE_CLEAR_FAILED", "Could not clear SurfaceView surface background: ${e.message}")
        }
    }
}

/**
 * Bigme EPD Adapter that communicates with Bigme Low-Latency Drawing SDK using Java Reflection.
 */
class BigmeEpdAdapter : EpdAdapter, EpdAdapterIntrospection {
    private var view: View? = null
    private var adapterState = EpdAdapterState.UNAVAILABLE

    // Path drawing for live drawing preview
    private val currentPath = Path()
    private var isFirstPoint = true
    private val paint = Paint().apply {
        color = Color.BLACK
        strokeWidth = 5f
        style = Paint.Style.STROKE
        strokeJoin = Paint.Join.ROUND
        strokeCap = Paint.Cap.ROUND
        isAntiAlias = true
    }

    override fun probe(view: View): EpdAdapterProbeResult = EpdAdapterProbeResult(
        supported = false,
        reason = "Bigme native low-latency integration is not implemented yet"
    )

    override fun init(view: View) {
        this.view = null
        adapterState = EpdAdapterState.UNAVAILABLE
        OpenInkBridgeLogger.w(
            Subsystem.Backend,
            "BIGME",
            "BACKEND_NOT_IMPLEMENTED",
            "Bigme adapter is a stub and cannot be selected; use an operational fallback backend"
        )
    }

    override fun startStroke(tool: StylusTool, color: Int, width: Float) {
        paint.color = color
        paint.strokeWidth = width
        currentPath.reset()
        isFirstPoint = true
        view?.invalidate()
    }

    override fun drawPoint(point: PenPoint) {
        if (isFirstPoint) {
            currentPath.moveTo(point.x, point.y)
            isFirstPoint = false
        } else {
            currentPath.lineTo(point.x, point.y)
        }
        view?.invalidate()
    }

    override fun draw(canvas: Canvas) {
        canvas.drawPath(currentPath, paint)
    }

    override fun endStroke() {
        view?.invalidate()
    }

    override fun clear() {
        currentPath.reset()
        view?.invalidate()
    }

    override fun triggerFullRefresh() {}
    override fun setRefreshMode(mode: EInkRefreshMode) {}
    override fun release() {
        view = null
        adapterState = EpdAdapterState.RELEASED
    }

    override fun status(): EpdAdapterStatus = EpdAdapterStatus(
        state = adapterState,
        reason = "Bigme native low-latency integration is not implemented yet"
    )

    override fun setBrushStyle(color: Int, width: Float) {
        paint.color = color
        paint.strokeWidth = width
    }
}

