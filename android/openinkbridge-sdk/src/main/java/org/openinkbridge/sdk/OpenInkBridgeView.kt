package org.openinkbridge.sdk

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.SurfaceView

/**
 * A zero-configuration standalone drawing canvas view for native Android.
 * Automatically handles stylus coordinate capturing, high-frequency motion history,
 * stroke smoothing, and hardware E-Ink rendering updates based on device vendor.
 */
class OpenInkBridgeView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : SurfaceView(context, attrs, defStyleAttr) {

    private val epdAdapterManager = EpdAdapterManager(this)
    private var onStrokeCompleted: ((List<PenPoint>) -> Unit)? = null



    private val strokePoints = mutableListOf<PenPoint>()
    private val completedStrokes = mutableListOf<DrawingStroke>()
    
    private var strokeColor = Color.BLACK
    private var strokeWidth = 5f
    private var isDrawing = false

    // Standard drawing paint for rendering historical strokes on screen
    private val renderPaint = Paint().apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        isAntiAlias = true
    }

    init {
        // Enable onDraw on SurfaceView so standard vector path drawing works
        setWillNotDraw(false)
        
        // Read XML attributes if available
        attrs?.let {
            // Placeholder: Parse strokeColor/strokeWidth attributes from XML custom attributes
        }
    }

    /**
     * Configure the drawing brush settings.
     */
    fun setBrushStyle(color: Int, width: Float) {
        this.strokeColor = color
        this.strokeWidth = width
        epdAdapterManager.activeAdapter.setBrushStyle(color, width)
        invalidate()
    }

    /**
     * Set a listener to receive finalized vector path data when the pen is lifted.
     */
    fun setOnStrokeListener(listener: (List<PenPoint>) -> Unit) {
        this.onStrokeCompleted = listener
    }

    fun addCompletedStroke(stroke: List<PenPoint>) {
        completedStrokes.add(DrawingStroke(stroke, strokeColor, strokeWidth))
        invalidate()
        onStrokeCompleted?.invoke(stroke)
    }

    private var stylusOnly = true

    fun setStylusOnly(enabled: Boolean) {
        this.stylusOnly = enabled
        epdAdapterManager.activeAdapter.setStylusOnly(enabled)
    }

    fun setRawDrawingEnabled(enabled: Boolean) {
        epdAdapterManager.activeAdapter.setRawDrawingEnabled(enabled)
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (event.action == MotionEvent.ACTION_MOVE) {
            android.util.Log.d("OpenInkBridge", "[DISPATCH_TOUCH] x=${event.x} y=${event.y}")
        }
        return super.dispatchTouchEvent(event)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val tool = event.getToolType(0)
        val isStylus = tool == MotionEvent.TOOL_TYPE_STYLUS || tool == MotionEvent.TOOL_TYPE_ERASER
        android.util.Log.d("OpenInkBridge", "[VIEW] onTouchEvent action=${event.action} tool=$tool isStylus=$isStylus stylusOnly=$stylusOnly directDraw=${epdAdapterManager.activeAdapter.isDirectDrawingActive()}")
        if (stylusOnly && !isStylus) {
            return false
        }

        // When TouchHelper is active, it has registered its own OnTouchListener on this view.
        // We must call super.onTouchEvent so the listener chain fires.
        // Skip our own manual stroke tracking — TouchHelper collects points via hardware callbacks.
        if (epdAdapterManager.activeAdapter.isDirectDrawingActive()) {
            android.util.Log.d("OpenInkBridge", "[VIEW] Routing to super.onTouchEvent for TouchHelper")
            epdAdapterManager.activeAdapter.onTouchEvent(event)
            super.onTouchEvent(event)
            return true // Consumes the touch stream to receive move/up actions
        }
        
        epdAdapterManager.activeAdapter.onTouchEvent(event)
        val toolType = when (event.getToolType(0)) {
            MotionEvent.TOOL_TYPE_STYLUS -> StylusTool.PEN
            MotionEvent.TOOL_TYPE_ERASER -> StylusTool.ERASER_STROKE
            else -> StylusTool.PEN
        }

        val point = PenPoint(
            x = event.x,
            y = event.y,
            pressure = event.pressure,
            tilt = event.getAxisValue(MotionEvent.AXIS_TILT),
            timestamp = event.eventTime
        )

        when (event.action) {
            MotionEvent.ACTION_DOWN -> {
                isDrawing = true
                strokePoints.clear()
                strokePoints.add(point)
                
                epdAdapterManager.activeAdapter.startStroke(toolType, strokeColor, strokeWidth)
                epdAdapterManager.activeAdapter.drawPoint(point)
            }
            MotionEvent.ACTION_MOVE -> {
                if (isDrawing) {
                    val historySize = event.historySize
                    for (i in 0 until historySize) {
                        val histPoint = PenPoint(
                            x = event.getHistoricalX(0, i),
                            y = event.getHistoricalY(0, i),
                            pressure = event.getHistoricalPressure(0, i),
                            tilt = event.getHistoricalAxisValue(MotionEvent.AXIS_TILT, 0, i),
                            timestamp = event.getHistoricalEventTime(i)
                        )
                        strokePoints.add(histPoint)
                        epdAdapterManager.activeAdapter.drawPoint(histPoint)
                    }

                    strokePoints.add(point)
                    epdAdapterManager.activeAdapter.drawPoint(point)
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                if (isDrawing) {
                    strokePoints.add(point)
                    epdAdapterManager.activeAdapter.drawPoint(point)
                    epdAdapterManager.activeAdapter.endStroke()

                    val smoothedStroke = CoreBridge.smoothStroke(strokePoints)
                    completedStrokes.add(DrawingStroke(smoothedStroke, strokeColor, strokeWidth))
                    
                    onStrokeCompleted?.invoke(smoothedStroke)
                    strokePoints.clear()
                    isDrawing = false
                    
                    invalidate() // Trigger redraw to render the smoothed vector path
                }
            }
        }
        return true
    }

    override fun onHoverEvent(event: MotionEvent): Boolean {
        if (epdAdapterManager.activeAdapter.isDirectDrawingActive()) {
            if (epdAdapterManager.activeAdapter.onHoverEvent(event)) {
                return true
            }
        }
        return super.onHoverEvent(event)
    }

    override fun onDraw(canvas: Canvas) {
        // Clear canvas with white background
        canvas.drawColor(Color.WHITE)

        // Draw all finalized vector strokes
        for (stroke in completedStrokes) {
            if (stroke.points.size < 2) continue
            renderPaint.color = stroke.color
            for (i in 0 until stroke.points.size - 1) {
                val p1 = stroke.points[i]
                val p2 = stroke.points[i + 1]
                val avgPressure = (p1.pressure + p2.pressure) / 2f
                val width = stroke.width * (0.3f + 1.4f * avgPressure)
                renderPaint.strokeWidth = width
                canvas.drawLine(p1.x, p1.y, p2.x, p2.y, renderPaint)
            }
        }

        // Draw the currently active stroke preview (e.g. standard software or predictive)
        epdAdapterManager.activeAdapter.draw(canvas)
    }

    /**
     * Clear the canvas and completed vector paths.
     */
    fun clear() {
        completedStrokes.clear()
        epdAdapterManager.activeAdapter.clear()
        invalidate()
    }

    /**
     * Export drawing as an Android Bitmap object.
     */
    fun exportToBitmap(): Bitmap {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        draw(canvas)
        return bitmap
    }

    /**
     * Export drawing direct to an SVG string.
     */
    fun exportToSvg(): String {
        val sb = StringBuilder()
        sb.append("<svg viewBox=\"0 0 $width $height\" xmlns=\"http://www.w3.org/2000/svg\">\n")
        
        for (stroke in completedStrokes) {
            if (stroke.points.size < 2) continue
            val hexColor = String.format("#%06X", 0xFFFFFF and stroke.color)
            sb.append("  <path d=\"M ${stroke.points[0].x} ${stroke.points[0].y}")
            for (i in 1 until stroke.points.size) {
                sb.append(" L ${stroke.points[i].x} ${stroke.points[i].y}")
            }
            sb.append("\" stroke=\"$hexColor\" stroke-width=\"${stroke.width}\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\" />\n")
        }
        
        sb.append("</svg>")
        return sb.toString()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
    }

    override fun onDetachedFromWindow() {
        // Auto-release hardware E-Ink rendering locks to prevent screen flickering in other apps
        epdAdapterManager.activeAdapter.endStroke()
        epdAdapterManager.release()
        super.onDetachedFromWindow()
    }

    fun release() {
        epdAdapterManager.release()
    }
}
