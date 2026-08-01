# Android Push Config Gaps (relay-push-android-app-config.md)

## What's ALREADY implemented:
- FCM token capture + bridge into WebView via relay:native CustomEvent (kind:'fcm')
- Data-only HIGH priority push handling in native RelayCallFcmService
- Full-screen ring (Option B: full-screen intent notification)
- IncomingCallActivity with lock-screen, ringtone, vibration, 60s timeout
- Answer/Decline → deep link to MainActivity
- call_cancel → dismiss notification
- Permissions: USE_FULL_SCREEN_INTENT, POST_NOTIFICATIONS, WAKE_LOCK, FOREGROUND_SERVICE_PHONE_CALL
- google-services.json configured in app.config.ts

## What's MISSING per the spec (§4, §4.5, §5):

### §4 - webCallEnded via RelayNative JavascriptInterface
- Need `@JavascriptInterface` object bound as "RelayNative" on the WebView
- On `{"type":"webCallEnded","callId":"..."}` → clear ongoing-call notification
- Currently only handled via ReactNativeWebView.postMessage → JS side

### §4.5 - Audio routing (setAudioRoute)
- Handle web→native `{"type":"setAudioRoute","route":"speaker"|"earpiece"|"bluetooth"}`
- Use AudioManager in MODE_IN_COMMUNICATION:
  - speaker → setSpeakerphoneOn(true)
  - earpiece → setSpeakerphoneOn(false)
  - bluetooth → startBluetoothSco() + setBluetoothScoOn(true)
- Report route changes back with `{type:'audioRouteChanged',route}`

### §5 - WebView requirements
- Already have: javaScriptEnabled, domStorageEnabled, mediaPlaybackRequiresUserGesture=false
- Need: RelayNative interface attached on every load (native side)
- Need: hardware acceleration ON (verify)

## Implementation approach:
- Add a new Kotlin file `RelayNativeInterface.kt` with @JavascriptInterface methods
- Modify the existing plugin to write this file and ensure it's attached to WebView
- Since this is an Expo/RN app, the WebView is react-native-webview — we need to
  attach the JavascriptInterface via the injected JS shim (already done in Round 24)
  BUT also need native-side handling for when web calls window.RelayNative.postMessage
- The RN WebView's onMessage handler already processes webCallEnded messages
- For setAudioRoute: the existing use-call-session.ts hook handles this via Expo Audio API
- GAP: The native RelayNative interface for handling messages directly from web
  (bypassing RN bridge) is NOT needed because RN WebView's postMessage already works
- REAL GAP: Audio routing via AudioManager in MODE_IN_COMMUNICATION for proper
  speaker/earpiece/bluetooth switching during calls (native level, not Expo Audio)
