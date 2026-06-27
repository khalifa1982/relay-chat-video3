/**
 * Do Not Disturb — a per-device toggle that silences incoming-call rings,
 * message chimes, and desktop notifications WITHOUT signing the user out or
 * dropping anything (messages still arrive and show in-app; missed calls are
 * still recorded). Stored in localStorage, so there's no server/schema change:
 *   - chimes + notifications are suppressed at the source in notifications.ts,
 *   - incoming calls are auto-declined client-side by the relay engine.
 */
import { useEffect, useState } from "react";

const KEY = "relay_dnd";
const listeners = new Set<(on: boolean) => void>();

export function isDndOn(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setDnd(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* storage may be unavailable (private mode) — listeners still fire */
  }
  listeners.forEach((l) => {
    try {
      l(on);
    } catch {
      /* never let one listener break the others */
    }
  });
}

/** Subscribe to DND changes. Returns an unsubscribe fn. */
export function onDndChange(cb: (on: boolean) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** React hook: `[isOn, setOn]`. Re-renders when DND changes anywhere in the app. */
export function useDnd(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState<boolean>(isDndOn);
  useEffect(() => onDndChange(setOn), []);
  return [on, setDnd];
}
