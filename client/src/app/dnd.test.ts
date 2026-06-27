import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isDndOn, setDnd, onDndChange } from "./dnd";

describe("dnd store", () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to off", () => {
    expect(isDndOn()).toBe(false);
  });

  it("persists on then off", () => {
    setDnd(true);
    expect(isDndOn()).toBe(true);
    expect(store["relay_dnd"]).toBe("1");
    setDnd(false);
    expect(isDndOn()).toBe(false);
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    const seen: boolean[] = [];
    const off = onDndChange((v) => seen.push(v));
    setDnd(true);
    setDnd(false);
    off();
    setDnd(true); // after unsubscribe — must NOT be observed
    expect(seen).toEqual([true, false]);
  });

  it("is resilient when localStorage throws (Safari private mode) and still notifies", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(isDndOn()).toBe(false);
    const seen: boolean[] = [];
    const off = onDndChange((v) => seen.push(v));
    expect(() => setDnd(true)).not.toThrow();
    expect(seen).toEqual([true]);
    off();
  });
});
