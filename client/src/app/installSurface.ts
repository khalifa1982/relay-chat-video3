/**
 * WHERE THE "INSTALL RELAY" AFFORDANCE IS ALLOWED TO APPEAR.
 *
 * Owner (v2.106.81, pointing at the iOS install banner): *"if the system deduct
 * that the user access it by mobile browser or mobile app, no need to show this
 * unless it's been desktop, and show it the icon that can be added to the browser
 * or to the desktop — as you click, automatically create a shortcut to the
 * /app link directly"*.
 *
 * THE BANNER WAS ALSO GENUINELY WRONG INSIDE THE NATIVE SHELL, which is a bug
 * rather than a preference and is the likeliest thing the owner was looking at.
 * `iosNeedsInstallForPush()` is `isIos() && !standalone && !pushSupported()`, and
 * ALL THREE are true inside the Expo WebView: a WebView is not `display-mode:
 * standalone`, and it exposes no PushManager. So the shell told the user to "tap
 * Safari's Share button" when there is no Safari to tap — and that shell already
 * receives calls over APNs/FCM, so the advice was not merely useless, it pointed
 * at the wrong product.
 *
 * THE SHELL CHECK IS A CAPABILITY CHECK, NEVER A USER-AGENT SNIFF — the same call
 * v2.106.76 made for audio routing. A UA sniff would claim a shell for every
 * Android browser and suppress the banner for people who genuinely need it.
 */

/** True only inside the Expo/native shell, which injects `RelayNative`. */
export function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  const rn = (window as unknown as { RelayNative?: { postMessage?: unknown } }).RelayNative;
  return typeof rn?.postMessage === "function";
}

/** Already installed — as a PWA, or launched from a Home Screen icon. */
export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * A phone or tablet BROWSER (not the shell).
 *
 * `(pointer: coarse)` is the honest signal — it asks what the input device is
 * rather than parsing a string the browser is free to lie about. Paired with a
 * width bound so a touchscreen laptop, which is a desktop in every way that
 * matters here, is not mistaken for a phone.
 */
export function isMobileBrowser(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches === true;
  const narrow = window.innerWidth < 900;
  return coarse && narrow;
}

/* ── The deferred install prompt ──────────────────────────────────────────────
   `beforeinstallprompt` fires on Chromium (Chrome/Edge) only. Safari and Firefox
   never fire it and expose no programmatic install at all.

   THAT IS WHY THE BUTTON IS GATED ON THE EVENT HAVING ACTUALLY FIRED rather than
   on "is this a desktop": on desktop Safari a button would be present, tappable,
   and able to do literally nothing — the silent-no-op class this repo keeps
   removing (v2.103.3: a control that can never work should be ABSENT, not
   disabled). We show the affordance only when we hold a real prompt to fire.

   The event must be captured at module load, because the browser fires it once,
   early, and it is gone if nobody called preventDefault() on it. */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Without preventDefault the browser shows its own mini-infobar and the event
    // cannot be replayed later from our own button.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  // Once installed the prompt is spent and the affordance must disappear.
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

/** Whether a real, firable install prompt is in hand right now. */
export function hasInstallPrompt(): boolean {
  return deferred !== null;
}

export function subscribeInstallPrompt(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Fire the browser's own install flow. Resolves to whether it was accepted.
 *
 * The prompt is SINGLE-USE: the spec allows it to be fired once, so it is dropped
 * afterwards either way — leaving it in hand would give the user a button that
 * works the first time and silently does nothing the second.
 */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  notify();
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    return outcome === "accepted";
  } catch {
    return false;
  }
}

/**
 * THE ONE DECISION, so no surface can disagree with another about it.
 *
 * Show the install affordance only when: not already installed, not inside the
 * native shell, not a mobile browser (the owner's call — they now ship real iOS
 * and Android apps, so telling a mobile visitor to Add-to-Home-Screen points at
 * the wrong product), and we actually hold a prompt we can fire.
 *
 * The shortcut lands on `/app` with no work here: `manifest.webmanifest` already
 * declares `"start_url": "/app"`, which is what the browser uses for the icon it
 * creates.
 */
export function shouldOfferInstall(): boolean {
  return !isInstalled() && !isNativeShell() && !isMobileBrowser() && hasInstallPrompt();
}
