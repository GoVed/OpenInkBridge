package org.openinkbridge.sdk

import org.json.JSONArray
import org.json.JSONObject

internal data class BridgeSessionRoute(
    val sessionId: String,
    val canvasId: String
)

internal data class BridgeRect(
    val left: Float,
    val top: Float,
    val width: Float,
    val height: Float
)

internal sealed interface BridgeCommand {
    val route: BridgeSessionRoute
}

internal data class SetWritingModeCommand(
    override val route: BridgeSessionRoute,
    val enabled: Boolean,
    val color: String,
    val width: Float,
    val stylusOnly: Boolean,
    val rect: BridgeRect?
) : BridgeCommand

internal data class StrokeDrawnCommand(
    override val route: BridgeSessionRoute
) : BridgeCommand

internal object BridgeProtocol {
    const val VERSION = 1
    const val MAX_MESSAGE_LENGTH = 1_000_000

    fun parseCommand(message: String): BridgeCommand? {
        if (message.length > MAX_MESSAGE_LENGTH) return null
        val value = runCatching { JSONObject(message) }.getOrNull() ?: return null
        if (value.optInt("protocolVersion", -1) != VERSION) return null

        val route = BridgeSessionRoute(
            sessionId = value.readIdentifier("sessionId") ?: return null,
            canvasId = value.readIdentifier("canvasId") ?: return null
        )

        return when (value.optString("type")) {
            "setWritingMode" -> SetWritingModeCommand(
                route = route,
                enabled = value.optBoolean("enabled", false),
                color = value.optString("color", "#000000"),
                width = value.optFiniteFloat("width", 5f).coerceIn(0.5f, 128f),
                stylusOnly = value.optBoolean("stylusOnly", true),
                rect = value.optJSONObject("rect")?.toBridgeRect()
            )
            "strokeDrawn" -> StrokeDrawnCommand(route)
            else -> null
        }
    }

    fun strokeFinished(route: BridgeSessionRoute, points: JSONArray): String = JSONObject().apply {
        put("protocolVersion", VERSION)
        put("type", "strokeFinished")
        put("sessionId", route.sessionId)
        put("canvasId", route.canvasId)
        put("payload", JSONObject().put("points", points))
    }.toString()

    private fun JSONObject.readIdentifier(name: String): String? {
        val value = optString(name).trim()
        return value.takeIf { it.isNotEmpty() && it.length <= 128 }
    }

    private fun JSONObject.optFiniteFloat(name: String, fallback: Float): Float {
        val value = optDouble(name, fallback.toDouble())
        return if (value.isFinite()) value.toFloat() else fallback
    }

    private fun JSONObject.toBridgeRect(): BridgeRect? {
        val left = optFiniteFloat("left", 0f)
        val top = optFiniteFloat("top", 0f)
        val width = optFiniteFloat("width", 0f)
        val height = optFiniteFloat("height", 0f)
        if (width < 0f || height < 0f) return null
        return BridgeRect(
            left = left.coerceIn(-1_000_000f, 1_000_000f),
            top = top.coerceIn(-1_000_000f, 1_000_000f),
            width = width.coerceAtMost(1_000_000f),
            height = height.coerceAtMost(1_000_000f)
        )
    }
}
