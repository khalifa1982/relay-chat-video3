/**
 * App passcode — a lightweight app lock, ACCOUNT-WIDE since v2.107.77. NOT account
 * auth (it gates the local UI only). The salted SHA-256 hash lives in localStorage
 * as the OFFLINE CACHE and is mirrored to the account (appLock.get/set), so setting
 * the code on one device makes every device of the account ask for it. The
 * plaintext is never stored anywhere, server included — the server holds the same
 * hash+salt pair this file has always held, nothing more. When set, the app locks
 * on every load and can be locked on demand; the correct passcode unlocks it for
 * the session.
 *
 * (Face ID / fingerprint would use WebAuthn/passkeys — a separate follow-up; a
 *  numeric passcode is the broadly-supported, no-prompt baseline.)
 */
import { useEffect, useState } from "react";

const HASH_KEY = "relay_pass_hash";
const SALT_KEY = "relay_pass_salt";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return toHex(new Uint8Array(buf));
}

/* ── shared with the per-group lock (v2.105.20) ───────────────────────────────
 * `groupLock.ts` stores a code the same way this file does, and it must not carry
 * its own copy of the salting: two implementations of "hash a 4-digit code" is how
 * two surfaces come to disagree about what a stored hash means, and the one that
 * drifts silently stops matching. So the two primitives are exported and there is
 * exactly ONE implementation of each.
 *
 * Deliberately NOT exported: the storage keys, the lock state, or anything that
 * would let another module write THIS passcode. The group lock hashes with these;
 * it never touches `relay_pass_*`.
 */
export function randomSaltHex(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(8)));
}
export function hashCode(salt: string, code: string): Promise<string> {
  return sha256Hex(salt + ":" + code);
}

export function hasPasscode(): boolean {
  try {
    return !!localStorage.getItem(HASH_KEY);
  } catch {
    return false;
  }
}

export async function setPasscode(code: string): Promise<{ hash: string; salt: string }> {
  const salt = randomSaltHex();
  const hash = await hashCode(salt, code);
  try {
    localStorage.setItem(SALT_KEY, salt);
    localStorage.setItem(HASH_KEY, hash);
  } catch {
    /* storage unavailable */
  }
  notify(); // setting a passcode while using the app does not lock it
  // Returned so the caller can mirror the pair to the account (v2.107.77) — this
  // module stays transport-free; the sync lives with the tRPC hooks.
  return { hash, salt };
}

/* ── ACCOUNT SYNC (v2.107.77) ────────────────────────────────────────────────
 * Two primitives and nothing more, so the sync policy (who wins, when to push)
 * lives in ONE place — RelayEngine's effect — rather than being re-decided by
 * every caller of this file.
 */
/** The locally cached pair, for pushing a pre-feature device's lock up to the
 *  account. Null when no lock is set (or storage is unavailable). */
export function localLockSnapshot(): { hash: string; salt: string } | null {
  try {
    const hash = localStorage.getItem(HASH_KEY);
    const salt = localStorage.getItem(SALT_KEY);
    return hash && salt ? { hash, salt } : null;
  } catch {
    return null;
  }
}

/** Adopt the account's pair onto THIS device. `lockNow` gates immediately — used
 *  when this device had no lock at all (the just-opened-the-app case); a device
 *  that already gates keeps its unlocked-for-this-session state and simply starts
 *  verifying against the account's (possibly rotated) code. Inputs are
 *  shape-checked so a malformed sync can never poison the stored pair. */
export function adoptRemoteLock(hash: string, salt: string, opts?: { lockNow?: boolean }): void {
  if (!/^[0-9a-f]{64}$/.test(hash) || !/^[0-9a-f]{8,32}$/.test(salt)) return;
  try {
    localStorage.setItem(SALT_KEY, salt);
    localStorage.setItem(HASH_KEY, hash);
  } catch {
    return; /* storage unavailable — nothing adopted, nothing to gate with */
  }
  if (opts?.lockNow) locked = true;
  notify();
}

export async function verifyPasscode(code: string): Promise<boolean> {
  try {
    const salt = localStorage.getItem(SALT_KEY) || "";
    const hash = localStorage.getItem(HASH_KEY) || "";
    if (!hash) return true; // none set
    return (await hashCode(salt, code)) === hash;
  } catch {
    return false;
  }
}

export function clearPasscode(): void {
  try {
    localStorage.removeItem(HASH_KEY);
    localStorage.removeItem(SALT_KEY);
  } catch {
    /* */
  }
  locked = false; // removing the passcode unlocks
  notify();
}

// ── lock state (in-memory; locked on load when a passcode exists) ──
let locked = hasPasscode();
const listeners = new Set<(l: boolean) => void>();
function notify() {
  listeners.forEach((l) => {
    try {
      l(locked);
    } catch {
      /* */
    }
  });
}

export function isLocked(): boolean {
  return locked;
}
export function lockApp(): void {
  if (hasPasscode()) {
    locked = true;
    notify();
  }
}
export function unlockApp(): void {
  locked = false;
  notify();
}

/** Re-renders when the lock state changes. */
export function useLocked(): boolean {
  const [l, setL] = useState(locked);
  useEffect(() => {
    listeners.add(setL);
    return () => {
      listeners.delete(setL);
    };
  }, []);
  return l;
}
