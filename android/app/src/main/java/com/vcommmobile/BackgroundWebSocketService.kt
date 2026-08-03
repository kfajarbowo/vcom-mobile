package com.vcommmobile

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.provider.Settings
import android.net.Uri
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
        private const val MAX_RECONNECT_DELAY_MS = 60000L
        private const val PING_INTERVAL_MS = 30000L
    }

    // @Volatile: written on the main thread, read on OkHttp's WS callback threads (onClosed/
    // onFailure use it as the current-socket identity guard).
    @Volatile private var webSocket: WebSocket? = null
    // Tracks whether the current socket is open+authenticated. Used both to gate the network
    // callback's reconnect (don't tear down a healthy socket) and the onStartCommand idempotency
    // check (a non-null-but-dead socket must not read as healthy).
    @Volatile private var isConnected = false
    private var okHttpClient: OkHttpClient? = null
    private var serviceUrl: String? = null
    private var clientUserId: String? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var reconnectAttempts = 0
    private var isRunning = false
    private var pingHandler: android.os.Handler? = null
    private var pingRunnable: Runnable? = null
    // The callId currently ringing via a native notification/full-screen activity (set when we
    // post an incoming call while backgrounded/killed). Lets a later cancellation message dismiss
    // exactly the call it belongs to.
    @Volatile private var ringingCallId: String? = null
    // A SINGLE handler + tracked runnable for reconnects, so a pending reconnect can actually be
    // cancelled. (The old code created a fresh Handler per scheduleReconnect, so removeCallbacks
    // could never target it — a root cause of the perpetual flap loop.)
    private val reconnectHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private var reconnectRunnable: Runnable? = null
    private var connectivityCallback: ConnectivityManager.NetworkCallback? = null

    override fun onCreate() {
        super.onCreate()
        createServiceNotificationChannel()
        createMessageNotificationChannel()
        createCallNotificationChannel()
        acquireWakeLock()
        registerNetworkCallback()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Explicit stop request (logout / disable).
        if (intent?.action == "STOP") {
            stopForegroundService()
            return START_NOT_STICKY
        }

        // Resolve credentials. On a fresh START they come from the intent extras; on a
        // START_STICKY system restart (intent == null) or a boot restart they must be
        // reloaded from persisted config, because serviceUrl/clientUserId are in-memory
        // only and are lost when the process is recreated.
        val prefs = getSharedPreferences(BootReceiver.PREFS_NAME, Context.MODE_PRIVATE)
        val url = intent?.getStringExtra("url") ?: prefs.getString(BootReceiver.KEY_GOTIFY_URL, null)
        val userId = intent?.getStringExtra("tokenOrUserId") ?: prefs.getString(BootReceiver.KEY_CLIENT_TOKEN, null)

        if (url.isNullOrEmpty() || userId.isNullOrEmpty()) {
            Log.e(TAG, "No url/userId in intent and none persisted (action=${intent?.action}); stopping")
            stopSelf()
            return START_NOT_STICKY
        }

        Log.d(TAG, "🔐 Service (re)starting with clientUserId: $userId (action=${intent?.action ?: "restart"})")

        // Persist so a future sticky/boot restart can recover without the JS layer.
        BootReceiver.saveServiceConfig(this, url, userId, true)

        // Always (re)enter the foreground promptly. This is required both for a fresh
        // startForegroundService() call and for a sticky restart, and it is safe to call
        // repeatedly (it just refreshes the ongoing notification).
        startAsForeground()

        // Idempotency: if we are already connected with the same credentials, keep the
        // existing healthy socket instead of tearing it down and reconnecting. This makes
        // the "ensure on foreground" calls from JS cheap. Gate on isConnected (set in onOpen,
        // cleared in onClosed/onFailure) rather than webSocket != null: a socket that has failed
        // but whose field hasn't been replaced yet would otherwise read as healthy and this
        // "ensure" would no-op against a dead connection while a long backoff runs.
        val alreadyHealthy = isRunning && url == serviceUrl && userId == clientUserId && isConnected && webSocket != null

        serviceUrl = url
        clientUserId = userId
        isRunning = true

        if (alreadyHealthy) {
            Log.d(TAG, "Service already running with same credentials; keeping existing connection")
        } else {
            Log.d(TAG, "Connecting to WebSocket...")
            connectToWebSocket()
        }

        return START_STICKY
    }

    /**
     * Promote the service to the foreground. Uses the DATA_SYNC foreground-service type,
     * which (unlike PHONE_CALL) has no runtime prerequisite on Android 14+, so it starts
     * reliably from the app foreground, from a sticky restart and from boot.
     */
    private fun startAsForeground() {
        val notification = createServiceNotification()
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(SERVICE_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else {
                startForeground(SERVICE_NOTIFICATION_ID, notification)
            }
            Log.d(TAG, "Foreground service started successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start foreground service with type: ${e.message}")
            // Fallback attempt without an explicit type argument.
            try {
                startForeground(SERVICE_NOTIFICATION_ID, notification)
                Log.d(TAG, "Foreground service started with fallback")
            } catch (e2: Exception) {
                Log.e(TAG, "Critical failure to start service: ${e2.message}")
                stopSelf()
            }
        }
    }

    /**
     * When the user swipes the app away from recents the hosting process may be killed on
     * aggressive OEMs.
     *
     * Primary recovery is START_STICKY: the system restarts the service (delivering a null
     * intent) and onStartCommand recovers from the persisted config. On Android 11 and
     * below we ALSO schedule an explicit alarm restart as a belt-and-suspenders. We do NOT
     * do this on Android 12+ (S): starting a foreground service from the background is
     * restricted there, and a PendingIntent-triggered start would throw
     * ForegroundServiceStartNotAllowedException — so we lean on START_STICKY instead.
     *
     * Note: a hard force-stop by an aggressive OEM cancels both START_STICKY and alarms and
     * requires the user to whitelist / reopen the app. That is inherent to a no-FCM design.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        Log.d(TAG, "Task removed; relying on START_STICKY for restart")
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            try {
                if (isRunning && serviceUrl != null && clientUserId != null) {
                    val restartIntent = Intent(applicationContext, BackgroundWebSocketService::class.java).apply {
                        action = "START"
                        putExtra("url", serviceUrl)
                        putExtra("tokenOrUserId", clientUserId)
                    }
                    val piFlags = PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
                    val pendingIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        PendingIntent.getForegroundService(applicationContext, 101, restartIntent, piFlags)
                    } else {
                        PendingIntent.getService(applicationContext, 101, restartIntent, piFlags)
                    }
                    val alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager
                    alarmManager.setAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        System.currentTimeMillis() + 1500,
                        pendingIntent
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error scheduling restart on task removal: ${e.message}")
            }
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        cancelScheduledReconnect()
        unregisterNetworkCallback()
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
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            // Reuse a single, non-reference-counted wake lock. Re-calling acquire() just
            // resets its timeout instead of leaking a new lock each time (the old code
            // overwrote the field on every call, leaking the previous lock). Acquired only
            // around connect/reconnect (bounded work), NOT continuously.
            if (wakeLock == null) {
                wakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "VComm:BackgroundServiceWakeLock"
                ).apply {
                    setReferenceCounted(false)
                }
            }
            wakeLock?.acquire(15 * 60 * 1000L)
        } catch (e: Exception) {
            Log.e(TAG, "Error acquiring wake lock: ${e.message}")
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

        // Cancel any pending reconnect: we are connecting right now, so a queued reconnect would
        // only tear this fresh socket down again.
        cancelScheduledReconnect()

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
                // Ignore an open from a socket we've already superseded.
                if (webSocket !== this@BackgroundWebSocketService.webSocket) {
                    Log.d(TAG, "Ignoring onOpen from stale WebSocket")
                    return
                }
                Log.d(TAG, "WebSocket connected")
                reconnectAttempts = 0
                isConnected = true
                // Connected: cancel any still-pending reconnect and release the wake lock we held
                // across the (now-finished) connect work. Holding it for the whole session drains
                // battery; the foreground service + OkHttp pings keep the socket warm.
                cancelScheduledReconnect()
                releaseWakeLock()

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
                // Ignore messages from a stale/superseded socket (e.g. one still closing
                // during a reconnect). Only the current socket is authoritative — this
                // prevents a session_terminated aimed at a socket we already replaced from
                // tearing down a healthy new connection.
                if (webSocket !== this@BackgroundWebSocketService.webSocket) {
                    Log.d(TAG, "Ignoring message from stale WebSocket")
                    return
                }
                Log.d(TAG, "Message received: $text")
                handleWebSocketMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closing: $code - $reason")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closed: $code - $reason")
                // Only the CURRENT socket's termination may schedule a reconnect. A socket we
                // closed ourselves during a reconnect/replace (disconnectFromWebSocket nulls the
                // field before the callback fires) is stale — reconnecting on it created the
                // perpetual 5s flap loop.
                if (webSocket !== this@BackgroundWebSocketService.webSocket) {
                    Log.d(TAG, "Ignoring onClosed from stale WebSocket (self-initiated close)")
                    return
                }
                isConnected = false
                scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failure: ${t.message}")
                if (webSocket !== this@BackgroundWebSocketService.webSocket) {
                    Log.d(TAG, "Ignoring onFailure from stale WebSocket")
                    return
                }
                isConnected = false
                // Null the dead socket so isConnected/alreadyHealthy checks and the current-socket
                // identity guards treat it as gone.
                this@BackgroundWebSocketService.webSocket = null
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

            // The server invalidated this session (the same user authenticated elsewhere
            // with source="background"). Stop for good so we do not fight the other device
            // in a reconnect/re-auth war and do not keep delivering to a superseded device.
            // Clear persisted config so we also do not restart on the next boot/sticky kill.
            if (type == "session_terminated") {
                Log.d(TAG, "Session terminated by server; clearing config and stopping background service")
                BootReceiver.clearServiceConfig(this)
                // Stop on the main thread (this runs on the OkHttp WS thread).
                android.os.Handler(mainLooper).post { stopForegroundService() }
                return
            }

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
                     ringingCallId = callId
                     showIncomingCallNotification(callId, callerId, callerName, callType, isGroupCall, payloadString)
                     // Also emit the event to JS side (in case app wakes up)
                     emitCallEvent(callId, callerId, callerName, callType, isGroupCall, payloadString)
                 } else {
                     Log.d(TAG, "App in foreground, skipping notification (React Native will handle)")
                 }
            } else if (type == "incoming_group_call") {
                 // The server delivers group-call invitations as their own type. Without this branch
                 // a backgrounded/killed device would never ring for a group call (the JS gate refuses
                 // to post while not foreground, expecting the native service to own it).
                 val payload = json.optJSONObject("payload") ?: json
                 val callId = payload.optString("callId", "")
                 val callerId = payload.optString("fromUserId", "")
                 val groupName = payload.optString("groupName", "")
                 val callerName = payload.optString("fromUserName", "Unknown")
                 val callType = payload.optString("callType", "audio")
                 val displayName = if (groupName.isNotEmpty()) groupName else callerName
                 val payloadString = payload.toString()

                 Log.d(TAG, "Incoming group call '$displayName' (callId: $callId)")
                 if (!isAppForeground) {
                     Log.d(TAG, "App in background, showing incoming group call notification/activity")
                     ringingCallId = callId
                     showIncomingCallNotification(callId, callerId, displayName, callType, true, payloadString)
                     emitCallEvent(callId, callerId, displayName, callType, true, payloadString)
                 } else {
                     Log.d(TAG, "App in foreground, skipping group call notification (React Native will handle)")
                 }
            } else if (type == "call_ended" || type == "end_call" || type == "call_missed" ||
                       type == "call_rejected" || type == "call_failed" || type == "group_call_ended") {
                 // The ringing call was cancelled/ended/timed out on the server side. When the app
                 // process is alive JS dismisses the notification; when it is killed only the native
                 // service can, so cancel the notification and close the full-screen activity for the
                 // matching call. Without this a killed-app callee keeps ringing for up to ~30s after
                 // the caller has already hung up.
                 val payload = json.optJSONObject("payload") ?: json
                 val cancelCallId = payload.optString("callId", "")
                 val ringing = ringingCallId
                 if (ringing != null && (cancelCallId.isEmpty() || cancelCallId == ringing)) {
                     Log.d(TAG, "Dismissing ringing call $ringing due to '$type'")
                     cancelIncomingCallUi()
                     ringingCallId = null
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

    /**
     * Dismiss any active incoming-call UI: cancel the notification and broadcast the close intent
     * that IncomingCallActivity listens for. Used when a ringing call is cancelled/ended remotely
     * while the app process is not alive to handle it in JS.
     */
    private fun cancelIncomingCallUi() {
        try {
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.cancel(CallNotificationModule.NOTIFICATION_ID)
            // setPackage: varian VPN terpasang berdampingan dengan VComm biasa,
            // dan broadcast tanpa batas package bisa menutup layar panggilan
            // milik aplikasi sebelah.
            sendBroadcast(
                Intent("com.vcommmobile.CLOSE_INCOMING_CALL_ACTIVITY").setPackage(packageName)
            )
            Log.d(TAG, "Incoming call UI dismissed (notification cancelled + close broadcast sent)")
        } catch (e: Exception) {
            Log.e(TAG, "Error dismissing incoming call UI: ${e.message}")
        }
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

        // Collapse duplicate reconnects: cancel any already-pending one before scheduling a new
        // one, so we never have two reconnect runnables racing (each of which would close the
        // other's socket).
        cancelScheduledReconnect()

        acquireWakeLock() // Hold the wake lock across the (bounded) reconnect work
        reconnectAttempts++
        val delay = minOf(RECONNECT_DELAY_MS * reconnectAttempts, MAX_RECONNECT_DELAY_MS)
        Log.d(TAG, "Scheduling reconnect attempt $reconnectAttempts (delay: ${delay}ms)")

        val runnable = Runnable {
            reconnectRunnable = null
            if (isRunning) {
                connectToWebSocket()
            }
        }
        reconnectRunnable = runnable
        reconnectHandler.postDelayed(runnable, delay)
    }

    private fun cancelScheduledReconnect() {
        reconnectRunnable?.let { reconnectHandler.removeCallbacks(it) }
        reconnectRunnable = null
    }

    private fun startPingHandler() {
        stopPingHandler()
        pingHandler = android.os.Handler(mainLooper)
        pingRunnable = object : Runnable {
            override fun run() {
                // NOTE: intentionally do NOT renew the wake lock here. Holding a
                // PARTIAL_WAKE_LOCK for the whole (multi-day) authenticated session is a
                // battery drain and makes aggressive OEMs more likely to kill the app. The
                // foreground service keeps the process alive, OkHttp's pingInterval keeps
                // the socket warm while the CPU is awake, an inbound packet wakes the CPU on
                // its own, and the battery-optimization exemption covers Doze. The lock is
                // acquired only around connect/reconnect (bounded work).
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

    private fun registerNetworkCallback() {
        try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            connectivityCallback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    // Only (re)connect if we don't already have a healthy socket. This callback
                    // fires immediately on registration for the already-active network (which would
                    // otherwise double-connect against onStartCommand and seed the flap loop), and
                    // on every Wi-Fi<->cellular handoff even when the current socket is still fine.
                    if (isConnected && webSocket != null) {
                        Log.d(TAG, "Network available but socket already healthy; not reconnecting")
                        return
                    }
                    Log.d(TAG, "Network available and no healthy socket, triggering reconnect...")
                    reconnectAttempts = 0
                    reconnectHandler.post {
                        if (isRunning && !(isConnected && webSocket != null)) {
                            connectToWebSocket()
                        }
                    }
                }
            }
            cm.registerNetworkCallback(request, connectivityCallback!!)
            Log.d(TAG, "Network callback registered")
        } catch (e: Exception) {
            Log.e(TAG, "Error registering network callback: ${e.message}")
        }
    }

    private fun unregisterNetworkCallback() {
        try {
            connectivityCallback?.let {
                val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
                cm.unregisterNetworkCallback(it)
            }
            connectivityCallback = null
        } catch (e: Exception) {
            Log.e(TAG, "Error unregistering network callback: ${e.message}")
        }
    }

    fun requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                intent.data = Uri.parse("package:$packageName")
                intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                startActivity(intent)
            }
        }
    }

    private fun disconnectFromWebSocket() {
        stopPingHandler()
        isConnected = false
        // Null the field BEFORE closing so the closing socket's onClosed sees itself as stale
        // (webSocket !== current) and does NOT schedule a reconnect for our intentional close.
        val socket = webSocket
        webSocket = null
        socket?.close(1000, "Service stopping")
        okHttpClient?.dispatcher?.executorService?.shutdown()
        okHttpClient = null
    }

    private fun stopForegroundService() {
        isRunning = false
        cancelScheduledReconnect()
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
