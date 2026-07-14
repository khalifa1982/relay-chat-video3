# RELAY Mobile — Android & iOS store apps

*Owner's runbook. Written 2026-07-14 (v2.85.0). Everything an agent can build is
already in this repo; the steps only the account owner can perform are marked
**[YOU]**.*

---

## 1 · Architecture decision (read this first)

> **SUPERSEDED (2026-07-14, owner mandate):** RELAY mobile is now a **full
> native rewrite** — compiled UI, no webview anywhere, WhatsApp/Telegram as
> the quality bar. Stack: **React Native + TypeScript + Swift/Kotlin native
> modules** (chosen because the existing TypeScript call engine + protocol
> port with near-line fidelity — the only tractable path to absolute feature
> parity — while CallKit/ConnectionService deliver the native call
> experience). Lives at **`mobile/native/`**; built by
> `.github/workflows/native-rn.yml`.
>
> Milestones (each ends in an installable build):
> **M1 ✅ Foundation** — typed client for the unmodified backend (tRPC/
> superjson + device-id identity), native tab shell in the RELAY visual
> identity, live-data Dialer/History/Messages/Contacts/Profile.
> **M2** Messaging + contacts write-parity (send, attachments, voice notes,
> read receipts, typing, block, categories). **M3** The call engine port
> (SSE+POST signaling verbatim, mesh via react-native-webrtc + LiveKit RN
> SDK, staged progress, consent protocol, call waiting, rejoin/paging).
> **M4** OS call experience — CallKit + ConnectionService + VoIP push (the
> "rings like a real phone" milestone). **M5** Filters (MediaPipe native),
> screen share, native PiP, recording. **M6** Full QA matrix + store swap.
>
> The Capacitor app below (v2.86) remains the **interim/store-now option**
> and its native layer (FCM plumbing, server fcm.ts, signing/CI/runbooks)
> carries over. Mobile-convention substitutions (allowed by the mandate):
> store updates replace the 30s self-updater; native biometrics replace
> WebAuthn; native PiP replaces browser PiP.

**Previous strategy (v2.85–v2.86): store-grade native shells around the live web app.**

| Option | Verdict | Why |
|---|---|---|
| **Android TWA + iOS Capacitor shell** (chosen) | ✅ ship now | 100% feature & visual parity *by construction* — the shells run the real app. Every web deploy is instantly the mobile release (the in-app auto-updater already handles versioning). One codebase; the store apps never lag. |
| React Native rewrite | ❌ not now | Would re-implement ~5,000 lines of call engine (mesh + SFU, consent protocol, call-waiting/hold/merge, rejoin, paging, push) that took 30+ releases to stabilize. RN's WebRTC story is a third-party module with its own audio-routing quirks — we'd re-fight the exact battles just won in v2.80–v2.84, ×2 platforms. |
| Kotlin + Swift rewrites | ❌ not now | Same as above with double the surface. Justified only when there's a native-only requirement (CallKit/ConnectionService integration is the first real one — see §7). |

The engine, protocol, and API layer are already latency-tuned for mobile
(v2.81 code-splitting: 1,941→723 kB entry; immutable asset caching; SSE
signaling with reconnect-on-foreground; Web Push wake-ups; tRPC batching).
The shells add zero network hops — the "mobile API" **is** the web API.

Key advantage over the current `BETA 1.0.16` WebView wrapper: the TWA runs
**real Chrome** (proper WebRTC audio routing, autoplay policy, Web Push,
permission persistence). Several Android-only audio oddities reported against
the wrapper simply don't exist in Chrome.

---

## 2 · What's in this repo

```
mobile/
├── native/             ★ THE NATIVE REWRITE (React Native, M1) — compiled
│                         UI, typed client to the existing API, no webview
├── app/                The shared Capacitor project (one config, two platforms)
│   ├── capacitor.config.json   (loads https://www.your-chat.org/app)
│   ├── android/        ★ NATIVE Android app (v2.86) — Capacitor + native call
│   │                     layer: full-screen incoming ring, OS speakerphone,
│   │                     ongoing-call foreground service, FCM push
│   └── ios/App/        iOS Xcode project (camera/mic strings, bg audio)
├── android/            TWA shell (kept as a lightweight fallback)
├── README.md           This runbook
└── QA-TEST-PLAN.md     Release test protocol (device matrix + call scenarios)
.github/workflows/android-apk.yml   CI: native APK/AAB (primary) + TWA
server/wellKnown.ts     /.well-known/assetlinks.json (env-driven)
server/fcm.ts           FCM sender for the native app (FIREBASE_SERVICE_ACCOUNT_JSON)
```

