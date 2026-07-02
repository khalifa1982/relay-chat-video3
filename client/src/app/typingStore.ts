/**
 * Ephemeral "who's typing" registry. The server fans out a transient `typing`
 * event to other participants; useRealtime records it here. Each (conversation,
 * sender) entry auto-expires after TYPING_TTL unless refreshed, so a stale
 * indicator never lingers. No persistence, no polling — per-entry timeouts.
 */
import { useEffect, useState } from "react";

const TYPING_TTL = 5000;
const active = new Map<number, Map<number, ReturnType<typeof setTimeout>>>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* */
    }
  });
}

/** Record/refresh that `from` is typing in `conversationId`. */
export function setTyping(conversationId: number, from: number): void {
  let inner = active.get(conversationId);
  if (!inner) {
    inner = new Map();
    active.set(conversationId, inner);
  }
  const existing = inner.get(from);
  if (existing) clearTimeout(existing);
  const isNew = !existing;
  inner.set(
    from,
    setTimeout(() => {
      const m = active.get(conversationId);
      if (m) {
        m.delete(from);
        if (m.size === 0) active.delete(conversationId);
      }
      notify();
    }, TYPING_TTL)
  );
  if (isNew) notify(); // only re-render when the SET of typers changes
}

/** Clear a sender's typing state (e.g. once their message actually arrives). */
export function clearTyping(conversationId: number, from?: number): void {
  const m = active.get(conversationId);
  if (!m) return;
  if (from == null) {
    m.forEach((t) => clearTimeout(t));
    active.delete(conversationId);
  } else {
    const t = m.get(from);
    if (t) clearTimeout(t);
    m.delete(from);
    if (m.size === 0) active.delete(conversationId);
  }
  notify();
}

export function getTypers(conversationId: number): number[] {
  return Array.from(active.get(conversationId)?.keys() ?? []);
}

export function onTypingChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** React hook: the identity ids currently typing in a conversation. */
export function useTypers(conversationId: number): number[] {
  const [ids, setIds] = useState<number[]>(() => getTypers(conversationId));
  useEffect(() => {
    setIds(getTypers(conversationId));
    return onTypingChange(() => setIds(getTypers(conversationId)));
  }, [conversationId]);
  return ids;
}

/** All conversation ids with at least one active typer right now. */
export function getTypingConversations(): number[] {
  return Array.from(active.keys());
}

/** React hook: the conversation ids that currently have someone typing — one
 *  subscription for the whole thread list, so each row can show a live
 *  "typing…" state without a hook-per-row. */
export function useTypingConversations(): number[] {
  const [ids, setIds] = useState<number[]>(() => getTypingConversations());
  useEffect(() => {
    setIds(getTypingConversations());
    return onTypingChange(() => setIds(getTypingConversations()));
  }, []);
  return ids;
}
