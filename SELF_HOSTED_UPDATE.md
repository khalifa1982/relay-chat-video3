# RELAY Mobile — APK Auto-Update Guide (GitHub Releases)

The app updates **itself** on Android: it checks a small JSON manifest, compares
versions, and (when a newer build exists) downloads the APK with a progress bar
and launches the system installer — the user does **no** manual download.

> **Platform note:** Self-installing an APK is an **Android-only** capability.
> Apple does not permit apps to install other apps, so on iOS this flow is a
> safe no-op (iOS updates still go through TestFlight / App Store).

## Where updates are hosted

Updates are hosted on a dedicated **public** GitHub repository so the download
URLs work on any phone without a login token:

- **Repo:** `https://github.com/khalifa1982/relay-app-releases`
- **Manifest:** `https://github.com/khalifa1982/relay-app-releases/releases/latest/download/version.json`
- **APK:** `https://github.com/khalifa1982/relay-app-releases/releases/latest/download/relay-mobile.apk`

> Your **app source code stays private** (`khalifa1982/relay-chat-video3`). Only
> the built APK + manifest live in the public releases repo. GitHub's
> `releases/latest/download/...` always points at the newest published release,
> so the app never needs a code change when you ship a new build.

### `version.json` format

```json
{
  "buildNumber": 6,
  "versionName": "1.0.6",
  "apkUrl": "https://github.com/khalifa1982/relay-app-releases/releases/latest/download/relay-mobile.apk",
  "mandatory": false,
  "notes": "RELAY 1.0.6"
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `buildNumber` | Yes | Integer fallback signal. |
| `versionName` | Recommended | **Primary** signal — `1.0.7 > 1.0.6` triggers an update. |
| `apkUrl` | No | APK URL. Defaults to the public release `relay-mobile.apk`. |
| `notes` | No | Release notes (shown in footer/banner). |
| `mandatory` | No | When `true`, a blocking "Update required" screen is shown until it installs. |

## How the app decides to update

1. On launch, on every foreground resume, **and every 10 minutes** while running,
   it fetches `version.json` (cache-busted).
2. It compares the manifest **`versionName`** to the installed version name
   (primary); `buildNumber` vs the installed Android `versionCode` is the fallback.
3. If newer, it downloads the APK with a live progress bar, then launches the
   Android package installer to install + restart.
4. If a call is active, the install/restart is deferred so the call isn't dropped.
5. The footer status row shows the current build, the latest build, and a
   **Check** button that reports the real reason (e.g. "you're on the latest",
   "manifest unreachable") instead of failing silently.

## Your release workflow (every new version)

You build the APK (Manus **Publish** button), then publish it. The simplest path:

### Option A — one command (recommended)

From the project folder, with the GitHub CLI logged in:

```bash
scripts/publish-release.sh /path/to/relay-mobile-v1_0_7.apk 1.0.7
```

The script auto-creates the GitHub Release, attaches `relay-mobile.apk`, and
writes a matching `version.json` (build number derived from the version, e.g.
`1.0.7 → 7`). Installed apps pick it up within ~10 minutes.

### Option B — manual (GitHub web UI)

1. Go to `https://github.com/khalifa1982/relay-app-releases/releases` → **Draft a new release**.
2. Tag it `v1.0.7`, attach two assets named exactly `relay-mobile.apk` and `version.json`.
3. In `version.json`, set `versionName` to `1.0.7` and `buildNumber` to `7`.
4. **Publish release.** ("latest" now points to it automatically.)

> Tip: keep the asset names exactly `relay-mobile.apk` and `version.json` — the
> app's `releases/latest/download/<name>` URLs depend on those names.

## Important: bump the build version when you Publish

When you build in Manus, make sure the new build's version increases. In
`app.config.ts` the Android build number is:

```ts
const ANDROID_BUILD_NUMBER = 6; // bump for every release (and version "1.0.x")
```

The app compares the **version name** first, so bumping `version` (e.g.
`1.0.6 → 1.0.7`) is what matters most; keep `ANDROID_BUILD_NUMBER` and the
manifest `buildNumber` in step as a fallback.

## Configurable endpoints (optional)

Point the app elsewhere without code changes via env vars (Secrets panel):

| Env var | Default |
| --- | --- |
| `EXPO_PUBLIC_UPDATE_BASE_URL` | `https://github.com/khalifa1982/relay-app-releases/releases/latest/download` |
| `EXPO_PUBLIC_UPDATE_MANIFEST_URL` | `<base>/version.json` |
| `EXPO_PUBLIC_UPDATE_APK_URL` | `<base>/relay-mobile.apk` |

## User-side one-time setting

On the first auto-update, Android asks the user to allow "Install unknown apps"
for RELAY (because the APK is not from the Play Store). This is a standard
one-time prompt; after granting it, future updates install smoothly.
