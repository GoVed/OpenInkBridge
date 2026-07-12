package org.openinkbridge.sdk

import android.os.Build
import android.util.Log
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

        Log.d("OpenInkBridge", "Detecting hardware: Manufacturer=$manufacturer, Brand=$brand, Device=$device")

        activeAdapter = when {
            manufacturer.contains("onyx") || brand.contains("onyx") -> {
                Log.i("OpenInkBridge", "Binding Onyx Boox EPD Adapter")
                OnyxBooxEpdAdapter()
            }
            manufacturer.contains("bigme") || brand.contains("bigme") -> {
                Log.i("OpenInkBridge", "Binding Bigme EPD Adapter")
                BigmeEpdAdapter()
            }
            device.contains("supernote") -> {
                Log.i("OpenInkBridge", "Binding Supernote EPD Adapter (Fallback)")
                FallbackCanvasAdapter() // Placeholder for Supernote specific implementation
            }
            else -> {
                Log.i("OpenInkBridge", "No custom E-Ink hardware detected. Binding Jetpack Ink Adapter.")
                JetpackInkAdapter()
            }
        }
        activeAdapter.init(view)
    }

    fun release() {
        activeAdapter.release()
    }
}
