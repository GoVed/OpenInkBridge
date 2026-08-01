package org.openinkbridge.sdk

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
            OpenInkBridgeLogger.i(
                Subsystem.Core,
                "JNI",
                "NATIVE_LIBRARY_LOADED",
                "Successfully loaded native Rust core library (libopeninkbridge_core.so)"
            )
        } catch (e: UnsatisfiedLinkError) {
            OpenInkBridgeLogger.w(
                Subsystem.Core,
                "JNI",
                "NATIVE_LIBRARY_FALLBACK",
                "Native Rust core library not found; falling back to Kotlin implementations",
                mapOf("error" to (e.message ?: "UnsatisfiedLinkError"))
            )
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
                val startTime = System.currentTimeMillis()
                val jsonInput = strokePointsToJson(points)
                val jsonOutput = smoothStroke(jsonInput)
                val result = jsonToStrokePoints(jsonOutput)
                val duration = System.currentTimeMillis() - startTime
                OpenInkBridgeLogger.d(
                    Subsystem.Performance,
                    "JNI",
                    "STROKE_SMOOTH_PERF",
                    "Native Rust JNI stroke smoothing completed in ${duration}ms for ${points.size} points"
                )
                return result
            } catch (e: Exception) {
                OpenInkBridgeLogger.e(
                    Subsystem.Core,
                    "JNI",
                    "JNI_EXECUTION_FAILED",
                    "JNI Stroke smoothing execution failed; falling back to Kotlin implementation",
                    mapOf("error" to (e.message ?: "Exception"))
                )
            }
        } else {
            OpenInkBridgeLogger.d(
                Subsystem.Core,
                "KotlinFallback",
                "STROKE_SMOOTH_FALLBACK",
                "Using Kotlin fallback moving average for ${points.size} points"
            )
        }

        return StrokeSmoother.smooth(points)
    }

    fun setNativeLogLevel(level: LogLevel) {
        if (isNativeLibraryLoaded) {
            try {
                setLogLevel(level.name)
            } catch (e: Exception) {
                OpenInkBridgeLogger.w(Subsystem.Core, "JNI", "SET_LOG_LEVEL_FAILED", "Could not set native log level: ${e.message}")
            }
        }
    }

    fun getNativeDiagnostics(backendName: String): String? {
        if (isNativeLibraryLoaded) {
            return try {
                getDiagnosticsJson(backendName)
            } catch (e: Exception) {
                null
            }
        }
        return null
    }

    // Declaring the native Rust JNI methods
    private external fun smoothStroke(pointsJson: String): String
    private external fun setLogLevel(levelStr: String)
    private external fun getDiagnosticsJson(backendName: String): String
    private external fun getRingBufferLogsJson(): String

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

}

