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
}

export function clearDraft(conversationId: number): void {
  try {
    localStorage.removeItem(key(conversationId));
  } catch {
    /* */
  }
}

/** React hook: loads the saved draft once per conversation, debounce-saves on
 *  change (500ms), and exposes `clear()` to call after a successful send. */
export function useDraft(conversationId: number) {
  const [draft, setDraft] = useState<Draft>(() => getDraft(conversationId));
  const saveT = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Conversation changed — load ITS draft (don't carry the prior one over).
  useEffect(() => {
    setDraft(getDraft(conversationId));
    return () => {
      if (saveT.current) clearTimeout(saveT.current);
    };
  }, [conversationId]);

  function update(next: Partial<Draft>) {
    setDraft((prev) => {
      const merged = { ...prev, ...next };
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
    setDraft(EMPTY);
    clearDraft(conversationId);
  }

  return { draft, update, clear };
}
