package org.openinkbridge.sdk

import android.os.Build
import android.view.View

data class EpdAdapterAttempt(
    val backend: String,
    val probeSupported: Boolean,
    val state: EpdAdapterState,
    val reason: String?
)

data class EpdBackendSelectionReport(
    val selectedBackend: String,
    val selectedStatus: EpdAdapterStatus,
    val fallbackReason: String?,
    val attempts: List<EpdAdapterAttempt>
)

class EpdAdapterManager(private val view: View) {
    var activeAdapter: EpdAdapter = FallbackCanvasAdapter()
        private set

    var selectionReport: EpdBackendSelectionReport = EpdBackendSelectionReport(
        selectedBackend = "UnboundAdapter",
        selectedStatus = EpdAdapterStatus(EpdAdapterState.UNINITIALIZED),
        fallbackReason = null,
        attempts = emptyList()
    )
        private set

    var isBound: Boolean = false
        private set

    @Synchronized
    fun bind(): Boolean {
        if (isBound) {
            OpenInkBridgeLogger.d(
                Subsystem.Backend,
                activeAdapter.javaClass.simpleName,
                "BIND_SKIPPED",
                "EpdAdapter is already bound"
            )
            return true
        }

        val manufacturer = Build.MANUFACTURER.lowercase()
        val brand = Build.BRAND.lowercase()
        val hardware = Build.HARDWARE.lowercase()
        val device = Build.DEVICE.lowercase()

        OpenInkBridgeLogger.d(
            Subsystem.Backend,
            "System",
            "HARDWARE_DETECTION",
            "Detecting hardware: Manufacturer=$manufacturer, Brand=$brand, Device=$device, Hardware=$hardware",
            mapOf("manufacturer" to manufacturer, "brand" to brand, "device" to device)
        )

        val candidates: List<() -> EpdAdapter> = when {
            manufacturer.contains("onyx") || brand.contains("onyx") -> {
                listOf(::OnyxBooxEpdAdapter, ::JetpackInkAdapter, ::FallbackCanvasAdapter)
            }
            manufacturer.contains("bigme") || brand.contains("bigme") -> {
                listOf(::BigmeEpdAdapter, ::JetpackInkAdapter, ::FallbackCanvasAdapter)
            }
            device.contains("supernote") -> {
                OpenInkBridgeLogger.w(
                    Subsystem.Backend,
                    "SUPERNOTE",
                    "BACKEND_FALLBACK",
                    "Supernote hardware detected; binding Fallback Canvas Adapter (native integration pending)"
                )
                listOf(::FallbackCanvasAdapter)
            }
            else -> {
                listOf(::JetpackInkAdapter, ::FallbackCanvasAdapter)
            }
        }

        val attempts = mutableListOf<EpdAdapterAttempt>()
        val failureReasons = mutableListOf<String>()

        for (factory in candidates) {
            val adapter = try {
                factory()
            } catch (error: Throwable) {
                val reason = "Backend class could not be loaded: ${error.message ?: error.javaClass.simpleName}"
                failureReasons.add(reason)
                OpenInkBridgeLogger.e(
                    Subsystem.Backend,
                    "System",
                    "BACKEND_LOAD_FAILED",
                    reason
                )
                continue
            }

            val backendName = adapter.javaClass.simpleName
            val introspection = adapter as? EpdAdapterIntrospection
            val probe = try {
                introspection?.probe(view) ?: EpdAdapterProbeResult(supported = true)
            } catch (error: Throwable) {
                EpdAdapterProbeResult(
                    supported = false,
                    reason = "Probe failed: ${error.message ?: error.javaClass.simpleName}"
                )
            }

            if (!probe.supported) {
                val reason = probe.reason ?: "Backend probe reported unsupported"
                attempts.add(EpdAdapterAttempt(backendName, false, EpdAdapterState.UNAVAILABLE, reason))
                failureReasons.add("$backendName: $reason")
                OpenInkBridgeLogger.w(
                    Subsystem.Backend,
                    backendName,
                    "BACKEND_PROBE_REJECTED",
                    reason
                )
                continue
            }

            val status = try {
                adapter.init(view)
                introspection?.status() ?: EpdAdapterStatus(EpdAdapterState.OPERATIONAL)
            } catch (error: Throwable) {
                EpdAdapterStatus(
                    state = EpdAdapterState.UNAVAILABLE,
                    reason = "Initialization failed: ${error.message ?: error.javaClass.simpleName}"
                )
            }
            attempts.add(EpdAdapterAttempt(backendName, true, status.state, status.reason))

            if (!status.canRender) {
                val reason = status.reason ?: "Backend did not become operational"
                failureReasons.add("$backendName: $reason")
                runCatching { adapter.release() }
                OpenInkBridgeLogger.w(
                    Subsystem.Backend,
                    backendName,
                    "BACKEND_INITIALIZATION_REJECTED",
                    reason
                )
                continue
            }

            activeAdapter = adapter
            isBound = true
            selectionReport = EpdBackendSelectionReport(
                selectedBackend = backendName,
                selectedStatus = status,
                fallbackReason = failureReasons.takeIf { it.isNotEmpty() }?.joinToString("; "),
                attempts = attempts.toList()
            )
            OpenInkBridgeLogger.i(
                Subsystem.Backend,
                backendName,
                "INITIALIZATION_COMPLETE",
                "EpdAdapter initialized and bound with state=${status.state}",
                mapOf(
                    "adapter" to backendName,
                    "state" to status.state.name,
                    "reason" to (status.reason ?: "none")
                )
            )
            return true
        }

        val unavailable = EpdAdapterStatus(
            state = EpdAdapterState.UNAVAILABLE,
            reason = failureReasons.joinToString("; ").ifEmpty { "No backend candidates were available" }
        )
        selectionReport = EpdBackendSelectionReport(
            selectedBackend = "UnboundAdapter",
            selectedStatus = unavailable,
            fallbackReason = unavailable.reason,
            attempts = attempts.toList()
        )
        OpenInkBridgeLogger.e(
            Subsystem.Backend,
            "System",
            "NO_OPERATIONAL_BACKEND",
            unavailable.reason ?: "No operational EpdAdapter could be bound"
        )
        return false
    }

    @Synchronized
    fun release() {
        if (!isBound) {
            OpenInkBridgeLogger.d(
                Subsystem.Backend,
                activeAdapter.javaClass.simpleName,
                "RELEASE_SKIPPED",
                "EpdAdapter resources are already released"
            )
            return
        }
        OpenInkBridgeLogger.i(
            Subsystem.Backend,
            activeAdapter.javaClass.simpleName,
            "RELEASE",
            "Releasing EpdAdapter resources"
        )
        runCatching { activeAdapter.endStroke() }
        runCatching { activeAdapter.release() }
        isBound = false
        selectionReport = selectionReport.copy(
            selectedStatus = EpdAdapterStatus(
                state = EpdAdapterState.RELEASED,
                reason = "View is detached or the manager was explicitly released",
                capabilities = selectionReport.selectedStatus.capabilities
            )
        )
    }
}

