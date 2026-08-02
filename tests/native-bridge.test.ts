import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  jsLiteral,
  nativeEventJs,
  navigateJs,
  isCallAction,
  isCallMode,
  sanitizeCallId,
  NATIVE_EVENT,
} from "../lib/native-bridge";

/**
 * The `relay://` deep-link → WebView injection hole.
 *
 * `hooks/use-android-call-intent.ts` and `lib/voip-call-manager.ts` built the
 * injected JavaScript by INTERPOLATING values into single-quoted string literals:
 *
 *     detail: { type: 'callAnswered', callId: '${callId}', mode: '${mode}' }
 *
 * `callId` and `mode` come from a `relay://` URL. That scheme is declared in
 * app.config.ts and is public, so ANY installed app — or any web page the user
 * follows a link from — can fire one. A single apostrophe closed the literal and
 * everything after it ran as JavaScript INSIDE the WebView holding the user's
 * authenticated RELAY session.
 *
 * These tests execute the generated source against a stub `window`, so they prove
 * the payload arrives as DATA rather than merely asserting on its text.
 */

/** Run generated bridge JS against a stub window; return what was dispatched. */
function runInjected(js: string): { events: { type: string; detail: unknown }[]; href: string | null } {
  const events: { type: string; detail: unknown }[] = [];
  let href: string | null = null;
  // A canary: if the payload ever escapes its literal, it will call this.
  let pwned = false;

  class FakeCustomEvent {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  }
  const win = {
    dispatchEvent: (e: FakeCustomEvent) => events.push({ type: e.type, detail: e.detail }),
    location: {
      set href(v: string) {
        href = v;
      },
      get href() {
        return href ?? "";
      },
    },
    __pwn: () => {
      pwned = true;
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function("window", "CustomEvent", "console", js);
  fn(win, FakeCustomEvent, { warn() {}, log() {} });
  expect(pwned, "injected payload escaped its string literal").toBe(false);
  return { events, href };
}

/** Payloads that break out of a single-quoted JS literal.
 *
 * The FIRST one is not hypothetical: run against the pre-fix template it
 * executes `window.__pwn()` and reads `document.cookie`. Delivered as
 *   relay://call?action=answer&mode=voice&nativeCall=a'%2C%20x%3A%20window.__pwn()%2C%20y%3A%20'
 * it added a second property to the object literal, so the call ran while the
 * detail object was being constructed and the surrounding syntax stayed valid.
 */
const BREAKOUTS = [
  "a', x: window.__pwn(), y: '",
  "x'});window.__pwn();({a:'",
  "x'; window.__pwn(); '",
  "'+window.__pwn()+'",
  'x"});window.__pwn();({a:"',
  "x\\'});window.__pwn();({a:'",
  "x\n});window.__pwn();({a:'",
  "x });window.__pwn();({a:'",
  "x });window.__pwn();({a:'",
  "</script><script>window.__pwn()</script>",
  "x\\\\'});window.__pwn();({a:'",
];

describe("nativeEventJs — a deep link cannot execute JS in the WebView", () => {
  for (const payload of BREAKOUTS) {
    it(`carries ${JSON.stringify(payload).slice(0, 44)}… as data, not code`, () => {
      const js = nativeEventJs({ type: "callAnswered", callId: payload, mode: "voice" });
      const { events } = runInjected(js);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(NATIVE_EVENT);
      // The value must arrive EXACTLY as given — neither executed nor mangled.
      expect(events[0].detail).toEqual({ type: "callAnswered", callId: payload, mode: "voice" });
    });
  }

  it("round-trips ordinary values unchanged", () => {
    const detail = { type: "callDeclined", callId: "8f14e45f-ce4a-4b1e-9f27-000000000001" };
    const { events } = runInjected(nativeEventJs(detail));
    expect(events[0].detail).toEqual(detail);
  });

  it("serializes the EVENT NAME too, not just the payload", () => {
    expect(nativeEventJs({ type: "x" })).toContain(JSON.stringify(NATIVE_EVENT));
  });

  it("ends in a truthy expression (injectJavaScript warns otherwise)", () => {
    expect(nativeEventJs({ type: "x" }).trim().endsWith("true;")).toBe(true);
    expect(navigateJs("https://your-chat.io/app").trim().endsWith("true;")).toBe(true);
  });
});

describe("navigateJs — a URL cannot break out either", () => {
  for (const payload of ["https://x/'+window.__pwn()+'", "https://x/';window.__pwn();'"]) {
    it(`escapes ${payload.slice(0, 30)}…`, () => {
      const { href } = runInjected(navigateJs(payload));
      expect(href).toBe(payload);
    });
  }
});

describe("jsLiteral", () => {
  it("escapes the line separators that are legal in JSON but were not in JS", () => {
    expect(jsLiteral("a b")).not.toContain(" ");
    expect(jsLiteral("a b")).not.toContain(" ");
    // …and still parses back to the original.
    expect(JSON.parse(jsLiteral("a b") as string)).toBe("a b");
  });

  it("renders null for undefined rather than the bare word undefined", () => {
    // `undefined` is not valid JSON and would be a syntax error in the emitted
    // object literal, taking the whole bridge message down.
    expect(jsLiteral(undefined)).toBe("null");
  });
});

describe("deep-link input validation", () => {
  it("accepts only the actions and modes the native layer emits", () => {
    expect(isCallAction("answer")).toBe(true);
    expect(isCallAction("decline")).toBe(true);
    for (const bad of ["Answer", "ANSWER", "", "hangup", null, undefined, 1]) {
      expect(isCallAction(bad), String(bad)).toBe(false);
    }
    expect(isCallMode("voice")).toBe(true);
    expect(isCallMode("video")).toBe(true);
    for (const bad of ["Voice", "", "screen", null]) {
      expect(isCallMode(bad), String(bad)).toBe(false);
    }
  });

  it("sanitizeCallId admits real ids and rejects everything else", () => {
    expect(sanitizeCallId("8f14e45f-ce4a-4b1e-9f27-000000000001")).toBe(
      "8f14e45f-ce4a-4b1e-9f27-000000000001",
    );
    expect(sanitizeCallId("room_123:456")).toBe("room_123:456");
    expect(sanitizeCallId("  padded  ")).toBe("padded");
    for (const bad of [...BREAKOUTS, "", "   ", "a".repeat(129), null, undefined, 42, {}]) {
      expect(sanitizeCallId(bad as unknown), JSON.stringify(bad)?.slice(0, 30)).toBeNull();
    }
  });
});

/* ── Source pins: no site may go back to interpolating ─────────────────── */
const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("every injection site goes through the helper", () => {
  const SITES = [
    "hooks/use-android-call-intent.ts",
    "lib/voip-call-manager.ts",
    "components/relay-webview.tsx",
  ];

  it("no injected event interpolates a value into a quoted JS literal", () => {
    for (const f of SITES) {
      const src = read(f);
      // The exact defective shape: a ${...} inside a quoted literal within a
      // dispatched detail object.
      expect(src, `${f} interpolates into an injected detail`).not.toMatch(
        /detail:\s*\{[^}]*['"]\$\{/,
      );
    }
  });

  it("the deep-link handler validates action, mode and callId before use", () => {
    const src = read("hooks/use-android-call-intent.ts");
    expect(src).toMatch(/sanitizeCallId\(urlObj\.searchParams\.get\("nativeCall"\)\)/);
    expect(src).toMatch(/isCallMode\(mode\) && isCallAction\(action\)/);
  });

  it("both bridge files import the helper rather than hand-rolling", () => {
    expect(read("hooks/use-android-call-intent.ts")).toMatch(/from "@\/lib\/native-bridge"/);
    expect(read("lib/voip-call-manager.ts")).toMatch(/from "\.\/native-bridge"/);
  });
});
