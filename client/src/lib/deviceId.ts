/**
 * Per-browser device id used to make the guest session sticky across
 * cookie loss, IP changes, and network swaps.
 *
 * Why this exists:
 *   Cookies are the only thing the server natively trusts, but they
 *   are aggressively dropped on many browsers (Safari ITP, Brave
 *   Shields, Firefox ETP, iOS Private Browsing, third-party-cookie
 *   blockers). When the cookie is gone, the user looks signed-out
 *   and the OnboardingGate would happily mint them a fresh identity
 *   with a different number \u2014 the exact bug reported as "I get
 *   disconnected and my number changes randomly".
 *
 *   localStorage is a much more durable surface. By generating a
 *   16-byte random id on first load and sending it as an HTTP header
 *   on every API call, the server can re-bind the browser to its
 *   existing identity even if the cookie is gone.
 *
 * Properties:
 *   - 16 bytes of crypto-grade randomness (32 hex chars), enough to
 *     make collisions astronomically unlikely (~1 in 2^128).
 *   - Stored under the key `relay_device_id` so it shows up in dev
 *     tools and the user can reset it by clearing site data.
 *   - SSR-safe: returns null when window/localStorage are unavailable,
 *     so importing this module won't throw on the server.
 *   - Side-effect free import \u2014 the id is minted on first call.
 */

const STORAGE_KEY = "relay_device_id";
const ID_LENGTH_HEX = 32; // 16 bytes
let cached: string | null = null;

/**
 * Hex pattern accepted by the server. Keep in sync with
 * `extractDeviceId` on the server.
 */
const HEX_RE = /^[a-f0-9]{16,64}$/;

function randomHex16(): string {
  // crypto.getRandomValues is supported in every browser we care about
  // and in modern Node (used by SSR / tests under happy-dom).
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  }
  // Last-resort fallback. We bias toward correctness over speed; this
  // path only fires in very old / unusual environments.
  let out = "";
  while (out.length < ID_LENGTH_HEX) {
    out += Math.floor(Math.random() * 0xffff)
      .toString(16)
      .padStart(4, "0");
  }
  return out.slice(0, ID_LENGTH_HEX);
}

function readStored(): string | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (typeof v === "string" && HEX_RE.test(v)) return v.toLowerCase();
    return null;
  } catch {
    return null;
  }
}

function writeStored(value: string): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* storage may be disabled (Safari private mode) \u2014 we still keep
       the in-memory cache so the session at least survives the page
       load. */
  }
}

/**
 * Get the device id for this browser, creating it on first call.
 * Returns null only when no random source AND no storage are
 * available, which is effectively never in practice.
 */
export function getDeviceId(): string | null {
  if (cached) return cached;
  const existing = readStored();
  if (existing) {
    cached = existing;
    return cached;
  }
  const fresh = randomHex16();
  cached = fresh;
  writeStored(fresh);
  return cached;
}

/**
 * Reset the device id. Exposed so a "Sign out completely" button
 * (or a future "switch account" flow) can sever this browser from
 * its previous identity. Callers should also clear the guest cookie
 * via the server in the same gesture; otherwise the cookie would
 * silently restore the previous identity on the next request.
 */
export function resetDeviceId(): string {
  const fresh = randomHex16();
  cached = fresh;
  writeStored(fresh);
  return fresh;
}

/**
 * Clear the RELAY signaling-channel identity (connection id + cached pin) for
 * this browser. Call on an explicit logout so the NEXT user on a SHARED browser
 * gets a brand-new cid -> a brand-new number, and can never be auto-rejoined
 * into the previous user's still-live call. The server enforces the same
 * invariant (a differing pin request severs the old binding), but clearing here
 * is cheap defense-in-depth that also closes the narrow "registers before its
 * own number loads" race.
 */
export function clearRelayChannel(): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.removeItem("relay_cid");
    window.localStorage.removeItem("relay_pin");
  } catch {
    /* storage disabled (private mode) — nothing to clear */
  }
}

/**
 * Header name the server expects. Keep in sync with
 * `DEVICE_ID_HEADER` on the server.
 */
export const DEVICE_ID_HEADER = "x-relay-device-id";
