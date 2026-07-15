package com.relaynative

import android.app.PictureInPictureParams
import android.os.Build
import android.util.Rational
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /** M5: home/recents mid-call shrinks the app to Picture-in-Picture instead
   *  of hiding it — the engine gates eligibility (CallNativeModule) so an
   *  idle app never pips. */
  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    if (Build.VERSION.SDK_INT >= 26 && CallNativeModule.pipEligible) {
      try {
        enterPictureInPictureMode(
          PictureInPictureParams.Builder()
            .setAspectRatio(Rational(3, 4))
            .build()
        )
      } catch (ignored: Exception) {
        // Device/policy refused PiP — the FGS keep-alive still protects audio.
      }
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "RelayNative"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
