/* ============================================================
   v2.99.79 — linking Firebase to the Expo WebView shell.

   The owner's shipping app is a React Native + Expo shell wrapping
   the live app URL in a WebView, so the native layer holds the push
   token and the web app holds the identity. The token crosses by postMessage.

   The advice the owner was given was a bare
   `window.addEventListener("message", …)` that registers whatever token arrives.
   On a real website that is a notification-hijack primitive: any frame that can
   post into this page hands us a token for THEIR device and starts receiving
   somebody else's calls. This repo already has a recorded finding of that class
   (v2.99.49 R1, push-endpoint re-bind).

   So the gates are tested BEHAVIOURALLY. A source pin cannot tell you whether a
   cross-origin message is refused, and that refusal is the entire point.
   ============================================================ */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  acceptTokenMessage,
  looksLikePushToken,
  tokenKind,
  mountNativeTokenBridge,
} from "./nativeTokenBridge";
import { classifyNativeToken } from "../../../server/expoPush";

const SELF = "https://relay.test";
const WIN = { name: "self" };
const EXPO = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";
const FCM = "fGzL9v".repeat(12);

const msg = (over: Record<string, unknown> = {}) => ({
  origin: SELF,
  source: WIN,
  data: JSON.stringify({ type: "SET_PUSH_TOKEN", token: EXPO }),
  ...over,
});

describe("the gates — which messages are REFUSED", () => {
  it("accepts a same-origin post from our own window", () => {
    expect(acceptTokenMessage(msg(), SELF, WIN)).toBe(EXPO);
  });

  it("accepts the native-injection shape: empty or 'null' origin, no source", () => {
    // An injected-JS post from a WebView has no separate window, and on iOS the
    // origin is reported empty. Refusing these would refuse the only case this
    // module exists for.
    expect(acceptTokenMessage(msg({ origin: "", source: undefined }), SELF, WIN)).toBe(EXPO);
    expect(acceptTokenMessage(msg({ origin: "null", source: null }), SELF, WIN)).toBe(EXPO);
  });

  it("REFUSES a cross-origin post — the gate that does the actual work", () => {
    // A hostile iframe, opener or ad frame always has a real, different origin.
    for (const origin of [
      "https://evil.example",
      "http://relay.test", // scheme downgrade
      "https://relay.test.evil.example", // suffix trick
      "https://sub.relay.test", // a subdomain is NOT us
      "https://relay.test:8443", // a different port is a different origin
    ]) {
      expect(acceptTokenMessage(msg({ origin }), SELF, WIN), `${origin} is refused`).toBeNull();
    }
  });

  it("REFUSES a post whose source is another frame", () => {
    // Same-origin is not sufficient on its own: a same-origin iframe could post.
    expect(acceptTokenMessage(msg({ source: { name: "iframe" } }), SELF, WIN)).toBeNull();
  });

  it("REFUSES anything that is not the exact envelope", () => {
    for (const data of [
      JSON.stringify({ type: "SOMETHING_ELSE", token: EXPO }),
      JSON.stringify({ token: EXPO }), // no type
      JSON.stringify({ type: "SET_PUSH_TOKEN" }), // no token
      EXPO, // a BARE token: indistinguishable from any string a library posts
      "not json at all",
      JSON.stringify(null),
      JSON.stringify([EXPO]),
      "",
    ]) {
      expect(acceptTokenMessage(msg({ data }), SELF, WIN), `${String(data).slice(0, 30)}`).toBeNull();
    }
  });

  it("REFUSES an implausible token rather than storing it", () => {
    // A token the server cannot classify would be stored and never delivered to —
    // a silent failure. Refuse at the door instead.
    for (const token of ["", "short", "has space in it", "Expo" + "PushToken[", null, 42, {}]) {
      const data = JSON.stringify({ type: "SET_PUSH_TOKEN", token });
      expect(acceptTokenMessage(msg({ data }), SELF, WIN), `${String(token)}`).toBeNull();
    }
  });

  it("accepts an already-parsed object, since not every shell stringifies", () => {
    expect(
      acceptTokenMessage(msg({ data: { type: "SET_PUSH_TOKEN", token: FCM } }), SELF, WIN)
    ).toBe(FCM);
  });

  it("bounds the string it will try to parse", () => {
    const huge = JSON.stringify({ type: "SET_PUSH_TOKEN", token: EXPO }) + " ".repeat(9000);
    expect(acceptTokenMessage(msg({ data: huge }), SELF, WIN)).toBeNull();
  });
});

