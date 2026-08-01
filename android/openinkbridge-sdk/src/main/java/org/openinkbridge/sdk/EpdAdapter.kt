package org.openinkbridge.sdk

import android.graphics.Canvas
import android.view.MotionEvent
import android.view.View

/** Capabilities that are implemented by a backend, rather than inferred from the device brand. */
data class EpdAdapterCapabilities(
    val directDrawing: Boolean = false,
    val motionPrediction: Boolean = false,
    val refreshModeControl: Boolean = false,
    val fullRefresh: Boolean = false,
    val drawingLimit: Boolean = false,
    val rawDrawingToggle: Boolean = false,
    val hardwareScribbleHandoff: Boolean = false
)

data class EpdAdapterProbeResult(
    val supported: Boolean,
    val reason: String? = null
)

enum class EpdAdapterState {
    UNINITIALIZED,
    OPERATIONAL,
    DEGRADED,
    UNAVAILABLE,
    RELEASED
}

data class EpdAdapterStatus(
    val state: EpdAdapterState,
    val reason: String? = null,
    val capabilities: EpdAdapterCapabilities = EpdAdapterCapabilities()
) {
    val canRender: Boolean
        get() = state == EpdAdapterState.OPERATIONAL || state == EpdAdapterState.DEGRADED
}

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
     * Update active brush/stroke style dynamically.
     */
    fun setBrushStyle(color: Int, width: Float) {}

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

/**
 * Optional runtime capability contract for adapters. Keeping this separate preserves binary
 * compatibility with adapters compiled against the original [EpdAdapter] interface.
 */
interface EpdAdapterIntrospection {
    fun probe(view: View): EpdAdapterProbeResult
    fun status(): EpdAdapterStatus
}
