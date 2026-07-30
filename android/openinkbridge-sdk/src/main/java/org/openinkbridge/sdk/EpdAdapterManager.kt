package org.openinkbridge.sdk

import android.os.Build
import android.view.View

class EpdAdapterManager(private val view: View) {
    var activeAdapter: EpdAdapter = FallbackCanvasAdapter()
        private set

    init {
        detectAndBind()
    }

    private fun detectAndBind() {
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

        activeAdapter = when {
            manufacturer.contains("onyx") || brand.contains("onyx") -> {
                OpenInkBridgeLogger.i(
                    Subsystem.Backend,
                    "BOOX",
                    "BACKEND_SELECTED",
                    "Binding Onyx Boox EPD Adapter"
                )
                OnyxBooxEpdAdapter()
            }
            manufacturer.contains("bigme") || brand.contains("bigme") -> {
                OpenInkBridgeLogger.i(
                    Subsystem.Backend,
                    "BIGME",
                    "BACKEND_SELECTED",
                    "Binding Bigme EPD Adapter"
                )
                BigmeEpdAdapter()
            }
            device.contains("supernote") -> {
                OpenInkBridgeLogger.w(
                    Subsystem.Backend,
                    "SUPERNOTE",
                    "BACKEND_FALLBACK",
                    "Supernote hardware detected; binding Fallback Canvas Adapter (native integration pending)"
                )
                FallbackCanvasAdapter()
            }
            else -> {
                OpenInkBridgeLogger.i(
                    Subsystem.Backend,
                    "JETPACK_INK",
                    "BACKEND_SELECTED",
                    "No proprietary E-Ink vendor detected; binding Jetpack Ink Adapter with MotionEventPredictor"
                )
                JetpackInkAdapter()
            }
        }
        activeAdapter.init(view)
        OpenInkBridgeLogger.i(
            Subsystem.Backend,
            activeAdapter.javaClass.simpleName,
            "INITIALIZATION_COMPLETE",
            "EpdAdapter initialized and bound to view",
            mapOf("adapter" to activeAdapter.javaClass.simpleName)
        )
    }

    fun release() {
        OpenInkBridgeLogger.i(
            Subsystem.Backend,
            activeAdapter.javaClass.simpleName,
            "RELEASE",
            "Releasing EpdAdapter resources"
        )
        activeAdapter.release()
    }
}

