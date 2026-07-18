package org.openinkbridge.sdk

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.view.MotionEvent
import android.view.View

import android.view.SurfaceView
import android.graphics.PixelFormat

class OpenInkBridgeOverlayCanvas(
    context: Context,
    private val epdAdapterManager: EpdAdapterManager
) : SurfaceView(context) {

    var onStrokeCompleted: ((List<PenPoint>) -> Unit)? = null
    
    private val strokePoints = mutableListOf<PenPoint>()
    private var strokeColor = Color.BLACK
    private var strokeWidth = 5f
    private var isDrawing = false

    init {
        // Enable onDraw on SurfaceView so standard vector path drawing works
        setWillNotDraw(false)
        
        // Configure SurfaceView to be transparent so the WebView underneath is visible
        setZOrderOnTop(true)
        holder.setFormat(PixelFormat.TRANSPARENT)
    }

    private var stylusOnly = true

    fun setStylusOnly(enabled: Boolean) {
        this.stylusOnly = enabled
        epdAdapterManager.activeAdapter.setStylusOnly(enabled)
    }

    fun configureStroke(color: Int, width: Float) {
        this.strokeColor = color
        this.strokeWidth = width
        epdAdapterManager.activeAdapter.setBrushStyle(color, width)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        // Reject fingers if stylus only mode is active
        val tool = event.getToolType(0)
        val isStylus = tool == MotionEvent.TOOL_TYPE_STYLUS || tool == MotionEvent.TOOL_TYPE_ERASER
        if (stylusOnly && !isStylus) {
            return false
        }

        if (isStylus && epdAdapterManager.activeAdapter.isDirectDrawingActive()) {
            epdAdapterManager.activeAdapter.onTouchEvent(event)
            super.onTouchEvent(event)
            return true // Consumes the touch stream to receive move/up actions
        }

        epdAdapterManager.activeAdapter.onTouchEvent(event)
        val toolType = when (event.getToolType(0)) {
            MotionEvent.TOOL_TYPE_STYLUS -> StylusTool.PEN
            MotionEvent.TOOL_TYPE_ERASER -> StylusTool.ERASER_STROKE
            else -> StylusTool.PEN // Treat fingers as pens if overlay is enabled
        }

        // Clamp stylus inputs exactly to the view's layout bounds to prevent leaking/drawing in margins
        val clampedX = event.x.coerceIn(0f, width.toFloat())
        val clampedY = event.y.coerceIn(0f, height.toFloat())

        val point = PenPoint(
            x = clampedX,
            y = clampedY,
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
                    // E-Ink stylus sensors fire high-frequency batch events. 
                    // Process historical points for maximum resolution.
                    val historySize = event.historySize
                    for (i in 0 until historySize) {
                        val histX = event.getHistoricalX(0, i).coerceIn(0f, width.toFloat())
                        val histY = event.getHistoricalY(0, i).coerceIn(0f, height.toFloat())
                        
                        val histPoint = PenPoint(
                            x = histX,
                            y = histY,
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

                    
                    onStrokeCompleted?.invoke(strokePoints.toList())
                    strokePoints.clear()
                    isDrawing = false
                }
            }
        }
        invalidate()
        return true
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        
        // Render current active stroke preview
        epdAdapterManager.activeAdapter.draw(canvas)
    }
}
