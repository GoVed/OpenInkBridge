package org.openinkbridge.sdk

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class StrokeSmootherContractTest {
    @Test
    fun matchesSharedStrokeProcessingContract() {
        val contractText = requireNotNull(
            javaClass.classLoader?.getResourceAsStream("stroke-processing-v1.json")
        ) { "Shared stroke-processing-v1.json contract fixture was not packaged for tests" }
            .bufferedReader()
            .use { it.readText() }
        val contract = JSONObject(contractText)

        assertEquals(1, contract.getInt("schemaVersion"))
        val kernel = contract.getJSONArray("kernel")
        assertEquals(0.25, kernel.getDouble(0), 0.0)
        assertEquals(0.50, kernel.getDouble(1), 0.0)
        assertEquals(0.25, kernel.getDouble(2), 0.0)

        val vectors = contract.getJSONArray("vectors")
        for (vectorIndex in 0 until vectors.length()) {
            val vector = vectors.getJSONObject(vectorIndex)
            val actual = StrokeSmoother.smooth(readPoints(vector, "input"))
            val expected = readPoints(vector, "expected")
            assertEquals(vector.getString("name"), expected.size, actual.size)
            expected.zip(actual).forEachIndexed { pointIndex, (expectedPoint, actualPoint) ->
                val message = "${vector.getString("name")} point $pointIndex"
                assertEquals(message, expectedPoint.x, actualPoint.x, 0.0001f)
                assertEquals(message, expectedPoint.y, actualPoint.y, 0.0001f)
                assertEquals(message, expectedPoint.pressure, actualPoint.pressure, 0.0001f)
                assertEquals(message, expectedPoint.tilt, actualPoint.tilt, 0.0001f)
                assertEquals(message, expectedPoint.timestamp, actualPoint.timestamp)
            }
        }
    }

    @Test
    fun returnsShortStrokeWithoutAllocating() {
        val points = listOf(
            PenPoint(1f, 2f, 0.5f, 0f, 1L),
            PenPoint(3f, 4f, 0.75f, 1f, 2L)
        )

        assertSame(points, StrokeSmoother.smooth(points))
    }

    private fun readPoints(vector: JSONObject, field: String): List<PenPoint> {
        val array = vector.getJSONArray(field)
        return (0 until array.length()).map { index ->
            val point = array.getJSONObject(index)
            PenPoint(
                x = point.getDouble("x").toFloat(),
                y = point.getDouble("y").toFloat(),
                pressure = point.getDouble("pressure").toFloat(),
                tilt = point.getDouble("tilt").toFloat(),
                timestamp = point.getLong("timestamp")
            )
        }
    }
}
