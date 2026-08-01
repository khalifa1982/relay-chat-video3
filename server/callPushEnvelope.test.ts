/**
 * THE CALL-PUSH ENVELOPE AND THE CANCEL THAT WAS MISSING (2026-08-01).
 *
 * The owner handed over a push-backend spec with both credential pipes already
 * staged and proven on production. Diffing it against the code found four real
 * gaps, and this file pins each:
 *
 *   1. FCM DROPPED THE CALL BLOCK ENTIRELY. Only the APNs branch read
 *      `payload.call`, so an Android ring arrived with `kind: "incoming-call"` and
 *      NO ROOM — the shell could render a full-screen ring and then had nothing to
 *      join. Worse than not ringing, because the user acts on it.
 *
 *   2. THE TWO PLATFORMS SENT DIFFERENT FIELDS. iOS got
 *      `{callerName, callerPin, roomId, video, kind}`; Android got a notification
 *      envelope. One shell, two contracts.
 *
 *   3. THERE WAS NO `call_cancel` AT ALL. `cancelPendingRings` sends a websocket
 *      frame, which by definition cannot reach a callee whose phone was WOKEN —
 *      that is why they were pushed. Their handset rang out the full 45s expiry
 *      after the caller gave up; on iOS, a CallKit screen answered into nothing.
 *
 *   4. EVERY VALUE MUST BE A STRING, and that is a safety property rather than a
 *      formatting one: FCM answers 400 INVALID_ARGUMENT to a non-string `data`
 *      value, and the sender used to read a 400 as a dead token and PRUNE it. A
 *      boolean here would have deregistered handsets.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCallCancel, buildCallPush } from "./callPushPayload";
import { codeOnly } from "./testing/codeOnly";

const read = (p: string) => codeOnly(readFileSync(resolve(process.cwd(), p), "utf8"));
const WEBPUSH = read("server/webPush.ts");
const APNS = read("server/apnsVoip.ts");
const RELAY = read("server/relay.ts");
const CORE = read("server/_core/index.ts");

const RING = {
  type: "incoming_call" as const,
  roomId: "room-42",
  callerName: "Amira",
  callerPin: "777777",
  video: true,
  callerAvatar: "/manus-storage/relay-chat/3/avatar_x.png",
  nowMs: 1_760_000_000_000,
};

describe("the envelope the spec asks for", () => {
  it("carries every field the spec names", () => {
    const p = buildCallPush(RING);
    for (const k of ["type", "callId", "roomId", "mode", "callerName", "callerAvatar", "ts"]) {
      expect(p, `missing ${k}`).toHaveProperty(k);
    }
    expect(p.type).toBe("incoming_call");
    expect(p.mode).toBe("video");
    expect(p.callerName).toBe("Amira");
    expect(p.ts).toBe("1760000000000");
  });

  it("EVERY value is a string — a non-string is a pruned registration, not a cosmetic bug", () => {
    /* FCM's data contract refuses a non-string with 400 INVALID_ARGUMENT, and
       `tokenIsDead` used to read any 400 as a dead token. So a boolean `video` here
       would not merely fail to ring — it would deregister the handset. */
    for (const [k, v] of Object.entries(buildCallPush(RING))) {
      expect(typeof v, `${k} is ${typeof v}`).toBe("string");
    }
    for (const [k, v] of Object.entries(buildCallCancel("room-42", 1))) {
      expect(typeof v, `${k} is ${typeof v}`).toBe("string");
    }
  });

  it("`callId` IS the roomId, which is what makes cancel correct by construction", () => {
    /* RELAY has no separate call identifier. Minting one would need storage both the
       ring path and the hang-up path could read, and a mismatch there is a phone that
       rings until its expiry with nobody on the other end. */
    const ring = buildCallPush(RING);
    const cancel = buildCallCancel(RING.roomId, 2);
    expect(ring.callId).toBe(RING.roomId);
    expect(cancel.callId).toBe(ring.callId);
  });

  it("`mode` is the spec's word, not a boolean in disguise", () => {
    expect(buildCallPush({ ...RING, video: true }).mode).toBe("video");
    expect(buildCallPush({ ...RING, video: false }).mode).toBe("voice");
  });

  it("a missing avatar is an empty string, never the word undefined", () => {
    /* `String(undefined)` is "undefined", which a shell would happily try to load. */
    expect(buildCallPush({ ...RING, callerAvatar: null }).callerAvatar).toBe("");
    expect(buildCallPush({ ...RING, callerAvatar: undefined }).callerAvatar).toBe("");
  });

  it("the fields the SHIPPED shells read survive alongside the new ones", () => {
    /* Additive, never renaming. `kind`, `callerPin` and `video` are what the handsets
       already on people's phones branch on; renaming them would be a deploy that
       silently stops those devices ringing. */
    const p = buildCallPush(RING);
    expect(p.kind).toBe("incoming-call");
    expect(p.callerPin).toBe("777777");
    expect(p.video).toBe("1");
    expect(buildCallPush({ ...RING, video: false }).video).toBe("0");
  });

  it("a cancel names the call and nothing else", () => {
    const c = buildCallCancel("room-9", 5);
    expect(c.type).toBe("call_cancel");
    expect(c.kind).toBe("call-cancel");
    expect(c.callId).toBe("room-9");
    /* No caller identity: a cancel arrives when the callee may already have dismissed
       the ring, and re-sending who called there is data leaving the server for a
       screen being torn down. */
    expect(c.callerName).toBe("");
    expect(c.callerPin).toBe("");
    expect(c.callerAvatar).toBe("");
  });
});

