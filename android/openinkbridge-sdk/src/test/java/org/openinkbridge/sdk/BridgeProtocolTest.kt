package org.openinkbridge.sdk

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeProtocolTest {
    private val contract: JSONObject by lazy {
        val text = requireNotNull(
            javaClass.classLoader?.getResourceAsStream("bridge-protocol-v1.json")
        ) { "Shared bridge-protocol-v1.json fixture was not packaged for tests" }
            .bufferedReader()
            .use { it.readText() }
        JSONObject(text)
    }

    @Test
    fun parsesSharedProtocolCommands() {
        assertEquals(BridgeProtocol.VERSION, contract.getInt("schemaVersion"))

        val writing = BridgeProtocol.parseCommand(contract.getJSONObject("setWritingMode").toString())
        assertTrue(writing is SetWritingModeCommand)
        writing as SetWritingModeCommand
        assertEquals("session-contract", writing.route.sessionId)
        assertEquals("canvas-contract", writing.route.canvasId)
        assertEquals("#123456", writing.color)
        assertEquals(7f, writing.width, 0f)
        assertEquals(300f, writing.rect?.width ?: -1f, 0f)

        val drawn = BridgeProtocol.parseCommand(contract.getJSONObject("strokeDrawn").toString())
        assertTrue(drawn is StrokeDrawnCommand)
        assertEquals("session-contract", drawn?.route?.sessionId)
    }

    @Test
    fun emitsSharedScopedStrokeEnvelope() {
        val expected = contract.getJSONObject("strokeFinished")
        val actual = JSONObject(
            BridgeProtocol.strokeFinished(
                BridgeSessionRoute("session-contract", "canvas-contract"),
                expected.getJSONObject("payload").getJSONArray("points")
            )
        )

        assertEquals(expected.toString(), actual.toString())
    }

    @Test
    fun rejectsMalformedFutureAndOversizedMessages() {
        assertNull(BridgeProtocol.parseCommand("{broken"))
        assertNull(BridgeProtocol.parseCommand(contract.getJSONObject("setWritingMode").apply {
            put("protocolVersion", 2)
        }.toString()))
        assertNull(BridgeProtocol.parseCommand(" ".repeat(BridgeProtocol.MAX_MESSAGE_LENGTH + 1)))
    }
}
