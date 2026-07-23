/**
 * Turn a User-Agent string into a short, human device label for the device
 * list (e.g. "Chrome on Android", "Safari on iPhone", "Edge on Windows").
 * Pure + dependency-free so it's unit-tested; deliberately coarse — this is a
 * friendly hint in Settings, not fingerprinting. Never throws; unknown UAs
 * fall back to "Unknown device".
 */
export function deviceLabelFromUA(ua: unknown): string {
  const s = typeof ua === "string" ? ua : "";
  if (!s) return "Unknown device";

  // Native RELAY app marks itself (mobile/native sets a custom UA fragment).
  if (/RelayNative|RelayApp/i.test(s)) {
    return /iPhone|iPad|iOS/i.test(s) ? "RELAY app on iPhone" : "RELAY app on Android";
  }

  // OS / device.
  let os = "";
  if (/iPhone/i.test(s)) os = "iPhone";
  else if (/iPad/i.test(s)) os = "iPad";
  else if (/Android/i.test(s)) os = "Android";
  else if (/Windows NT/i.test(s)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(s)) os = "Mac";
  else if (/CrOS/i.test(s)) os = "ChromeOS";
  else if (/Linux/i.test(s)) os = "Linux";

  // Browser (order matters: Edge/Opera/Brave spoof Chrome; Chrome spoofs Safari).
  let browser = "";
  if (/Edg\//i.test(s)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(s)) browser = "Opera";
  else if (/SamsungBrowser/i.test(s)) browser = "Samsung Internet";
  else if (/Firefox\/|FxiOS/i.test(s)) browser = "Firefox";
  else if (/CriOS/i.test(s)) browser = "Chrome";
  else if (/Chrome\//i.test(s)) browser = "Chrome";
  else if (/Safari\//i.test(s) && /Version\//i.test(s)) browser = "Safari";

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return os;
  return "Unknown device";
}
