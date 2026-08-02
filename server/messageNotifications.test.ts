/**
 * MESSAGE NOTIFICATIONS ON iOS + ANDROID (2026-08-02).
 *
 * The owner's spec asked for a message arriving while the app is minimised or
 * killed to show a banner on the phone. Auditing it clause by clause against
 * source found most of it ALREADY SHIPPED — the send-path hook, the offline gate,
 * per-conversation collapse, the 3600s TTL, HIGH priority, the multi-device
 * fan-out, the token-kind registry, the master push switch, and "never a message
 * over VoIP" (v2.99.42 R7 GAP1, v2.105.11, v2.105.13). Four things were genuinely
 * absent and are what this file covers:
 *
 *   1. FCM was DATA-ONLY, so on a shell with no FirebaseMessagingService — the
 *      shipping Expo one — the push arrived and displayed NOTHING.
 *   2. No `apns` block at all, so an iOS-registered FCM token got no banner.
 *   3. A group push named the SENDER, so it said who spoke and never where.
 *   4. The body was fixed prose; the spec asks for a preview.
 *
 * The load-bearing assertion in here is the FIRST one: a ring must never gain a
 * `notification` block.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildFcmMessage } from "./fcm";
import {
  messagePushPreview,
  messagePushTitle,
  messagePushBody,
  MESSAGE_PREVIEW_MAX,
  MESSAGE_PREVIEW_GENERIC,
} from "./messagePush";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** Comment spans stripped, so a rule is never satisfied by prose describing it. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("a RING must never carry an OS-displayed notification block", () => {
  /* THIS IS THE ONE THAT MATTERS, and the failure it prevents is invisible in
   * every log: for a message carrying `notification`, Android displays it itself
   * and does NOT invoke `onMessageReceived` while the app is backgrounded. The
   * lock-screen ring depends on that callback to raise IncomingCallActivity
   * (v2.86), so a `notification` block on a ring replaces a full-screen
   * CallKit-style screen with an ordinary banner — no ringtone, nothing to answer,
   * and the push itself still reports delivered. */
  it("a call payload has no notification, no apns block, and keeps the ring TTL", () => {
    const m = buildFcmMessage("tok", { kind: "incoming-call", title: "A", body: "" }, null);
    expect(m.notification).toBeUndefined();
    expect(m.apns).toBeUndefined();
    const android = m.android as Record<string, unknown>;
    expect(android.notification).toBeUndefined();
    // The ring's own short bound, not the 3600s message tier.
    expect(String(android.ttl)).not.toBe("3600s");
  });

  it("omitting `display` reproduces the pre-2026-08-02 payload exactly", () => {
    // So nothing that worked before this change can have changed shape.
    const m = buildFcmMessage("tok", { kind: "missed-call", title: "A", body: "b" });
    expect(Object.keys(m).sort()).toEqual(["android", "data", "token"]);
    expect(m.android).toEqual({ priority: "HIGH", ttl: "3600s" });
  });

  it("the fan-out withholds `display` for a ring and supplies it for everything else", () => {
    // The gate lives at the ONE place `payload.kind` is already the discriminator.
    const code = codeOnly(read("server/webPush.ts"));
    const at = code.indexOf("const display =");
    expect(at, "webPush.ts must decide the display block").toBeGreaterThan(0);
    const decl = code.slice(at, at + 260);
    expect(decl).toMatch(/payload\.kind === "incoming-call"/);
    // Null on the CALL side of the ternary — the inverse would be the defect.
    expect(decl).toMatch(/\?\s*null/);
    // And it must actually reach the sender.
    expect(code).toMatch(/sendFcmData\([\s\S]{0,600}?,\s*display\)/);
  });

  it("apnsVoip stays ring-only — a message never rides PushKit", () => {
    const code = codeOnly(read("server/webPush.ts"));
    const at = code.indexOf('s.kind === "apns-voip"');
    expect(at).toBeGreaterThan(0);
    // The send is gated on the call kind AND on a call payload being present.
    expect(code.slice(at, at + 400)).toMatch(
      /payload\.kind === "incoming-call" && payload\.call/,
    );
  });
});

