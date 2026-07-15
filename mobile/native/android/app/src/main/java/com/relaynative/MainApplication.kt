package com.relaynative

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.livekit.reactnative.LiveKitReactNative

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Manual (non-autolinked) native modules:
          add(CallNativePackage()) // FGS + FCM token + notification permission (M4)
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // MANDATORY LiveKit init (per the lib's install docs) and load-bearing for
    // M5 screen share: it flips enableMediaProjectionService so the WebRTC
    // lib launches its mediaProjection foreground service between the capture
    // grant and projection start — without it, getDisplayMedia resolves a
    // frameless track on Android 10+ (SecurityException swallowed internally)
    // and "sharing" broadcasts black to the room.
    LiveKitReactNative.setup(this)
    loadReactNative(this)
  }
}
