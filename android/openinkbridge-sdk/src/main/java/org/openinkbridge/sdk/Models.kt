package org.openinkbridge.sdk

enum class StylusTool {
    PEN, PENCIL, BRUSH, HIGHLIGHTER, ERASER_STROKE, ERASER_POINT
}

data class PenPoint(
    val x: Float,
    val y: Float,
    val pressure: Float,
    val tilt: Float,
    val timestamp: Long
)

enum class EInkRefreshMode {
    SPEED,      // Fast, low quality (high ghosting) - ideal for quick sketching
    QUALITY,    // High quality, slow - ideal for viewing text/details
    BALANCED    // Middle ground
}
