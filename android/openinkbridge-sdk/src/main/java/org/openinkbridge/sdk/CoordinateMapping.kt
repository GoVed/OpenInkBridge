package org.openinkbridge.sdk

/**
 * Identifies the coordinate space used by a captured stroke.
 *
 * MotionEvents delivered to the overlay are already overlay-local. Vendor callbacks may instead
 * report points relative to the host view that contains the positioned overlay.
 */
internal enum class PenPointCoordinateSpace {
    OVERLAY_LOCAL_PHYSICAL_PIXELS,
    HOST_VIEW_LOCAL_PHYSICAL_PIXELS
}

internal data class OverlayCoordinateContext(
    val overlayLeftPx: Float,
    val overlayTopPx: Float,
    val density: Float
)

internal object OverlayCoordinateMapper {
    fun toWebCssPoint(
        point: PenPoint,
        sourceSpace: PenPointCoordinateSpace,
        context: OverlayCoordinateContext
    ): PenPoint {
        require(context.density > 0f) { "Display density must be greater than zero" }

        val overlayLocalX = when (sourceSpace) {
            PenPointCoordinateSpace.OVERLAY_LOCAL_PHYSICAL_PIXELS -> point.x
            PenPointCoordinateSpace.HOST_VIEW_LOCAL_PHYSICAL_PIXELS -> point.x - context.overlayLeftPx
        }
        val overlayLocalY = when (sourceSpace) {
            PenPointCoordinateSpace.OVERLAY_LOCAL_PHYSICAL_PIXELS -> point.y
            PenPointCoordinateSpace.HOST_VIEW_LOCAL_PHYSICAL_PIXELS -> point.y - context.overlayTopPx
        }

        return point.copy(
            x = overlayLocalX / context.density,
            y = overlayLocalY / context.density
        )
    }
}
