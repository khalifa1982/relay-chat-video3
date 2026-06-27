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

import { isThreadMuted, setThreadMuted, onMutedChange } from "./mutedThreads";

beforeEach(() => mem.clear());

describe("per-conversation mute store", () => {
  it("defaults to unmuted", () => {
    expect(isThreadMuted(42)).toBe(false);
  });

  it("mutes and unmutes a specific conversation, leaving others alone", () => {
    setThreadMuted(42, true);
    expect(isThreadMuted(42)).toBe(true);
    expect(isThreadMuted(43)).toBe(false);
    setThreadMuted(42, false);
    expect(isThreadMuted(42)).toBe(false);
  });

  it("persists to localStorage as a JSON array", () => {
    setThreadMuted(7, true);
    setThreadMuted(9, true);
    const raw = mem.getItem("relay_muted_threads");
    expect(JSON.parse(raw!).sort()).toEqual([7, 9]);
  });

  it("notifies subscribers on change", () => {
    let calls = 0;
    const off = onMutedChange(() => { calls++; });
    setThreadMuted(1, true);
    setThreadMuted(1, false);
    expect(calls).toBe(2);
    off();
    setThreadMuted(1, true);
    expect(calls).toBe(2); // unsubscribed
  });

  it("tolerates corrupt storage (returns unmuted, never throws)", () => {
    mem.setItem("relay_muted_threads", "{not json");
    expect(isThreadMuted(1)).toBe(false);
  });
});