### The native Android app (v2.86) — what's native and why

The web app remains the UI + call engine; native Android code adds what no
web shell can do:
- **Full-screen incoming call** (`IncomingCallActivity` via FCM
  `fullScreenIntent`): rings over the lock screen with Answer/Decline even
  when the app is CLOSED. Answer opens the app; the signaling server
  redelivers the held ring (`deliverPendingRing`) and the in-app flow takes over.
- **Real speakerphone routing** (`CallAudioPlugin` → AudioManager) — the
  in-call speaker button now switches the OS route like the system dialer.
- **Ongoing-call foreground service** (`CallService`) — Android never freezes
  a live call in the background.
- **FCM device token** registered with the server as
  `push_subscriptions.kind = "fcm"`; the server delivers incoming-call /
  missed-call DATA messages via FCM v1 (`server/fcm.ts`).

### **[YOU]** Firebase setup (~10 min — push stays dormant until this)

1. https://console.firebase.google.com → **Add project** (name: RELAY;
   Analytics optional/off).
2. In the project: **Add app → Android**, package name **`org.yourchat.relay`**
   → download **`google-services.json`** → commit it at
   `mobile/app/android/app/google-services.json` (it contains no secrets; the
   build auto-detects it and enables FCM).
3. **Project settings → Service accounts → Generate new private key** →
   download the JSON. In Manus **Settings → Secrets** add
   `FIREBASE_SERVICE_ACCOUNT_JSON` = the ENTIRE file content (one line is
   fine). Publish from Manus. Server-side FCM sends are now live.
4. Rebuild the app (Actions → Android APK) and reinstall — the app registers
   its token on next open, and closed-app rings work.

---

## 3 · Android — from repo to Play Store

### 3.1 Get an APK today (no toolchain needed)
GitHub → **Actions → "Android APK" → Run workflow**. Artifacts:
- **`RELAY-NATIVE-debug-apk`** — the native app; install directly on any phone
  (enable "install unknown apps"). This is your test build.
- **`RELAY-NATIVE-release-aab`** — the bundle you'll sign & upload to Play
  (`RELAY-NATIVE-release-aab-SIGNED` appears once the signing secrets are set).
- `RELAY-debug-apk` / `RELAY-release-aab` — the TWA fallback shell.

Local alternative: open `mobile/android/` in Android Studio (it generates the
Gradle wrapper) → Build.

