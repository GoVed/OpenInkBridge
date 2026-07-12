package org.openinkbridge.sdk

import android.graphics.Canvas
import android.view.MotionEvent
import android.view.View

interface EpdAdapter {
    /**
     * Bind the adapter to the rendering view.
     */
    fun init(view: View)

    /**
     * Render the active stroke path onto the main Canvas (for fallbacks/previews).
     */
    fun draw(canvas: Canvas) {}

    /**
     * Start a new low-latency stroke.
     */
    fun startStroke(tool: StylusTool, color: Int, width: Float)

    /**
     * Feed raw coordinates directly to the vendor's low-latency drawing path.
     */
    fun drawPoint(point: PenPoint)

    /**
     * Handle raw touch events for advanced adapters (e.g. predictive rendering).
     */
    fun onTouchEvent(event: MotionEvent) {}

    /**
     * End the current stroke and commit the vector data.
     */
    fun endStroke()

    /**
     * Clear the low-latency hardware canvas layer.
     */
    fun clear()

    /**
     * Manually trigger a full-screen refresh to clear E-Ink ghosting.
     */
    fun triggerFullRefresh()

    /**
     * Dynamically change the refresh mode of the screen.
     */
    fun setRefreshMode(mode: EInkRefreshMode)

    /**
     * Release any hardware resource hooks.
     */
    fun release()

    /**
     * Checks if the adapter handles hardware-level direct drawing.
     */
    fun isDirectDrawingActive(): Boolean = false

    /**
     * Set stylus only mode to enable/disable finger touch in hardware level drawing.
     */
    fun setStylusOnly(enabled: Boolean) {}

    /**
     * Dynamically enable or disable E-Ink raw drawing.
     */
    fun setRawDrawingEnabled(enabled: Boolean) {}

    /**
     * Safely clear any persistent hardware-level scribbles from the screen,
     * typically called when the software canvas rendering has finished drawing.
     */
    fun clearHardwareScribble() {}

    /**
     * Handle hover events for low-latency active raw drawing toggling.
     */
    fun onHoverEvent(event: MotionEvent): Boolean = false

    /**
     * Set a boundary limit rectangle for low-latency drawing.
     */
    fun setDrawingLimit(rect: android.graphics.Rect?) {}
}
