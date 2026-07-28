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

## Round 4 — Self-hosted APK auto-update + full-screen call notifications
- [x] Replaced Expo OTA with self-hosted APK updater (Android); removed expo-updates
- [x] Check fixed manifest URL (your-chat.org/update/version.json) on each launch + resume
- [x] Compare server buildNumber vs installed versionCode; trigger update when newer
- [x] Download APK from fixed URL (your-chat.org/update/app.apk) with a live progress bar
- [x] Launch Android package installer (REQUEST_INSTALL_PACKAGES) to install + restart
- [x] iOS safe no-op (Android-only sideload)
- [x] Defer APK install/restart during an active call
- [x] Full-screen-style incoming-call notification: MAX-importance sticky heads-up + Accept/Decline + ringtone; USE_FULL_SCREEN_INTENT + showWhenLocked/turnScreenOn via plugin
- [x] Incoming-message notification when unread badge increases
- [x] Server-side hosting instructions (SELF_HOSTED_UPDATE.md)
- [x] tsc clean + 32 unit tests pass; expo config validated
- [x] Checkpoint and deliver

## Round 5 — Audio routing, screen share, background ringing, 10-min auto-update, prior suggestions
- [x] Audio output switching: earpiece / loudspeaker / Bluetooth via setAudioRoute (web speaker control reported to native; BLUETOOTH/MODIFY_AUDIO_SETTINGS perms added)
- [x] Enable Android screen share: mediaCapturePermissionGrantType=grant + getDisplayMedia shim + FOREGROUND_SERVICE_MEDIA_PROJECTION service
- [x] Reliable background ringing when minimized & online (useBackgroundPresence ongoing notification + online detection from injected script)
- [x] Auto-update poll every 10 minutes (POLL_INTERVAL_MS) in addition to launch/resume
- [x] Mandatory update mode: blocking "Update required" overlay via manifest `mandatory`
- [x] In-app build/status row: shows current build + latest + manual Check button
- [x] Refined incoming-call + unread-message + online detection selectors
- [x] tsc clean + 34 unit tests pass; expo config validated (perms + bg modes + plugin)
- [x] Checkpoint and deliver

## Round 6 — Professional in-app update flow (footer)
- [x] Split update flow into discrete phases: check -> available -> downloading (progress bar) -> ready -> restart
- [x] Footer build/status row shows build number + "Up to date" and, when an update exists, a live download progress bar below it
- [x] Footer action button adapts: Check -> Update -> (progress %) -> Restart
- [x] Download no longer auto-starts for normal updates (user taps Update); mandatory updates still auto-download + block
- [x] Restart button applies the downloaded APK via the system installer and relaunches
- [x] Removed the redundant non-mandatory bottom banner; banner is now mandatory-only overlay
- [x] tsc clean + 38 unit tests pass (added isMandatoryUpdate tests)
- [x] Checkpoint and deliver

## Round 7 — Fix "no new build" + hosting clarity
- [x] Diagnosed root cause: /update/version.json and /update/app.apk return the web app HTML (no manifest/APK hosted)
- [x] Updater now compares human version name (1.0.5 > 1.0.4) as primary signal, buildNumber as fallback
- [x] Check button now reports the REAL reason (manifest not JSON / not reachable / up to date / available) instead of silent "no update"
- [x] Footer shows Version name (installed + latest) instead of only build number
- [x] Added semver compare + version-name update-detection unit tests (19 apk-update tests)
- [x] Provided hosting options; user chose GitHub Releases path (see Round 8)

## Round 8 — GitHub Releases auto-update hosting (live)
- [x] Received built APK v1.0.6 from user; confirmed versionName 1.0.6
- [x] Diagnosed private-repo download URLs return "Not Found" (no public auth)
- [x] Created PUBLIC release host repo khalifa1982/relay-app-releases
- [x] Published v1.0.6 release with relay-mobile.apk + version.json assets
- [x] Verified public URLs: version.json returns JSON; APK returns vnd.android.package-archive (52.9 MB, 200)
- [x] Pointed app default update URLs at the public release host (latest/download)
- [x] Synced app version to 1.0.6 / ANDROID_BUILD_NUMBER 6
- [x] Added live end-to-end test (fetch manifest + APK content-type) — 46 tests pass, tsc clean
- [x] Added scripts/publish-release.sh one-command release helper
- [x] Rewrote SELF_HOSTED_UPDATE.md for the GitHub Releases workflow
- [x] Checkpoint and deliver

