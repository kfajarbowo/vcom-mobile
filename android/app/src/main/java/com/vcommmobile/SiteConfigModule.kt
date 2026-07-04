package com.vcommmobile

import android.content.Intent
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Receives site connection info handed over by the Portal app as intent extras
 * (site_ip / site_port / site_name / site_code, see Portal's AppLauncher) and
 * exposes it to JS so the server configuration can be switched automatically.
 */
class SiteConfigModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val TAG = "SiteConfigModule"

        private var instance: SiteConfigModule? = null

        // Config from an intent that arrived before JS was listening (cold start).
        // Kept until JS consumes it via consumeInitialSiteConfig(); applying the
        // same config twice is a no-op on the JS side.
        @Volatile
        private var pending: SiteConfig? = null

        data class SiteConfig(
            val ip: String,
            val port: Int,
            val siteName: String?,
            val siteCode: String?
        )

        /** Called from MainActivity for both onCreate and onNewIntent. */
        fun handleIntent(intent: Intent) {
            val ip = intent.getStringExtra("site_ip") ?: return
            val port = intent.getIntExtra("site_port", 0)
            if (ip.isBlank() || port <= 0) return

            val config = SiteConfig(
                ip = ip,
                port = port,
                siteName = intent.getStringExtra("site_name"),
                siteCode = intent.getStringExtra("site_code")
            )
            Log.d(TAG, "Received site config from intent: $config")

            pending = config
            instance?.emit(config)

            // Clear the extras to prevent re-processing
            intent.removeExtra("site_ip")
            intent.removeExtra("site_port")
            intent.removeExtra("site_name")
            intent.removeExtra("site_code")
            intent.removeExtra("site_url")
        }

        private fun toMap(config: SiteConfig): WritableMap =
            Arguments.createMap().apply {
                putString("ip", config.ip)
                putInt("port", config.port)
                putString("siteName", config.siteName)
                putString("siteCode", config.siteCode)
            }
    }

    init {
        instance = this
    }

    override fun getName(): String = "SiteConfigModule"

    private fun emit(config: SiteConfig) {
        try {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("onSiteConfig", toMap(config))
        } catch (e: Exception) {
            // JS not ready yet; config stays pending until consumeInitialSiteConfig()
            Log.w(TAG, "Could not emit site config event: ${e.message}")
        }
    }

    /** Returns and clears the config received before JS was listening, or null. */
    @ReactMethod
    fun consumeInitialSiteConfig(promise: Promise) {
        val config = pending
        pending = null
        promise.resolve(config?.let { toMap(it) })
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN event emitter
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN event emitter
    }
}