describe("the displayed payload serves Android and iOS from one message", () => {
  const display = { title: "Design Crew", body: "Sara: on my way", collapseId: "relay-msg-7" };

  it("carries a top-level notification for the OS to render with no app code", () => {
    const m = buildFcmMessage("tok", { kind: "message", title: "x", body: "y" }, display);
    expect(m.notification).toEqual({ title: "Design Crew", body: "Sara: on my way" });
  });

  it("carries an APNs alert block, never a voip push type", () => {
    const m = buildFcmMessage("tok", { kind: "message", title: "x", body: "y" }, display);
    const apns = m.apns as { headers: Record<string, string>; payload: Record<string, unknown> };
    expect(apns.headers["apns-push-type"]).toBe("alert");
    expect(apns.headers["apns-push-type"]).not.toBe("voip");
    expect(apns.headers["apns-priority"]).toBe("10");
    expect(apns.headers["apns-collapse-id"]).toBe("relay-msg-7");
    const aps = (apns.payload as { aps: Record<string, unknown> }).aps;
    expect(aps.alert).toEqual({ title: "Design Crew", body: "Sara: on my way" });
    expect(aps.sound).toBe("default");
    // Groups stack into one thread rather than N banners.
    expect(aps["thread-id"]).toBe("relay-msg-7");
  });

  it("collapses per conversation on Android too", () => {
    const m = buildFcmMessage("tok", { kind: "message", title: "x", body: "y" }, display);
    const android = m.android as Record<string, unknown>;
    expect(android.collapse_key).toBe("relay-msg-7");
    expect(android.notification).toEqual({ channel_id: "messages", tag: "relay-msg-7" });
    expect(android.ttl).toBe("3600s");
  });

  it("drops an over-long collapse id rather than letting APNs refuse the push", () => {
    // APNs caps `apns-collapse-id` at 64 bytes and rejects the WHOLE message when
    // it is longer — so a grouping nicety must never cost the notification.
    const m = buildFcmMessage(
      "tok",
      { kind: "message", title: "x", body: "y" },
      { title: "t", body: "b", collapseId: "x".repeat(65) },
    );
    const apns = m.apns as { headers: Record<string, string> };
    expect(apns.headers["apns-collapse-id"]).toBeUndefined();
    expect((m.android as Record<string, unknown>).collapse_key).toBeUndefined();
    // The banner itself still goes.
    expect(m.notification).toBeDefined();
  });

  it("drops an empty collapse id too", () => {
    const m = buildFcmMessage(
      "tok",
      { kind: "message", title: "x", body: "y" },
      { title: "t", body: "b", collapseId: "" },
    );
    expect((m.apns as { headers: Record<string, string> }).headers["apns-collapse-id"]).toBeUndefined();
    expect((m.android as Record<string, unknown>).collapse_key).toBeUndefined();
  });

  it("still carries the data block, so a shell that renders it itself is unaffected", () => {
    // RELAY's own shell reads `data.kind`/`title`/`body` in RelayFcmService. The
    // display block is additive; it must not replace the data message.
    const m = buildFcmMessage("tok", { kind: "message", title: "T", body: "B" }, display);
    expect(m.data).toEqual({ kind: "message", title: "T", body: "B" });
  });
});

describe("what the banner says", () => {
  it("quotes a short message verbatim", () => {
    expect(messagePushPreview({ kind: "text", body: "on my way" })).toBe("on my way");
  });

  it("collapses whitespace before spending the budget", () => {
    // A message opening with blank lines would otherwise render as a blank banner.
    expect(messagePushPreview({ kind: "text", body: "\n\n  hello   there \n" })).toBe(
      "hello there",
    );
  });

  it("caps a long message and ends on a word", () => {
    const body = `${"word ".repeat(60)}end`;
    const out = messagePushPreview({ kind: "text", body });
    expect(out.length).toBeLessThanOrEqual(MESSAGE_PREVIEW_MAX + 1); // +1 for the ellipsis
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/ …$/); // no dangling space before the ellipsis
    expect(out.slice(0, -1).endsWith("word")).toBe(true);
  });

  it("cuts mid-word rather than losing most of the budget to one long token", () => {
    // A 200-character URL has no space to break on; truncating at the last space
    // would produce an almost-empty banner.
    const out = messagePushPreview({ kind: "text", body: `see ${"a".repeat(200)}` });
    expect(out.length).toBeGreaterThan(MESSAGE_PREVIEW_MAX - 10);
  });

  it("names the media for a caption-less attachment", () => {
    expect(messagePushPreview({ kind: "image", body: null })).toBe("📷 Photo");
    expect(messagePushPreview({ kind: "video", body: null })).toBe("🎥 Video");
    expect(messagePushPreview({ kind: "audio", body: null })).toBe("🎤 Voice note");
    expect(messagePushPreview({ kind: "file", body: "   " })).toBe("📎 File");
  });

  it("prefers a caption over the media word", () => {
    expect(messagePushPreview({ kind: "image", body: "look at this" })).toBe("look at this");
  });

  /* THE ONE CASE THAT IS A CORRECTNESS RULE RATHER THAN A WORDING CHOICE. A
   * view-once message's whole promise is that the content stops existing once it
   * has been seen — and a notification OUTLIVES it, sitting in the notification
   * centre after the bubble has burned, with nothing left in the app to correspond
   * to it. Quoting one in a push defeats the feature the push is about. */
  it("never quotes an expiring message", () => {
    for (const expire of ["once", 5, 10, 30] as const) {
      const out = messagePushPreview({ kind: "text", body: "the secret", meta: { expire } });
      expect(out).not.toMatch(/secret/);
      expect(out).toMatch(/disappearing/i);
    }
    // Including when the content is an attachment rather than text.
    expect(messagePushPreview({ kind: "image", body: null, meta: { expire: "once" } })).not.toBe(
      "📷 Photo",
    );
  });

  it("falls back to a true sentence rather than a blank banner", () => {
    expect(messagePushPreview({ kind: undefined, body: null })).toBe(MESSAGE_PREVIEW_GENERIC);
    expect(messagePushPreview({})).toBe(MESSAGE_PREVIEW_GENERIC);
  });
});

