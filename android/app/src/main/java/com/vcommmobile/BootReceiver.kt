package com.vcommmobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context?, intent: Intent?) {
        if (context == null || intent == null) return

        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == "android.intent.action.QUICKBOOT_POWERON") {

            Log.d(TAG, "Boot completed, checking if Gotify service should start")

            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val serviceEnabled = prefs.getBoolean(KEY_SERVICE_ENABLED, false)
            val gotifyUrl = prefs.getString(KEY_GOTIFY_URL, null)
            val clientToken = prefs.getString(KEY_CLIENT_TOKEN, null)

            if (serviceEnabled && gotifyUrl != null && clientToken != null) {
                Log.d(TAG, "Starting Gotify service after boot")

                val serviceIntent = Intent(context, GotifyForegroundService::class.java).apply {
                    action = "START"
                    putExtra("gotifyUrl", gotifyUrl)
                    putExtra("clientToken", clientToken)
                }

                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        context.startForegroundService(serviceIntent)
                    } else {
                        context.startService(serviceIntent)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error starting Gotify service: ${e.message}")
                }
            } else {
                Log.d(TAG, "Gotify service not configured, skipping")
            }
        }
    }

    companion object {
        const val TAG = "BootReceiver"
        const val PREFS_NAME = "GotifyServicePrefs"
        const val KEY_GOTIFY_URL = "gotifyUrl"
        const val KEY_CLIENT_TOKEN = "clientToken"
        const val KEY_SERVICE_ENABLED = "serviceEnabled"

        fun saveServiceConfig(
            context: Context,
            gotifyUrl: String,
            clientToken: String,
            enabled: Boolean
        ) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().apply {
                putString(KEY_GOTIFY_URL, gotifyUrl)
                putString(KEY_CLIENT_TOKEN, clientToken)
                putBoolean(KEY_SERVICE_ENABLED, enabled)
                apply()
            }
        }

        fun clearServiceConfig(context: Context) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().apply {
                remove(KEY_GOTIFY_URL)
                remove(KEY_CLIENT_TOKEN)
                putBoolean(KEY_SERVICE_ENABLED, false)
                apply()
            }
        }
    }
}
