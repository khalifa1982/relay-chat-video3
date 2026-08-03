/**
 * A 4-digit lock on a group conversation (v2.105.20, the last piece of #108).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS A PRIVACY SCREEN, NOT ACCESS CONTROL, AND EVERYTHING BELOW FOLLOWS FROM
 * THAT. Membership in the group is what grants read: the server serves every
 * message to every member, this device already holds them, and the same account
 * signed in on a laptop sees the group unlocked. So the lock cannot be — and must
 * never claim to be — a permission. What it does is stop the content appearing on
 * a screen somebody else is looking at, which is the actual thing being asked for
 * ("I hand my phone to someone with the app open").
 *
 * Consequences, each of which shaped the code:
 *
 *   • PER-DEVICE, in localStorage. A server-side lock would be a permission model
 *     the server cannot enforce, and it would lock the group on every device the
 *     account owns — including ones nobody was worried about.
 *
 *   • IT REQUIRES AN APP PASSCODE FIRST, and that is the load-bearing decision.
 *     A privacy screen with no recovery is a trap: forget four digits and your own
 *     group is redacted on that device forever, with "clear all site data" — which
 *     destroys the guest identity and its 6-digit number (v2.99.68) — as the only
 *     way back. The app passcode IS the recovery, so it has to exist before a lock
 *     can be set. `setGroupLock` refuses otherwise and says where to go.
 *
 *   • THE HASHING IS IMPORTED, NOT REIMPLEMENTED. `passcode.ts` exports
 *     `randomSaltHex`/`hashCode` for exactly this; a private copy is how two
 *     stores come to disagree about what a hash means.
 *
 *   • UNLOCKING LASTS THE SESSION, NOT FOREVER — the same model as the app lock,
 *     where `locked` is in-memory and a reload re-locks. A durable unlock would
 *     make the lock a one-time question rather than a screen.
 *
 * FAILS TOWARD *NOT* LOCKED on any storage trouble, and that is consistent rather
 * than lazy: failing the other way would make every group permanently unopenable
 * on a browser with localStorage blocked, and since the lock is a screen over data
 * the device already has, an unreadable store means "we cannot tell", which is the
 * same answer `hasPasscode()` gives.
 * ───────────────────────────────────────────────────────────────────────────── */
import { useEffect, useState } from "react";
import { hasPasscode, hashCode, randomSaltHex, verifyPasscode } from "./passcode";

const KEY = "relay_glock_v1";

/** Exactly four digits. Shape-checked rather than length-checked, so "12 4" or
 *  "١٢٣٤" cannot be stored as something the keypad can never reproduce. */
export function isValidLockCode(code: unknown): code is string {
  return typeof code === "string" && /^\d{4}$/.test(code);
}

type Entry = { salt: string; hash: string };
type Store = Record<string, Entry>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object" || Array.isArray(o)) return {};
    const out: Store = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      // A malformed entry is DROPPED rather than kept as a half-lock: an entry with
      // no hash would report the group locked and then match no code at all, which
      // is the un-openable state this module exists not to create.
      const e = v as Entry | null;
      if (e && typeof e.salt === "string" && typeof e.hash === "string" && e.hash) out[k] = e;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStore(s: Store): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function isGroupLocked(conversationId: number): boolean {
  return !!readStore()[String(conversationId)];
}

/** Every locked id, for the service-worker mirror. */
export function lockedConversationIds(): number[] {
  return Object.keys(readStore())
    .map((k) => Number(k))
    .filter((n) => Number.isInteger(n));
}

export type SetLockResult = "ok" | "bad-code" | "needs-app-passcode" | "storage-unavailable";

/**
 * Lock a group on this device.
 *
 * `needs-app-passcode` is a REFUSAL, not a warning, because the app passcode is the
 * only route back from a forgotten code — see the header. The caller shows the
 * reason and a way to set one.
 */
export async function setGroupLock(conversationId: number, code: string): Promise<SetLockResult> {
  if (!isValidLockCode(code)) return "bad-code";
  if (!hasPasscode()) return "needs-app-passcode";
  const salt = randomSaltHex();
  const hash = await hashCode(salt, code);
  const s = readStore();
  s[String(conversationId)] = { salt, hash };
  if (!writeStore(s)) return "storage-unavailable";
  unlockGroupForSession(conversationId); // locking it while you are reading it must not shut you out
  notify();
  return "ok";
}

/** Does this code open that group? False for an unlocked group, so a caller cannot
 *  use this to probe whether a lock exists. */
export async function verifyGroupLock(conversationId: number, code: string): Promise<boolean> {
  const e = readStore()[String(conversationId)];
  if (!e) return false;
  if (!isValidLockCode(code)) return false;
  return (await hashCode(e.salt, code)) === e.hash;
}