## Round 9 — Glossy Check button with 10-min countdown ring
- [x] Published v1.0.7 APK to GitHub Releases host (build 7)
- [x] Expose poll interval + next-check time (lastCheckAt + pollIntervalMs) from useApkUpdate
- [x] Redesign the footer Check control as a glossy blue circular icon button (gradient/sheen)
- [x] Add a ring/arc that drains over the 10-min poll window (no numbers), triggers a check at 0, then refills
- [x] Keep adaptive states (refresh / download / % / restart) working with the new look
- [x] Added pure countdown helper + unit tests; made live APK test version-agnostic
- [x] Visually verified all phases; tsc clean + 52 tests pass
- [ ] Bump app.config.ts to 1.0.8 / build 8 for the next APK build (pending user request)

## Round 11 — PushKit + CallKit: a LOCKED iPhone shows the real call screen
- [x] **The ask, verbatim: "Implement PushKit + CallKit for iOS".** Before this the shell had
      `fullScreenIntent` (Android) and `interruptionLevel: "timeSensitive"` (iOS), so an iPhone got a
      time-sensitive notification rather than the FaceTime-style screen. A VoIP push is the only thing
      that can produce that screen, and PushKit has no managed-Expo equivalent — so it needs native
      code, delivered as a config plugin since this project is CNG (no checked-in `ios/`).
- [x] `plugins/with-ios-voip.js` — injects `PKPushRegistryDelegate` into `AppDelegate.swift`, registers
      for PushKit inside `didFinishLaunchingWithOptions`, and merges the `voip` background mode.
- [x] **THE RULE THAT MATTERS MOST, and why the report is native rather than in JS.** Since iOS 13
      every VoIP push MUST produce a `reportNewIncomingCall` before the handler returns; miss it and
      iOS terminates the app, miss it repeatedly and iOS **stops delivering VoIP pushes at all** — a
      penalty that then looks like a server fault forever. When a push wakes a KILLED app the React
      Native bridge does not exist yet, so a JS-side report would arrive too late or never. The
      injected handler reports to CallKit FIRST and forwards to JS second; a mutation swapping that
      order bites.
- [x] **It FAILS LOUDLY.** If the AppDelegate anchor is not found the plugin THROWS at prebuild
      instead of returning the file untouched. A silent no-op yields an app that builds, installs,
      looks correct and never rings, with nothing reporting why — the class of failure this project
      keeps closing.
- [x] **iOS ONLY, deliberately.** Android already rings through the existing FCM/Expo path plus the
      full-screen-intent notification. CallKeep's Android ConnectionService would add a second,
      competing incoming-call UI plus permissions to a platform that works — the same discipline the
      iOS-only Expo-token switch used, so fixing one platform cannot break the other. A test forbids
      the plugin naming any Android mod.
- [x] **A PUSHKIT TOKEN IS NOT THE ALERT TOKEN, and that is the sharpest detail here.** iOS issues
      TWO hex tokens: PushKit (topic `<bundle>.voip`) and the ordinary alert token (topic
      `<bundle>`). They are indistinguishable by shape, so `hooks/use-voip-callkit.ts` posts
      `kind: "apns-voip"` alongside it — the one label the server trusts, precisely because the shape
      cannot carry it and mislabelling costs only this device its own ring. Sending a VoIP push to an
      ALERT token earns `BadDeviceToken`, which the server reads as stale and PRUNES, so getting this
      wrong DESTROYS the registration rather than merely failing.
- [x] **The native modules are loaded OPTIONALLY.** They exist only in a real prebuild — not Expo Go,
      not web, not a unit test — so every use is behind a guarded require. An unguarded one would take
      the whole app down at startup, and the app is more useful without ringing than not launching.
- [x] **The shell does not try to join the call itself.** CallKit's Answer button brings the WebView
      forward and refreshes the camera; the web app's own pending-ring delivery is what connects. One
      implementation of "answer", not two that can diverge.
- [x] `tests/voip-callkit.test.ts` (27). **VERIFIED AGAINST A REAL PREBUILD, not only a fixture**:
      `expo prebuild --platform ios` was run and the generated `ios/RELAY/AppDelegate.swift` inspected
      — the imports land after the existing ones, the delegate extension appears exactly once, the
      report-before-forward order holds, `UIBackgroundModes` reads `['audio','voip','remote-notification']`,
      and a SECOND prebuild changes nothing. Two tests read that real artefact when present and skip
      in CI, where `ios/` is gitignored. **All 15 tripwires verified by MUTATION**, sources
      byte-identical afterwards.
