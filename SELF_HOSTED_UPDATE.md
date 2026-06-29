# RELAY Mobile — Self-Hosted APK Auto-Update Guide

This app updates **itself** on Android by checking a small JSON manifest you
host, comparing build numbers, and (when a newer build exists) downloading the
APK with a progress bar and launching the system installer — no manual
download by the user.

> **Platform note:** Self-installing an APK is an **Android-only** capability.
> Apple does not permit apps to install other apps, so on iOS this flow is a
> safe no-op (iOS updates still go through TestFlight / App Store).

## 1. What the app expects on your server

Host two files at a fixed location under `https://your-chat.org/update/`:

| File | URL | Purpose |
| --- | --- | --- |
| Version manifest | `https://your-chat.org/update/version.json` | Declares the latest build number + APK URL |
| APK binary | `https://your-chat.org/update/app.apk` | The installable Android app |

Both URLs are configurable via environment variables (see section 4), but the
defaults above match what we agreed.

### `version.json` format

```json
{
  "buildNumber": 2,
  "versionName": "1.1.0",
  "apkUrl": "https://your-chat.org/update/app.apk",
  "notes": "Bug fixes and improvements",
  "mandatory": false
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `buildNumber` | Yes | Integer. Must be **greater than** the installed build to trigger an update. |
| `versionName` | No | Shown to the user (e.g. in the update banner). |
| `apkUrl` | No | APK download URL. Falls back to `https://your-chat.org/update/app.apk`. |
| `notes` | No | Release notes (reserved for display). |
| `mandatory` | No | Reserved for forcing the update. |

## 2. How the app decides to update

1. On every launch — and every time the app returns to the foreground — it
   fetches `version.json` (cache-busted).
2. It reads the installed Android build number (`versionCode`).
3. If `manifest.buildNumber > installedBuildNumber`, it downloads the APK with a
   live progress bar, then launches the Android package installer to install +
   restart.
4. If a call is active, the install prompt is deferred so it won't drop the call.

The installed `versionCode` is set in `app.config.ts`:

```ts
const ANDROID_BUILD_NUMBER = 1; // bump this for every release you build
```

## 3. Your release workflow (every new version)

1. **Increment the build number** in `app.config.ts`
   (`ANDROID_BUILD_NUMBER`) — e.g. `1` → `2`. (Optionally bump `version`.)
2. **Build the APK** (via the Publish button in the Manus UI, or your EAS/Gradle
   build). This produces an APK whose `versionCode` equals `ANDROID_BUILD_NUMBER`.
3. **Upload the APK** to `https://your-chat.org/update/app.apk` (overwrite the
   previous file).
4. **Update `version.json`** so `buildNumber` equals the new build number
   (e.g. `2`) and bump `versionName`.

That's it. Next time any installed app launches, it sees build `2 > 1`,
downloads the new APK, and installs it.

> Keep `buildNumber` in `version.json` and `ANDROID_BUILD_NUMBER` in the built
> APK **in sync**. The manifest number must match (or be ≤) the number baked
> into the APK you uploaded, otherwise the app will keep re-offering the update.

## 4. Configurable endpoints (optional)

You can point the app at different URLs without code changes using these
environment variables (e.g. via the Secrets panel):

| Env var | Default | Purpose |
| --- | --- | --- |
| `EXPO_PUBLIC_UPDATE_BASE_URL` | `https://your-chat.org/update` | Base folder |
| `EXPO_PUBLIC_UPDATE_MANIFEST_URL` | `<base>/version.json` | Manifest URL |
| `EXPO_PUBLIC_UPDATE_APK_URL` | `<base>/app.apk` | APK URL |

## 5. Server requirements

- Serve `app.apk` with `Content-Type: application/vnd.android.package-archive`
  (most servers do this by extension; not strictly required since we install
  from a local copy).
- Serve `version.json` with `Content-Type: application/json` and **no aggressive
  caching** (the app cache-busts with a `?t=` query param, but a short max-age
  is recommended).
- Both must be served over **HTTPS**.

## 6. User-side one-time setting

On first update, Android asks the user to allow "Install unknown apps" for
RELAY (because the APK is not from the Play Store). This is a standard one-time
Android permission prompt; after granting it, future updates install smoothly.