/**
 * Remove a group's lock. Accepts EITHER the group's own code OR the device's app
 * passcode — the second is the recovery path, and the reason `setGroupLock`
 * insists on one existing.
 */
export async function removeGroupLock(conversationId: number, code: string): Promise<boolean> {
  const ok = (await verifyGroupLock(conversationId, code)) || (hasPasscode() && (await verifyPasscode(code)));
  if (!ok) return false;
  const s = readStore();
  delete s[String(conversationId)];
  writeStore(s);
  // OPENED, not merely un-remembered. With the lock gone `unlocked` is not
  // consulted at all, so this costs nothing in the normal case — but `writeStore`
  // can fail (private mode, quota), and then the entry is still in localStorage.
  // Clearing the session unlock there would re-hide a group the user has just
  // proved they may see, and report success while doing it.
  unlocked.add(conversationId);
  notify();
  return true;
}

export type OpenAttempt = "unlocked" | "recovered" | "no";

/**
 * The ONE rule for "does this code open the group", used by the gate.
 *
 * IT HAS TO ACCEPT THE APP PASSCODE, and finding that out changed the design. The
 * gate replaces the whole conversation — header included — so the group's own
 * details sheet, which is where a lock is normally removed, sits BEHIND it. A gate
 * that took only the group code would therefore strand somebody who forgot it: the
 * lock could not be reached to be removed. That is precisely the trap the
 * app-passcode requirement exists to prevent, so the recovery has to be reachable
 * from the gate itself.
 *
 * The app passcode REMOVES the lock rather than merely unlocking for the session:
 * whoever used it has just demonstrated they do not know the group code, so leaving
 * the lock in place would strand them again on the next reload — a recovery that
 * has to be performed every session is not a recovery.
 *
 * ORDER MATTERS: the group code is tried FIRST, so the ordinary path never removes
 * a lock. Reversed, a group whose code happened to equal the app passcode would be
 * silently unlocked-and-removed every time it was opened.
 */
export async function attemptOpenGroup(conversationId: number, code: string): Promise<OpenAttempt> {
  if (!isValidLockCode(code)) return "no";
  if (await verifyGroupLock(conversationId, code)) {
    unlockGroupForSession(conversationId);
    return "unlocked";
  }
  if (hasPasscode() && (await verifyPasscode(code))) {
    const s = readStore();
    delete s[String(conversationId)];
    writeStore(s);
    // Same reason as `removeGroupLock`, and it bites harder here: this IS the
    // recovery path. If the write fails, dropping the session unlock leaves the
    // gate up on a group whose app passcode has just been entered correctly —
    // "recovered" is returned, the conversation re-hides, and the only way out is
    // the code they have already demonstrated they do not know.
    unlocked.add(conversationId);
    notify();
    return "recovered";
  }
  return "no";
}

/* ── session unlock ──────────────────────────────────────────────────────────
 * In memory only, so closing the tab re-locks. Keyed by conversation id, because
 * unlocking one group must not unlock another.
 */
const unlocked = new Set<number>();

export function unlockGroupForSession(conversationId: number): void {
  unlocked.add(conversationId);
  notify();
}

/** Should this group's content be hidden right now? */
export function isGroupHidden(conversationId: number): boolean {
  return isGroupLocked(conversationId) && !unlocked.has(conversationId);
}

/** Re-lock without removing the lock — the per-group equivalent of `lockApp()`. */
export function relockGroup(conversationId: number): void {
  unlocked.delete(conversationId);
  notify();
}

const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* one bad listener must not stop the rest */
    }
  });
}

/**
 * Subscribe to lock changes from OUTSIDE React.
 *
 * This exists so `swPrefs.ts` can keep the service worker's copy of the locked list
 * current WITHOUT this module importing it. `swPrefs` already reads
 * `lockedConversationIds()`, so calling `syncAlertPrefsToSw()` from here would close
 * an import cycle — the same reason the server reaches `statsFeed` through
 * `setPresenceChangeHook` rather than importing it from `v2db`.
 *
 * The alternative — syncing from each caller of `setGroupLock`/`removeGroupLock` — is
 * the shape that rots: a third caller added later simply forgets, and the worker then
 * names a member of a chat that is locked.
 */
export function onGroupLocksChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Re-renders when any lock is set, removed, unlocked or re-locked. Returns a
 *  counter rather than a snapshot, because the interesting state lives in two
 *  places (localStorage and the session Set) and a component should just re-ask. */
export function useGroupLocks(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const l = () => setN((x) => x + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return n;
}
