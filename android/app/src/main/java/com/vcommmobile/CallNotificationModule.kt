package com.vcommmobile

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class CallNotificationModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val TAG = "CallNotificationModule"
        const val CHANNEL_ID = "incoming_calls"
        const val CHANNEL_NAME = "Incoming Calls"
        const val MSG_CHANNEL_ID = "chat_messages"
        const val MSG_CHANNEL_NAME = "Chat Messages"
        const val NOTIFICATION_ID = 1001
        
        const val REQUEST_CODE_ACCEPT = 1
        const val REQUEST_CODE_REJECT = 2
        const val REQUEST_CODE_FULLSCREEN = 3

        private var instance: CallNotificationModule? = null

        fun getInstance(): CallNotificationModule? = instance

        fun emitEvent(eventName: String, params: WritableMap?) {
            instance?.sendEvent(eventName, params)
        }
    }

    init {
        instance = this
        createNotificationChannel()
        createMessageNotificationChannel()
    }

    override fun getName(): String = "CallNotificationModule"

    private fun sendEvent(eventName: String, params: WritableMap?) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, importance).apply {
                description = "Incoming call notifications"
                setShowBadge(true)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 1000, 500, 1000, 500, 1000)
                setBypassDnd(true)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC

                val ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                val audioAttributes = AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .build()
                setSound(ringtoneUri, audioAttributes)
            }

            val notificationManager = reactApplicationContext
                .getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun createMessageNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel(MSG_CHANNEL_ID, MSG_CHANNEL_NAME, importance).apply {
                description = "Chat message notifications"
                setShowBadge(true)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 500)
                setBypassDnd(false)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
            }

            val notificationManager = reactApplicationContext
                .getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    @ReactMethod
    fun showIncomingCallNotification(
        callId: String,
        callerId: String,
        callerName: String,
        callType: String,
        isGroupCall: Boolean,
        promise: Promise
    ) {
        try {
            Log.d(TAG, "Showing incoming call notification for callId: $callId")
            showIncomingCallNotificationInternal(callId, callerId, callerName, callType, isGroupCall, null)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error showing incoming call notification: ${e.message}")
            promise.reject("ERROR", e.message)
        }
    }

    fun showIncomingCallNotificationInternal(
        callId: String,
        callerId: String,
        callerName: String,
        callType: String,
        isGroupCall: Boolean,
        payload: String?
    ) {
        val context = reactApplicationContext

        // Full-screen intent for when the screen is locked
        val fullScreenIntent = Intent(context, IncomingCallActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_NO_USER_ACTION or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("callId", callId)
            putExtra("callerId", callerId)
            putExtra("callerName", callerName)
            putExtra("callType", callType)
            putExtra("isGroupCall", isGroupCall)
            if (payload != null) {
                putExtra("payload", payload)
            }
        }

        val fullScreenPendingIntent = PendingIntent.getActivity(
            context,
            REQUEST_CODE_FULLSCREEN,
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Accept action
        val acceptIntent = Intent(context, CallActionReceiver::class.java).apply {
            action = "com.vcommmobile.ACCEPT_CALL"
            putExtra("callId", callId)
            putExtra("callerId", callerId)
            putExtra("callerName", callerName)
            putExtra("callType", callType)
            putExtra("isGroupCall", isGroupCall)
            if (payload != null) {
                putExtra("payload", payload)
            }
        }
        val acceptPendingIntent = PendingIntent.getBroadcast(
            context,
            REQUEST_CODE_ACCEPT,
            acceptIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Reject action
        val rejectIntent = Intent(context, CallActionReceiver::class.java).apply {
            action = "com.vcommmobile.REJECT_CALL"
            putExtra("callId", callId)
            putExtra("callerId", callerId)
            putExtra("callerName", callerName)
            putExtra("callType", callType)
            putExtra("isGroupCall", isGroupCall)
        }
        val rejectPendingIntent = PendingIntent.getBroadcast(
            context,
            REQUEST_CODE_REJECT,
            rejectIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Get ringtone URI
        val ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)

        val callTypeLabel = if (callType == "video") "Video Call" else "Voice Call"
        val groupLabel = if (isGroupCall) " (Group)" else ""

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle("Incoming $callTypeLabel$groupLabel")
            .setContentText(callerName)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(30000) // Auto-dismiss after 30 seconds
            .setSound(ringtoneUri)
            .setVibrate(longArrayOf(0, 1000, 500, 1000, 500, 1000))
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .setContentIntent(fullScreenPendingIntent)
            // .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", rejectPendingIntent)
            // .addAction(android.R.drawable.ic_menu_call, "Answer", acceptPendingIntent)
            .build()

        // Check permission for Android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                Log.w(TAG, "Notification permission not granted, trying to start activity directly")
                // Try to start activity as fallback (may be blocked by Android)
                try {
                    val intent = Intent(context, IncomingCallActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                        putExtra("callId", callId)
                        putExtra("callerId", callerId)
                        putExtra("callerName", callerName)
                        putExtra("callType", callType)
                        putExtra("isGroupCall", isGroupCall)
                        if (payload != null) {
                            putExtra("payload", payload)
                        }
                    }
                    context.startActivity(intent)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to start activity: ${e.message}")
                }
                return
            }
        }

        val notificationManager = NotificationManagerCompat.from(context)
        notificationManager.notify(NOTIFICATION_ID, notification)
        Log.d(TAG, "Incoming call notification posted with ID: $NOTIFICATION_ID")
    }

    @ReactMethod
    fun showChatNotification(
        title: String,
        message: String,
        conversationId: String,
        senderId: String,
        promise: Promise
    ) {
        try {
            showChatNotificationInternal(title, message, conversationId, senderId)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error showing chat notification: ${e.message}")
            promise.reject("ERROR", e.message)
        }
    }

    fun showChatNotificationInternal(
        title: String,
        message: String,
        conversationId: String,
        senderId: String
    ) {
        Log.d(TAG, "Showing chat notification from $title")

        val context = reactApplicationContext
        
        // Pending intent to open app
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("conversationId", conversationId) // Deep link param
        }
        
        val pendingIntent = PendingIntent.getActivity(
            context, 
            System.currentTimeMillis().toInt(), 
            intent, 
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notificationId = conversationId.hashCode()

        val notification = NotificationCompat.Builder(context, MSG_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle(title)
            .setContentText(message)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setVibrate(longArrayOf(0, 500))
            .setDefaults(NotificationCompat.DEFAULT_SOUND)
            .build()

        // Check permission
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                return
            }
        }

        val notificationManager = NotificationManagerCompat.from(context)
        notificationManager.notify(notificationId, notification)
    }

    @ReactMethod
    fun startBackgroundService(url: String, tokenOrUserId: String, promise: Promise) {
        try {
            Log.d(TAG, "Starting background service with URL: $url")
            val intent = Intent(reactApplicationContext, BackgroundWebSocketService::class.java).apply {
                action = "START"
                putExtra("url", url)
                putExtra("tokenOrUserId", tokenOrUserId)
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactApplicationContext.startForegroundService(intent)
            } else {
                reactApplicationContext.startService(intent)
            }

            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error starting background service: ${e.message}")
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopBackgroundService(promise: Promise) {
        try {
            val intent = Intent(reactApplicationContext, BackgroundWebSocketService::class.java).apply {
                action = "STOP"
            }
            reactApplicationContext.stopService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun requestNotificationPermission(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val activity = currentActivity
                if (activity != null) {
                    if (ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
                        ActivityCompat.requestPermissions(
                            activity,
                            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                            1234
                        )
                        promise.resolve("requested")
                    } else {
                        promise.resolve("granted")
                    }
                } else {
                    promise.resolve("no_activity")
                }
            } else {
                promise.resolve("not_required")
            }
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun checkNotificationPermission(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val granted = ContextCompat.checkSelfPermission(
                    reactApplicationContext,
                    Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED
                promise.resolve(granted)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
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
