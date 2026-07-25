import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * v2.99.49 — M48's forced-hot-mic guard, re-tested for the two ways it was
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

/* ─────────────────────────────────────────────────────────────────────────
   v2.99.57 — the /i/<pin> guard must normalize the segment EXACTLY as the
   consumer does.

   M48 was "the guard regex tested the raw query string while the consumer used
   URLSearchParams, which percent-decodes KEYS". This is the same defect a third
   time, one layer over: the guard required a digit immediately after `/i/`
   (`/^\/i\/(\d{1,6})/`), while App.tsx's route strips EVERY non-digit
   (`params.pin.replace(/\D/g, "").slice(0, 6)`). So `/i/x555555` was invisible
   to the guard and fully dialable by the consumer — one click, live mic, to a
   number the attacker chose.
   ───────────────────────────────────────────────────────────────────────── */

/** App.tsx's `/i/:pin` route normalization, copied verbatim from the consumer. */
function consumerPin(seg: string): string {
  return seg.replace(/\D/g, "").slice(0, 6);
}

describe("v2.99.57 — /i/<pin> arrivals can never slip past the guard", () => {
  const SNEAKY = ["x555555", "+555555", ".555555", "%20555555", "-555555", "(555)555", "5x5x5x5x5x5x"];

  for (const seg of SNEAKY) {
    it(`/i/${seg} is detected as an arrival (was null before the fix)`, async () => {
      const m = await bootAt(`/i/${seg}`, "");
      const target = m.bootDialTarget();
      // Never null: anything under /i/ is an arrival from outside the app.
      expect(target).not.toBeNull();
      // And when the consumer would resolve a real 6-digit number, the guard must
      // name the SAME number — otherwise arrivedWithDialTarget() misses it.
      const expected = consumerPin(seg);
      if (/^\d{6}$/.test(expected)) {
        expect(target).toBe(expected);
        expect(m.arrivedWithDialTarget(expected)).toBe(true);
      }
    });
  }

  it("agrees with the consumer's normalization on every input", async () => {
    for (const seg of [...SNEAKY, "555555", "55", "", "999999999999", "abc"]) {
      const m = await bootAt(`/i/${seg}`, "");
      const expected = consumerPin(seg);
      const got = m.bootDialTarget();
      if (/^\d{6}$/.test(expected)) {
        expect(got, `/i/${seg}`).toBe(expected);
      } else {
        // Not a usable number, but still an arrival — must not be null.
        expect(got, `/i/${seg}`).toBe("*");
      }
    }
  });

  it("does not widen beyond the FIRST path segment", async () => {
    // `/^\/i\//` against the whole path would start flagging unrelated deep links.
    const m = await bootAt("/app/messages/i/555555", "");
    expect(m.bootDialTarget()).toBeNull();
  });

  it("a query or fragment after the segment does not leak into the pin", async () => {
    const m = await bootAt("/i/555555", "?ref=x");
    expect(m.bootDialTarget()).toBe("555555");
  });

  it("an in-app navigation is still NOT an arrival (one-tap calling intact)", async () => {
    const m = await bootAt("/app/dialer", "");
    expect(m.bootDialTarget()).toBeNull();
    expect(m.arrivedWithDialTarget("555555")).toBe(false);
  });
});
