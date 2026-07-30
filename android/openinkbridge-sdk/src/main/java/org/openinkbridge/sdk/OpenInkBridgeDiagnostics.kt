package org.openinkbridge.sdk

import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

data class CapabilitiesReport(
    val pressure: Boolean = true,
    val tilt: Boolean = false,
    val hover: Boolean = true,
    val eraser: Boolean = true,
    val refreshModes: List<String> = listOf("SPEED", "BALANCED", "QUALITY"),
    val hardwareAcceleration: Boolean = true
)

data class DiagnosticsData(
    val version: String = "0.1.1",
    val platform: String = "Android SDK",
    val osVersion: String = Build.VERSION.RELEASE,
    val apiLevel: Int = Build.VERSION.SDK_INT,
    val deviceModel: String = Build.MODEL,
    val manufacturer: String = Build.MANUFACTURER,
    val brand: String = Build.BRAND,
    val hardware: String = Build.HARDWARE,
    val selectedBackend: String,
    val availableBackends: List<String>,
    val fallbackReason: String?,
    val capabilities: CapabilitiesReport,
    val refreshMode: String,
    val directDrawingActive: Boolean,
    val recentLogs: List<LogEntry>
) {
    fun toJson(): String {
        val obj = JSONObject().apply {
            put("version", version)
            put("platform", platform)
            put("osVersion", osVersion)
            put("apiLevel", apiLevel)
            put("deviceModel", deviceModel)
            put("manufacturer", manufacturer)
            put("brand", brand)
            put("hardware", hardware)
            put("selectedBackend", selectedBackend)
            put("availableBackends", JSONArray(availableBackends))
            put("fallbackReason", fallbackReason ?: JSONObject.NULL)

            val caps = JSONObject().apply {
                put("pressure", capabilities.pressure)
                put("tilt", capabilities.tilt)
                put("hover", capabilities.hover)
                put("eraser", capabilities.eraser)
                put("refreshModes", JSONArray(capabilities.refreshModes))
                put("hardwareAcceleration", capabilities.hardwareAcceleration)
            }
            put("capabilities", caps)
            put("refreshMode", refreshMode)
            put("directDrawingActive", directDrawingActive)

            val logsArr = JSONArray()
            for (entry in recentLogs) {
                val logObj = JSONObject().apply {
                    put("timestamp", entry.timestamp)
                    put("level", entry.level.name)
                    put("subsystem", entry.subsystem.name)
                    put("backend", entry.backend)
                    put("event", entry.event)
                    put("message", entry.message)
                }
                logsArr.put(logObj)
            }
            put("recentLogs", logsArr)
        }
        return obj.toString(2)
    }
}

object OpenInkBridgeDiagnostics {

    fun collectDiagnostics(adapterManager: EpdAdapterManager? = null): DiagnosticsData {
        val activeAdapter = adapterManager?.activeAdapter
        val backendName = activeAdapter?.javaClass?.simpleName ?: "UnboundAdapter"
        val isDirectDrawing = activeAdapter?.isDirectDrawingActive() ?: false

        val available = listOf(
            "OnyxBooxEpdAdapter",
            "BigmeEpdAdapter",
            "JetpackInkAdapter",
            "FallbackCanvasAdapter"
        )

        val fallbackReason = if (backendName == "FallbackCanvasAdapter") {
            "No specialized E-Ink SDK detected for ${Build.MANUFACTURER} / ${Build.BRAND} / ${Build.MODEL}"
        } else {
            null
        }

        return DiagnosticsData(
            version = "0.1.1",
            platform = "Android SDK",
            osVersion = Build.VERSION.RELEASE,
            apiLevel = Build.VERSION.SDK_INT,
            deviceModel = Build.MODEL,
            manufacturer = Build.MANUFACTURER,
            brand = Build.BRAND,
            hardware = Build.HARDWARE,
            selectedBackend = backendName,
            availableBackends = available,
            fallbackReason = fallbackReason,
            capabilities = CapabilitiesReport(
                pressure = true,
                tilt = Build.MANUFACTURER.lowercase().contains("onyx"),
                hover = true,
                eraser = true,
                refreshModes = listOf("SPEED", "BALANCED", "QUALITY", "REGAL", "DU"),
                hardwareAcceleration = isDirectDrawing
            ),
            refreshMode = "SPEED",
            directDrawingActive = isDirectDrawing,
            recentLogs = OpenInkBridgeLogger.getRingBufferLogs()
        )
    }

    fun dumpConfiguration(adapterManager: EpdAdapterManager? = null): String {
        val diag = collectDiagnostics(adapterManager)
        val sb = StringBuilder()
        sb.append("========== OpenInkBridge Diagnostics ==========\n")
        sb.append("Version: ${diag.version}\n")
        sb.append("Platform: ${diag.platform} (Android ${diag.osVersion}, API ${diag.apiLevel})\n")
        sb.append("Device: ${diag.manufacturer} ${diag.modelName()} (${diag.brand} / ${diag.hardware})\n")
        sb.append("Selected Backend: ${diag.selectedBackend}\n")
        sb.append("Available Backends: ${diag.availableBackends.joinToString(", ")}\n")
        if (diag.fallbackReason != null) {
            sb.append("Fallback Reason: ${diag.fallbackReason}\n")
        }
        sb.append("Capabilities:\n")
        sb.append("  - Pressure: ${if (diag.capabilities.pressure) "Supported" else "Unsupported"}\n")
        sb.append("  - Tilt: ${if (diag.capabilities.tilt) "Supported" else "Unsupported"}\n")
        sb.append("  - Hover: ${if (diag.capabilities.hover) "Supported" else "Unsupported"}\n")
        sb.append("  - Eraser: ${if (diag.capabilities.eraser) "Supported" else "Unsupported"}\n")
        sb.append("  - Refresh Modes: [${diag.capabilities.refreshModes.joinToString(", ")}]\n")
        sb.append("  - Hardware Acceleration: ${if (diag.capabilities.hardwareAcceleration) "Enabled" else "Disabled"}\n")
        sb.append("Refresh Mode: ${diag.refreshMode}\n")
        sb.append("Direct Drawing Active: ${diag.directDrawingActive}\n")
        sb.append("===============================================\n")
        return sb.toString()
    }

    fun createBugReport(adapterManager: EpdAdapterManager? = null): String {
        val sb = StringBuilder(dumpConfiguration(adapterManager))
        sb.append("\n========== Recent Warnings & Errors ==========\n")
        val warnErrorLogs = OpenInkBridgeLogger.getRingBufferLogs().filter {
            it.level == LogLevel.WARN || it.level == LogLevel.ERROR
        }

        if (warnErrorLogs.isEmpty()) {
            sb.append("No warnings or errors reported in recent log buffer.\n")
        } else {
            for (entry in warnErrorLogs) {
                sb.append("${entry.formatLine()}\n")
            }
        }
        sb.append("===============================================\n")
        return sb.toString()
    }

    private fun DiagnosticsData.modelName(): String = if (deviceModel.isEmpty()) "Generic" else deviceModel
}
