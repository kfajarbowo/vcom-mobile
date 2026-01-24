package com.vcommmobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Arguments
import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class GotifyForegroundService : Service() {

    companion object {
        const val TAG = "GotifyForegroundService"
        const val SERVICE_CHANNEL_ID = "gotify_service"
        const val SERVICE_CHANNEL_NAME = "Background Notification Service"
        const val SERVICE_NOTIFICATION_ID = 2001

        private const val RECONNECT_DELAY_MS = 5000L
        private const val MAX_RECONNECT_ATTEMPTS = 10
    }

    private var webSocket: WebSocket? = null
    private var okHttpClient: OkHttpClient? = null
    private var gotifyUrl: String? = null
    private var clientToken: String? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var reconnectAttempts = 0
    private var isRunning = false

    override fun onCreate() {
        super.onCreate()
        createServiceNotificationChannel()
        acquireWakeLock()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            "START" -> {
                gotifyUrl = intent.getStringExtra("gotifyUrl")
                clientToken = intent.getStringExtra("clientToken")

                if (gotifyUrl != null && clientToken != null) {
                    startForeground(SERVICE_NOTIFICATION_ID, createServiceNotification())
                    isRunning = true
                    connectToGotify()
                } else {
                    Log.e(TAG, "Missing gotifyUrl or clientToken")
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
        disconnectFromGotify()
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
            .setContentText("Connected for incoming calls")
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun acquireWakeLock() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "VComm:GotifyServiceWakeLock"
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

    private fun connectToGotify() {
        if (gotifyUrl == null || clientToken == null) {
            Log.e(TAG, "Cannot connect: missing URL or token")
            return
        }

        disconnectFromGotify()

        okHttpClient = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS) // No timeout for WebSocket
            .writeTimeout(30, TimeUnit.SECONDS)
            .pingInterval(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()

        // Convert HTTP URL to WebSocket URL
        val wsUrl = gotifyUrl!!
            .replace("https://", "wss://")
            .replace("http://", "ws://")
            .trimEnd('/') + "/stream?token=$clientToken"

        Log.d(TAG, "Connecting to Gotify WebSocket: $wsUrl")

        val request = Request.Builder()
            .url(wsUrl)
            .build()

        webSocket = okHttpClient!!.newWebSocket(request, createWebSocketListener())
    }

    private fun createWebSocketListener(): WebSocketListener {
        return object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "Gotify WebSocket connected")
                reconnectAttempts = 0
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                Log.d(TAG, "Gotify message received: $text")
                handleGotifyMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "Gotify WebSocket closing: $code - $reason")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "Gotify WebSocket closed: $code - $reason")
                scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "Gotify WebSocket failure: ${t.message}")
                scheduleReconnect()
            }
        }
    }

    private fun handleGotifyMessage(message: String) {
        try {
            val json = JSONObject(message)
            val extras = json.optJSONObject("extras")
            val data = extras?.optJSONObject("data") ?: extras?.optJSONObject("client::notification")?.optJSONObject("data")

            if (data != null && data.optString("type") == "call") {
                val callId = data.optString("callId", "")
                val callerId = data.optString("callerId", "")
                val callerName = data.optString("callerName", "Unknown")
                val callType = data.optString("callType", "audio")
                val isGroupCall = data.optBoolean("isGroupCall", false)

                Log.d(TAG, "Incoming call from $callerName (callId: $callId)")

                // Show incoming call notification
                showIncomingCallNotification(callId, callerId, callerName, callType, isGroupCall)

                // Emit event to React Native
                emitCallEvent(callId, callerId, callerName, callType, isGroupCall)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing Gotify message: ${e.message}")
        }
    }

    private fun showIncomingCallNotification(
        callId: String,
        callerId: String,
        callerName: String,
        callType: String,
        isGroupCall: Boolean
    ) {
        val intent = Intent(this, IncomingCallActivity::class.java).apply {
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

        startActivity(intent)
    }

    private fun emitCallEvent(
        callId: String,
        callerId: String,
        callerName: String,
        callType: String,
        isGroupCall: Boolean
    ) {
        val params = Arguments.createMap().apply {
            putString("callId", callId)
            putString("callerId", callerId)
            putString("callerName", callerName)
            putString("callType", callType)
            putBoolean("isGroupCall", isGroupCall)
        }

        CallNotificationModule.emitEvent("onIncomingCall", params)
    }

    private fun scheduleReconnect() {
        if (!isRunning) return

        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++
            Log.d(TAG, "Scheduling reconnect attempt $reconnectAttempts")

            android.os.Handler(mainLooper).postDelayed({
                if (isRunning) {
                    connectToGotify()
                }
            }, RECONNECT_DELAY_MS * reconnectAttempts)
        } else {
            Log.e(TAG, "Max reconnect attempts reached")
        }
    }

    private fun disconnectFromGotify() {
        webSocket?.close(1000, "Service stopping")
        webSocket = null
        okHttpClient?.dispatcher?.executorService?.shutdown()
        okHttpClient = null
    }

    private fun stopForegroundService() {
        isRunning = false
        disconnectFromGotify()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }
}