describe("who the banner is from", () => {
  it("a group is titled by the GROUP with the sender leading the body", () => {
    // v2.99.42 titled both by the sender, so a group notification told you who
    // spoke and never where — and "Sara" alone is not something you can act on.
    const title = messagePushTitle({ isGroup: true, groupTitle: "Design Crew", senderName: "Sara" });
    expect(title).toBe("Design Crew");
    expect(messagePushBody({ isGroup: true, senderName: "Sara", preview: "on my way" })).toBe(
      "Sara: on my way",
    );
  });

  it("a DM is titled by the sender with no prefix on the body", () => {
    expect(messagePushTitle({ isGroup: false, groupTitle: "x", senderName: "Sara" })).toBe("Sara");
    expect(messagePushBody({ isGroup: false, senderName: "Sara", preview: "hi" })).toBe("hi");
  });

  it("an unnamed group falls back to the sender rather than to nothing", () => {
    for (const t of [null, undefined, "", "   "]) {
      expect(messagePushTitle({ isGroup: true, groupTitle: t, senderName: "Sara" })).toBe("Sara");
    }
  });

  it("a blank sender leaves the body unprefixed rather than starting with a colon", () => {
    expect(messagePushBody({ isGroup: true, senderName: "  ", preview: "hi" })).toBe("hi");
  });
});

