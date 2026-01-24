package com.vcommmobile

import android.app.ActivityManager
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Arguments

class IncomingCallActivity : AppCompatActivity() {

    companion object {
        const val TAG = "IncomingCallActivity"
        const val CALL_TIMEOUT_MS = 30000L // 30 seconds
    }

    private var callId: String? = null
    private var callerId: String? = null
    private var callerName: String? = null
    private var callType: String? = null
    private var isGroupCall: Boolean = false
    private var hasCallId: Boolean = false
    private var hasCallerUserId: Boolean = false
    private var hasOffer: Boolean = false
    

    private var ringtone: Ringtone? = null
    private var vibrator: Vibrator? = null
    private var timeoutHandler: Handler? = null
    private var timeoutRunnable: Runnable? = null

    private val closeReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            Log.d(TAG, "Received close broadcast")
            finishAndRemoveTask()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setupWindowFlags()
        extractIntentData()
        setupUI()
        startRingtoneAndVibration()
        setupTimeout()
        registerCloseReceiver()
    }

    private fun setupWindowFlags() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
            keyguardManager.requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            )
        }

        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
        )
    }

    private fun extractIntentData() {
        intent?.let {
            callId = it.getStringExtra("callId")
            callerId = it.getStringExtra("callerId")
            callerName = it.getStringExtra("callerName") ?: "Unknown"
            callType = it.getStringExtra("callType") ?: "audio"
            isGroupCall = it.getBooleanExtra("isGroupCall", false)
            
            // Check if this was launched from notification accept button
            val autoAccept = it.getBooleanExtra("autoAccept", false)
            if (autoAccept) {
                // Accept the call immediately
                handleAccept()
                
                // Bring the app to foreground using ActivityManager
                try {
                    val activityManager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
                    val appTasks = activityManager.appTasks
                    if (appTasks.isNotEmpty()) {
                        // Move the main app task to front
                        appTasks[0].moveToFront()
                        Log.d(TAG, "Moved app task to foreground")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to bring app to foreground: ${e.message}")
                }
                
                // Finish this activity
                finish()
                return
            }
        }
        Log.d(TAG, "Incoming call from: $callerName, type: $callType, group: $isGroupCall")
    }

    private fun setupUI() {
        val mainLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)

            // Gradient background
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Color.parseColor("#1a1a2e"), Color.parseColor("#16213e"))
            )
        }

        // Avatar placeholder
        val avatarContainer = LinearLayout(this).apply {
            gravity = Gravity.CENTER
            val size = (120 * resources.displayMetrics.density).toInt()
            layoutParams = LinearLayout.LayoutParams(size, size).apply {
                bottomMargin = (24 * resources.displayMetrics.density).toInt()
            }
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#4a90d9"))
            }
        }

        val avatarIcon = ImageView(this).apply {
            setImageResource(
                if (isGroupCall) android.R.drawable.ic_menu_myplaces
                else android.R.drawable.ic_menu_my_calendar
            )
            setColorFilter(Color.WHITE)
            val iconSize = (60 * resources.displayMetrics.density).toInt()
            layoutParams = LinearLayout.LayoutParams(iconSize, iconSize)
        }
        avatarContainer.addView(avatarIcon)

        // Caller name
        val nameText = TextView(this).apply {
            text = callerName
            textSize = 28f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = (8 * resources.displayMetrics.density).toInt()
            }
        }

        // Call type indicator
        val callTypeText = TextView(this).apply {
            val typeLabel = if (callType == "video") "Video Call" else "Voice Call"
            val groupLabel = if (isGroupCall) " (Group)" else ""
            text = "Incoming $typeLabel$groupLabel"
            textSize = 16f
            setTextColor(Color.parseColor("#aaaaaa"))
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = (48 * resources.displayMetrics.density).toInt()
            }
        }

        // Buttons container
        val buttonsLayout = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        // Reject button
        val rejectButton = createCircleButton(
            Color.parseColor("#e74c3c"),
            android.R.drawable.ic_menu_close_clear_cancel
        ) {
            handleReject()
        }

        // Accept button
        val acceptButton = createCircleButton(
            Color.parseColor("#27ae60"),
            android.R.drawable.ic_menu_call
        ) {
            handleAccept()
        }

        // Reject label
        val rejectLabel = TextView(this).apply {
            text = "Decline"
            textSize = 14f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = (8 * resources.displayMetrics.density).toInt()
            }
        }

        // Accept label
        val acceptLabel = TextView(this).apply {
            text = "Accept"
            textSize = 14f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = (8 * resources.displayMetrics.density).toInt()
            }
        }

        // Reject container
        val rejectContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                marginEnd = (60 * resources.displayMetrics.density).toInt()
            }
            addView(rejectButton)
            addView(rejectLabel)
        }

        // Accept container
        val acceptContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
            addView(acceptButton)
            addView(acceptLabel)
        }

        buttonsLayout.addView(rejectContainer)
        buttonsLayout.addView(acceptContainer)

        mainLayout.addView(avatarContainer)
        mainLayout.addView(nameText)
        mainLayout.addView(callTypeText)
        mainLayout.addView(buttonsLayout)

        setContentView(mainLayout)
    }

    private fun createCircleButton(color: Int, iconRes: Int, onClick: () -> Unit): View {
        val buttonSize = (72 * resources.displayMetrics.density).toInt()
        val iconSize = (32 * resources.displayMetrics.density).toInt()

        return LinearLayout(this).apply {
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(buttonSize, buttonSize)
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(color)
            }
            isClickable = true
            isFocusable = true
            setOnClickListener { onClick() }

            val icon = ImageView(this@IncomingCallActivity).apply {
                setImageResource(iconRes)
                setColorFilter(Color.WHITE)
                layoutParams = LinearLayout.LayoutParams(iconSize, iconSize)
            }
            addView(icon)
        }
    }

    private fun startRingtoneAndVibration() {
        // Start ringtone
        try {
            val ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            ringtone = RingtoneManager.getRingtone(applicationContext, ringtoneUri)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                ringtone?.isLooping = true
            }

            ringtone?.play()
        } catch (e: Exception) {
            Log.e(TAG, "Error playing ringtone: ${e.message}")
        }

        // Start vibration
        try {
            vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vibratorManager.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }

            val pattern = longArrayOf(0, 1000, 500, 1000, 500, 1000)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(pattern, 0)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error starting vibration: ${e.message}")
        }
    }

    private fun stopRingtoneAndVibration() {
        ringtone?.stop()
        ringtone = null
        vibrator?.cancel()
        vibrator = null
    }

    private fun setupTimeout() {
        timeoutHandler = Handler(Looper.getMainLooper())
        timeoutRunnable = Runnable {
            Log.d(TAG, "Call timeout reached")
            handleMissedCall()
        }
        timeoutHandler?.postDelayed(timeoutRunnable!!, CALL_TIMEOUT_MS)
    }

    private fun cancelTimeout() {
        timeoutRunnable?.let { timeoutHandler?.removeCallbacks(it) }
        timeoutHandler = null
        timeoutRunnable = null
    }

    private fun registerCloseReceiver() {
        val filter = IntentFilter("com.vcommmobile.CLOSE_INCOMING_CALL_ACTIVITY")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(closeReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(closeReceiver, filter)
        }
    }

    private fun handleAccept() {
        Log.d(TAG, "Call accepted")
        stopRingtoneAndVibration()
        cancelTimeout()
        cancelNotification()

        // Emit event to React Native
        val params = Arguments.createMap().apply {
            putString("callId", callId)
            putString("callerId", callerId)
            putString("callerName", callerName)
            putString("callType", callType)
            putBoolean("isGroupCall", isGroupCall)
            putString("action", "accept")
        }
        CallNotificationModule.emitEvent("onCallAction", params)

        // Launch main app
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("callId", callId)
            putExtra("callerId", callerId)
            putExtra("callerName", callerName)
            putExtra("callType", callType)
            putExtra("isGroupCall", isGroupCall)
            putExtra("callAction", "accept")
        }
        launchIntent?.let { startActivity(it) }

        finishAndRemoveTask()
    }

    private fun handleReject() {
        Log.d(TAG, "Call rejected")
        stopRingtoneAndVibration()
        cancelTimeout()
        cancelNotification()

        // Emit event to React Native
        val params = Arguments.createMap().apply {
            putString("callId", callId)
            putString("callerId", callerId)
            putString("callerName", callerName)
            putString("callType", callType)
            putBoolean("isGroupCall", isGroupCall)
            putString("action", "reject")
        }
        CallNotificationModule.emitEvent("onCallAction", params)

        finishAndRemoveTask()
    }

    private fun handleMissedCall() {
        Log.d(TAG, "Call missed (timeout)")
        stopRingtoneAndVibration()
        cancelNotification()

        // Emit event to React Native
        val params = Arguments.createMap().apply {
            putString("callId", callId)
            putString("callerId", callerId)
            putString("callerName", callerName)
            putString("callType", callType)
            putBoolean("isGroupCall", isGroupCall)
            putString("action", "missed")
        }
        CallNotificationModule.emitEvent("onCallAction", params)

        finishAndRemoveTask()
    }

    private fun cancelNotification() {
        val notificationManager = NotificationManagerCompat.from(this)
        notificationManager.cancel(CallNotificationModule.NOTIFICATION_ID)
    }

    override fun onDestroy() {
        super.onDestroy()
        stopRingtoneAndVibration()
        cancelTimeout()
        try {
            unregisterReceiver(closeReceiver)
        } catch (e: Exception) {
            Log.e(TAG, "Error unregistering receiver: ${e.message}")
        }
    }

    override fun onBackPressed() {
        // Don't allow back button to dismiss call screen
        // User must explicitly accept or reject
    }
}
