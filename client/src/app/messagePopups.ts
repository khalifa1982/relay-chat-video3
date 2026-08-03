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

/**
 * The cards that may actually be SHOWN, given what this device is hiding
 * (v2.107.12).
 *
 * A card carries the group's title, the sender's avatar and a preview of what
 * they said, so a group LOCKED on this device must not get one — the lock's own
 * scenario is a phone handed over with the app open, which makes this the surface
 * it is most about, and it was the last message surface that did not consult it.
 *
 * Its own function, taking the predicate, for two reasons. It is the RULE rather
 * than a `.filter` buried in a component, so the reasoning above has somewhere to
 * live. And this repo's tests run with no DOM, so a rule inside a component can
 * only be pinned at source, while this one can be driven.
 */
export function visibleMessagePopups(
  popups: readonly MessagePopup[],
  isHidden: (conversationId: number) => boolean,
): MessagePopup[] {
  return popups.filter((p) => {
    try {
      return !isHidden(p.conversationId);
    } catch {
      /* An unreadable lock store must not blank the popups. `groupLock` already
         fails toward NOT locked for the same reason, and a card that silently
         never appears is the harder failure to notice. */
      return true;
    }
  });
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
