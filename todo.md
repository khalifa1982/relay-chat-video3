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
- [ ] Save checkpoint and deliver preview to user

## Notes
- The app is a thin shell: all features come from the live web app at
  https://your-chat.org/app. Web updates/upgrades reflect automatically.
- WebView only renders on native (iOS/Android via Expo Go); the Expo web
  preview shows an informational fallback by design.
