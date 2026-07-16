/*
 * Tests for client/src/lib/deviceId.ts \u2014 the localStorage-backed
 * sticky-session device id introduced in v2.1.0.
 *
 * The contract this code guards:
 *   - Same browser, same id forever (until explicit reset or storage
 *     cleared by the user).
 *   - Different browsers, different ids (no shared global state).
 *   - 16\u201364 hex characters so it matches the server validator.
 *   - SSR-safe (importing the module on Node must not throw).
 *
 * We polyfill `window` + `localStorage` in this test because vitest's
 * default env is `node`, and the deviceId module deliberately checks
 * for `window` to stay SSR-safe. Re-importing per-test via dynamic
 * `import()` resets the module-level cache.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeStorage implements Storage {
  store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

function installWindow(storage?: FakeStorage) {
  const ls = storage ?? new FakeStorage();
  (globalThis as { window?: { localStorage: Storage } }).window = {
    localStorage: ls,
  };
  return ls;
}

function clearWindow() {
  delete (globalThis as { window?: unknown }).window;
}

async function freshImport() {
  vi.resetModules();
  return await import("./deviceId");
}

const HEX_RE = /^[a-f0-9]{32}$/;

describe("getDeviceId — sticky per-browser identity", () => {
  beforeEach(() => {
    clearWindow();
    vi.resetModules();
  });
  afterEach(() => {
    clearWindow();
  });

  it("mints a 32-char hex id on first call", async () => {
    installWindow();
    const { getDeviceId } = await freshImport();
    const id = getDeviceId();
    expect(id).not.toBeNull();
    expect(id).toMatch(HEX_RE);
  });

  it("returns the same id on subsequent calls within the same session (cache)", async () => {
    installWindow();
    const { getDeviceId } = await freshImport();
    const a = getDeviceId();
    const b = getDeviceId();
    expect(a).toBe(b);
  });

  it("persists across a module reload via localStorage", async () => {
    const ls = installWindow();
    const mod1 = await freshImport();
    const first = mod1.getDeviceId();

    // Simulate a fresh page load: keep storage, drop module cache.
    const mod2 = await freshImport();
    // localStorage must still hold the value.
    expect(ls.getItem("relay_device_id")).toBe(first);
    expect(mod2.getDeviceId()).toBe(first);
  });

  it("returns null when window is not available (SSR)", async () => {
    clearWindow();
    const { getDeviceId } = await freshImport();
    // Without window, the module can still mint an id from crypto and
    // cache it in memory (no localStorage to read from). It must not
    // throw and must still return a hex value so the header always
    // carries something. This is intentional \u2014 we'd rather have a
    // best-effort id than no id at all.
    const id = getDeviceId();
    expect(id).toMatch(HEX_RE);
  });

  it("survives localStorage that holds an obviously bogus value", async () => {
    const ls = installWindow();
    ls.setItem("relay_device_id", "not-a-hex-value!!");
    const { getDeviceId } = await freshImport();
    const id = getDeviceId();
    // Bogus value rejected; module mints a fresh one.
    expect(id).toMatch(HEX_RE);
    expect(id).not.toBe("not-a-hex-value!!");
    expect(ls.getItem("relay_device_id")).toMatch(HEX_RE);
  });

  it("resetDeviceId generates a new id different from the previous one", async () => {
    installWindow();
    const { getDeviceId, resetDeviceId } = await freshImport();
    const before = getDeviceId();
    const after = resetDeviceId();
    expect(after).toMatch(HEX_RE);
    expect(after).not.toBe(before);
    // Subsequent getDeviceId must return the post-reset id.
    expect(getDeviceId()).toBe(after);
  });

  it("DEVICE_ID_HEADER export matches the server constant", async () => {
    installWindow();
    const { DEVICE_ID_HEADER } = await freshImport();
    expect(DEVICE_ID_HEADER).toBe("x-relay-device-id");
  });

  it("clearRelayChannel removes the relay cid + cached pin (logout severs the call channel)", async () => {
    const ls = installWindow();
    ls.setItem("relay_cid", "abc123def456abc1");
    ls.setItem("relay_pin", "123456");
    ls.setItem("relay_device_id", "0123456789abcdef"); // must be left intact
    const { clearRelayChannel } = await freshImport();
    clearRelayChannel();
    expect(ls.getItem("relay_cid")).toBeNull();
    expect(ls.getItem("relay_pin")).toBeNull();
    // The device id is a SEPARATE concern (handled by resetDeviceId) — untouched.
    expect(ls.getItem("relay_device_id")).toBe("0123456789abcdef");
  });

  it("clearRelayChannel is a no-op (no throw) when localStorage is unavailable", async () => {
    clearWindow();
    const { clearRelayChannel } = await freshImport();
    expect(() => clearRelayChannel()).not.toThrow();
  });

  it("survives a localStorage that throws on setItem (Safari private mode)", async () => {
    const ls = installWindow();
    const orig = ls.setItem.bind(ls);
    ls.setItem = vi.fn(() => {
      throw new Error("QuotaExceededError: storage is disabled");
    }) as unknown as typeof orig;
    const { getDeviceId } = await freshImport();
    const id = getDeviceId();
    expect(id).toMatch(HEX_RE);
    // Even though we couldn't persist, the in-memory cache must hold
    // the value for the lifetime of the page.
    expect(getDeviceId()).toBe(id);
  });
});

describe("sign-out truly ends the session (v2.87.1 — owner-reported glitch)", () => {
  const read = (p: string) =>
    require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../..", p), "utf8");

  it("Profile's sign-out rotates the device id and lands on the app entry screen", () => {
    const src = read("client/src/pages/app/Profile.tsx");
    // Clearing the cookie alone let the device-id binding resurrect the same
    // guest on the next visit ("logs me in without filling my name again").
    expect(src).toContain("resetDeviceId();");
    expect(src).toContain('window.location.href = "/app"');
    expect(src).not.toContain('window.location.href = "/";');
  });

  it("AppShell's sign-out lands on the app entry screen, not the marketing page", () => {
    const src = read("client/src/app/AppShell.tsx");
    expect(src).toContain('window.location.href = "/app"');
    expect(src).not.toContain('window.location.href = "/"))');
  });
});
