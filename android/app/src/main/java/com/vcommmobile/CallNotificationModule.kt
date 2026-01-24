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
            Log.d(TAG, "Showing incoming call notification: $callerName, $callType")

            val context = reactApplicationContext

            // Create full-screen intent for IncomingCallActivity
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
            }

            val fullScreenPendingIntent = PendingIntent.getActivity(
                context,
                REQUEST_CODE_FULLSCREEN,
                fullScreenIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            // Accept action intent
            val acceptIntent = Intent(context, CallActionReceiver::class.java).apply {
                action = "com.vcommmobile.ACCEPT_CALL"
                putExtra("callId", callId)
                putExtra("callerId", callerId)
                putExtra("callerName", callerName)
                putExtra("callType", callType)
                putExtra("isGroupCall", isGroupCall)
            }
            val acceptPendingIntent = PendingIntent.getBroadcast(
                context,
                REQUEST_CODE_ACCEPT,
                acceptIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            // Reject action intent
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

            // Build notification
            val callTypeText = if (callType == "video") "Video Call" else "Voice Call"
            val groupText = if (isGroupCall) " (Group)" else ""

            val ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)

            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_menu_call)
                .setContentTitle("$callerName$groupText")
                .setContentText("Incoming $callTypeText")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setFullScreenIntent(fullScreenPendingIntent, true)
                .setContentIntent(fullScreenPendingIntent)
                .setOngoing(true)
                .setAutoCancel(false)
                .setTimeoutAfter(30000) // 30 second timeout
                .setSound(ringtoneUri)
                .setVibrate(longArrayOf(0, 1000, 500, 1000, 500, 1000))
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .addAction(
                    android.R.drawable.ic_menu_close_clear_cancel,
                    "Reject",
                    fullScreenPendingIntent
                )
                .addAction(
                    android.R.drawable.ic_menu_call,
                    "Accept",
                    fullScreenPendingIntent
                )
                .build()

            // Check notification permission for Android 13+
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                    Log.w(TAG, "POST_NOTIFICATIONS permission not granted")
                    promise.resolve(false)
                    return
                }
            }

            val notificationManager = NotificationManagerCompat.from(context)
            notificationManager.notify(NOTIFICATION_ID, notification)

            Log.d(TAG, "Notification shown successfully")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error showing notification: ${e.message}")
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun cancelCallNotification(promise: Promise) {
        try {
            val notificationManager = NotificationManagerCompat.from(reactApplicationContext)
            notificationManager.cancel(NOTIFICATION_ID)

            // Also close IncomingCallActivity if open
            val intent = Intent("com.vcommmobile.CLOSE_INCOMING_CALL_ACTIVITY")
            reactApplicationContext.sendBroadcast(intent)

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun startGotifyService(gotifyUrl: String, clientToken: String, promise: Promise) {
        try {
            Log.d(TAG, "Starting Gotify service with URL: $gotifyUrl")
            val intent = Intent(reactApplicationContext, GotifyForegroundService::class.java).apply {
                action = "START"
                putExtra("gotifyUrl", gotifyUrl)
                putExtra("clientToken", clientToken)
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactApplicationContext.startForegroundService(intent)
            } else {
                reactApplicationContext.startService(intent)
            }

            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error starting Gotify service: ${e.message}")
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopGotifyService(promise: Promise) {
        try {
            val intent = Intent(reactApplicationContext, GotifyForegroundService::class.java).apply {
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
