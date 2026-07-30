package org.openinkbridge.sdk

import android.util.Log
import java.util.ArrayDeque

enum class LogLevel(val severity: Int) {
    ERROR(0),
    WARN(1),
    INFO(2),
    DEBUG(3),
    TRACE(4);

    companion object {
        fun fromString(str: String): LogLevel {
            return when (str.uppercase()) {
                "ERROR" -> ERROR
                "WARN", "WARNING" -> WARN
                "INFO" -> INFO
                "DEBUG" -> DEBUG
                "TRACE" -> TRACE
                else -> INFO
            }
        }
    }
}

enum class Subsystem {
    Core,
    Backend,
    Renderer,
    PenInput,
    Refresh,
    Synchronization,
    JsBridge,
    Android,
    Linux,
    Performance,
    Configuration,
    Networking
}

data class LogEntry(
    val timestamp: Long = System.currentTimeMillis(),
    val level: LogLevel,
    val subsystem: Subsystem,
    val backend: String,
    val event: String,
    val message: String,
    val parameters: Map<String, String>? = null
) {
    fun formatLine(): String {
        val paramStr = if (parameters.isNullOrEmpty()) "" else " ${parameters.entries.joinToString(", ") { "${it.key}=${it.value}" }}"
        val bName = if (backend.isEmpty()) "System" else backend
        return "[${level.name}][${subsystem.name}][$bName] $event: $message$paramStr"
    }
}

object OpenInkBridgeLogger {
    var logLevel: LogLevel = LogLevel.INFO
    private const val BUFFER_CAPACITY = 500
    private val ringBuffer = ArrayDeque<LogEntry>(BUFFER_CAPACITY)
    private var lastTraceTimestamp: Long = 0L

    @Synchronized
    fun log(
        level: LogLevel,
        subsystem: Subsystem,
        backend: String,
        event: String,
        message: String,
        parameters: Map<String, String>? = null
    ) {
        val entry = LogEntry(
            timestamp = System.currentTimeMillis(),
            level = level,
            subsystem = subsystem,
            backend = backend,
            event = event,
            message = message,
            parameters = parameters
        )

        // Always push to in-memory RingBuffer
        if (ringBuffer.size >= BUFFER_CAPACITY) {
            ringBuffer.removeFirst()
        }
        ringBuffer.addLast(entry)

        // Forward to Android system logcat if level <= configured threshold
        if (level.severity <= logLevel.severity) {
            val tag = "OpenInkBridge"
            val formatted = entry.formatLine()
            when (level) {
                LogLevel.ERROR -> Log.e(tag, formatted)
                LogLevel.WARN -> Log.w(tag, formatted)
                LogLevel.INFO -> Log.i(tag, formatted)
                LogLevel.DEBUG -> Log.d(tag, formatted)
                LogLevel.TRACE -> Log.v(tag, formatted)
            }
        }
    }

    @Synchronized
    fun shouldLogTrace(minIntervalMs: Long = 20L): Boolean {
        val now = System.currentTimeMillis()
        if (now >= lastTraceTimestamp + minIntervalMs) {
            lastTraceTimestamp = now
            return true
        }
        return false
    }

    fun e(subsystem: Subsystem, backend: String, event: String, message: String, params: Map<String, String>? = null) {
        log(LogLevel.ERROR, subsystem, backend, event, message, params)
    }

    fun w(subsystem: Subsystem, backend: String, event: String, message: String, params: Map<String, String>? = null) {
        log(LogLevel.WARN, subsystem, backend, event, message, params)
    }

    fun i(subsystem: Subsystem, backend: String, event: String, message: String, params: Map<String, String>? = null) {
        log(LogLevel.INFO, subsystem, backend, event, message, params)
    }

    fun d(subsystem: Subsystem, backend: String, event: String, message: String, params: Map<String, String>? = null) {
        log(LogLevel.DEBUG, subsystem, backend, event, message, params)
    }

    fun t(subsystem: Subsystem, backend: String, event: String, message: String, params: Map<String, String>? = null) {
        log(LogLevel.TRACE, subsystem, backend, event, message, params)
    }

    @Synchronized
    fun getRingBufferLogs(): List<LogEntry> {
        return ringBuffer.toList()
    }

    @Synchronized
    fun clearRingBuffer() {
        ringBuffer.clear()
    }
}
