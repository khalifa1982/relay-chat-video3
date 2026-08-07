import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  toAppPath,
  registerNavHandler,
  installNativeNavBridge,
  __resetNavBridgeForTest,
} from "./nativeNavBridge";

describe("nativeNavBridge — toAppPath", () => {
  it("keeps a bare in-app path with its query", () => {
    expect(toAppPath("/app/messages?c=5")).toBe("/app/messages?c=5");
    expect(toAppPath("/app/history?filter=missed")).toBe("/app/history?filter=missed");
  });

  it("strips a full URL down to path+query (the origin is discarded — we only route in-app)", () => {
    expect(toAppPath("https://your-chat.io/app/messages?c=9")).toBe("/app/messages?c=9");
    // Even a hostile origin only contributes its PATH — the router never leaves our app.
    expect(toAppPath("https://evil.example/app/dialer")).toBe("/app/dialer");
  });

  it("accepts the invite paths and adds a missing leading slash", () => {
    expect(toAppPath("/i/909090")).toBe("/i/909090");
    expect(toAppPath("/g/tok")).toBe("/g/tok");
    expect(toAppPath("app/dialer")).toBe("/app/dialer");
  });

  it("REFUSES a javascript:/data: URL — a push must never inject a scheme", () => {
    expect(toAppPath("javascript:alert(1)")).toBeNull();
    expect(toAppPath("data:text/html,<script>1</script>")).toBeNull();
  });

  it("REFUSES a path outside the app's own surfaces", () => {
    expect(toAppPath("/evil")).toBeNull();
    expect(toAppPath("/")).toBeNull();
    expect(toAppPath("/login")).toBeNull();
  });

  it("REFUSES empty / non-string input", () => {
    expect(toAppPath("")).toBeNull();
    expect(toAppPath("   ")).toBeNull();
    expect(toAppPath(undefined)).toBeNull();
    expect(toAppPath(null)).toBeNull();
    expect(toAppPath(42)).toBeNull();
  });
});

describe("nativeNavBridge — queue + flush", () => {
  beforeEach(() => {
    __resetNavBridgeForTest();
    (globalThis as unknown as { window: unknown }).window = { addEventListener: () => {} };
  });
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    __resetNavBridgeForTest();
  });

  function nav(url: string) {
    (
      globalThis as unknown as { window: { __relayNavigate__: (u: string) => void } }
    ).window.__relayNavigate__(url);
  }

  it("QUEUES a nav that arrives before the navigator registers, then flushes it (kills the cold-start race)", () => {
    installNativeNavBridge();
    nav("/app/messages?c=7"); // app still booting — nobody registered yet
    const seen: string[] = [];
    registerNavHandler((p) => seen.push(p));
    expect(seen).toEqual(["/app/messages?c=7"]);
  });

  it("routes immediately when a navigator is already registered", () => {
    installNativeNavBridge();
    const seen: string[] = [];
    registerNavHandler((p) => seen.push(p));
    nav("/app/history?filter=missed");
    expect(seen).toEqual(["/app/history?filter=missed"]);
  });

  it("drops a bad deep link silently rather than routing to it", () => {
    installNativeNavBridge();
    const seen: string[] = [];
    registerNavHandler((p) => seen.push(p));
    nav("javascript:alert(1)");
    nav("/evil");
    expect(seen).toEqual([]);
  });

  it("unregister detaches the handler (a later nav queues instead of calling the stale one)", () => {
    installNativeNavBridge();
    const seen: string[] = [];
    const off = registerNavHandler((p) => seen.push(p));
    off();
    nav("/app/dialer");
    expect(seen).toEqual([]); // stale handler not called
  });
});