### 3.2 **[YOU]** Google Play account & signing
1. Create a [Play Console](https://play.google.com/console) developer account —
   $25 one-time, needs a Google account + identity verification (can take a
   couple of days; start early).
2. Create app → name **RELAY**, package `org.yourchat.relay` (must match
   `mobile/android/app/build.gradle`; change *before* first upload if you want
   a different id — it's permanent).
3. Use **Play App Signing** (default). Generate an upload key locally:
   `keytool -genkeypair -v -keystore relay-upload.keystore -alias relay -keyalg RSA -keysize 2048 -validity 10000`
   Keep the keystore + password in a password manager.
4. **Easiest signing path — let CI do it**: add four GitHub repo secrets
   (Settings → Secrets and variables → Actions): `ANDROID_KEYSTORE_BASE64`
   (`base64 -w0 relay-upload.keystore`), `ANDROID_KEYSTORE_PASSWORD`,
   `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Every "Android APK" run then
   also emits **`RELAY-release-aab-SIGNED`** — download, unzip, upload that
   `.aab` straight to Play Console. (Manual alternative:
   `jarsigner -keystore relay-upload.keystore app-release.aab relay`.)

### 3.3 **[YOU]** Digital Asset Links → full-screen
After the first upload, Play Console → **Test and release → App integrity →
App signing** shows two SHA-256 fingerprints (App signing key + Upload key).
In Manus **Settings → Secrets** add:
```
TWA_SHA256_FINGERPRINTS = AA:BB:...:11, CC:DD:...:22   ← both, comma-separated
```
(`TWA_PACKAGE_NAME` only if you changed the package id.) Publish the app from
Manus, then verify `https://www.your-chat.org/.well-known/assetlinks.json`
returns them. Until then the Android app works but shows Chrome's URL bar.

### 3.4 **[YOU]** Store listing
- Screenshots: phone 1080×1920+ (Dialer, in-call, Messages, Contacts, History).
- Feature graphic 1024×500, icon 512×512 (export `client/public/icon.svg`).
- Privacy policy URL: `https://www.your-chat.org/privacy-policy` (already live).
- Data-safety form: collects display name, optional email; camera/mic used for
  calls, not recorded server-side by default; messages stored to deliver them.
- Content rating questionnaire → communication app.
- Review notes: "WebRTC calling app. Test: open app → Enter as guest → dial the
  6-digit number of a second test device." Provide two guest numbers.

---

## 4 · iOS — from repo to App Store

Building iOS requires a Mac with Xcode (Apple's rule — no CI shortcut without
a paid macOS runner).

### 4.1 Build steps (any Mac)
```bash
cd mobile/app
npm install
npx cap sync ios          # installs Pods (needs CocoaPods: `brew install cocoapods`)
npx cap open ios          # opens ios/App/App.xcworkspace in Xcode
```
In Xcode: set your Team (Signing & Capabilities), bundle id
`org.yourchat.relay` (or your choice — set it once, it's permanent per app),
then **Product → Archive → Distribute** (TestFlight first).

### 4.2 **[YOU]** Apple Developer account
1. Enroll at [developer.apple.com](https://developer.apple.com/programs/enroll/)
   — $99/year. Individual enrollment is fastest; an organization needs a D-U-N-S
   number (free but slow to issue).
2. App Store Connect → New App → RELAY, the bundle id above.

### 4.3 iOS review — known gotchas (already handled in the project)
- Camera/mic **purpose strings** are set in Info.plist (missing ones = instant
  crash + rejection).
- `UIBackgroundModes: audio` keeps a call alive when backgrounded.
- Guideline 4.2 ("web clipping"): communication apps wrapping their own
  functional web app generally pass — emphasize in review notes that this is a
  full-featured calling/messaging product, include test numbers. If review
  pushes back, the standard remedies are Capacitor-native touches (haptics,
  share sheet) — cross that bridge if it comes.
- Push inside the shell uses the site's Web Push (works in WKWebView-hosted
  content only when installed as PWA — for the **shell** app, notifications
  arrive via the same standalone-PWA rules; native APNs/VoIP push is the §7
  upgrade if review or UX demands it).

---

## 5 · Design parity (Material / HIG)

The web app already implements a phone-native layout: bottom tab bar with
per-tab accents, sheet-style dialogs, safe-area-aware shell height (measured
`--relay-vh`), portrait lock, dark OLED palette, large touch targets, ringtone
+ haptics. Platform deltas the shells inherit for free: system back gesture
(Android/Chrome history), status-bar theming (`#0A0D10` in both shells),
adaptive/monochrome launcher icon (Material You) from the same brand SVG.
No separate mobile design track is needed while parity is the mandate.

---

## 6 · Performance / latency (the KPI)

Nothing mobile-specific to add server-side — the shells consume the same
optimized stack, measured this session:
- entry bundle 723 kB (route-split), hashed assets `immutable, max-age=1y`
- signaling: SSE + POST with 250ms→backoff retries, instant reconnect on
  foreground, 30s disconnect grace, ring redelivery, Web Push paging
- media: LiveKit SFU (10-way) with mesh fallback; Opus `speech` preset; DTX;
  per-party mesh bitrate caps
- JSON payloads are small (superjson via tRPC, batched); no serialization
  change would move the needle vs. RTT — the dominant term is TURN/SFU
  proximity. **If latency ever regresses**: check the LiveKit region and TURN
  host locality first.

---

## 7 · Deliberately deferred (next native steps, in order of value)

1. **Android ConnectionService / iOS CallKit + VoIP push** — OS-level incoming
   call screen when the app is closed. Requires going hybrid (Capacitor plugin
   or small native layer) and APNs VoIP certificates. This is the single
   biggest UX gap between "wrapped" and "native" for a caller.
2. Native APNs/FCM push transport for the shells (today: Web Push semantics).
3. In-app review prompts, share-sheet targets, app shortcuts.
