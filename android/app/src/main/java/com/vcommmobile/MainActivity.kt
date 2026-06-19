package com.vcommmobile

import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.bridge.Arguments
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  companion object {
    private const val TAG = "MainActivity"

    // Static flag to track if the app is in foreground
    @Volatile
    var isAppInForeground: Boolean = false
      private set

    fun setAppForegroundState(inForeground: Boolean) {
      isAppInForeground = inForeground
      Log.d(TAG, "App foreground state changed: $inForeground")
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "VCommMobile"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    handleCallIntent(intent)
    SiteConfigModule.handleIntent(intent)
  }

  override fun onResume() {
    super.onResume()
    setAppForegroundState(true)
  }

  override fun onPause() {
    super.onPause()
    setAppForegroundState(false)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleCallIntent(intent)
    SiteConfigModule.handleIntent(intent)
  }
  
  private fun handleCallIntent(intent: Intent) {
    val callAction = intent.getStringExtra("callAction")
    if (callAction != null) {
      val callId = intent.getStringExtra("callId") ?: ""
      val callerId = intent.getStringExtra("callerId") ?: ""
      val callerName = intent.getStringExtra("callerName") ?: ""
      val callType = intent.getStringExtra("callType") ?: "audio"
      val isGroupCall = intent.getBooleanExtra("isGroupCall", false)
      val payload = intent.getStringExtra("payload")

      Log.d(TAG, "Handling call intent: action=$callAction, callId=$callId, hasPayload=${payload != null}")

      // Emit event to React Native
      val params = Arguments.createMap().apply {
        putString("callId", callId)
        putString("callerId", callerId)
        putString("callerName", callerName)
        putString("callType", callType)
        putBoolean("isGroupCall", isGroupCall)
        putString("action", callAction)
        if (payload != null) {
          putString("payload", payload)
        }
      }
      CallNotificationModule.emitEvent("onCallAction", params)

      // Clear the extras to prevent re-processing
      intent.removeExtra("callAction")
      intent.removeExtra("callId")
      intent.removeExtra("callerId")
      intent.removeExtra("callerName")
      intent.removeExtra("callType")
      intent.removeExtra("isGroupCall")
      intent.removeExtra("payload")
    }
  }
}
