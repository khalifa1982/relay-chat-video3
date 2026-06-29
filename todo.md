# RELAY Mobile — TODO

## Round 1 — Initial build
- [x] Initialize Expo mobile project (relay-mobile)
- [x] Install react-native-webview
- [x] Generate RELAY app icon + splash, set branding in app.config.ts
- [x] Build full-screen WebView shell mirroring https://your-chat.org/app
- [x] Camera/mic permissions for voice/video calling
- [x] Loading overlay + offline/error screen with retry
- [x] Android hardware-back through web history; external links to system browser
- [x] Persist cookies/storage for guest identity
- [x] Add unit test validating RELAY URL config + live reachability
- [x] Verify tsc / dev server has no errors
- [x] Save checkpoint v1.0 and deliver preview to user

## Round 2 — Reported issues
- [x] BUG: After login, web app bottom nav loaded forever — fixed loading overlay logic
- [x] Keep the "reload" prompt when the WEB content updates
- [x] FEATURE: OTA self-update via expo-updates
- [x] Add expo-updates and configure runtimeVersion + update URL
- [x] Add in-app update check + apply + restart flow
- [x] Add unit tests for version-watch logic; tsc + tests pass
- [x] Checkpoint and deliver

## Round 3 — Reported issues
- [x] BUG: Active call breaks when backgrounded; camera frozen on resume — added call detection bridge + background audio session + keep-awake + camera re-acquire on resume
- [x] Keep WebRTC media/audio session alive in background (expo-audio background mode + iOS UIBackgroundModes audio/voip)
- [x] Enable Android picture-in-picture for active calls (WebView allowsPictureInPictureMediaPlayback + with-android-pip config plugin + best-effort PiP trigger)
- [x] Ensure camera/video stream re-initializes on resume (window.__relayReacquireCamera injected on foreground)
- [x] FEATURE: Incoming-call notifications enabled at setup (permission + Android channel created on mount)
- [x] Add a nice ringtone that plays on incoming call (assets/audio/ringtone.wav, looped via expo-audio + notification sound)
- [x] FEATURE: Fully automatic OTA self-update — auto-check on launch + resume, download, restart; deferred during active calls
- [x] Test all changes (tsc clean + 21 unit tests pass incl. live reachability)
- [x] Deliver updated app + setup notes
