package org.openinkbridge.sdk

/** Kotlin implementation of the canonical 0.25 / 0.50 / 0.25 stroke kernel. */
internal object StrokeSmoother {
    fun smooth(points: List<PenPoint>): List<PenPoint> {
        if (points.size < 3) return points

        val smoothed = ArrayList<PenPoint>(points.size)
        smoothed.add(points.first())
        for (index in 1 until points.lastIndex) {
            val previous = points[index - 1]
            val current = points[index]
            val next = points[index + 1]
            smoothed.add(
                PenPoint(
                    x = previous.x * 0.25f + current.x * 0.50f + next.x * 0.25f,
                    y = previous.y * 0.25f + current.y * 0.50f + next.y * 0.25f,
                    pressure = previous.pressure * 0.25f +
                        current.pressure * 0.50f +
                        next.pressure * 0.25f,
                    tilt = previous.tilt * 0.25f + current.tilt * 0.50f + next.tilt * 0.25f,
                    timestamp = current.timestamp
                )
            )
        }
        smoothed.add(points.last())
        return smoothed
    }
}
