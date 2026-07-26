/* ──────────────────────────────────────────────────────────────────────────
 * Round 11 part B — a SIGNED proof that the server once admitted a pin to a room.
 *
 * The fallback path ("the server no longer knows this room — recreate it") only
 * exists because the authoritative fix can fail: a Redis failover blip between
 * the write and the read, a leader that died before its first write-through.
 * Recreating a room from what a CLIENT asserts is the obvious implementation and
 * it is an authorization hole: room ids are relayed to every participant, so a
 * client that simply names a stranger's roomId would be admitted to their live
 * call, and a client that claims `role: "host"` would gain kick/mute/admit over
 * it. That is precisely the class closed by v2.99.43 (M45, moderator powers
 * outliving membership) and v2.99.57 (R-GENPIN, a squatted number reaching a
 * live call) — it must not be reopened by the recovery path.
 *
 * So the client is never asked what it is. It is asked for a CAPABILITY the
 * server itself minted at the moment it admitted that pin to that room, and the
 * server re-derives everything from the signature:
 *
 *     <exp>.<role>.<hmac over roomId|pin|exp|role>
 *
 * The subject pin is taken from the CONNECTION (which register already binds to
 * a verified number where one exists), never from the message — so a leaked
 * capability is useless to anyone holding a different number, and a client can
 * only ever present a capability for a room it was genuinely in.
 *
 * Same fleet secret family as the bus and the persisted room records; with no
 * secret configured, minting returns null and verification refuses everything,
 * so the fallback simply does not exist rather than existing unauthenticated.
 * ────────────────────────────────────────────────────────────────────────── */
import crypto from "crypto";
import { busSecret } from "./redisBus";

/** Long enough to outlive any call (rooms reap after 5 minutes idle anyway), and
 *  bounded so a capability recovered from an old profile is not eternal. */
export const ROOM_CAP_TTL_MS = 12 * 60 * 60_000;

export type RoomRole = "host" | "cohost" | "";

function capMac(roomId: string, pin: string, exp: number, role: RoomRole, key: string): string {
  return crypto
    .createHmac("sha256", key)
    .update(`${roomId}|${pin}|${exp}|${role}`)
    .digest("hex")
    .slice(0, 32); // 128-bit tag
}

function normRole(v: unknown): RoomRole {
  return v === "host" || v === "cohost" ? v : "";
}

/**
 * Mint a capability for (roomId, pin). Returns null when there is no fleet
 * secret — the caller then simply omits it and the fallback is unavailable,
 * which is the correct degradation for an authorization token.
 */
export function mintRoomCap(
  roomId: string,
  pin: string,
  role: unknown,
  nowMs: number = Date.now(),
): string | null {
  const key = busSecret();
  if (!key || !roomId || !/^\d{6}$/.test(pin)) return null;
  const exp = nowMs + ROOM_CAP_TTL_MS;
  const r = normRole(role);
  return `${exp}.${r}.${capMac(roomId, pin, exp, r, key)}`;
}

export interface RoomCapClaim {
  /** The role the server granted AT ISSUE TIME. Never an escalation: it is
   *  inside the signature, so a client cannot promote itself by editing it. */
  role: RoomRole;
  exp: number;
}

/**
 * Verify a capability against a roomId and the connection's own pin. Returns the
 * signed claim, or null for anything that is expired, malformed, mis-signed, or
 * minted for a different room or pin. Never throws.
 */
export function verifyRoomCap(
  cap: unknown,
  roomId: string,
  pin: string,
  nowMs: number = Date.now(),
): RoomCapClaim | null {
  const key = busSecret();
  if (!key) return null;
  if (typeof cap !== "string" || cap.length > 256) return null;
  if (!roomId || !/^\d{6}$/.test(pin)) return null;
  const parts = cap.split(".");
  if (parts.length !== 3) return null;
  const [expRaw, roleRaw, mac] = parts;
  if (!/^\d{1,15}$/.test(expRaw)) return null;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= nowMs) return null;
  if (roleRaw !== "" && roleRaw !== "host" && roleRaw !== "cohost") return null;
  const role = roleRaw as RoomRole;
  const expected = capMac(roomId, pin, exp, role, key);
  if (typeof mac !== "string" || mac.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return null;
  } catch {
    return null;
  }
  return { role, exp };
}
