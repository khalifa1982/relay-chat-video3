# RELAY Mobile — Design Plan

## Concept

RELAY Mobile is a **native shell (wrapper) app** for iOS/Android that loads the live
RELAY web app (`https://your-chat.io/app`) inside a full-screen WebView. The goal is
**mirroring**: every update or upgrade made on the web is instantly reflected in the
app, with no app-store re-release. The native layer only provides the chrome
(splash, permissions, navigation gestures, offline handling), while all features
(voice, video, chat, contacts, dialer, history) come from the web.

## Orientation & Usage

- Mobile portrait (9:16), one-handed usage.
- The web app supplies its own bottom navigation, so the native app does **not** add a
  second tab bar — it presents a single, immersive full-screen WebView.

## Screen List

1. **Loading / Splash** — App icon on brand background while the WebView boots and the
   web app loads. A branded overlay spinner covers the WebView until first paint.
2. **WebView Shell (main)** — Full-screen WebView rendering `https://your-chat.io/app`.
   Hosts the entire RELAY experience.
3. **Connection Error** — Shown when the device is offline or the web app fails to load.
   Displays a friendly message, the RELAY mark, and a **Retry** button.

## Primary Content & Functionality per Screen

- **WebView Shell**
  - Loads the configured RELAY URL (`EXPO_PUBLIC_RELAY_URL`, default `https://your-chat.io`).
  - Camera + microphone permissions granted to the WebView for WebRTC voice/video.
  - Media playback inline (no forced fullscreen takeover), autoplay allowed.
  - Pull-to-refresh-style reload available; hardware Android back navigates web history.
  - Persists cookies/localStorage so the user's guest identity & 6-digit number survive.
  - External links (mailto:, tel:, non-RELAY https) open in the system browser/app.
- **Loading overlay**
  - Branded gradient background, centered RELAY icon, subtle spinner.
  - Auto-hides once the web content finishes loading.
- **Connection Error**
  - Detects load failures / no network; offers Retry that reloads the WebView.

## Key User Flows

1. **Cold start →** Splash → WebView loads RELAY → onboarding/name entry (handled by web)
   → user lands on Dialer. All native; nothing to configure.
2. **Make a call →** User taps call in web UI → WebView requests camera/mic → native
   permission prompt (first time) → call connects. Permissions persist after first grant.
3. **App backgrounded mid-call →** Web app's own auto-rejoin handles reconnect; native
   keeps the WebView mounted.
4. **Offline →** Load fails → Connection Error screen → user taps Retry when back online.
5. **Web gets upgraded →** Next app launch (or reload) shows the new web version
   automatically — no rebuild needed.

## Navigation

- No native tab bar. Single Stack with one route (the WebView shell). The web app owns
  in-app navigation.
- Android hardware back button → goes back in WebView history; if no history, prompts/exits.

## Color Choices (brand)

Matches the RELAY web app's dark, modern WebRTC aesthetic:

| Token        | Value     | Use                                  |
|--------------|-----------|--------------------------------------|
| Brand indigo | `#4F46E5` | Primary accent, spinner, buttons     |
| Brand cyan   | `#06B6D4` | Gradient highlight                   |
| Deep navy    | `#0B1020` | Splash / loading background, app bg  |
| Surface      | `#11182B` | Error card surface                   |
| Foreground   | `#E5E9F5` | Primary text on dark                 |
| Muted        | `#8B93AD` | Secondary text                       |

The status bar uses light content on the dark background. The WebView background is set
to the deep navy so there is no white flash before the web app paints.

## Native Configuration

- `app.config.ts`: camera + microphone usage strings (iOS `infoPlist`), Android
  `CAMERA`/`RECORD_AUDIO`/`MODIFY_AUDIO_SETTINGS` permissions, branding (name = RELAY,
  logoUrl set to generated icon).
- `react-native-webview` with `mediaCapturePermissionGrantType="grant"`,
  `allowsInlineMediaPlayback`, `mediaPlaybackRequiresUserAction={false}`,
  `domStorageEnabled`, `sharedCookiesEnabled`, `thirdPartyCookiesEnabled`.
