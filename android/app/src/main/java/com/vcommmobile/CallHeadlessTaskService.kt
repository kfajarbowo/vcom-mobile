package com.vcommmobile

import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class CallHeadlessTaskService : HeadlessJsTaskService() {

    companion object {
        const val TAG = "CallHeadlessTaskService"
        const val TASK_KEY = "CallBackgroundTask"
    }

    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        if (intent == null) {
            Log.e(TAG, "Intent is null")
            return null
        }

        val extras = intent.extras
        if (extras == null) {
            Log.e(TAG, "Extras are null")
            return null
        }

        Log.d(TAG, "Starting HeadlessJS task with action: ${extras.getString("action")}")

        val data = Arguments.createMap().apply {
            putString("callId", extras.getString("callId", ""))
            putString("callerId", extras.getString("callerId", ""))
            putString("callerName", extras.getString("callerName", ""))
            putString("callType", extras.getString("callType", "audio"))
            putBoolean("isGroupCall", extras.getBoolean("isGroupCall", false))
            putString("action", extras.getString("action", "reject"))
        }

        return HeadlessJsTaskConfig(
            TASK_KEY,
            data,
            5000, // timeout in ms
            true // allow execution in foreground
        )
    }
}
