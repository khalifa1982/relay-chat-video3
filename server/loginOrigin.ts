/**
 * Where a sign-in came from, and how — the details the owner asked to be carried
 * on every second-device login (v2.100.1):
 *
 *   *"it need to be sent always the details from where his login type, country,
 *   IP, device name, everything."*
 *
 * WHY THIS IS ITS OWN MODULE. The approval prompt, the notification centre and the
 * Devices list all describe the same sign-in, and three copies of "how do I phrase
 * a login" is how three surfaces come to disagree about one event — the class this
 * codebase keeps re-learning (v2.99.77's presence divergence, v2.99.96's four
 * hand-rolled searches). The formatting is PURE and lives here; every surface
 * renders what these functions return.
 *
 * There is deliberately no geo lookup in here. Resolving an IP to a country is an
 * external HTTP call, and it is the one thing that must not sit in front of a
 * sign-in — see `resolveGeoForIp`'s use in `v2routers.ts`, where the country is
 * filled in AFTER the session row lands.
 */

/** The three ways into an account, exactly as the owner enumerated them. */
export const LOGIN_METHODS = ["code", "pin", "register"] as const;
export type LoginMethod = (typeof LOGIN_METHODS)[number];

/**
 * Narrow an unknown value to a login method, or null.
 *
 * FAILS TO NULL rather than to a default, because this string is shown to the
 * account owner as a claim about how somebody got in. "Signed in with a passcode"
 * when it was really an email code is worse than saying nothing.
 */
export function normalizeLoginMethod(v: unknown): LoginMethod | null {
  return typeof v === "string" && (LOGIN_METHODS as readonly string[]).includes(v)
    ? (v as LoginMethod)
    : null;
}

/** How the sign-in is described to the person who owns the account. */
export function loginMethodLabel(v: unknown): string | null {
  switch (normalizeLoginMethod(v)) {
    case "code":
      return "Email code";
    case "pin":
      return "4-digit passcode";
    case "register":
      return "New registration";
    default:
      return null;
  }
}

export type LoginOrigin = {
  ip?: string | null;
  country?: string | null;
  city?: string | null;
};

/**
 * "Dubai, AE" / "AE" / "192.0.2.7" / null — the most specific place we can honestly
 * name, and nothing when we cannot name one.
 *
 * The IP is the LAST resort rather than the headline, because a bare address tells
 * the owner very little about whether a sign-in was theirs, while a city and
 * country usually settles it at a glance. It is still shown, because the owner
 * asked for it by name and it is the only detail that survives when the geo service
 * is unreachable — which on a LAN, a VPN or a GeoIP miss is the ordinary case.
 */
export function describeLoginPlace(o: LoginOrigin): string | null {
  const city = (o.city || "").trim();
  const country = (o.country || "").trim().toUpperCase();
  if (city && country) return `${city}, ${country}`;
  if (city) return city;
  if (country) return country;
  const ip = (o.ip || "").trim();
  return ip || null;
}

/**
 * The full one-line summary: place · method. Either half may be missing, and the
 * separator only appears when both are present — an interpolation that emits a
 * dangling " · " is how a card ends up reading "Dubai, AE ·" with nothing after it.
 */
export function describeLogin(o: LoginOrigin & { method?: unknown }): string | null {
  const parts = [describeLoginPlace(o), loginMethodLabel(o.method)].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Trim a captured IP to something safe to store.
 *
 * The column is 64 chars, which fits any IPv6 form, and anything longer is not an
 * address — a header value that long is either a proxy chain that got through or
 * junk, and storing it would put attacker-controlled text into a row the account
 * owner reads. Whitespace and the IPv6 brackets some proxies add are stripped so
 * the same client does not appear as two different addresses across logins.
 *
 * A zone id (`fe80::1%eth0`) is deliberately REFUSED rather than parsed: a scoped
 * link-local address cannot be the client IP of a request that reached this server
 * through a load balancer, so accepting one would only widen what can be written
 * into a row the owner reads, for a case that cannot occur.
 */
export function normalizeLoginIp(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^\[|\]$/g, "");
  if (!s || s.length > 64) return null;
  // Addresses only: hex digits, dots and colons. Nothing else.
  if (!/^[0-9a-fA-F.:]+$/.test(s)) return null;
  return s;
}

/** ISO 3166-1 alpha-2, or null. Two letters exactly — the column holds two, and a
 *  longer value would be silently truncated into a country code that means
 *  something else. */
export function normalizeCountry(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

/** A city name, bounded to the column. Kept as written by the geo service rather
 *  than sanitised further, because it is rendered as TEXT by React and never
 *  interpolated into markup. */
export function normalizeCity(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, 96) : null;
}
