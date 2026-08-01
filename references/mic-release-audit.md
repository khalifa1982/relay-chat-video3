# Mic Release Audit Notes

## Current State

### JS-side (CALL_WATCH_JS in injected-scripts.ts)
- getUserMedia is patched: streams are tracked in `localStreams` Set
- Tracks have `ended` event listeners that call `recompute()`
- When all peer connections close → `recompute()` sets `state.active = false` and posts `relay-call` message
- **MISSING:** No explicit `track.stop()` call anywhere! Tracks are never stopped.
- The `localStreams` set grows but is never cleared.
- `webCallEnded` is sent from relay-webview.tsx (RN side) when it detects call ended, NOT from the web page itself.

### Android (with-android-fcm-call.js)
- `handleWebCallEnded()` cancels notifications and calls `audioRouter.deactivate()`
- `audioRouter.deactivate()` resets MODE_NORMAL, stops BT SCO, disables speaker
- **MISSING:** No foreground service to stop (it's a simple FCM service, not a persistent foreground service)
- **MISSING:** No audio focus release (`abandonAudioFocusRequest`)

### iOS (with-ios-voip-callkit.js)
- `webCallEnded` handler calls `reportCall(endedAt:reason:)` and `removeCall()`
- `didDeactivate` handler is a no-op (just logs)
- **MISSING:** No `AVAudioSession.setActive(false, options: .notifyOthersOnDeactivation)` anywhere!
- This is the root cause on iOS: other apps can't record because the session is never properly deactivated.

## Required Changes

### §1 JS-side: Add media teardown to CALL_WATCH_JS
- When call ends (peers.size === 0 after being > 0), stop ALL tracks in localStreams
- Also stop tracks from peer connection senders
- Send `callEnded` via RelayNative bridge
- Clear localStreams set

### §2 Android: Add audio focus release
- Request audio focus on call start, abandon on call end
- Already handles MODE_NORMAL reset

### §3 iOS: Add AVAudioSession deactivation with .notifyOthersOnDeactivation
- In the webCallEnded handler, after reportCall, deactivate the audio session
- In didDeactivate, call setActive(false, options: .notifyOthersOnDeactivation)
