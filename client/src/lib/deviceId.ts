/**
 * Per-browser-SESSION device id that keeps a guest's identity (its 6-digit
 * number, contacts, history) stable for the life of a browser session, and NO
 * longer.
 *
 * Why sessionStorage, not localStorage (v2.95 \u2014 owner spec: guest data is
 * "session-only, wiped on logout/close"):
 *   - WITHIN a session it makes the guest sticky across cookie loss (Safari ITP,
 *     Brave Shields, Firefox ETP, iOS Private Browsing) \u2014 the exact bug reported
 *     as "I get disconnected and my number changes randomly" is still fixed,
 *     because the id survives a mid-session cookie drop AND is shared with the
 *     server on every API call so it re-binds the same identity.
 *   - It clears on BROWSER CLOSE, so a fresh session mints a NEW guest \u2014 guest
 *     identities are ephemeral, exactly as specified. (The guest cookie is now a
 *     SESSION cookie too, so both halves of the survival pair die on close.)
 *   - Multi-tab still works: a new tab has no sessionStorage id, but the shared
 *     session GUEST COOKIE resolves the same guest and the server re-binds this
 *     tab's fresh id to it.
 *   - Registered users are unaffected \u2014 they resolve via their own persistent
 *     `relay_session` cookie, not this id.
 *
 * Properties:
 *   - 16 bytes of crypto-grade randomness (32 hex chars) \u2014 collisions ~1 in 2^128.
 *   - Key `relay_device_id`; SSR-safe (null when window/sessionStorage absent);
 *     side-effect-free import (minted on first call).
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
    if (typeof window === "undefined" || !window.sessionStorage) return null;
    const v = window.sessionStorage.getItem(STORAGE_KEY);
    if (typeof v === "string" && HEX_RE.test(v)) return v.toLowerCase();
    return null;
  } catch {
    return null;
  }
}

function writeStored(value: string): void {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    window.sessionStorage.setItem(STORAGE_KEY, value);
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
