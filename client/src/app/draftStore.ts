/**
 * Per-conversation message DRAFT persistence (localStorage, mirrors
 * mutedThreads.ts) — in-progress text + an active reply target survive
 * navigating away and back, or a reload, instead of being silently lost.
 *
 * Deliberately scoped to text + replyToId only — NOT a pending attachment
 * selection. An attachment is typically picked and sent within seconds, and
 * restoring one would need its full metadata (not just an id), which isn't
 * worth the added complexity for that narrow window.
 */
import { useEffect, useRef, useState } from "react";

const PREFIX = "relay_draft_";

export interface Draft {
  text: string;
  replyToId: number | null;
}

const EMPTY: Draft = { text: "", replyToId: null };

function key(conversationId: number): string {
  return PREFIX + conversationId;
}

/**
 * Change listeners (v2.107.52, roadmap QW-2) — the thread LIST paints a "Draft"
 * line for a conversation you typed in and left, so it has to hear about writes
 * made by a different component (the composer's hook). Same shape as
 * mutedThreads' listener set: module-level, fired by BOTH writers below, and
 * every write path in this file funnels through those two (the hook's debounce
 * and flush both call `saveDraftNow`).
 */
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* one bad listener must not silence the rest */
    }
  });
}

/** Subscribe to any draft write/clear; returns the unsubscribe. */
export function onDraftsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Pure read — exported for direct unit testing (mirrors isThreadMuted). */
export function getDraft(conversationId: number): Draft {
  try {
    const raw = localStorage.getItem(key(conversationId));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY;
    return {
      text: typeof parsed.text === "string" ? parsed.text : "",
      replyToId: typeof parsed.replyToId === "number" ? parsed.replyToId : null,
    };
  } catch {
    return EMPTY;
  }
}

/** Pure (non-debounced) write — exported for direct unit testing. */
export function saveDraftNow(conversationId: number, draft: Draft): void {
  try {
    if (!draft.text && draft.replyToId == null) localStorage.removeItem(key(conversationId));
    else localStorage.setItem(key(conversationId), JSON.stringify(draft));
  } catch {
    /* storage unavailable — draft just won't persist */
  }
  // AFTER the try/catch, not inside it: even when storage refused the write the
  // in-memory state the listeners will re-read is whatever getDraft returns —
  // letting them repaint is correct in both worlds.
  notify();
}

export function clearDraft(conversationId: number): void {
  try {
    localStorage.removeItem(key(conversationId));
  } catch {
    /* */
  }
  notify();
}

/** React hook: loads the saved draft once per conversation, debounce-saves on
 *  change (500ms), and exposes `clear()` to call after a successful send. */
export function useDraft(conversationId: number) {
  const [draft, setDraft] = useState<Draft>(() => getDraft(conversationId));
  const saveT = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest draft + the conversation it belongs to, tracked in refs so a
  // flush (on thread switch / unmount / tab hide) writes the CURRENT text to
  // the CORRECT conversation even though those code paths don't re-close over
  // the latest `draft` / `conversationId` render values.
  const draftRef = useRef<Draft>(draft);
  const convRef = useRef<number>(conversationId);

  /**
   * M6: flush any pending debounced save IMMEDIATELY. The old cleanup just
   * clearTimeout'd the pending save, so typing then switching threads within
   * the 500ms debounce window silently dropped the draft — defeating the whole
   * "navigating away mid-draft doesn't lose it" purpose. Now we write it first.
   */
  function flush() {
    if (saveT.current) {
      clearTimeout(saveT.current);
      saveT.current = null;
      saveDraftNow(convRef.current, draftRef.current);
    }
  }

  // Conversation changed — FLUSH the prior conversation's pending draft (don't
  // lose it), then load THIS conversation's draft (don't carry the prior over).
  useEffect(() => {
    const loaded = getDraft(conversationId);
    setDraft(loaded);
    draftRef.current = loaded;
    convRef.current = conversationId;
    return () => {
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Flush on tab hide / reload so a draft typed <500ms before isn't lost.
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(next: Partial<Draft>) {
    setDraft((prev) => {
      const merged = { ...prev, ...next };
      draftRef.current = merged;
      if (saveT.current) clearTimeout(saveT.current);
      saveT.current = setTimeout(() => saveDraftNow(conversationId, merged), 500);
      return merged;
    });
  }

  function clear() {
    if (saveT.current) {
      clearTimeout(saveT.current);
      saveT.current = null;
    }
    draftRef.current = EMPTY;
    setDraft(EMPTY);
    clearDraft(conversationId);
  }

  return { draft, update, clear };
}
