/**
 * GET-THE-APP configuration (v2.107.79) — the one place the mobile-browser
 * download prompt reads from, so enabling iOS later (or pointing Android at the
 * Play Store once the listing is live) is a one-line change here and a release,
 * with no component surgery.
 *
 * ANDROID ships as a DIRECT APK from the EAS artifact store — RELAY has no Play
 * listing yet, and the owner wants the download offered now. The artifact URL is
 * per-build: every new shell build that should be offered updates `url` here in
 * the same release. The APK is signed with the same keystore as the Play AAB, so
 * a Play install later upgrades cleanly over it.
 *
 * IOS is configured but DISABLED on purpose (owner: "keep that icon, but it will
 * not be active" — the App Store listing is still in review). The tab renders in
 * its coming-soon state; flipping `enabled` to true and filling `url` activates
 * it.
 */
export const APP_DOWNLOAD = {
  android: {
    enabled: true,
    /** EAS build 47 preview APK (Sentry native capture on board). */
    url: "https://expo.dev/artifacts/eas/NINvSvszkN80yYVkg-O-DivHiK-2ufVrya5FnjZdvDs.apk",
    /** The shell build the URL points at — bump together with `url`. */
    build: 47,
  },
  ios: {
    enabled: false,
    /** App Store URL once the listing is approved. */
    url: "",
  },
} as const;

/**
 * Which mobile OS is this browser, or null for everything else (desktop, bots).
 * Pure and exported so the prompt's whole gating story is unit-testable without
 * a DOM. `maxTouchPoints` catches iPadOS 13+, which reports a Mac UA and is only
 * distinguishable by its touch screen.
 */
export function detectMobileOs(
  ua: string,
  opts?: { platform?: string; maxTouchPoints?: number },
): "android" | "ios" | null {
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (opts?.platform === "MacIntel" && (opts?.maxTouchPoints ?? 0) > 1) return "ios";
  return null;
}