describe("the token's SHAPE decides the transport", () => {
  it("tells an Expo token from a device token", () => {
    expect(tokenKind(EXPO)).toBe("expo");
    expect(tokenKind("ExpoPushToken[abc123]")).toBe("expo");
    expect(tokenKind(FCM)).toBe("fcm");
    expect(tokenKind("nope")).toBeNull();
  });

  it("the CLIENT and the SERVER agree on every input — one rule, two languages", () => {
    // Two gates disagreeing about one rule is the recurring bug in this codebase
    // (v2.99.50, v2.99.71). The client picks the label it sends; the server
    // re-derives it and would refuse a mismatch, so a disagreement is a broken
    // registration. Cross-checked here rather than assumed.
    const cases = [
      EXPO,
      "ExpoPushToken[abc123]",
      FCM,
      "a".repeat(200),
      "short",
      "",
      "has space",
      "ExponentPushToken[unclosed",
      "APNS:" + "b".repeat(60),
    ];
    for (const t of cases) {
      expect(tokenKind(t), `client/server agree on ${JSON.stringify(t.slice(0, 24))}`).toBe(
        classifyNativeToken(t)
      );
    }
  });

  it("looksLikePushToken is the same predicate, not a second opinion", () => {
    for (const t of [EXPO, FCM, "short", "", "has space"]) {
      expect(looksLikePushToken(t)).toBe(tokenKind(t) !== null);
    }
  });
});

describe("mounting", () => {
  it("registers once per DISTINCT token, not once per post", () => {
    // The shell may post on every foreground; re-registering an unchanged token
    // would be a database write per app switch, forever.
    const listeners: Array<(e: MessageEvent) => void> = [];
    const g = globalThis as unknown as { window?: unknown };
    const prev = g.window;
    const fakeWin = {
      location: { origin: SELF },
      addEventListener: (_t: string, fn: (e: MessageEvent) => void) => listeners.push(fn),
      removeEventListener: () => {},
      postMessage: () => {},
    };
    g.window = fakeWin;
    try {
      const register = vi.fn();
      const off = mountNativeTokenBridge(register);
      const post = (token: string) =>
        listeners.forEach((fn) =>
          fn({
            origin: SELF,
            source: fakeWin,
            data: JSON.stringify({ type: "SET_PUSH_TOKEN", token }),
          } as unknown as MessageEvent)
        );
      post(EXPO);
      post(EXPO);
      post(EXPO);
      expect(register).toHaveBeenCalledTimes(1);
      expect(register).toHaveBeenCalledWith(EXPO, "expo");
      // A genuinely NEW token must still get through — a rotated token that was
      // suppressed would leave the device unnotifiable.
      post(FCM);
      expect(register).toHaveBeenCalledTimes(2);
      expect(register).toHaveBeenLastCalledWith(FCM, "fcm");
      off();
    } finally {
      g.window = prev;
    }
  });

  it("is inert with no window (SSR / tests)", () => {
    const g = globalThis as unknown as { window?: unknown };
    const prev = g.window;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (g as any).window;
    try {
      expect(() => mountNativeTokenBridge(() => {})()).not.toThrow();
    } finally {
      g.window = prev;
    }
  });
});

