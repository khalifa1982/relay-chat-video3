import { afterEach, describe, expect, it, vi } from "vitest";

async function fresh() {
  vi.resetModules();
  return await import("./messagePopups");
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { document?: unknown }).document;
});

describe("messagePopups store", () => {
  it("queues a popup", async () => {
    const s = await fresh();
    s.pushMessagePopup(1, 10);
    expect(s.getMessagePopups().map((p) => p.conversationId)).toEqual([1]);
  });

  it("de-dupes by conversation (keeps one, most recent)", async () => {
    const s = await fresh();
    s.pushMessagePopup(1, 10);
    s.pushMessagePopup(2, 20);
    s.pushMessagePopup(1, 11); // same conversation → replaces, moves to end
    const ids = s.getMessagePopups().map((p) => p.conversationId);
    expect(ids).toEqual([2, 1]);
    expect(s.getMessagePopups()).toHaveLength(2);
  });

  it("caps the stack at 3", async () => {
    const s = await fresh();
    for (let c = 1; c <= 5; c++) s.pushMessagePopup(c, c);
    const ids = s.getMessagePopups().map((p) => p.conversationId);
    expect(ids).toEqual([3, 4, 5]);
  });

  it("dismisses one conversation", async () => {
    const s = await fresh();
    s.pushMessagePopup(1, 10);
    s.pushMessagePopup(2, 20);
    s.dismissMessagePopup(1);
    expect(s.getMessagePopups().map((p) => p.conversationId)).toEqual([2]);
  });

  it("clears all popups", async () => {
    const s = await fresh();
    s.pushMessagePopup(1, 10);
    s.pushMessagePopup(2, 20);
    s.clearMessagePopups();
    expect(s.getMessagePopups()).toEqual([]);
  });
});

describe("isViewingConversation", () => {
  function setLoc(pathname: string, search: string, visible = true) {
    (globalThis as unknown as { window?: unknown }).window = { location: { pathname, search } };
    (globalThis as unknown as { document?: unknown }).document = {
      visibilityState: visible ? "visible" : "hidden",
    };
  }

  it("is true when the messages tab shows that conversation and is visible", async () => {
    const s = await fresh();
    setLoc("/app/messages", "?c=42");
    expect(s.isViewingConversation(42)).toBe(true);
  });

  it("is false for a different conversation", async () => {
    const s = await fresh();
    setLoc("/app/messages", "?c=7");
    expect(s.isViewingConversation(42)).toBe(false);
  });

  it("is false when not on the messages tab", async () => {
    const s = await fresh();
    setLoc("/app/dialer", "?c=42");
    expect(s.isViewingConversation(42)).toBe(false);
  });

  it("is false when the tab is hidden (in a call elsewhere)", async () => {
    const s = await fresh();
    setLoc("/app/messages", "?c=42", false);
    expect(s.isViewingConversation(42)).toBe(false);
  });
});
