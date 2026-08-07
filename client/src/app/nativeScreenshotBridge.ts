/**
 * Screenshot-block bridge (QW-12, mobile 1.0.44).
 *
 * The mobile shell is a WebView, and the WebView is the only layer that can flip
 * Android's FLAG_SECURE — the flag that blocks still screenshots, screen
 * recording, and the app-switcher thumbnail. The web app owns every piece of
 * settings UI, so the toggle lives here and the *decision* is posted to the
 * shell, which enforces it with expo-screen-capture.
 *
 * ── The two contracts ──────────────────────────────────────────────────────
 *
 *  • Shell → page, injected BEFORE page JS runs:
 *        window.__RELAY_NATIVE__ = {
 *          platform: "android" | "ios",
 *          capabilities: { screenshotBlock: boolean },
 *        }
 *    The toggle keys its visibility off `capabilities.screenshotBlock`, so it
 *    only ever appears on a build that can honour it. Older shells and desktop
 *    browsers leave `__RELAY_NATIVE__` undefined → the switch is hidden and this
 *    module never posts anything, so there is no dead control on a build that
 *    would ignore it. `screenshotBlock` is advertised on Android only (iOS
 *    cannot block a still screenshot), which is exactly why it is a capability
 *    flag and not merely `platform === "ios"`.
 *
 *  • Page → shell:
 *        window.ReactNativeWebView.postMessage(
 *          JSON.stringify({ type: "SET_SCREENSHOT_BLOCK", enabled: boolean })
 *        )
 *
 * ── Where the preference lives ─────────────────────────────────────────────
 *
 * localStorage, NOT a server flag. Blocking screenshots is a property of THIS
 * phone, not of the account — mirroring it to a desktop session or a second
 * device would be meaningless, and it needs no schema change. FLAG_SECURE is
 * per-Activity and is dropped when the Activity is recreated, so
 * `applyStoredScreenshotBlock()` re-posts the stored preference on every page
 * load; without that, a relaunch would silently stop blocking.
 */

const STORAGE_KEY = "relay.screenshotBlock";

type NativeCapabilities = { screenshotBlock?: boolean };
type NativeInfo = { platform?: string; capabilities?: NativeCapabilities };
type ReactNativeWebViewBridge = { postMessage: (message: string) => void };

function nativeInfo(): NativeInfo | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { __RELAY_NATIVE__?: NativeInfo }).__RELAY_NATIVE__;
}

/**
 * True only inside a shell build that has told us it can actually enforce the
 * block. This — not a user-agent sniff — is the single gate the toggle's
 * visibility hangs on.
 */
export function screenshotBlockSupported(): boolean {
  return nativeInfo()?.capabilities?.screenshotBlock === true;
}

/**
 * The stored device-local preference. Default OFF: screenshots are allowed until
 * the user opts into blocking, matching every other "turn this ON to lock down"
 * switch. Any storage failure reads as OFF rather than throwing.
 */
export function getScreenshotBlockPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function postToNative(enabled: boolean): void {
  if (typeof window === "undefined") return;
  const bridge = (window as unknown as { ReactNativeWebView?: ReactNativeWebViewBridge })
    .ReactNativeWebView;
  try {
    bridge?.postMessage(JSON.stringify({ type: "SET_SCREENSHOT_BLOCK", enabled }));
  } catch {
    /* A shell that can't receive the message simply keeps its default. */
  }
}

/** Persist the preference for this device and tell the shell to apply it now. */
export function setScreenshotBlock(enabled: boolean): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    } catch {
      /* Private-mode / disabled storage: the post below still applies it for
         this session, it just won't survive a relaunch. */
    }
  }
  postToNative(enabled);
}

/**
 * Re-post the stored preference to the shell. Called on every page load because
 * FLAG_SECURE is dropped when the Activity is recreated. A no-op off a supporting
 * shell, so it is safe to call unconditionally at app start.
 */
export function applyStoredScreenshotBlock(): void {
  if (!screenshotBlockSupported()) return;
  postToNative(getScreenshotBlockPref());
}