describe("the server stores and delivers it", () => {
  const ROUTERS = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "..", "server", "v2routers.ts"),
    "utf8"
  );
  const PUSH = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "..", "server", "webPush.ts"),
    "utf8"
  );

  it("push.subscribe accepts every native kind and re-derives it from the token", () => {
    // REWRITTEN IN v2.105.11 TO THE PROPERTY. This froze the exact enum LIST
    // `["webpush", "fcm", "expo"]`, so adding the `apns` kind broke it while saying
    // nothing about the property that matters — which is that the label is only a HINT
    // and the SHAPE decides. A frozen list forbids every legitimate addition and cannot
    // catch the one thing worth catching: the re-derivation going away.
    const enumLine = /kind: z\.enum\(\[([^\]]*)\]\)\.optional\(\)/.exec(ROUTERS);
    expect(enumLine).toBeTruthy();
    // Every kind the SERVER can classify must be expressible on the wire, or an honest
    // shell cannot say what it holds.
    for (const k of ["webpush", "fcm", "expo", "apns"]) {
      expect(enumLine![1], `wire enum accepts ${k}`).toContain(`"${k}"`);
    }
    // …and the label is overridden by the shape, which is what makes a lying client
    // harmless. Both must be present AND in this order.
    expect(ROUTERS).toMatch(/const actual = classifyNativeToken\(input\.endpoint\);/);
    expect(ROUTERS.indexOf("kind: z.enum([")).toBeLessThan(
      ROUTERS.indexOf("const actual = classifyNativeToken(input.endpoint);")
    );
    // A token that is neither shape is refused, not stored.
    expect(ROUTERS).toMatch(/message: "Unrecognised push token\."/);
  });

  it("keys are required for webpush ONLY — an expo token has none", () => {
    expect(ROUTERS).toMatch(/\(v\.kind \?\? "webpush"\) !== "webpush" \|\| !!v\.keys/);
  });

  it("the fan-out gives expo its own transport", () => {
    // Routing an Expo token to FCM drops it silently: it is not an FCM
    // registration token.
    expect(PUSH).toMatch(/const expoTokens = subs\.filter\(s => s\.kind === "expo"\)/);
    expect(PUSH).toMatch(/await sendExpoPush\(expoTokens, \{/);
    expect(PUSH).toMatch(/subs = subs\.filter\(s => s\.kind !== "expo"\);/);
    // …and EVERY native transport counts toward the delivered total. Pinned as
    // the set rather than as one frozen expression, because the count is what
    // `onPageCallee` returns as `pushed` and what the relay reads to decide
    // whether to page — a transport missing from this sum would ring a phone and
    // then tell the caller the callee was offline. v2.105.12 added apns.
    const sum = PUSH.match(/const nativeDelivered = ([^;]+);/)?.[1] ?? "";
    for (const t of ["fcmDelivered", "expoDelivered", "apnsDelivered"]) {
      expect(sum, `${t} counts toward the delivered total`).toContain(t);
    }
  });

  it("only a PERMANENTLY dead token is deleted", () => {
    const EXPO_SRC = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "..", "server", "expoPush.ts"),
      "utf8"
    );
    // A transient failure must never cost the user their registration.
    expect(EXPO_SRC).toMatch(/r\?\.details\?\.error === "DeviceNotRegistered"/);
    expect(PUSH).toMatch(/r\.dead\.map\(t => deletePushSubscription\(t\)\.catch/);
  });

  it("a ring is high-priority and short-TTL; everything else is not", () => {
    const EXPO_SRC = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "..", "server", "expoPush.ts"),
      "utf8"
    );
    expect(EXPO_SRC).toMatch(/const isCall = payload\.kind === "incoming-call";/);
    expect(EXPO_SRC).toMatch(/priority: isCall \? \("high" as const\) : \("normal" as const\)/);
    expect(EXPO_SRC).toMatch(/ttl: 60, channelId: "calls"/);
  });

  it("batches at Expo's documented limit", () => {
    const EXPO_SRC = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "..", "server", "expoPush.ts"),
      "utf8"
    );
    expect(EXPO_SRC).toMatch(/const EXPO_BATCH = 100;/);
    expect(EXPO_SRC).toMatch(/for \(let i = 0; i < valid\.length; i \+= EXPO_BATCH\)/);
  });

  it("adds no npm dependency, like every other sender here", () => {
    const pkg = fs.readFileSync(path.resolve(__dirname, "..", "..", "..", "package.json"), "utf8");
    expect(pkg).not.toMatch(/"firebase"/);
    expect(pkg).not.toMatch(/"expo-server-sdk"/);
  });
});
