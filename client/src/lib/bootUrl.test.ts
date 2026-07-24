import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * v2.99.48 — M48's forced-hot-mic guard, re-tested for the two ways it was
 * bypassed and the flow it broke.
 *
 * `bootUrl.ts` reads `window.location` at MODULE EVALUATION (that is the whole
 * point — it must capture the URL the document booted with, before any routing),
 * so each case stubs a location and re-imports the module fresh.
 */
async function bootAt(pathname: string, search: string) {
  vi.resetModules();
  (globalThis as unknown as { window: unknown }).window = {
    location: { pathname, search },
  };
  return await import("./bootUrl");
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  vi.resetModules();
});

describe("bootDialTarget — parses the boot URL the way the DIALER does", () => {
  it("reads a plain ?to=", async () => {
    const m = await bootAt("/app/dialer", "?to=555555&voice=1");
    expect(m.bootDialTarget()).toBe("555555");
    expect(m.arrivedWithDialTarget("555555")).toBe(true);
  });

  /**
   * THE BYPASS. The old guard was a regex over the RAW search string
   * (`/(^|[?&])to=/`) while the consumer reads the value with URLSearchParams,
   * which percent-decodes KEYS. `%74` is `t`, so `?%74o=` was invisible to the
   * guard and perfectly visible to the code it guarded — one click on
   * `/app/dialer?%74o=<attacker>&video=1` still opened a live mic AND camera.
   */
  it("catches a PERCENT-ENCODED key, which the old regex missed", async () => {
    const m = await bootAt("/app/dialer", "?%74o=555555&video=1");
    expect(/(^|[?&])to=/.test(m.BOOT_SEARCH)).toBe(false); // the old test: blind
    expect(m.bootDialTarget()).toBe("555555"); // the new one: sees it
    expect(m.arrivedWithDialTarget("555555")).toBe(true);
  });

  it("catches every other spelling of the same key", async () => {
    for (const q of ["?t%6F=555555", "?%74%6F=555555", "?a=1&%74o=555555"]) {
      const m = await bootAt("/app/dialer", q);
      expect(m.arrivedWithDialTarget("555555"), q).toBe(true);
    }
  });

  /**
   * THE OTHER BYPASS. `/i/<pin>` is the app's own share link and the shorter form
   * people actually send. It boots with an EMPTY search and only then redirects
   * CLIENT-SIDE to `/app/dialer?to=…`, so a search-only guard read it as an
   * in-app tap and auto-dialed — the documented invite URL stayed exploitable
   * while the long form was closed.
   */
  it("treats an /i/<pin> arrival as an arrival (empty search, path carries it)", async () => {
    const m = await bootAt("/i/555555", "");
    expect(m.BOOT_SEARCH).toBe("");
    expect(m.bootDialTarget()).toBe("555555");
    expect(m.arrivedWithDialTarget("555555")).toBe(true);
  });

  it("an /i/ arrival with a malformed pin still counts as an arrival", async () => {
    const m = await bootAt("/i/55", "");
    expect(m.arrivedWithDialTarget("555555")).toBe(true); // "*" matches anything
  });

  it("the legacy /app/call redirect is an arrival too", async () => {
    const m = await bootAt("/app/call", "");
    expect(m.arrivedWithDialTarget("123456")).toBe(true);
  });
});

describe("arrivedWithDialTarget — per NAVIGATION, not per document", () => {
  /**
   * THE REGRESSION. `BOOT_SEARCH` is captured once per document, so the old
   * "did we boot with any target?" test meant that after ONE arrival (tapping
   * "Call" on a back-online alert is a full page load) every later in-app call
   * tap in that tab took the prefill branch — one-tap calling from
   * Contacts/Messages stayed broken for the rest of the session.
   */
  it("a LATER in-app dial to a different number is not treated as an arrival", async () => {
    const m = await bootAt("/app/dialer", "?to=555555&voice=1");
    expect(m.arrivedWithDialTarget("555555")).toBe(true); // the boot target
    expect(m.arrivedWithDialTarget("777777")).toBe(false); // an in-app tap
    expect(m.bootedWithDialTarget()).toBe(true); // the old, blunter question
  });

  it("an ordinary boot with no target never requires a confirming tap", async () => {
    const m = await bootAt("/app/dialer", "");
    expect(m.bootDialTarget()).toBeNull();
    expect(m.arrivedWithDialTarget("555555")).toBe(false);
  });

  it("a non-dial query is not an arrival", async () => {
    const m = await bootAt("/app/messages", "?filter=missed");
    expect(m.arrivedWithDialTarget("555555")).toBe(false);
  });
});

describe("the one-time same-origin intent marker", () => {
  it("round-trips once and then clears (a reload can't silently re-dial)", async () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const m = await bootAt("/app/dialer", "?to=555555");
    m.markDialIntent("555555");
    expect(m.consumeDialIntent()).toBe("555555");
    expect(m.consumeDialIntent()).toBeNull();
    delete (globalThis as unknown as { sessionStorage?: unknown }).sessionStorage;
  });

  it("fails SAFE when storage is unavailable (no marker ⇒ a tap is required)", async () => {
    const m = await bootAt("/app/dialer", "?to=555555");
    expect(() => m.markDialIntent("555555")).not.toThrow();
    expect(m.consumeDialIntent()).toBeNull();
  });
});
