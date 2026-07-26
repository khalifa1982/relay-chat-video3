/**
 * Pure helpers for the expanded profile hub (mobile numbers, social links,
 * status, last-seen). Shared by client (UI) and server (validation) so both
 * agree on the shapes/caps. No DOM, no DB — unit-tested directly.
 */

/** The social/link platforms a user can attach to their profile. */
export type SocialPlatform = "x" | "website" | "snapchat" | "whatsapp";

export interface SocialPlatformDef {
  key: SocialPlatform;
  label: string;
  placeholder: string;
  /** Build a tappable URL from the stored value (null = not linkable). */
  href: (value: string) => string | null;
}

export const SOCIAL_PLATFORMS: SocialPlatformDef[] = [
  {
    key: "x",
    label: "X (Twitter)",
    placeholder: "@handle or x.com/handle",
    href: (v) => {
      const h = v.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "");
      return h ? `https://x.com/${encodeURIComponent(h.split(/[/?#]/)[0])}` : null;
    },
  },
  {
    key: "website",
    label: "Website",
    placeholder: "https://example.com",
    href: (v) => {
      const t = v.trim();
      if (!t) return null;
      return /^https?:\/\//i.test(t) ? t : `https://${t}`;
    },
  },
  {
    key: "snapchat",
    label: "Snapchat",
    placeholder: "username",
    href: (v) => {
      const h = v.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?snapchat\.com\/add\//i, "");
      return h ? `https://snapchat.com/add/${encodeURIComponent(h.split(/[/?#]/)[0])}` : null;
    },
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    placeholder: "+1 555 123 4567",
    href: (v) => {
      const digits = v.replace(/[^\d]/g, "");
      return digits.length >= 6 ? `https://wa.me/${digits}` : null;
    },
  },
];

const PLATFORM_KEYS = new Set<string>(SOCIAL_PLATFORMS.map((p) => p.key));

export interface SocialLink {
  platform: SocialPlatform;
  value: string;
}

export const MAX_SOCIALS = 10;
export const MAX_MOBILES = 5;
const MAX_SOCIAL_VALUE = 200;
const MAX_MOBILE_LEN = 32;

/** Keep only well-formed social links (known platform + non-empty value), trim,
 *  cap value length and count. Returns a clean array. */
export function sanitizeSocials(input: unknown): SocialLink[] {
  if (!Array.isArray(input)) return [];
  const out: SocialLink[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const platform = (item as { platform?: unknown }).platform;
    const value = (item as { value?: unknown }).value;
    if (typeof platform !== "string" || !PLATFORM_KEYS.has(platform)) continue;
    if (typeof value !== "string") continue;
    const v = value.trim().slice(0, MAX_SOCIAL_VALUE);
    if (!v) continue;
    out.push({ platform: platform as SocialPlatform, value: v });
    if (out.length >= MAX_SOCIALS) break;
  }
  return out;
}

/** Keep only non-empty mobile strings (allow leading +, digits, spaces, dashes,
 *  parens), trim, cap length + count. */
export function sanitizeMobiles(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    const v = item.trim().slice(0, MAX_MOBILE_LEN);
    // Must contain at least 4 digits to be a plausible number, and only
    // phone-ish characters (+, digits, spaces, dashes, parens) — so "(020) …"
    // and "+1 555 …" pass while free text is rejected.
    if ((v.match(/\d/g) || []).length < 4) continue;
    if (!/^[+\d\s().-]+$/.test(v)) continue;
    out.push(v);
    if (out.length >= MAX_MOBILES) break;
  }
  return out;
}

export type StatusOverride = "" | "away" | "travel";

/** Manual status the user can set; "" means "auto" (derived from live presence). */
export function sanitizeStatusOverride(input: unknown): StatusOverride {
  return input === "away" || input === "travel" ? input : "";
}

/** The effective status to DISPLAY, combining live presence with any override. */
export type EffectiveStatus = "online" | "offline" | "away" | "travel";
export function effectiveStatus(isOnline: boolean, override: StatusOverride): EffectiveStatus {
  if (override === "travel") return "travel";
  if (override === "away") return "away";
  return isOnline ? "online" : "offline";
}

/**
 * WhatsApp-style "last seen" string from a timestamp. Pure; `now` is injected so
 * it's deterministic to test.
 *   < 60s         → "last seen just now"
 *   < 60m         → "last seen N minutes ago"
 *   same day      → "last seen today at H:MM AM"
 *   previous day  → "last seen yesterday at H:MM AM"
 *   older         → "last seen on MON D at H:MM AM"
 *   older, other year → "last seen on MON D, YYYY at H:MM AM"
 *
 * v2.99.66 (owner screenshot of the dialer preview): the older-than-yesterday
 * branch used to stop at the date — "last seen on Jul 23" — while the same-day
 * and yesterday branches already carried the clock. Owner: "it shows you last
 * seen on this, but doesn't show you the time and the minutes." The time is the
 * part that tells you whether they were here this morning or at 3am, so it is
 * now on EVERY dated branch. The year is added only when it differs from now,
 * because "Jul 23" reads as this year and would otherwise be wrong by twelve
 * months without saying so.
 */
export function formatLastSeen(lastSeenMs: number, nowMs: number): string {
  if (!Number.isFinite(lastSeenMs) || lastSeenMs <= 0) return "";
  const diff = nowMs - lastSeenMs;
  if (diff < 0) return "last seen just now";
  if (diff < 60_000) return "last seen just now";
  if (diff < 60 * 60_000) {
    const m = Math.floor(diff / 60_000);
    return `last seen ${m} minute${m === 1 ? "" : "s"} ago`;
  }
  const then = new Date(lastSeenMs);
  const now = new Date(nowMs);
  const time = formatClock(then);
  const sameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();
  if (sameDay) return `last seen today at ${time}`;
  const yest = new Date(nowMs - 24 * 60 * 60_000);
  const isYesterday =
    then.getFullYear() === yest.getFullYear() &&
    then.getMonth() === yest.getMonth() &&
    then.getDate() === yest.getDate();
  if (isYesterday) return `last seen yesterday at ${time}`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = `${months[then.getMonth()]} ${then.getDate()}`;
  const year = then.getFullYear() === now.getFullYear() ? "" : `, ${then.getFullYear()}`;
  return `last seen on ${day}${year} at ${time}`;
}

function formatClock(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}
