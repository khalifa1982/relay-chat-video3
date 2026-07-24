/**
 * Per-conversation mute — a per-device setting (localStorage, like DND) that
 * silences chimes + desktop notifications for a specific thread/group, without
 * any server/schema change. Muted threads still receive messages and update
 * in-app; only the alert is suppressed (gated in useRealtime).
 */
import { useEffect, useState } from "react";
import { syncAlertPrefsToSw } from "./swPrefs";

const KEY = "relay_muted_threads";
const listeners = new Set<() => void>();

function read(): Set<number> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "number") : []);
  } catch {
    return new Set();
  }
}

function write(set: Set<number>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* storage unavailable — listeners still fire so UI stays consistent */
  }
  // Mirror to the service worker: since v2.99.42 the server pushes for new
  // messages, and a push bypasses the page — so the worker has to know which
  // threads are muted or it would buzz the phone for one.
  syncAlertPrefsToSw();
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* */
    }
  });
}

export function isThreadMuted(conversationId: number): boolean {
  return read().has(conversationId);
}

export function setThreadMuted(conversationId: number, muted: boolean): void {
  const set = read();
  if (muted) set.add(conversationId);
  else set.delete(conversationId);
  write(set);
}

/** Subscribe to any mute change. Returns an unsubscribe fn. */
export function onMutedChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** React hook: `[isMuted, toggle]` for one conversation. */
export function useThreadMuted(conversationId: number): [boolean, (muted: boolean) => void] {
  const [muted, setMuted] = useState<boolean>(() => isThreadMuted(conversationId));
  useEffect(() => {
    setMuted(isThreadMuted(conversationId));
    return onMutedChange(() => setMuted(isThreadMuted(conversationId)));
  }, [conversationId]);
  return [muted, (m: boolean) => setThreadMuted(conversationId, m)];
}
