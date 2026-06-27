/**
 * Optional device passcode — a lightweight app lock. NOT account auth (it gates
 * the local UI only). The passcode is salted + SHA-256 hashed in localStorage;
 * the plaintext is never stored. When set, the app locks on every load and can
 * be locked on demand; the correct passcode unlocks it for the session.
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

export function hasPasscode(): boolean {
  try {
    return !!localStorage.getItem(HASH_KEY);
  } catch {
    return false;
  }
}

export async function setPasscode(code: string): Promise<void> {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(8)));
  const hash = await sha256Hex(salt + ":" + code);
  try {
    localStorage.setItem(SALT_KEY, salt);
    localStorage.setItem(HASH_KEY, hash);
  } catch {
    /* storage unavailable */
  }
  notify(); // setting a passcode while using the app does not lock it
}

export async function verifyPasscode(code: string): Promise<boolean> {
  try {
    const salt = localStorage.getItem(SALT_KEY) || "";
    const hash = localStorage.getItem(HASH_KEY) || "";
    if (!hash) return true; // none set
    return (await sha256Hex(salt + ":" + code)) === hash;
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
