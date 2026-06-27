import { describe, it, expect, beforeEach } from "vitest";

/**
 * Tests for the optional device passcode (app lock). The store talks to
 * localStorage + Web Crypto; we run under the node test env, so we provide a
 * tiny in-memory localStorage polyfill (Web Crypto is already a Node global).
 *
 * The import below is hoisted above the polyfill assignment, so passcode.ts'
 * load-time `locked = hasPasscode()` sees no storage and starts unlocked —
 * exactly the fresh-device state each test wants.
 */
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

import {
  hasPasscode,
  setPasscode,
  verifyPasscode,
  clearPasscode,
  isLocked,
  lockApp,
  unlockApp,
} from "./passcode";

beforeEach(() => {
  mem.clear();
  unlockApp();
});

describe("passcode store", () => {
  it("reports no passcode on a fresh device", () => {
    expect(hasPasscode()).toBe(false);
  });

  it("sets and verifies a passcode", async () => {
    await setPasscode("1357");
    expect(hasPasscode()).toBe(true);
    expect(await verifyPasscode("1357")).toBe(true);
    expect(await verifyPasscode("0000")).toBe(false);
  });

  it("stores only a salted hash — never the plaintext", async () => {
    await setPasscode("8642");
    expect(mem.getItem("relay_pass_hash")).not.toContain("8642");
    expect(mem.getItem("relay_pass_salt")).not.toContain("8642");
    expect(mem.getItem("relay_pass_hash")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses a random salt so the same code hashes differently each time", async () => {
    await setPasscode("1234");
    const h1 = mem.getItem("relay_pass_hash");
    await setPasscode("1234");
    const h2 = mem.getItem("relay_pass_hash");
    expect(h1).not.toBe(h2);
  });

  it("verifyPasscode returns true when none is set (nothing to gate)", async () => {
    expect(hasPasscode()).toBe(false);
    expect(await verifyPasscode("whatever")).toBe(true);
  });

  it("clearPasscode removes it and unlocks", async () => {
    await setPasscode("4444");
    lockApp();
    expect(isLocked()).toBe(true);
    clearPasscode();
    expect(hasPasscode()).toBe(false);
    expect(isLocked()).toBe(false);
  });

  it("lockApp is a no-op when no passcode exists", () => {
    expect(hasPasscode()).toBe(false);
    lockApp();
    expect(isLocked()).toBe(false);
  });

  it("locks and unlocks once a passcode exists (setting does not lock the live session)", async () => {
    await setPasscode("2468");
    expect(isLocked()).toBe(false);
    lockApp();
    expect(isLocked()).toBe(true);
    unlockApp();
    expect(isLocked()).toBe(false);
  });
});