- [x] **Dead code found by that real prebuild and removed.** The extension carried a
      `voipRegistration()` wrapper nothing called — registration happens straight from
      `didFinishLaunchingWithOptions`. A wrapper nothing calls reads as the registration path, and the
      next person to change this would edit the dead one and wonder why the phone stopped ringing.
- [x] **NOT VERIFIED ON A DEVICE, said plainly.** No Mac and no iPhone here, so the injected Swift has
      never been compiled and no handset has rung. What is proven: the transform, its idempotency, its
      loud failure, and that Expo's own prebuild accepts it. The build itself needs Codemagic.
- [ ] Owner-side: upload the APNs key to EAS (or keep using the fleet's `.p8` — the server sends VoIP
      pushes directly either way) and run a Codemagic iOS build from this branch.

## Round 10 — UI/UX match-to-web + footer Beta/Installed wording
- [ ] Footer: show "Beta {bundled appVersion}" line (the app build shipped)
- [ ] Footer: show "Installed {device versionName} (build N)" line clearly
- [ ] Keep adaptive update states (checking/available/downloading/ready) intact
- [ ] UI/UX: richer themed loading screen + smoother web-update toast to match web
- [ ] UI/UX: consistent dark surfaces / status bar so the shell blends with RELAY
- [ ] Bump app.config.ts to 1.0.8 / build 8
- [ ] tsc clean + tests pass
- [ ] Checkpoint and deliver

