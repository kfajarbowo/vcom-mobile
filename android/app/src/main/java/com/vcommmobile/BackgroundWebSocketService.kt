package com.vcommmobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Arguments
import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class BackgroundWebSocketService : Service() {

    companion object {
        const val TAG = "BackgroundWebSocketService"
        const val SERVICE_CHANNEL_ID = "vcomm_background_service"
        const val SERVICE_CHANNEL_NAME = "VComm Background Service"
        const val SERVICE_NOTIFICATION_ID = 2001
        
        private const val RECONNECT_DELAY_MS = 5000L
        private const val MAX_RECONNECT_ATTEMPTS = 100
        private const val PING_INTERVAL_MS = 30000L
    }

    private var webSocket: WebSocket? = null
    private var okHttpClient: OkHttpClient? = null
    private var serviceUrl: String? = null
    private var clientUserId: String? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var reconnectAttempts = 0
    private var isRunning = false
    private var pingHandler: android.os.Handler? = null
    private var pingRunnable: Runnable? = null

    override fun onCreate() {
        super.onCreate()
        createServiceNotificationChannel()
        createMessageNotificationChannel()
        createCallNotificationChannel()
        acquireWakeLock()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            "START" -> {
                serviceUrl = intent.getStringExtra("url")
                clientUserId = intent.getStringExtra("tokenOrUserId")

                if (serviceUrl != null && clientUserId != null) {
                    Log.d(TAG, "🔐 Service starting with clientUserId: $clientUserId")
                    val notification = createServiceNotification()

                    try {
                        if (Build.VERSION.SDK_INT >= 34) { // Android 14+
                            // Use DATA_SYNC type for WebSocket connections on Android 14+
                            startForeground(SERVICE_NOTIFICATION_ID, notification,
                                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
                        } else if (Build.VERSION.SDK_INT >= 29) {
                            startForeground(SERVICE_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
                        } else {
                            startForeground(SERVICE_NOTIFICATION_ID, notification)
                        }
                        Log.d(TAG, "Foreground service started successfully")
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to start foreground service with type: ${e.message}")
                        // Fallback attempt without specific type
                        try {
                             startForeground(SERVICE_NOTIFICATION_ID, notification)
                             Log.d(TAG, "Foreground service started with fallback")
                        } catch (e2: Exception) {
                             Log.e(TAG, "Critical failure to start service: ${e2.message}")
                             stopSelf()
                             return START_NOT_STICKY
                        }
                    }

                    isRunning = true
                    Log.d(TAG, "Connecting to WebSocket...")
                    connectToWebSocket()
                } else {
                    Log.e(TAG, "Missing url or tokenOrUserId - url: $serviceUrl, userId: $clientUserId")
                    stopSelf()
                }
            }
            "STOP" -> {
                stopForegroundService()
            }
        }

        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        disconnectFromWebSocket()
        releaseWakeLock()
    }

    private fun createServiceNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                SERVICE_CHANNEL_ID,
                SERVICE_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps the app connected for incoming calls"
                setShowBadge(false)
            }

            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun createMessageNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CallNotificationModule.MSG_CHANNEL_ID,
                CallNotificationModule.MSG_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Chat message notifications"
                setShowBadge(true)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 500)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
            }

            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun createCallNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CallNotificationModule.CHANNEL_ID,
                CallNotificationModule.CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Incoming call notifications"
                setShowBadge(true)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 1000, 500, 1000, 500, 1000)
                setBypassDnd(true)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC

                val ringtoneUri = android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_RINGTONE)
                val audioAttributes = android.media.AudioAttributes.Builder()
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .build()
                setSound(ringtoneUri, audioAttributes)
            }

            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun createServiceNotification(): Notification {
        val notificationIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            notificationIntent,
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, SERVICE_CHANNEL_ID)
            .setContentTitle("VComm")
            .setContentText("Listening for incoming calls")
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun acquireWakeLock() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "VComm:BackgroundServiceWakeLock"
        ).apply {
            acquire(10 * 60 * 1000L) // 10 minutes max, will be reacquired
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
            }
        }
        wakeLock = null
    }

    private fun connectToWebSocket() {
        if (serviceUrl == null) {
            Log.e(TAG, "Cannot connect: missing URL")
            return
        }

        disconnectFromWebSocket()

        okHttpClient = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS) // No timeout for WebSocket
            .writeTimeout(30, TimeUnit.SECONDS)
            .pingInterval(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
            
        val wsUrl = serviceUrl!!
        Log.d(TAG, "Connecting to WebSocket: $wsUrl")

        val request = Request.Builder()
            .url(wsUrl)
            .build()

        webSocket = okHttpClient!!.newWebSocket(request, createWebSocketListener())
    }

    private fun createWebSocketListener(): WebSocketListener {
        return object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "WebSocket connected")
                reconnectAttempts = 0

                try {
                     val authJson = JSONObject()
                     authJson.put("type", "auth")
                     val payload = JSONObject()

                     val userIdInt = clientUserId?.toIntOrNull()
                     if (userIdInt != null) {
                         payload.put("userId", userIdInt)
                         payload.put("source", "background")  // Identify as background service
                         authJson.put("payload", payload)
                         Log.d(TAG, "Sending auth for userId: $userIdInt (background)")
                         webSocket.send(authJson.toString())
                     } else {
                         Log.w(TAG, "User ID not numeric, skipping automatic auth")
                     }
                } catch (e: Exception) {
                    Log.e(TAG, "Error constructing auth message: ${e.message}")
                }

                // Start application-level ping
                startPingHandler()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                Log.d(TAG, "Message received: $text")
                handleWebSocketMessage(text)
            }
            
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closing: $code - $reason")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closed: $code - $reason")
                scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failure: ${t.message}")
                scheduleReconnect()
            }
        }
    }

    private fun handleWebSocketMessage(message: String) {
        try {
            val json = JSONObject(message)
            val type = json.optString("type")

            val isAppForeground = MainActivity.isAppInForeground
            Log.d(TAG, "Received message type: $type, app in foreground: $isAppForeground")

            if (type == "incoming_call") {
                 val payload = json.optJSONObject("payload") ?: json
                 val callId = payload.optString("callId", "")
                 val callerId = payload.optString("fromUserId", "")
                 val callerName = payload.optString("fromUserName", "Unknown")
                 val callType = payload.optString("callType", "audio")
                 val isGroupCall = payload.optBoolean("isGroupCall", false)

                 Log.d(TAG, "Incoming call from $callerName (callId: $callId)")
                 // Pass the full payload (as string) to preserve the offer/SDP
                 val payloadString = payload.toString()

                 // Only show notification/activity if app is NOT in foreground
                 // When app is in foreground, the React Native UI will handle it
                 if (!isAppForeground) {
                     Log.d(TAG, "App in background, showing incoming call notification/activity")
                     showIncomingCallNotification(callId, callerId, callerName, callType, isGroupCall, payloadString)
                     // Also emit the event to JS side (in case app wakes up)
                     emitCallEvent(callId, callerId, callerName, callType, isGroupCall, payloadString)
                 } else {
                     Log.d(TAG, "App in foreground, skipping notification (React Native will handle)")
                 }
            } else if (type == "new_message") {
                val payload = json.optJSONObject("payload") ?: json
                val senderName = payload.optString("senderName", "Unknown")
                val content = payload.optString("content", "")
                val conversationId = payload.optString("conversationId", "")
                // Handle senderId as either string or number from JSON
                val senderIdRaw = payload.opt("senderId")
                val senderId = senderIdRaw?.toString() ?: ""

                Log.d(TAG, "📨 New message received:")
                Log.d(TAG, "  - senderName: $senderName")
                Log.d(TAG, "  - content: ${content.take(50)}...")
                Log.d(TAG, "  - conversationId: $conversationId")
                Log.d(TAG, "  - senderId (raw): $senderIdRaw, (string): $senderId")
                Log.d(TAG, "  - clientUserId: $clientUserId")
                Log.d(TAG, "  - isAppForeground: $isAppForeground")
                Log.d(TAG, "  - senderId != clientUserId: ${senderId != clientUserId}")

                // Don't show notification for messages from ourselves
                // Only show notification if app is NOT in foreground
                if (senderId.isNotEmpty() && senderId != clientUserId && !isAppForeground) {
                    Log.d(TAG, "✅ Showing chat notification from $senderName")
                    showChatNotification(senderName, content, conversationId, senderId)
                } else if (senderId.isNotEmpty() && senderId != clientUserId && isAppForeground) {
                    Log.d(TAG, "⏭️ App in foreground, skipping chat notification (React Native will handle)")
                } else if (senderId == clientUserId) {
                    Log.d(TAG, "⏭️ Skipping own message notification")
                } else {
                    Log.d(TAG, "❌ Skipping notification - senderId empty or other condition")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing WebSocket message: ${e.message}")
        }
    }

    private fun showIncomingCallNotification(
        callId: String,
        callerId: String,
        callerName: String,
        callType: String,
        isGroupCall: Boolean,
        payload: String
    ) {
        Log.d(TAG, "Showing incoming call notification via CallNotificationModule")

        // Use CallNotificationModule to show the notification if available
        val module = CallNotificationModule.getInstance()
        if (module != null) {
            module.showIncomingCallNotificationInternal(callId, callerId, callerName, callType, isGroupCall, payload)
        } else {
            // Fallback: Show notification directly
            showIncomingCallNotificationDirect(callId, callerId, callerName, callType, isGroupCall, payload)
        }
    }

    private fun showIncomingCallNotificationDirect(
        callId: String,
        callerId: String,
        callerName: String,
        callType: String,
        isGroupCall: Boolean,
        payload: String
    ) {
        Log.d(TAG, "Showing incoming call notification directly")

        // Full-screen intent for when the screen is locked
        val fullScreenIntent = Intent(this, IncomingCallActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_NO_USER_ACTION or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("callId", callId)
            putExtra("callerId", callerId)
            putExtra("callerName", callerName)
            putExtra("callType", callType)
            putExtra("isGroupCall", isGroupCall)
            putExtra("payload", payload)
        }

        val fullScreenPendingIntent = PendingIntent.getActivity(
            this,
            3, // REQUEST_CODE_FULLSCREEN
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Accept action
        val acceptIntent = Intent(this, CallActionReceiver::class.java).apply {
            action = "com.vcommmobile.ACCEPT_CALL"
            putExtra("callId", callId)
            putExtra("callerId", callerId)
            putExtra("callerName", callerName)
            putExtra("callType", callType)
            putExtra("isGroupCall", isGroupCall)
            putExtra("payload", payload)
        }
        val acceptPendingIntent = PendingIntent.getBroadcast(
            this,
            1, // REQUEST_CODE_ACCEPT
            acceptIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Reject action
        val rejectIntent = Intent(this, CallActionReceiver::class.java).apply {
            action = "com.vcommmobile.REJECT_CALL"
            putExtra("callId", callId)
            putExtra("callerId", callerId)
            putExtra("callerName", callerName)
            putExtra("callType", callType)
            putExtra("isGroupCall", isGroupCall)
        }
        val rejectPendingIntent = PendingIntent.getBroadcast(
            this,
            2, // REQUEST_CODE_REJECT
            rejectIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Get ringtone URI
        val ringtoneUri = android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_RINGTONE)

        val callTypeLabel = if (callType == "video") "Video Call" else "Voice Call"
        val groupLabel = if (isGroupCall) " (Group)" else ""

        val notification = NotificationCompat.Builder(this, CallNotificationModule.CHANNEL_ID)
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

        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        notificationManager.notify(CallNotificationModule.NOTIFICATION_ID, notification)
        Log.d(TAG, "Incoming call notification posted")
    }

    private fun emitCallEvent(
        callId: String,
        callerId: String,
        callerName: String,
        callType: String,
        isGroupCall: Boolean,
        payload: String
    ) {
        val params = Arguments.createMap().apply {
            putString("callId", callId)
            putString("callerId", callerId)
            putString("callerName", callerName)
            putString("callType", callType)
            putBoolean("isGroupCall", isGroupCall)
            putString("payload", payload)
        }

        CallNotificationModule.emitEvent("onIncomingCall", params)
    }

    private fun showChatNotification(
        senderName: String,
        content: String,
        conversationId: String,
        senderId: String
    ) {
        Log.d(TAG, "📲 showChatNotification called:")
        Log.d(TAG, "  - senderName: $senderName")
        Log.d(TAG, "  - content: ${content.take(50)}")
        Log.d(TAG, "  - conversationId: $conversationId")
        Log.d(TAG, "  - senderId: $senderId")

        // Use CallNotificationModule to show the notification if available
        val module = CallNotificationModule.getInstance()
        if (module != null) {
            Log.d(TAG, "📲 Using CallNotificationModule for notification")
            module.showChatNotificationInternal(senderName, content, conversationId, senderId)
        } else {
            Log.d(TAG, "📲 CallNotificationModule not available, using direct notification")
            // Fallback: Show notification directly
            showChatNotificationDirect(senderName, content, conversationId)
        }
        Log.d(TAG, "📲 Notification shown successfully")
    }

    private fun showChatNotificationDirect(
        senderName: String,
        content: String,
        conversationId: String
    ) {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("conversationId", conversationId)
        }

        val pendingIntent = PendingIntent.getActivity(
            this,
            System.currentTimeMillis().toInt(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notificationId = conversationId.hashCode()

        val notification = NotificationCompat.Builder(this, CallNotificationModule.MSG_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle(senderName)
            .setContentText(content)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setVibrate(longArrayOf(0, 500))
            .setDefaults(NotificationCompat.DEFAULT_SOUND)
            .build()

        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        Log.d(TAG, "📲 Posting notification with ID: $notificationId, channel: ${CallNotificationModule.MSG_CHANNEL_ID}")
        notificationManager.notify(notificationId, notification)
        Log.d(TAG, "📲 Notification posted to system")
    }

    private fun scheduleReconnect() {
        if (!isRunning) return

        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++
            Log.d(TAG, "Scheduling reconnect attempt $reconnectAttempts")

            android.os.Handler(mainLooper).postDelayed({
                if (isRunning) {
                    connectToWebSocket()
                }
            }, RECONNECT_DELAY_MS * reconnectAttempts)
        } else {
            Log.e(TAG, "Max reconnect attempts reached")
        }
    }

    private fun startPingHandler() {
        stopPingHandler()
        pingHandler = android.os.Handler(mainLooper)
        pingRunnable = object : Runnable {
            override fun run() {
                webSocket?.let { ws ->
                    try {
                        val pingJson = JSONObject()
                        pingJson.put("type", "ping")
                        ws.send(pingJson.toString())
                        Log.d(TAG, "Ping sent")
                    } catch (e: Exception) {
                        Log.e(TAG, "Error sending ping: ${e.message}")
                    }
                }
                pingHandler?.postDelayed(this, PING_INTERVAL_MS)
            }
        }
        pingHandler?.postDelayed(pingRunnable!!, PING_INTERVAL_MS)
    }

    private fun stopPingHandler() {
        pingRunnable?.let { pingHandler?.removeCallbacks(it) }
        pingHandler = null
        pingRunnable = null
    }

    private fun disconnectFromWebSocket() {
        stopPingHandler()
        webSocket?.close(1000, "Service stopping")
        webSocket = null
        okHttpClient?.dispatcher?.executorService?.shutdown()
        okHttpClient = null
    }

    private fun stopForegroundService() {
        isRunning = false
        disconnectFromWebSocket()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }
}
