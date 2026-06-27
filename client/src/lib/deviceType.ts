/* Lightweight client device-type detection (Mobile vs Desktop). Used for the
 * device chip next to the country flag and on in-call tiles. Dependency-free. */

export type DeviceType = "Mobile" | "Desktop";

/**
 * Best-effort device classification. Prefers the modern `userAgentData.mobile`
 * hint, falls back to a UA regex, and finally to a coarse-pointer + small-screen
 * heuristic (catches phones whose UA was spoofed to desktop). Pure given the
 * environment; safe to call on the server (returns "Desktop").
 */
export function detectDeviceType(): DeviceType {
  if (typeof navigator === "undefined") return "Desktop";
  const uaData = (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData && typeof uaData.mobile === "boolean") {
    return uaData.mobile ? "Mobile" : "Desktop";
  }
  const ua = navigator.userAgent || "";
  if (/Mobi|Android|iPhone|iPod|IEMobile|Opera Mini|BlackBerry|Windows Phone/i.test(ua)) {
    return "Mobile";
  }
  // iPad on iOS 13+ reports a desktop UA — catch it via touch + screen size.
  try {
    if (
      typeof matchMedia === "function" &&
      matchMedia("(pointer: coarse)").matches &&
      typeof screen !== "undefined" &&
      Math.min(screen.width, screen.height) < 820
    ) {
      return "Mobile";
    }
  } catch {
    /* matchMedia/screen unavailable — fall through */
  }
  return "Desktop";
}
