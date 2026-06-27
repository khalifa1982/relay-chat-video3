/* Tiny external store for in-app "new message" popups. useRealtime pushes a
 * conversationId when a message arrives while the user is elsewhere; the
 * <MessagePopups/> manager renders a dismissible card with the content + an
 * inline reply box. Mirrors the typingStore pattern (useSyncExternalStore). */

import { useSyncExternalStore } from "react";

export interface MessagePopup {
  id: number;
  conversationId: number;
  from: number;
}

let queue: MessagePopup[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/** Queue (or refresh) a popup for a conversation. De-dupes by conversation and
 *  caps the stack so we never flood the screen. */
export function pushMessagePopup(conversationId: number, from: number): void {
  queue = queue.filter((q) => q.conversationId !== conversationId);
  queue.push({ id: ++seq, conversationId, from });
  if (queue.length > 3) queue = queue.slice(-3);
  emit();
}

export function dismissMessagePopup(conversationId: number): void {
  const next = queue.filter((q) => q.conversationId !== conversationId);
  if (next.length !== queue.length) {
    queue = next;
    emit();
  }
}

export function clearMessagePopups(): void {
  if (queue.length) {
    queue = [];
    emit();
  }
}

/** Current popup queue (also the useSyncExternalStore snapshot). */
export function getMessagePopups(): MessagePopup[] {
  return queue;
}
const getSnapshot = getMessagePopups;

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const EMPTY: MessagePopup[] = [];
export function useMessagePopups(): MessagePopup[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

/** True when the user is actively viewing this conversation (so we suppress the
 *  popup — they can already see the message). */
export function isViewingConversation(conversationId: number): boolean {
  if (typeof window === "undefined") return false;
  try {
    const { pathname, search } = window.location;
    if (!pathname.startsWith("/app/messages")) return false;
    if (document.visibilityState !== "visible") return false;
    const c = new URLSearchParams(search).get("c");
    return c === String(conversationId);
  } catch {
    return false;
  }
}