describe("the send path", () => {
  const code = codeOnly(read("server/v2routers.ts"));

  it("uses the shared wording helpers rather than composing its own", () => {
    // Two copies of "what does a message notification say" is how a group banner
    // and a DM banner come to describe one message differently.
    expect(code).toMatch(/messagePushPreview\(/);
    expect(code).toMatch(/messagePushTitle\(/);
    expect(code).toMatch(/messagePushBody\(/);
    expect(code, "the old fixed sentence must be gone from the send path").not.toMatch(
      /body: "Sent you a message — tap to read it\."/,
    );
  });

  it("passes the real message kind, body and meta to the preview", () => {
    const at = code.indexOf("messagePushPreview({");
    expect(at).toBeGreaterThan(0);
    const call = code.slice(at, code.indexOf("}", at) + 1);
    expect(call).toMatch(/kind: input\.kind/);
    // `trimmedBody` is what was STORED; using input.body would quote whitespace
    // the message itself does not contain.
    expect(call).toMatch(/body: trimmedBody/);
    /* THE REAL VALUE, NOT JUST THE KEY. A first version of this asserted
     * `/meta:/`, which `meta: null` satisfies — so a mutation making the
     * expiring-message rule COMPLETELY INERT survived the whole suite. That is
     * the worst survivor available here: a view-once message's content would be
     * quoted on a lock screen, where the notification outlives the burn. */
    expect(call, "the expiring-message rule is only reachable if meta is passed").toMatch(
      /meta: input\.meta/,
    );
  });

  it("reads the conversation header only when somebody is actually offline", () => {
    // A conversation whose members are all online must cost no extra query.
    const at = code.indexOf("getConversationPushHeader(");
    expect(at).toBeGreaterThan(0);
    const before = code.slice(Math.max(0, at - 400), at);
    expect(before).toMatch(/offlinePeerIds\.length > 0/);
  });

  it("keeps the per-conversation tag, so a burst replaces instead of stacking", () => {
    expect(code).toMatch(/tag: `relay-msg-\$\{input\.conversationId\}`/);
  });

  it("still skips the sender and anyone who can see the message in the open app", () => {
    // Both suppression rules the spec asks for, unchanged.
    expect(code).toMatch(/peerIds = participantIds\.filter\(\(p\) => p !== me\.id\)/);
    expect(code).toMatch(/presenceNeedsNotification/);
  });

  it("a voicemail keeps its own better-worded push and gets no second banner", () => {
    const at = code.indexOf("!input.meta?.voicemail");
    expect(at).toBeGreaterThan(0);
  });
});

describe("the conversation header reader", () => {
  const code = codeOnly(read("server/v2db.ts"));
  const at = code.indexOf("export async function getConversationPushHeader");
  // Bounded by the function's OWN end, not a character count. A fixed slice here
  // ran into `deleteMessage`, which legitimately uses `.select()` — so a
  // "reads only two columns" assertion failed on correct source.
  const end = code.indexOf("export async function", at + 10);
  const body = at > 0 && end > at ? code.slice(at, end) : "";

  it("the slice is real", () => {
    expect(at).toBeGreaterThan(0);
    expect(body.length).toBeGreaterThan(200);
    expect(body).toContain("getConversationPushHeader");
  });

  it("reads only the two columns a banner needs", () => {
    expect(body).toMatch(/kind: conversations\.kind/);
    expect(body).toMatch(/title: conversations\.title/);
    // Not the whole row: this runs on the send path.
    expect(body).not.toMatch(/\.select\(\)/);
  });

  it("fails soft, so a decoration lookup can never cost the message", () => {
    expect(body).toMatch(/catch/);
    expect(body).toMatch(/return null/);
  });
});

describe("§2 — the token bridge needs no change, and that is the decision", () => {
  /* The spec's §3 has the iOS shell register with `kind: "alert"` carrying the
   * FIREBASE token (not the raw APNs one), so iOS is served by FCM v1 through the
   * same payload as Android. Our classifier decides by SHAPE, and an FCM
   * registration token is shaped `<instance-id>:APA91b…` — so it already routes to
   * `fcm`, which is exactly right, and no `alert` kind is needed anywhere.
   *
   * Recorded as a pin rather than left implicit because the tempting "fix" —
   * adding an `alert` branch that trusts the declared kind — would let a RAW APNs
   * hex token be routed to FCM, where it is silently undeliverable. The one kind
   * that may be declared is `apns-voip`, because the PushKit and alert tokens are
   * indistinguishable by shape (v2.105.13) and mislabelling costs only the
   * declarer their own ring. */
  it("an FCM token routes to fcm whatever kind the shell declares", () => {
    const code = codeOnly(read("server/v2routers.ts"));
    const at = code.indexOf("isVoipDeclaration(input.kind, actual)");
    expect(at, "the stored kind must be re-derived from the token's shape").toBeGreaterThan(0);
    // `actual` is the shape-derived kind; the declaration only ever promotes the
    // one ambiguous case.
    expect(code.slice(at - 120, at + 120)).toMatch(/kind = isVoipDeclaration\(/);
  });

  it("only apns-voip may be declared — no other kind is trusted", () => {
    const bridge = codeOnly(read("client/src/app/nativeTokenBridge.ts"));
    expect(bridge).toMatch(/d\.kind === "apns-voip"/);
    // An `alert` (or any other) declaration must not become a routing decision.
    expect(bridge).not.toMatch(/d\.kind === "alert"/);
    expect(bridge).not.toMatch(/kind === "fcm" \?/);
  });

  it("a raw APNs hex token is still stored inert rather than mis-routed to FCM", () => {
    // If a shell sends the APNs token instead of the Firebase one, it lands as
    // `apns`: no banner, but diagnosable in the admin push doctor — never
    // delivered to the wrong service and never silently pruned.
    const wp = codeOnly(read("server/webPush.ts"));
    expect(wp).toMatch(/s\.kind !== "apns-voip" && s\.kind !== "apns"/);
    const fcmLine = wp.slice(wp.indexOf('subs.filter(s => s.kind === "fcm")'), wp.indexOf('subs.filter(s => s.kind === "fcm")') + 80);
    expect(fcmLine, "the FCM transport takes ONLY fcm-kind rows").not.toMatch(/apns/);
  });
});

describe("the EMAIL keeps its content-free rule", () => {
  /* Two channels, two rules, deliberately. A banner is transient and on the
   * owner's own lock screen; an email sits in a third-party inbox indefinitely.
   * The owner's rule for the email ("WITHOUT the content") is unchanged, and the
   * preview must not have leaked into it. */
  it("the offline-message email still says nothing about the message", () => {
    // Both templates live in v2routers.ts beside their one call site.
    const src = read("server/v2routers.ts");
    for (const fn of ["messageWaitingHtml", "messageWaitingText"]) {
      const at = src.indexOf(`function ${fn}(`);
      expect(at, `${fn} must exist`).toBeGreaterThan(0);
      const region = src.slice(at, at + 2200);
      expect(region, `${fn} must not learn to quote the message`).not.toMatch(
        /messagePushPreview|preview\b/,
      );
      expect(region).toMatch(/we don't include message contents in email/);
    }
  });

  it("the email's own body is not the push's body", () => {
    // The push and the email are composed independently, so a later edit to one
    // cannot silently carry the message text into the other.
    const code = codeOnly(read("server/v2routers.ts"));
    const at = code.indexOf("messageWaitingHtml({");
    expect(at).toBeGreaterThan(0);
    const call = code.slice(at, at + 200);
    expect(call).not.toMatch(/preview|body:/);
  });
});
