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
