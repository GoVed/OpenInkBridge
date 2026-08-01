package org.openinkbridge.sdk

import org.junit.Assert.assertEquals
import org.junit.Test

class OverlayCoordinateMapperTest {
    private val context = OverlayCoordinateContext(
        overlayLeftPx = 200f,
        overlayTopPx = 100f,
        density = 2f
    )

    @Test
    fun overlayLocalPointIsNotOffsetTwice() {
        val point = PenPoint(40f, 20f, 0.7f, 3f, 42L)

        val mapped = OverlayCoordinateMapper.toWebCssPoint(
            point,
            PenPointCoordinateSpace.OVERLAY_LOCAL_PHYSICAL_PIXELS,
            context
        )

        assertEquals(20f, mapped.x, 0f)
        assertEquals(10f, mapped.y, 0f)
        assertEquals(point.pressure, mapped.pressure, 0f)
        assertEquals(point.timestamp, mapped.timestamp)
    }

    @Test
    fun hostLocalPointSubtractsOverlayPositionOnce() {
        val point = PenPoint(240f, 120f, 0.7f, 3f, 42L)

        val mapped = OverlayCoordinateMapper.toWebCssPoint(
            point,
            PenPointCoordinateSpace.HOST_VIEW_LOCAL_PHYSICAL_PIXELS,
            context
        )

        assertEquals(20f, mapped.x, 0f)
        assertEquals(10f, mapped.y, 0f)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsInvalidDensity() {
        OverlayCoordinateMapper.toWebCssPoint(
            PenPoint(1f, 1f, 1f, 0f, 1L),
            PenPointCoordinateSpace.OVERLAY_LOCAL_PHYSICAL_PIXELS,
            context.copy(density = 0f)
        )
    }
}
