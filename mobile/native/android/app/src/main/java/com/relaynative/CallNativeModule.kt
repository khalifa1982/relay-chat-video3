package com.relaynative

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging

/**
 * Native call-lifecycle glue for the JS call engine (M4):
 *  - ongoing-call FOREGROUND SERVICE (Android never freezes a live call)
 *  - POST_NOTIFICATIONS runtime permission (Android 13+)
 *  - the FCM device token (null until google-services.json is configured)
 *  - cancelRing dismisses a lock-screen ring the JS layer has taken over
 */
class CallNativeModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "CallNative"

  override fun initialize() {
    super.initialize()
    NotificationHelper.ensureChannels(reactApplicationContext)
  }

  @ReactMethod
  fun startCallService(title: String?, promise: Promise) {
    try {
      val i = Intent(reactApplicationContext, CallService::class.java)
      if (title != null) i.putExtra("title", title)
      ContextCompat.startForegroundService(reactApplicationContext, i)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("start_call_service", "startCallService failed: ${e.message}")
    }
  }

  @ReactMethod
  fun stopCallService(promise: Promise) {
    try {
      reactApplicationContext.stopService(Intent(reactApplicationContext, CallService::class.java))
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("stop_call_service", "stopCallService failed: ${e.message}")
    }
  }

  /** Dismiss the native full-screen/notification ring (JS ring took over). */
  @ReactMethod
  fun cancelRing(promise: Promise) {
    try {
      NotificationHelper.cancelRing(reactApplicationContext)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.resolve(null) // best-effort
    }
  }

  @ReactMethod
  fun ensureNotificationPermission(promise: Promise) {
    var granted = true
    if (Build.VERSION.SDK_INT >= 33) {
      granted = ContextCompat.checkSelfPermission(
        reactApplicationContext, Manifest.permission.POST_NOTIFICATIONS
      ) == PackageManager.PERMISSION_GRANTED
      // RN 0.80+: the activity accessor lives on the react context (the base
      // class's getCurrentActivity() is a Kotlin fun — no property syntax).
      val activity = reactApplicationContext.currentActivity
      if (!granted && activity != null) {
        ActivityCompat.requestPermissions(
          activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 9911
        )
      }
    }
    val ret = Arguments.createMap()
    ret.putBoolean("granted", granted)
    promise.resolve(ret)
  }

  @ReactMethod
  fun getPushToken(promise: Promise) {
    try {
      if (FirebaseApp.getApps(reactApplicationContext).isEmpty()) {
        val ret = Arguments.createMap()
        ret.putNull("token")
        ret.putString("reason", "firebase-not-configured")
        promise.resolve(ret)
        return
      }
      FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
        val ret = Arguments.createMap()
        if (task.isSuccessful) ret.putString("token", task.result) else ret.putNull("token")
        promise.resolve(ret)
      }
    } catch (e: Exception) {
      val ret = Arguments.createMap()
      ret.putNull("token")
      ret.putString("reason", e.message ?: "unknown")
      promise.resolve(ret)
    }
  }
}
