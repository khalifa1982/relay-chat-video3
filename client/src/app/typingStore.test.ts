import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setTyping, clearTyping, getTypers, onTypingChange } from "./typingStore";

describe("typingStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // reset any leftover state from a prior test
    clearTyping(1);
    clearTyping(2);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("records typers per conversation, isolated from each other", () => {
    setTyping(1, 7);
    setTyping(1, 8);
    setTyping(2, 9);
    expect(getTypers(1).sort()).toEqual([7, 8]);
    expect(getTypers(2)).toEqual([9]);
  });

  it("auto-expires a typer after the TTL", () => {
    setTyping(1, 7);
    expect(getTypers(1)).toEqual([7]);
    vi.advanceTimersByTime(5001);
    expect(getTypers(1)).toEqual([]);
  });

  it("refreshing before the TTL keeps the typer alive", () => {
    setTyping(1, 7);
    vi.advanceTimersByTime(4000);
    setTyping(1, 7); // refresh
    vi.advanceTimersByTime(4000); // 8s total, but only 4s since refresh
    expect(getTypers(1)).toEqual([7]);
  });

  it("clearTyping(cid, from) removes one; clearTyping(cid) removes all", () => {
    setTyping(1, 7);
    setTyping(1, 8);
    clearTyping(1, 7);
    expect(getTypers(1)).toEqual([8]);
    clearTyping(1);
    expect(getTypers(1)).toEqual([]);
  });

  it("notifies subscribers when the set of typers changes (not on mere refresh)", () => {
    let calls = 0;
    const off = onTypingChange(() => { calls++; });
    setTyping(1, 7); // new → notify
    setTyping(1, 7); // refresh same → no notify
    expect(calls).toBe(1);
    clearTyping(1, 7); // change → notify
    expect(calls).toBe(2);
    off();
  });
});
