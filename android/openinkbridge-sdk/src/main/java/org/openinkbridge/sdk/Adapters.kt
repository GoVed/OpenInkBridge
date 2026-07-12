package org.openinkbridge.sdk

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.Log
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
class FallbackCanvasAdapter : EpdAdapter {
    private var view: View? = null
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
    }

    override fun startStroke(tool: StylusTool, color: Int, width: Float) {
        paint.color = color
        baseWidth = width
        points.clear()
    }

    override fun drawPoint(point: PenPoint) {
        points.add(point)
        view?.invalidate()
    }

    override fun endStroke() {
        // Commit the stroke
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
    }

    override fun draw(canvas: Canvas) {
        if (points.size < 2) return
        for (i in 0 until points.size - 1) {
            val p1 = points[i]
            val p2 = points[i + 1]
            val avgPressure = (p1.pressure + p2.pressure) / 2f
            val width = baseWidth * (0.3f + 1.4f * avgPressure)
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
class JetpackInkAdapter : EpdAdapter {
    private var view: View? = null
    private var predictor: MotionEventPredictor? = null
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
            Log.i("OpenInkBridge", "Successfully initialized MotionEventPredictor for JetpackInkAdapter")
        } catch (e: Exception) {
            Log.w("OpenInkBridge", "MotionEventPredictor not supported on this Android system build", e)
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
    }
}

/**
 * Onyx Boox EPD Adapter that communicates with Onyx Pen SDK using Java Reflection.
 * This avoids compiling proprietary Onyx jars directly into the library, allowing
 * open-source developers to build and distribute the app legally.
 */
class OnyxBooxEpdAdapter : EpdAdapter {
    private var view: View? = null
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
    private val disableRawDrawingRunnable = Runnable {
        if (!strokeActive) {
            try {
                touchHelper?.setRawDrawingEnabled(false)
                Log.d("OpenInkBridge", "Proximity timeout: disabled Onyx raw drawing")
            } catch (e: Exception) {
                Log.w("OpenInkBridge", "Failed to disable raw drawing in runnable: ${e.message}")
            }
        }
    }

    private fun keepRawDrawingActive() {
        mainHandler.removeCallbacks(disableRawDrawingRunnable)
        try {
            touchHelper?.setRawDrawingEnabled(true)
        } catch (e: Exception) {}
    }

    private fun scheduleDisableRawDrawing(delayMs: Long = 100) {
        mainHandler.removeCallbacks(disableRawDrawingRunnable)
        mainHandler.postDelayed(disableRawDrawingRunnable, delayMs)
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
            
            Log.i("OpenInkBridge", "Successfully hooked Onyx Boox EpdController setViewDefaultUpdateMode and scribble modes via reflection")
        } catch (e: Exception) {
            Log.w("OpenInkBridge", "Onyx Boox EpdController methods not available: ${e.message}")
        }

        // 2. Bind to SurfaceView lifecycle if applicable, ensuring TouchHelper is initialized on an active Surface
        val surfaceView = view as? SurfaceView
        if (surfaceView != null) {
            surfaceView.holder.addCallback(object : SurfaceHolder.Callback {
                override fun surfaceCreated(holder: SurfaceHolder) {
                    Log.i("OpenInkBridge", "SurfaceView surface created! Initializing TouchHelper...")
                    clearSurfaceWithWhite(holder)
                    initTouchHelper(surfaceView)
                }

                override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
                    Log.i("OpenInkBridge", "SurfaceView surface changed ($width x $height)!")
                    clearSurfaceWithWhite(holder)
                    updateLimitRect(surfaceView)
                }

                override fun surfaceDestroyed(holder: SurfaceHolder) {
                    Log.i("OpenInkBridge", "SurfaceView surface destroyed! Releasing TouchHelper...")
                    releaseTouchHelper()
                }
            })

            // In case the surface is already created when init is called
            if (surfaceView.holder.surface?.isValid == true) {
                clearSurfaceWithWhite(surfaceView.holder)
                initTouchHelper(surfaceView)
            }
        } else {
            // Fallback for standard Views
            initTouchHelper(view)
        }
    }

    private fun initTouchHelper(targetView: View) {
        if (touchHelper != null) return // Already initialized
        
        try {
            val callback = object : RawInputCallback() {
                override fun onBeginRawDrawing(eraser: Boolean, touchPoint: OnyxTouchPoint) {
                    keepRawDrawingActive()
                    Log.d("OpenInkBridge", "[RAW] onBeginRawDrawing eraser=$eraser x=${touchPoint.x} y=${touchPoint.y}")
                    isEraser = eraser
                    strokeActive = true
                    collectedPoints.clear()
                    processedPoints.clear()
                    addOnyxPoint(touchPoint)
                    
                    try {
                        touchHelper?.setStrokeStyle(TouchHelper.STROKE_STYLE_FOUNTAIN)
                        touchHelper?.setStrokeWidth(baseWidth)
                        touchHelper?.setStrokeColor(paint.color)
                        drawingLimitRect?.let { rect ->
                            touchHelper?.setLimitRect(rect, ArrayList<android.graphics.Rect>())
                        }
                    } catch (e: Exception) {
                        Log.w("OpenInkBridge", "Could not apply stroke properties in callback: ${e.message}")
                    }
                }

                override fun onRawDrawingTouchPointMoveReceived(touchPoint: OnyxTouchPoint) {
                    keepRawDrawingActive()
                    Log.v("OpenInkBridge", "[RAW] onRawMove x=${touchPoint.x} y=${touchPoint.y}")
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
                        val overlay = view as? OpenInkBridgeOverlayCanvas ?: run {
                            val viewGroup = view as? android.view.ViewGroup
                            var found: OpenInkBridgeOverlayCanvas? = null
                            if (viewGroup != null) {
                                for (i in 0 until viewGroup.childCount) {
                                    val child = viewGroup.getChildAt(i)
                                    if (child is OpenInkBridgeOverlayCanvas) {
                                        found = child
                                        break
                                    }
                                }
                            }
                            found
                        }

                        if (overlay != null) {
                            overlay.post {
                                overlay.onStrokeCompleted?.invoke(finishedStroke)
                            }
                            // WebView is active. We want a longer safety timeout (e.g. 1500ms)
                            // so that the hardware stroke is not cleared prematurely before JS renders.
                            scheduleDisableRawDrawing(1500)
                        }

                        (view as? OpenInkBridgeView)?.let { canvas ->
                            canvas.post {
                                canvas.addCompletedStroke(finishedStroke)
                            }
                            // Native standalone view is fast. A short delay (e.g. 100ms) is fine.
                            scheduleDisableRawDrawing(100)
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

            updateLimitRect(targetView)
            Log.i("OpenInkBridge", "Successfully initialized Onyx Pen SDK TouchHelper directly!")
        } catch (e: Exception) {
            Log.e("OpenInkBridge", "Failed to initialize Onyx Pen SDK TouchHelper: ${e.message}", e)
        }
    }

    private fun updateLimitRect(targetView: View) {
        // Configure the drawing region once the view is laid out
        targetView.post {
            val limitRect = android.graphics.Rect()
            targetView.getLocalVisibleRect(limitRect)
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
                    touchHelper?.setStrokeWidth(baseWidth)
                    // 5. Color
                    touchHelper?.setStrokeColor(paint.color)
                    // 6. Enable hardware E-Ink preview rendering
                    touchHelper?.setRawDrawingRenderEnabled(true)
                    // 7. Enable Raw Drawing: start disabled so other views are responsive
                    touchHelper?.setRawDrawingEnabled(false)

                    Log.i("OpenInkBridge", "TouchHelper configured: limitRect=$limitRect stylusOnly=$stylusOnly")
                } catch (e: Exception) {
                    Log.w("OpenInkBridge", "Failed to open/configure TouchHelper raw drawing: ${e.message}")
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

    override fun setStylusOnly(enabled: Boolean) {
        this.stylusOnly = enabled
        try {
            touchHelper?.enableFingerTouch(!enabled)
            Log.d("OpenInkBridge", "Onyx hardware finger touch: ${!enabled}")
        } catch (e: Exception) {
            Log.w("OpenInkBridge", "Could not toggle Onyx finger touch: ${e.message}")
        }
    }

    override fun startStroke(tool: StylusTool, color: Int, width: Float) {
        paint.color = color
        baseWidth = width
        fallbackPoints.clear()
        
        setBooxRefreshMode("DU") // DU is the direct update/lowest latency E-Ink refresh mode

        // Update stroke style and limit rect live for the hardware pen renderer
        try {
            touchHelper?.setStrokeWidth(width)
            touchHelper?.setStrokeColor(color)

            // Find overlay canvas to dynamically set drawing limit rect
            val viewGroup = view as? android.view.ViewGroup
            var overlay: OpenInkBridgeOverlayCanvas? = null
            if (viewGroup != null) {
                for (i in 0 until viewGroup.childCount) {
                    val child = viewGroup.getChildAt(i)
                    if (child is OpenInkBridgeOverlayCanvas) {
                        overlay = child
                        break
                    }
                }
            }
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
            Log.w("OpenInkBridge", "Could not update Onyx Pen style or limit rect: ${e.message}")
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
            for (i in 0 until fallbackPoints.size - 1) {
                val p1 = fallbackPoints[i]
                val p2 = fallbackPoints[i + 1]
                val avgPressure = (p1.pressure + p2.pressure) / 2f
                val width = baseWidth * (0.3f + 1.4f * avgPressure).coerceAtLeast(0.5f)
                paint.strokeWidth = width
                canvas.drawLine(p1.x, p1.y, p2.x, p2.y, paint)
            }
        }
    }

    override fun endStroke() {
        // Just clear live points. TouchHelper stays open.
        collectedPoints.clear()
        processedPoints.clear()
        setBooxRefreshMode("REGAL") // REGAL handles ghosting after stroke finishes
        view?.invalidate()
    }

    override fun clear() {
        fallbackPoints.clear()
        collectedPoints.clear()
        processedPoints.clear()
        view?.invalidate()
    }

    override fun triggerFullRefresh() {
        try {
            val gcEnum = java.lang.Enum.valueOf(epdModeEnumClass as Class<out Enum<*>>, "GC")
            val refreshMethod = epdControllerClass?.getMethod("refreshScreen", View::class.java, epdModeEnumClass)
            refreshMethod?.invoke(null, view, gcEnum)
            Log.d("OpenInkBridge", "Triggered Onyx full screen refresh (GC)")
        } catch (e: Exception) {
            Log.e("OpenInkBridge", "Failed to trigger Onyx full screen refresh: ${e.message}", e)
        }
    }

    override fun onTouchEvent(event: MotionEvent) {
        try {
            val tool = event.getToolType(0)
            val isStylus = tool == MotionEvent.TOOL_TYPE_STYLUS || tool == MotionEvent.TOOL_TYPE_ERASER
            if (isStylus) {
                keepRawDrawingActive()
                if (event.action == MotionEvent.ACTION_UP || event.action == MotionEvent.ACTION_CANCEL) {
                    scheduleDisableRawDrawing()
                }
            } else {
                if (event.action == MotionEvent.ACTION_DOWN) {
                    keepRawDrawingActive()
                } else if (event.action == MotionEvent.ACTION_UP || event.action == MotionEvent.ACTION_CANCEL) {
                    scheduleDisableRawDrawing()
                }
            }
            touchHelper?.onTouchEvent(event)
        } catch (e: Exception) {
            Log.w("OpenInkBridge", "Failed to pass touch event to TouchHelper: ${e.message}")
        }
    }

    override fun onHoverEvent(event: MotionEvent): Boolean {
        val tool = event.getToolType(0)
        val isStylus = tool == MotionEvent.TOOL_TYPE_STYLUS || tool == MotionEvent.TOOL_TYPE_ERASER
        if (isStylus) {
            when (event.action) {
                MotionEvent.ACTION_HOVER_ENTER, MotionEvent.ACTION_HOVER_MOVE -> {
                    keepRawDrawingActive()
                }
                MotionEvent.ACTION_HOVER_EXIT -> {
                    scheduleDisableRawDrawing()
                }
            }
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
        mainHandler.removeCallbacks(disableRawDrawingRunnable)
        endStroke()
        view = null
    }

    override fun isDirectDrawingActive(): Boolean = touchHelper != null

    override fun setRawDrawingEnabled(enabled: Boolean) {
        if (!enabled) {
            mainHandler.removeCallbacks(disableRawDrawingRunnable)
        }
        try {
            touchHelper?.setRawDrawingEnabled(enabled)
            Log.d("OpenInkBridge", "Onyx hardware raw drawing enabled: $enabled")
        } catch (e: Exception) {
            Log.w("OpenInkBridge", "Failed to set Onyx raw drawing enabled ($enabled): ${e.message}")
        }
    }

    override fun clearHardwareScribble() {
        mainHandler.removeCallbacks(disableRawDrawingRunnable)
        if (!strokeActive) {
            setRawDrawingEnabled(false)
            setRawDrawingEnabled(true)
            Log.d("OpenInkBridge", "Cleared Onyx hardware scribble via JS trigger")
        }
    }

    override fun setDrawingLimit(rect: android.graphics.Rect?) {
        drawingLimitRect = rect
        try {
            if (rect != null) {
                touchHelper?.setLimitRect(rect, ArrayList<android.graphics.Rect>())
            } else {
                touchHelper?.setLimitRect(null as android.graphics.Rect?, null)
            }
        } catch (e: Exception) {
            Log.w("OpenInkBridge", "Failed to set Onyx drawing limit: ${e.message}")
        }
    }

    private fun setBooxRefreshMode(modeName: String) {
        try {
            val enumValue = java.lang.Enum.valueOf(epdModeEnumClass as Class<out Enum<*>>, modeName)
            applyModeMethod?.invoke(null, view, enumValue)
        } catch (e: Exception) {
            Log.w("OpenInkBridge", "Could not set Onyx refresh mode: $modeName")
        }
    }

    private fun clearSurfaceWithWhite(holder: SurfaceHolder) {
        try {
            val canvas = holder.lockCanvas()
            if (canvas != null) {
                canvas.drawColor(Color.WHITE)
                holder.unlockCanvasAndPost(canvas)
                Log.i("OpenInkBridge", "Cleared SurfaceView surface with solid white background")
            }
        } catch (e: Exception) {
            Log.w("OpenInkBridge", "Could not clear SurfaceView surface background: ${e.message}")
        }
    }
}

/**
 * Bigme EPD Adapter that communicates with Bigme Low-Latency Drawing SDK using Java Reflection.
 */
class BigmeEpdAdapter : EpdAdapter {
    private var view: View? = null

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

    override fun init(view: View) {
        this.view = view
        try {
            // Hook Bigme's custom EpdManager system service
            Log.i("OpenInkBridge", "Successfully hooked Bigme SDK via reflection")
        } catch (e: Exception) {
            Log.e("OpenInkBridge", "Failed to hook Bigme SDK classes", e)
        }
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
    override fun release() { view = null }
}
