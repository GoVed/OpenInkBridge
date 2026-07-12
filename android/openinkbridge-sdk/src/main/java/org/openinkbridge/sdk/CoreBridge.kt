package org.openinkbridge.sdk

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * Native JNI bridge connecting Kotlin to the optimized Rust Core engine.
 * Automatically falls back to a Kotlin implementation of the smoothing algorithm
 * if the shared native library is not compiled or loaded.
 */
object CoreBridge {
    private var isNativeLibraryLoaded = false

    init {
        try {
            System.loadLibrary("openinkbridge_core")
            isNativeLibraryLoaded = true
            Log.i("OpenInkBridge", "Successfully loaded native Rust core library")
        } catch (e: UnsatisfiedLinkError) {
            Log.w("OpenInkBridge", "Native Rust core library not found; falling back to Kotlin implementations", e)
        }
    }

    /**
     * Smooths a list of PenPoints. Calls native Rust JNI method if available,
     * otherwise runs local Kotlin moving-average calculation.
     */
    fun smoothStroke(points: List<PenPoint>): List<PenPoint> {
        if (points.size < 3) return points

        if (isNativeLibraryLoaded) {
            try {
                val jsonInput = strokePointsToJson(points)
                val jsonOutput = smoothStroke(jsonInput)
                return jsonToStrokePoints(jsonOutput)
            } catch (e: Exception) {
                Log.e("OpenInkBridge", "JNI Stroke smoothing execution failed; falling back to Kotlin", e)
            }
        }

        // Fallback Kotlin moving-average logic
        return smoothPointsFallback(points)
    }

    // Declaring the native Rust JNI method
    private external fun smoothStroke(pointsJson: String): String

    private fun strokePointsToJson(points: List<PenPoint>): String {
        val array = JSONArray()
        for (p in points) {
            val obj = JSONObject().apply {
                put("x", p.x.toDouble())
                put("y", p.y.toDouble())
                put("pressure", p.pressure.toDouble())
                put("tilt", p.tilt.toDouble())
                put("timestamp", p.timestamp)
            }
            array.put(obj)
        }
        return array.toString()
    }

    private fun jsonToStrokePoints(jsonStr: String): List<PenPoint> {
        val list = mutableListOf<PenPoint>()
        val array = JSONArray(jsonStr)
        for (i in 0 until array.length()) {
            val obj = array.getJSONObject(i)
            list.add(
                PenPoint(
                    x = obj.getDouble("x").toFloat(),
                    y = obj.getDouble("y").toFloat(),
                    pressure = obj.getDouble("pressure").toFloat(),
                    tilt = obj.getDouble("tilt").toFloat(),
                    timestamp = obj.getLong("timestamp")
                )
            )
        }
        return list
    }

    private fun smoothPointsFallback(points: List<PenPoint>): List<PenPoint> {
        val smoothed = mutableListOf<PenPoint>()
        smoothed.add(points[0])

        for (i in 1 until points.size - 1) {
            val prev = points[i - 1]
            val curr = points[i]
            val next = points[i + 1]
            smoothed.add(
                PenPoint(
                    x = (prev.x + curr.x + next.x) / 3f,
                    y = (prev.y + curr.y + next.y) / 3f,
                    pressure = (prev.pressure + curr.pressure + next.pressure) / 3f,
                    tilt = (prev.tilt + curr.tilt + next.tilt) / 3f,
                    timestamp = curr.timestamp
                )
            )
        }
        smoothed.add(points.last())
        return smoothed
    }
}