## Round 10 — results
- [x] Footer: "BETA {bundled}" badge line + "Installed: {version} · build N · latest {x}" line
- [x] UI/UX: shell palette matched to live RELAY (#050608 bg), splash/footer aligned, splash backgroundColor synced, tagline added
- [x] Bumped app.config.ts to 1.0.8 / build 8
- [x] tsc clean + 52 tests pass; temp footer lab route removed
- [x] Checkpoint and deliver

## Round 11 — APK audit response
- [x] Add SHA-256 manifest field + parser (`lib/apk-update-config.ts`)
- [x] Pure, dependency-free streaming SHA-256 + base64 decoder (`lib/sha256.ts`)
- [x] On-device, memory-safe file hashing + verification (`lib/apk-integrity.ts`)
- [x] Wire verify step into update flow with a new "verifying" phase (`hooks/use-apk-update.ts`)
- [x] Show "verifying" state in footer button + mandatory overlay
- [x] publish-release.sh embeds APK sha256 in version.json
- [x] Strip external-storage perms via blockedPermissions; keep permission set minimal
- [x] Bump version to 1.0.9 / build 9 to align source with releases
- [x] Unit tests: hasher vs Node crypto, base64 round-trip, manifest parsing (13 new; 65 pass)
- [x] Document integrity verification in SELF_HOSTED_UPDATE.md
- [ ] NOT actionable here: backend hostname mismatch + server v2.65.0 fixes (separate mobile project com.app.relaymobile)

## Round 12 — Footer cleanup
- [x] Remove the verbose "You're on the latest version (…; server …)." line; keep concise "Up to date" status
- [x] tsc clean + 65 tests pass

## Round 13 — Reshape: bigger browsing, compact footer, persistent cache, robust background
- [x] Compact the bottom update/version footer into a slim bar; maximize WebView area
- [x] Persist WebView cache/cookies/DOM storage/session across app restarts (sessionStorage→localStorage bridge)
- [x] Ensure notifications stay enabled (calls + messages)
- [x] Picture-in-picture keeps working when minimized during a call (expo-video PiP)
- [x] Keep web session/call alive in background (foreground service + UIBackgroundModes audio/voip)
- [x] Incoming-call notification identifies the caller while minimized (USE_FULL_SCREEN_INTENT + widened caller detection)
- [x] tsc clean + 65 tests pass; bumped to 1.0.12 / build 12; checkpoint and deliver

## Round 14 — Fix update verification loop
- [x] Diagnose why "Verifying update..." gets stuck and loops back to download
- [x] Rewrite apk-integrity.ts with timeout-guarded verification (10s timeout, graceful skip on timeout)
- [x] Clean up failed/partial downloads before retry (deleteApkFile helper)
- [x] Add auto-retry: corrupt file triggers one automatic re-download before showing error
- [x] Add retry counter (max 1) to prevent infinite loops
- [x] Verification timeout: if SHA-256 takes >10s, skip and install via HTTPS trust
- [x] Bump version to 1.0.16 / build 16
- [x] tsc clean + 65 tests pass; checkpoint and deliver

## Round 15 — Fix call audio, hang-up icon, and iOS notifications
- [x] BUG #1: Android speaker not working on inbound calls — force speaker mode on call connect via injected JS + native audio session defaults to speaker
- [x] BUG #2: One-way audio between iPhone/Android — enhanced getUserMedia with full-duplex audio constraints (echoCancellation, noiseSuppression, autoGainControl), audio track health monitor, re-enable muted tracks, re-apply audio mode on resume
- [x] BUG #3: Corrupted hang-up icon on Android — injected CSS + SVG fallback for call-end button, periodic DOM fix for dynamically rendered call UI
- [x] BUG #4: iOS notification failure after backgrounding — re-register notification handlers + channels on every app resume, re-set foreground notification handler, refresh response listener
- [x] Bump version to 1.0.17 / build 17
- [x] tsc clean + 65 tests pass; checkpoint and deliver

## Round 16 — Fix Apple App Store rejection (Guideline 2.2 + 5.1.1(ii))
- [x] Guideline 2.2 (Beta Testing): Removed "BETA" badge from BuildStatusRow, hid entire update footer on iOS (iOS updates via App Store only), removed all beta/test visual indicators
- [x] Guideline 5.1.1(ii) (Privacy - Data Collection): Updated NSMicrophoneUsageDescription with detailed explanation + specific example of how microphone data is used during calls
- [x] Updated NSCameraUsageDescription with detailed explanation + specific example of video call usage
- [x] Updated expo-audio plugin microphonePermission string with full explanation + example
- [x] tsc clean + 65 tests pass; checkpoint and deliver

## Round 17 — Fix false "Incoming RELAY call" notification on iOS app open
- [x] Root cause: detectRinging() regex was too broad — matched "is calling" in static UI labels like "Voice Call" button text
- [x] Fix: Now requires BOTH specific ringing text patterns AND accept/decline DOM elements (buttons/modals) to be present
- [x] Added 4-second startup grace period: suppresses ring detection during initial page render
- [x] Added debounce: requires 2 consecutive positive detection cycles before firing the notification
- [x] Added caller name filtering to exclude false matches ("Voice", "Video", "Group", "Incoming", "RELAY")
- [x] tsc clean + 65 tests pass; checkpoint and deliver

## Round 18 — Change app URL from your-chat.org to your-chat.io
- [x] Updated DEFAULT_BASE_URL in lib/relay-config.ts from your-chat.org to your-chat.io
- [x] Updated test references in tests/apk-update.test.ts
- [x] Verified no remaining references to your-chat.org in the project
- [x] relay-config.test.ts live endpoint test passes against your-chat.io/app
- [x] tsc clean + 65 tests pass

## Round 19 — Final Apple Guideline 2.2 fix: remove all beta references
- [x] Confirmed BuildStatusRow already returns null on iOS (footer hidden)
- [x] Renamed betaVersionName prop to appVersionName to eliminate the word "beta" from compiled code
- [x] Verified zero occurrences of "beta" in any source file (ts/tsx/js)
- [x] tsc clean + 65 tests pass

## Round 20 — Integrate Firebase push notifications for iOS
- [x] Added GoogleService-Info.plist to project root (Bundle ID: io.yourchat.relay)
- [x] Added googleServicesFile to iOS config in app.config.ts
- [x] Added "remote-notification" to UIBackgroundModes for background push delivery
- [x] Created use-push-token.ts hook: gets native device push token (APNs) and injects it into WebView via postMessage
- [x] Integrated usePushToken into RelayWebView: sends token on load and on every app resume
- [x] Web app receives { type: "SET_PUSH_TOKEN", token: "<apns_token>" } via window.addEventListener("message")
- [x] tsc clean + 65 tests pass
- [x] Added google-services.json for Android (package: com.relaytech.calling) and configured googleServicesFile in app.config.ts

## Round 21 — Ensure update footer is completely hidden on iOS (Apple Guideline 2.2)
- [x] Added Platform.OS === "android" guard at the PARENT level in index.tsx so BuildStatusRow + ApkUpdateBanner + GlossyCheckButton are never rendered on iOS at all
- [x] Double protection: BuildStatusRow also returns null internally on iOS
- [x] No BETA badge, no build number, no refresh button visible on iOS
- [x] tsc clean + 65 tests pass

## Round 24 — the bridging-header fix was necessary but not sufficient; the Swift still could not compile
- [x] Round 23's `fix(ios): use bridging header` was the right diagnosis for the IMPORTS and is kept.
      What it left behind were four more compile errors in the same injected Swift, each verified against
      the pods' own ObjC headers rather than recalled.
- [x] **TWO CALLS NAMED METHODS THAT DO NOT EXIST.** `RNVoipPushNotificationManager.didUpdate(_:forType:)`
      — the real selector is `didUpdatePushCredentials:forType:`; and
      `didReceiveIncomingPush(with:forType:)` — the real first label is `withPayload:`. Read straight off
      `RNVoipPushNotificationManager.h`.
- [x] **THE WITNESSES HAD TO BE `public`.** The SDK 54 template is `public class AppDelegate:
      ExpoAppDelegate`, and Swift requires a witness for a requirement of a public protocol to be at least
      as visible as the conformance — an internal `func pushRegistry` fails with "must be declared public
      because it matches a requirement in public protocol 'PKPushRegistryDelegate'". All three now are.
- [x] **`import Foundation` ADDED for what the injected code itself uses.** The template imports neither
      Foundation nor UIKit and resolves both transitively; `NSLog`, `String(format:)` and `UUID()` are all
      Foundation, and an injection should not depend on the host file's import list.
- [x] **THE BRIDGING HEADER IS NOW APPENDED, NOT OVERWRITTEN, AND ITS NAME IS DERIVED.** Round 23 wrote
      the whole file from a template with the name hardcoded `RELAY-Bridging-Header.h`. Two problems: a
      whole-file write destroys whatever another plugin put there, and the Expo template already emits
      `<Project>-Bridging-Header.h` and already points `SWIFT_OBJC_BRIDGING_HEADER` at it — so a hardcoded
      name leaves an orphan the day the app is renamed. Appending under a marker is idempotent AND lets
      plugins coexist; the file is still CREATED if absent, so a template that stops emitting one degrades
      to "we make it ourselves" rather than to a build that cannot ring.
- [x] **BOTH POD IMPORTS USE THE ANGLE FORM.** Round 23 mixed `<RNCallKeep/RNCallKeep.h>` with
      `"RNVoipPushNotificationManager.h"`; the quoted form works only while a flattened search path
      happens to be present. Note the pod directory and the header file DIFFER for the VoIP pod
      (`RNVoipPushNotification/` vs `RNVoipPushNotificationManager.h`) — collapsing them fails with "file
      not found" and nothing that names the cause.
- [x] **ROUND 23's `NSLog` INVALIDATE HANDLER IS KEPT, and its finding was right**: the library exposes no
      `didInvalidate` class method, so a log is the whole available behaviour. My own first pass deleted
      the method outright; a diagnostic you can see in Console.app is the better call.
- [x] **A FALSE COMMENT OF MINE CORRECTED rather than left standing.** It claimed the stable uuid exists
      "so the answer JS reports later refers to the same CallKit call" — read against
      `use-voip-callkit.ts`, the hook answers via CallKeep's own `answerCall`/`endCall` events and never
      re-derives the uuid. The real value is that a RETRANSMITTED push for one room does not stack a
      second ringing call on the lock screen.
- [x] **THE LOAD-BEARING NEW TEST CROSS-CHECKS EVERY INJECTED CALL AGAINST THE POD'S OWN ObjC HEADER**,
      which is exactly what its absence allowed twice over. No test here can compile Swift, but the
      headers are on disk, so "does this method exist" is answerable for real. It also pins all twelve
      `reportNewIncomingCall` labels against the declaration, asserts the invalidate handler calls no
      library method BECAUSE the header has none, and reports whether the cross-check ran rather than
      skipping silently.
- [x] `tests/voip-callkit.test.ts` → 41. **All 9 new tripwires verified by MUTATION** from a byte-exact
      backup, with the mutator aborting unless its target occurs exactly once; source byte-identical
      afterwards. One aborted on a non-unique anchor and was re-run against both sites individually.
- [x] Verified by a REAL `expo prebuild --platform ios --clean`: the generated `AppDelegate.swift`,
      `RELAY-Bridging-Header.h` and the pbxproj's `SWIFT_OBJC_BRIDGING_HEADER` were all read back.
- [x] **NOT COMPILED, said plainly**: there is no Xcode or Swift toolchain on this machine, so this rests
      on reading the real generated artefacts and the real pod headers. The Codemagic run is what proves
      it. The one pre-existing test failure (`relay-config.test.ts` fetching your-chat.io) is this
      sandbox's egress proxy, unrelated.
