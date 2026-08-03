package com.vcommmobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.HeadlessJsTaskService

class CallActionReceiver : BroadcastReceiver() {

    companion object {
        const val TAG = "CallActionReceiver"
    }

    override fun onReceive(context: Context?, intent: Intent?) {
        if (context == null || intent == null) return

        val action = intent.action
        val callId = intent.getStringExtra("callId") ?: ""
        val callerId = intent.getStringExtra("callerId") ?: ""
        val callerName = intent.getStringExtra("callerName") ?: "Unknown"
        val callType = intent.getStringExtra("callType") ?: "audio"
        val isGroupCall = intent.getBooleanExtra("isGroupCall", false)
        val hasCallId = intent.getBooleanExtra("hasCallId", false)
        val hasCallerUserId = intent.getBooleanExtra("hasCallerUserId", false)
        val hasOffer = intent.getBooleanExtra("hasOffer", false)


        Log.d(TAG, "Received action: $action for call $callId")

        // Cancel the notification
        val notificationManager = NotificationManagerCompat.from(context)
        notificationManager.cancel(CallNotificationModule.NOTIFICATION_ID)

        // Close the IncomingCallActivity if open. setPackage keeps the broadcast
        // inside this app: the VPN variant is installed alongside the regular
        // VComm, and an unrestricted broadcast would close the other one's
        // incoming-call screen too.
        val closeIntent = Intent("com.vcommmobile.CLOSE_INCOMING_CALL_ACTIVITY")
            .setPackage(context.packageName)
        context.sendBroadcast(closeIntent)

        when (action) {
            "com.vcommmobile.ACCEPT_CALL" -> handleAccept(context, callId, callerId, callerName, callType, isGroupCall, hasCallerUserId, hasCallId, hasOffer)
            "com.vcommmobile.REJECT_CALL" -> handleReject(context, callId, callerId, callerName, callType, isGroupCall, hasCallerUserId, hasCallId, hasOffer)
        }
    }

    private fun handleAccept(
        context: Context,
        callId: String,
        callerId: String,
        callerName: String,
        callType: String,
        isGroupCall: Boolean,
        hasCallId: Boolean,
        hasCallerUserId: Boolean,
        hasOffer: Boolean
    ) {
        Log.d(TAG, "Accepting call: $callId")

        // Emit event if module is available
        val params = Arguments.createMap().apply {
            putString("callId", callId)
            putString("callerId", callerId)
            putString("callerName", callerName)
            putString("callType", callType)
            putBoolean("isGroupCall", isGroupCall)
            putString("action", "accept")
            putBoolean("hasCallId", hasCallId)
            putBoolean("hasCallerUserId", hasCallerUserId)
            putBoolean("hasOffer", hasOffer)
        }
        CallNotificationModule.emitEvent("onCallAction", params)

        // Launch IncomingCallActivity directly to show the full-screen call UI
        val callIntent = Intent(context, IncomingCallActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("callId", callId)
            putExtra("callerId", callerId)
            putExtra("callerName", callerName)
            putExtra("callType", callType)
            putExtra("isGroupCall", isGroupCall)
            putExtra("autoAccept", true) // Auto-accept the call since user tapped Accept
        }
        context.startActivity(callIntent)
    }

    private fun handleReject(
        context: Context,
        callId: String,
        callerId: String,
        callerName: String,
        callType: String,
        isGroupCall: Boolean,
        hasCallId: Boolean,
        hasCallerUserId: Boolean,
        hasOffer: Boolean
    ) {
        Log.d(TAG, "Rejecting call: $callId")

        // Emit event if module is available
        val params = Arguments.createMap().apply {
            putString("callId", callId)
            putString("callerId", callerId)
            putString("callerName", callerName)
            putString("callType", callType)
            putBoolean("isGroupCall", isGroupCall)
            putString("action", "reject")
            putBoolean("hasCallId", hasCallId)
            putBoolean("hasCallerUserId", hasCallerUserId)
            putBoolean("hasOffer", hasOffer)
        }
        CallNotificationModule.emitEvent("onCallAction", params)

        // Start HeadlessJS task to send rejection via WebSocket
        val serviceIntent = Intent(context, CallHeadlessTaskService::class.java).apply {
            putExtra("callId", callId)
            putExtra("callerId", callerId)
            putExtra("callerName", callerName)
            putExtra("callType", callType)
            putExtra("isGroupCall", isGroupCall)
            putExtra("action", "reject")
            putExtra("hasCallId", hasCallId)
            putExtra("hasCallerUserId", hasCallerUserId)
            putExtra("hasOffer", hasOffer)
        }

        try {
            context.startService(serviceIntent)
            HeadlessJsTaskService.acquireWakeLockNow(context)
        } catch (e: Exception) {
            Log.e(TAG, "Error starting HeadlessJS task: ${e.message}")
        }
    }
}
