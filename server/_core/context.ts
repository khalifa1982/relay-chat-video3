import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { getUserById } from "../db";
import { readLocalSession } from "../authLocal";
import {
  bindDeviceIdToIdentity,
  ensureUserIdentity,
  getIdentityByDeviceId,
  getIdentityByGuestToken,
  sessionState,
  touchSession,
  type ResolvedIdentity,
} from "../v2db";

export const GUEST_COOKIE = "relay_guest";
export const DEVICE_ID_HEADER = "x-relay-device-id";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  identity: ResolvedIdentity | null; // either guest or registered, when known
  /**
   * The device id presented by the client on this request (from the
   * `x-relay-device-id` header). Stable across cookie clears, IP
   * changes, and network swaps. Used by the resolver below to survive
   * cookie loss, and by procedures that want to bind a new identity to
   * the calling browser.
   */
  deviceId: string | null;
  /** The session ledger id from the local cookie (v2.99.1 device list), or null
   *  for OAuth users, guests, and legacy pre-ledger cookies. Lets procedures
   *  mark "this device" and clear the cookie when the current session is revoked. */
  sessionSid: string | null;
};

/** In-memory throttle so we bump a session's lastSeenAt at most every ~5 min
 *  instead of on every request (the ledger write is cosmetic). Per-process is
 *  fine — worst case a couple of instances each write once per window. */
const lastTouch = new Map<string, number>();
function maybeTouchSession(sid: string): void {
  const now = Date.now();
  const prev = lastTouch.get(sid) ?? 0;
  if (now - prev < 5 * 60_000) return;
  lastTouch.set(sid, now);
  // Fire-and-forget; never block the request on a cosmetic write.
  void touchSession(sid).catch(() => {});
  // Bound the map so a long-lived process can't grow it without limit.
  if (lastTouch.size > 5000) lastTouch.clear();
}

/**
 * Pull the device id from the inbound request header. Validate shape
 * defensively so a malformed header can't poison downstream lookups.
 */
export function extractDeviceId(req: CreateExpressContextOptions["req"]): string | null {
  const raw = req.headers[DEVICE_ID_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 64) return null;
  // Hex-only — the client mints it from crypto.getRandomValues, so any
  // non-hex character is a sign of a bogus header.
  if (!/^[a-f0-9]+$/i.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch {
    user = null;
  }
  // Fall back to a self-hosted email/password session (relay_session cookie) when
  // there's no Manus OAuth session. Both auth methods resolve to the same `user`.
  let sessionSid: string | null = null;
  if (!user) {
    try {
      const sess = readLocalSession(opts.req);
      if (sess?.userId != null) {
        if (sess.sid) {
          // NEW-format cookie (v2.99.1): gate it on the session ledger so a
          // device that was logged out remotely (row deleted) stops
          // authenticating. sessionState FAILS OPEN ("error") on any DB
          // trouble, so a hiccup never mass-logs-out the fleet. Legacy
          // cookies (sid null) skip this whole branch and behave as before.
          const state = await sessionState(sess.sid);
          if (state !== "revoked") {
            user = (await getUserById(sess.userId)) ?? null;
            if (user) {
              sessionSid = sess.sid;
              if (state === "active") maybeTouchSession(sess.sid);
            }
          }
        } else {
          user = (await getUserById(sess.userId)) ?? null;
        }
      }
    } catch {
      user = null;
    }
  }

  const deviceId = extractDeviceId(opts.req);
  const guestToken =
    (opts.req.cookies?.[GUEST_COOKIE] as string | undefined) ?? null;

  let identity: ResolvedIdentity | null = null;

  // Registered user takes precedence — ensure they have an identity row.
  if (user) {
    try {
      identity = await ensureUserIdentity({
        userId: user.id,
        displayName: user.name || "User",
        guestToken,
      });
    } catch {
      identity = null;
    }
  } else {
    /*
     * Guest resolution order, most-trusted to least-trusted:
     *
     *   1. Cookie hit (`relay_guest` matches a non-expired row). This
     *      is the happy path for the same browser within the cookie
     *      window.
     *   2. Cookie miss BUT a stable `x-relay-device-id` is present and
     *      matches a guest row. This catches the "cookies dropped /
     *      ITP / privacy mode" case so the user keeps their number.
     *   3. Cookie present but stale (no row), device id present and
     *      matches \u2014 same recovery as 2. (The order here matters: if
     *      the cookie matched a different row from the device id, we
     *      prefer the device id, because cookies can leak across tabs
     *      via copy-paste, extensions, or proxy caching while a
     *      localStorage value cannot.)
     *
     * The net effect: the same browser always lands on the same
     * identity, regardless of cookie state.
     */
    let resolved: ResolvedIdentity | null = null;
    if (guestToken) {
      try {
        resolved = await getIdentityByGuestToken(guestToken);
      } catch {
        resolved = null;
      }
    }

    if (deviceId) {
      try {
        const byDevice = await getIdentityByDeviceId(deviceId);
        if (byDevice) {
          // Device id always wins when it disagrees with the cookie.
          // This is the explicit "cookies are a hint, device id is
          // the truth" rule that fixes the multi-user-bleed bug.
          resolved = byDevice;
        }
      } catch {
        // Don't let a transient DB issue clobber a cookie-resolved
        // identity \u2014 fall through with `resolved` unchanged.
      }
    }

    identity = resolved;

    // One-time upgrade: if the resolved identity has no device id yet
    // (it predates this change) and the caller is presenting one, bind
    // it. `bindDeviceIdToIdentity` only writes when the slot is empty,
    // so this is safe to call on every request.
    if (identity && deviceId && identity.isGuest) {
      try {
        await bindDeviceIdToIdentity(identity.id, deviceId);
      } catch {
        // best-effort; the user keeps the resolved identity either way
      }
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    identity,
    deviceId,
    sessionSid,
  };
}
