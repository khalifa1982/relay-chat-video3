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
  resolveKind,
  mountNativeTokenBridge,
  acceptNativeEventDetail,
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

/**
 * Mount the real bridge against a fake window and drive it.
 *
 * This env is Node with no DOM, and the bridge reads `window.location.origin`
 * and installs a real listener — so the only honest way to exercise the dedup is
 * to stand in a window it accepts and post through the listener it registered.
 * The global is always restored, so one test cannot leak into the next.
 */
function withFakeWindow(
  body: (post: (data: unknown) => void, register: ReturnType<typeof vi.fn>) => void,
) {
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
    const post = (data: unknown) =>
      listeners.forEach((fn) =>
        fn({ origin: SELF, source: fakeWin, data: JSON.stringify(data) } as unknown as MessageEvent),
      );
    body(post, register);
    off();
  } finally {
    if (prev === undefined) delete g.window;
    else g.window = prev;
  }
}

describe("the gates — which messages are REFUSED", () => {
  it("accepts a same-origin post from our own window", () => {
    expect(acceptTokenMessage(msg(), SELF, WIN)?.token).toBe(EXPO);
  });

  it("accepts the native-injection shape: empty or 'null' origin, no source", () => {
    // An injected-JS post from a WebView has no separate window, and on iOS the
    // origin is reported empty. Refusing these would refuse the only case this
    // module exists for.
    expect(acceptTokenMessage(msg({ origin: "", source: undefined }), SELF, WIN)?.token).toBe(EXPO);
    expect(acceptTokenMessage(msg({ origin: "null", source: null }), SELF, WIN)?.token).toBe(EXPO);
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

  it("carries the shell's apns-voip declaration through, and nothing else", () => {
    // v2.105.13. iOS issues TWO hex tokens — PushKit (rings via CallKit) and the
    // ordinary alert token — and they are indistinguishable by shape, so this
    // label is the only signal. Everything else stays shape-decided.
    const voip = { type: "SET_PUSH_TOKEN", token: "b".repeat(64), kind: "apns-voip" };
    expect(acceptTokenMessage(msg({ data: voip }), SELF, WIN)).toEqual({
      token: "b".repeat(64),
      voip: true,
    });
    // No declaration ⇒ not voip. An alert token must never be rung by default,
    // because a VoIP push to it earns BadDeviceToken and gets the row PRUNED.
    expect(acceptTokenMessage(msg({ data: { ...voip, kind: undefined } }), SELF, WIN)?.voip).toBe(false);
    for (const kind of ["apns", "expo", "fcm", "webpush", "VOIP", 1, {}, null]) {
      expect(
        acceptTokenMessage(msg({ data: { ...voip, kind } }), SELF, WIN)?.voip,
        `${String(kind)} is not a voip declaration`,
      ).toBe(false);
    }
  });

  it("resolveKind applies the declaration ONLY to a hex token", () => {
    // A declaration on an Expo or FCM token must not relabel it — that would route
    // it to a transport that cannot carry it, which is a silent delivery failure.
    expect(resolveKind("b".repeat(64), true)).toBe("apns-voip");
    expect(resolveKind("b".repeat(64), false)).toBe("apns");
    expect(resolveKind(EXPO, true)).toBe("expo");
    expect(resolveKind(FCM, true)).toBe("fcm");
    expect(resolveKind("nope", true)).toBeNull();
  });

  it("registers BOTH of an iPhone's tokens, and each only once", () => {
    // An iOS shell now legitimately posts two tokens: Expo for notifications and
    // PushKit for ringing. A one-slot dedup would treat the alternation as a
    // change and re-register both on every foreground, forever.
    const VOIP = "c".repeat(64);
    withFakeWindow((post, register) => {
      for (let i = 0; i < 3; i++) {
        post({ type: "SET_PUSH_TOKEN", token: EXPO });
        post({ type: "SET_PUSH_TOKEN", token: VOIP, kind: "apns-voip" });
      }
      expect(register.mock.calls).toEqual([
        [EXPO, "expo"],
        [VOIP, "apns-voip"],
      ]);
    });
  });

  it("a token re-posted with a CORRECTED kind is not swallowed by the dedup", () => {
    // A shell that first posted its PushKit token unlabelled and then fixed the
    // label must be able to upgrade it, or the ring stays broken until reinstall.
    const T = "d".repeat(64);
    withFakeWindow((post, register) => {
      post({ type: "SET_PUSH_TOKEN", token: T });
      post({ type: "SET_PUSH_TOKEN", token: T, kind: "apns-voip" });
      expect(register.mock.calls).toEqual([
        [T, "apns"],
        [T, "apns-voip"],
      ]);
    });
  });

  it("accepts an already-parsed object, since not every shell stringifies", () => {
    expect(
      acceptTokenMessage(msg({ data: { type: "SET_PUSH_TOKEN", token: FCM } }), SELF, WIN)?.token
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

/**
 * THE SECOND ENVELOPE (2026-08-01) — `relay:native`, per the owner's push spec.
 *
 * Accepted ALONGSIDE the `postMessage`/`SET_PUSH_TOKEN` contract above, never
 * instead of it: the shell already on the owner's iPhone posts the old shape and
 * is the only handset whose ring has been proven end to end, so replacing the
 * contract would silence the one device that works.
 */
describe("acceptNativeEventDetail — the relay:native envelope", () => {
  const HEX = "a".repeat(64);

  it("accepts the spec's detail", () => {
    expect(acceptNativeEventDetail({ type: "pushToken", kind: "apns-voip", token: HEX })).toEqual({
      token: HEX,
      voip: true,
    });
    expect(
      acceptNativeEventDetail({ type: "pushToken", kind: "fcm", token: "abc:APA91b" + "x".repeat(40) }),
    ).toEqual({ token: "abc:APA91b" + "x".repeat(40), voip: false });
  });

  it("only `apns-voip` declares PushKit — every other kind is a hint the shape overrides", () => {
    /* The shape decides everything except this one bit, which no shape can answer:
       iOS issues two indistinguishable hex tokens, the PushKit one and the alert
       one (v2.105.13). */
    expect(acceptNativeEventDetail({ type: "pushToken", kind: "apns", token: HEX })?.voip).toBe(false);
    expect(acceptNativeEventDetail({ type: "pushToken", token: HEX })?.voip).toBe(false);
  });

  it("refuses anything that is not a token announcement", () => {
    for (const d of [
      null,
      "pushToken",
      { type: "pushToken" }, // no token
      { type: "pushToken", token: "short" },
      { type: "SET_PUSH_TOKEN", token: HEX }, // the OTHER envelope's type
      { type: "callAnswered", callId: "r1" }, // the call bridge's message
      { token: HEX }, // no type
    ]) {
      expect(acceptNativeEventDetail(d), JSON.stringify(d)).toBeNull();
    }
  });

  it("agrees with the postMessage envelope about what a token IS", () => {
    /* Two admit paths that disagree about the shape rule is how one transport
       registers a token the other would refuse — the class this repo keeps
       re-learning (v2.99.50, v2.99.71). */
    for (const token of [HEX, "ExponentPushToken[abcdefghijklmnop]", "abc:APA91b" + "y".repeat(40)]) {
      const viaEvent = acceptNativeEventDetail({ type: "pushToken", token });
      const viaPost = acceptTokenMessage(
        { origin: "", data: { type: "SET_PUSH_TOKEN", token } },
        "https://x",
        undefined,
      );
      expect(!!viaEvent, token).toBe(!!viaPost);
      expect(viaEvent?.token).toBe(viaPost?.token);
    }
  });
});