describe("both transports send the SAME envelope", () => {
  it("there is exactly ONE composer, and both senders reach for it", () => {
    /* Two literals is how iOS and Android come to disagree about what a call is —
       the class this repo already paid for with the TURN checker (v2.99.71) and the
       token classifier (v2.105.11). */
    expect(APNS).toMatch(/import \{ buildCallPush.*\} from "\.\/callPushPayload"/);
    expect(WEBPUSH).toMatch(/import \{ buildCallPush.*\} from "\.\/callPushPayload"/);
  });

  it("the APNs body IS the composed envelope, with no `aps` wrapper", () => {
    const at = APNS.indexOf("const body = JSON.stringify(");
    expect(at).toBeGreaterThan(-1);
    const body = APNS.slice(at, at + 600);
    expect(body).toMatch(/buildCallPush\(\{/);
    expect(body, "a VoIP push must carry no alert — iOS routes it to PushKit").not.toMatch(/\baps\b/);
  });

  it("the FCM data block carries the call, which it used to drop on the floor", () => {
    const at = WEBPUSH.indexOf("const r = await sendFcmData(fcmTokens, {");
    expect(at).toBeGreaterThan(-1);
    const call = WEBPUSH.slice(at, at + 900);
    expect(call).toMatch(/buildCallPush\(\{ type: "incoming_call"/);
    /* Spread LAST so `kind` resolves to the call discriminator rather than the
       notification one — a mutation moving it first bites. */
    expect(call.indexOf("kind: payload.kind")).toBeLessThan(call.indexOf("buildCallPush"));
  });

  it("only a RING composes one — a message push must not carry call fields", () => {
    const at = WEBPUSH.indexOf("const r = await sendFcmData(fcmTokens, {");
    const call = WEBPUSH.slice(at, at + 900);
    expect(call).toMatch(/payload\.kind === "incoming-call" && payload\.call/);
  });
});

describe("a pushed ring is cancelled by a push", () => {
  it("the pending ring records HOW it was delivered", () => {
    expect(RELAY).toMatch(/pushed\?: boolean;/);
    /* Only the PAGING branch marks it. The live-ring path must not: that callee has a
       socket, receives the websocket `ring-cancel`, and waking their phone a second
       time to tell them nothing is a regression, not a fix. */
    const marks = RELAY.match(/pushed: true/g) || [];
    expect(marks.length, "exactly one site marks a ring as pushed").toBe(1);
    const at = RELAY.indexOf("pushed: true");
    const around = RELAY.slice(Math.max(0, at - 500), at);
    expect(around, "the mark belongs to the paging branch").toMatch(/pagingRoom/);
  });

  it("the cancel hook lives on the REGISTRY, so no call site can forget it", () => {
    /* Three sites cancel rings today. A parameter would have to be passed at each,
       which is exactly how the fourth comes to be written without it —
       `onConferenceEnd` sits on the registry for the same reason. */
    expect(RELAY).toMatch(/onCancelRingPush\?: CancelPushHook;/);
    const sites = RELAY.match(/cancelPendingRings\(reg, [a-zA-Z.]+\)/g) || [];
    expect(sites.length).toBeGreaterThanOrEqual(3);
    for (const s of sites) {
      expect(s, "a call site must not have to pass the hook").not.toMatch(/onCancelRingPush/);
    }
  });

  it("it fires ONLY for a ring this caller actually pushed", () => {
    const at = RELAY.indexOf("export function cancelPendingRings(");
    const fn = RELAY.slice(at, RELAY.indexOf("\n}", at));
    expect(fn.length).toBeGreaterThan(200);
    expect(fn).toMatch(/reg\.onCancelRingPush && pending\?\.pushed && pending\.from === callerPin/);
    /* Read BEFORE clearPendingRing destroys the record, or the roomId is already gone
       and the cancel names nothing.
       BOTH INDICES ARE ASSERTED TO EXIST FIRST, and that is the whole correction: a
       mutation run showed this comparison passing VACUOUSLY when the read was deleted,
       because `indexOf` answers -1 and -1 is less than any real offset. The
       negative-index trap CLAUDE.md records at v2.99.78 and v2.106.56, reproduced
       inside an ordering test written to catch an ordering bug. */
    const readAt = fn.indexOf("const pending = reg.pendingRings.get(calleePin)");
    const clearAt = fn.indexOf("clearPendingRing(");
    expect(readAt, "the pending record is never read").toBeGreaterThan(-1);
    expect(clearAt, "the ring is never cleared").toBeGreaterThan(-1);
    expect(readAt).toBeLessThan(clearAt);
  });

  it("it cannot break a hang-up", () => {
    const at = RELAY.indexOf("export function cancelPendingRings(");
    const fn = RELAY.slice(at, RELAY.indexOf("\n}", at));
    expect(fn).toMatch(/void reg\.onCancelRingPush\(/); // never awaited
    /* And it is CAUGHT. Asserted structurally rather than on the comment that says so
       — `codeOnly` strips comments, which is what this assertion first matched on. */
    expect(fn).toMatch(/try \{\s*void reg\.onCancelRingPush\([\s\S]{0,120}?\}\s*catch\b/);
  });

  it("the implementation rides the SAME funnel and the SAME transports as the ring", () => {
    /* The hook is the LAST positional argument to `attachRelay`, not a named property —
       an earlier draft of this test looked for `onCancelRingPush:` in this file and
       failed on correct source. What proves the wiring is that the arrow sits inside
       the attachRelay argument list, after `onResolveDial`'s body. */
    const callAt = CORE.indexOf("attachRelay(");
    expect(callAt).toBeGreaterThan(-1);
    const resolveEnd = CORE.indexOf('return "identity" as const;', callAt);
    expect(resolveEnd, "onResolveDial is gone").toBeGreaterThan(callAt);
    const implAt = CORE.indexOf("(info) => {", resolveEnd);
    expect(implAt, "no hook follows onResolveDial").toBeGreaterThan(resolveEnd);
    const impl = CORE.slice(implAt);
    expect(impl.length).toBeGreaterThan(300);
    /* `sendPushToIdentity` is where the master push switch is enforced and where every
       transport fans out; a parallel sender would bypass it. */
    expect(impl).toMatch(/sendPushToIdentity\(callee\.id, \{/);
    expect(impl, "a direct sender bypasses the switch").not.toMatch(
      /sendVoipRing\(|sendFcmData\(|sendExpoPush\(/,
    );
    /* `kind` stays the ring's, because the APNs VoIP branch is gated on it — a cancel
       under a different kind would silently take a different route. */
    expect(impl).toMatch(/kind: "incoming-call"/);
    expect(impl).toMatch(/type: "call_cancel"/);
    expect(impl).toMatch(/roomId: info\.roomId/);
  });

  it("it is fire-and-forget at the implementation too", () => {
    const impl = CORE.slice(CORE.indexOf("(info) => {", CORE.indexOf('return "identity" as const;')));
    expect(impl.slice(0, 1400)).toMatch(/void \(async \(\) => \{/);
  });
});

describe("the ring carries the caller's avatar, and cannot be blocked by it", () => {
  it("it is resolved best-effort with its own catch", () => {
    const at = CORE.indexOf("callerAvatar: await getIdentityByNumber(info.callerPin)");
    expect(at).toBeGreaterThan(-1);
    /* Decoration on a screen that falls back to initials. A failure to resolve it must
       never be the reason a phone does not ring. */
    expect(CORE.slice(at, at + 200)).toMatch(/\.catch\(\(\) => null\)/);
  });
});
