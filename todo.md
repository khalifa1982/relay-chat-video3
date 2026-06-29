# RELAY Mobile — TODO

- [x] Initialize Expo mobile app project
- [x] Install react-native-webview
- [x] Confirm WebView shell approach with user
- [x] Write design.md
- [x] Configure RELAY URL via EXPO_PUBLIC_RELAY_URL secret
- [x] Generate and apply RELAY app icon (icon/splash/favicon/android-foreground)
- [x] Update app.config.ts: branding + camera/mic permissions (iOS + Android)
- [x] Build WebView shell screen (loading overlay, error state, refresh, back handling)
- [x] Configure single full-screen route (remove redundant native tab bar)
- [x] Set brand colors in theme.config.js
- [x] Add unit test validating RELAY URL config + live reachability
- [x] Verify tsc / dev server has no errors
- [x] Save checkpoint v1.0 and deliver preview to user

## Round 2 — Reported issues
- [x] BUG: After login, web app bottom nav loaded forever — root cause: loading overlay re-showed on every SPA navigation and never dismissed. Fixed: overlay shows only on first load + 12s safety timeout.
- [x] Investigate root cause (confirmed via live browser: /app/* anchor routes are internal; overlay was the blocker)
- [x] Keep the "reload" prompt when the WEB content updates (footer version watcher + Reload banner)
- [x] FEATURE: OTA self-update via expo-updates — auto check on launch/resume, download, restart
- [x] Add expo-updates and configure runtimeVersion + update URL (EXPO_PUBLIC_UPDATES_URL override)
- [x] Add in-app update check + apply + restart flow (use-ota-update hook + OtaUpdateBanner)
- [x] Add unit tests for version-watch logic; tsc + tests pass
- [ ] Checkpoint and deliver
