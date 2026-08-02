import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { pushTokenJs, NATIVE_EVENT } from "../lib/native-bridge";

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/**
 * Ring-when-closed was dead on Android, and the cause was one word: `document`.
 *
 * The shell's only way of telling the web app this device's FCM token was
 *
 *     webViewRef.current.postMessage(JSON.stringify({type:"SET_PUSH_TOKEN", …}))
 *
 * and react-native-webview implements that command differently per platform.
 * Android (RNCWebViewManagerImpl.kt) evaluates:
 *
 *     var event = new MessageEvent('message', {data: …});
 *     document.dispatchEvent(event);
 *
 * iOS (RNCWebViewImpl.m) evaluates `window.dispatchEvent(new MessageEvent(…))`.
 *
 * `MessageEvent` constructed without `bubbles` does not bubble, so the Android
 * dispatch never reaches a `window` listener — and a `window` listener is the
 * only kind the page has (`mountNativeTokenBridge`), because that is what the
 * push spec specifies and what the iPhone shell already relies on.
 *
 * Net effect: the server never learned any Android device's token, so it could
 * not wake the handset for an incoming call. Nothing errored, nothing logged;
 * the app simply never rang when it was closed.
 */

/** Minimal DOM: window and document, with the one propagation rule that matters. */
function makeDom() {
  const winListeners = new Map<string, ((e: any) => void)[]>();
  const docListeners = new Map<string, ((e: any) => void)[]>();
  const seenByWindow: any[] = [];
  const seenByDocument: any[] = [];

  class FakeEvent {
    type: string;
    bubbles: boolean;
    detail?: unknown;
    data?: unknown;
    origin?: string;
    source?: unknown;
    constructor(type: string, init: Record<string, any> = {}) {
      this.type = type;
      this.bubbles = init.bubbles === true;
      if ("detail" in init) this.detail = init.detail;
      if ("data" in init) this.data = init.data;
      this.origin = init.origin;
      this.source = init.source;
    }
  }

  const fire = (map: Map<string, ((e: any) => void)[]>, e: any) => {
    for (const fn of map.get(e.type) ?? []) fn(e);
  };

  const window: any = {
    addEventListener: (t: string, fn: (e: any) => void) => {
      winListeners.set(t, [...(winListeners.get(t) ?? []), fn]);
    },
    dispatchEvent: (e: any) => {
      seenByWindow.push(e);
      fire(winListeners, e);
      return true;
    },
    postMessage: (data: unknown, targetOrigin?: string) => {
      // Same-window post: delivered to this window's own listeners.
      const e = new FakeEvent("message", { data, origin: "https://your-chat.io", source: window });
      window.dispatchEvent(e);
      void targetOrigin;
    },
    location: { origin: "https://your-chat.io", href: "https://your-chat.io/app" },
  };
  const document: any = {
    addEventListener: (t: string, fn: (e: any) => void) => {
      docListeners.set(t, [...(docListeners.get(t) ?? []), fn]);
    },
    dispatchEvent: (e: any) => {
      seenByDocument.push(e);
      fire(docListeners, e);
      // THE RULE THIS TEST TURNS ON: an event dispatched at `document` reaches
      // `window` only if it bubbles.
      if (e.bubbles) fire(winListeners, e);
      return true;
    },
  };

  return { window, document, FakeEvent, seenByWindow, seenByDocument };
}

/** What the page does: `mountNativeTokenBridge`, reduced to the two envelopes. */
function mountPageListener(window: any) {
  const registered: { token: string; via: string }[] = [];
  window.addEventListener("message", (e: any) => {
    let data: unknown = e.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    const d = data as { type?: string; token?: string };
    if (d?.type === "SET_PUSH_TOKEN" && typeof d.token === "string") {
      registered.push({ token: d.token, via: "postMessage" });
    }
  });
  window.addEventListener(NATIVE_EVENT, (e: any) => {
    const d = e.detail as { type?: string; token?: string };
    if (d?.type === "pushToken" && typeof d.token === "string") {
      registered.push({ token: d.token, via: "relay:native" });
    }
  });
  return registered;
}

const FCM = "cXyZ:APA91bH" + "k".repeat(120);

describe("the Android delivery bug, reproduced", () => {
  it("react-native-webview's Android postMessage never reaches the page listener", () => {
    const { window, document } = makeDom();
    const registered = mountPageListener(window);

    // Verbatim shape of what RNCWebViewManagerImpl.kt evaluates in the page.
    const androidPostMessage = (message: string) => {
      // `new MessageEvent('message', {data})` — no `bubbles`, so it does not.
      document.dispatchEvent({ type: "message", bubbles: false, data: message });
    };
    androidPostMessage(JSON.stringify({ type: "SET_PUSH_TOKEN", token: FCM }));

    expect(registered).toEqual([]); // ← the bug: nothing registered, nothing logged
  });

  it("the same call on iOS did reach it, which is why only Android was broken", () => {
    const { window } = makeDom();
    const registered = mountPageListener(window);
    // RNCWebViewImpl.m: window.dispatchEvent(new MessageEvent('message', {...}))
    window.dispatchEvent({ type: "message", bubbles: false, data: JSON.stringify({ type: "SET_PUSH_TOKEN", token: FCM }) });
    expect(registered.map((r) => r.token)).toEqual([FCM]);
  });
});

