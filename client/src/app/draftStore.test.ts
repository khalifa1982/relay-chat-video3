import { describe, it, expect, beforeEach } from "vitest";

// Minimal localStorage polyfill for the node test env (assigned before import).
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}
const mem = new MemStorage();
(globalThis as unknown as { localStorage: MemStorage }).localStorage = mem;

import { getDraft, saveDraftNow, clearDraft } from "./draftStore";

beforeEach(() => mem.clear());

describe("per-conversation draft store", () => {
  it("defaults to empty text + no reply target", () => {
    expect(getDraft(42)).toEqual({ text: "", replyToId: null });
  });

  it("saves and restores text + a reply target, scoped per conversation", () => {
    saveDraftNow(42, { text: "hey there", replyToId: 7 });
    expect(getDraft(42)).toEqual({ text: "hey there", replyToId: 7 });
    expect(getDraft(43)).toEqual({ text: "", replyToId: null }); // other conversation untouched
  });

  it("an empty draft (no text, no reply) is removed from storage rather than kept as a stub row", () => {
    saveDraftNow(1, { text: "draft", replyToId: null });
    expect(mem.getItem("relay_draft_1")).not.toBeNull();
    saveDraftNow(1, { text: "", replyToId: null });
    expect(mem.getItem("relay_draft_1")).toBeNull();
  });

  it("clearDraft removes a saved draft outright", () => {
    saveDraftNow(5, { text: "won't send this", replyToId: null });
    clearDraft(5);
    expect(getDraft(5)).toEqual({ text: "", replyToId: null });
  });

  it("tolerates corrupt storage (returns the empty draft, never throws)", () => {
    mem.setItem("relay_draft_9", "{not json");
    expect(getDraft(9)).toEqual({ text: "", replyToId: null });
  });

  it("tolerates a non-object JSON value in storage", () => {
    mem.setItem("relay_draft_9", "42");
    expect(getDraft(9)).toEqual({ text: "", replyToId: null });
  });
});