describe("pushTokenJs delivers on both platforms", () => {
  const run = (js: string) => {
    const dom = makeDom();
    const registered = mountPageListener(dom.window);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function("window", "document", "CustomEvent", "console", js)(
      dom.window,
      dom.document,
      dom.FakeEvent,
      { warn() {}, log() {} },
    );
    return { registered, dom };
  };

  it("the token arrives at a window listener", () => {
    const { registered } = run(pushTokenJs(FCM, "fcm"));
    expect(registered.length).toBeGreaterThan(0);
    for (const r of registered) expect(r.token).toBe(FCM);
  });

  it("both envelopes are sent, so an older deployed page still gets it", () => {
    const { registered } = run(pushTokenJs(FCM, "fcm"));
    expect(registered.map((r) => r.via).sort()).toEqual(["postMessage", "relay:native"]);
  });

  it("nothing is dispatched at `document` — that channel is the bug", () => {
    const { dom } = run(pushTokenJs(FCM, "fcm"));
    expect(dom.seenByDocument).toEqual([]);
  });

  it("the detail matches the push spec the web app implements", () => {
    const dom = makeDom();
    const seen: unknown[] = [];
    dom.window.addEventListener(NATIVE_EVENT, (e: any) => seen.push(e.detail));
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function("window", "CustomEvent", "console", pushTokenJs(FCM, "fcm"))(
      dom.window,
      dom.FakeEvent,
      { warn() {}, log() {} },
    );
    expect(seen).toEqual([{ type: "pushToken", kind: "fcm", token: FCM }]);
  });

  it("a hostile token value is data, not code", () => {
    const evil = "x'});window.__pwn();({a:'";
    const dom = makeDom();
    let pwned = false;
    dom.window.__pwn = () => {
      pwned = true;
    };
    const seen: any[] = [];
    dom.window.addEventListener(NATIVE_EVENT, (e: any) => seen.push(e.detail));
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function("window", "CustomEvent", "console", pushTokenJs(evil, "fcm"))(
      dom.window,
      dom.FakeEvent,
      { warn() {}, log() {} },
    );
    expect(pwned).toBe(false);
    expect(seen[0].token).toBe(evil);
  });

  it("a page that refuses the postMessage still gets the event", () => {
    // A sandboxed / opaque-origin document throws on a targeted postMessage.
    const dom = makeDom();
    dom.window.postMessage = () => {
      throw new Error("opaque origin");
    };
    const seen: any[] = [];
    dom.window.addEventListener(NATIVE_EVENT, (e: any) => seen.push(e.detail));
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function("window", "CustomEvent", "console", pushTokenJs(FCM, "apns"))(
      dom.window,
      dom.FakeEvent,
      { warn() {}, log() {} },
    );
    expect(seen).toHaveLength(1);
  });

  it("ends in a truthy expression (injectJavaScript warns otherwise)", () => {
    expect(pushTokenJs(FCM, "fcm").trim().endsWith("true;")).toBe(true);
  });
});

/* ── Source pins ──────────────────────────────────────────────────────────── */

describe("the hook cannot go back to the broken channel", () => {
  const HOOK = read("hooks/use-push-token.ts");
  const code = HOOK.split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join("\n");

  it("delivers with injectJavaScript, never WebView.postMessage", () => {
    expect(code).not.toMatch(/webViewRef\.current\.postMessage/);
    expect(code).toMatch(/injectJavaScript\(pushTokenJs\(/);
  });

  it("re-sends, because there is no ready handshake to wait for", () => {
    expect(code).toMatch(/DELIVERY_SCHEDULE_MS/);
    // More than one attempt, and the first is immediate.
    const schedule = HOOK.match(/DELIVERY_SCHEDULE_MS = \[([^\]]+)\]/);
    expect(schedule).not.toBeNull();
    const offsets = schedule![1].split(",").map((s) => Number(s.replace(/_/g, "").trim()));
    expect(offsets[0]).toBe(0);
    expect(offsets.length).toBeGreaterThanOrEqual(3);
    expect(offsets.every((n, i) => i === 0 || n > offsets[i - 1])).toBe(true);
  });

  it("adopts a rotated token instead of holding the first one forever", () => {
    // FCM reissues on restore/reinstall; the old token stops delivering silently.
    expect(code).toMatch(/Notifications\.addPushTokenListener/);
    expect(code).toMatch(/sub\.remove\(\)/);
  });

  it("declares a kind the web app understands", () => {
    expect(code).toMatch(/Platform\.OS === "ios" \? "apns" : "fcm"/);
  });

  it("clears its timers on unmount", () => {
    expect(code).toMatch(/clearTimeout/);
    expect(code).toMatch(/useEffect\(\(\) => cancelPending, \[cancelPending\]\)/);
  });
});
