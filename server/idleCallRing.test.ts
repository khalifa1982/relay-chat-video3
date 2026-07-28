/* ──────────────────────────────────────────────────────────────────────────
 * v2.105.18 — a MINIMISED app now rings.
 *
 * THE GAP, and it is the FOURTH reader of a rule that has existed since v2.99.92.
 * That release established that minimising is IDLE, not offline: `markIdle`
 * deliberately keeps `isOnline` TRUE because the SSE stream is still open, and it
 * added `presenceNeedsNotification` (`!isOnline || idle`) for exactly the question
 * "can they see this in the open app, or must the OS tell them". Its three readers
 * are all in the MESSAGE path. The CALL path never learned it.
 *
 * So a call to a minimised callee took the LIVE branch — an SSE ring plus a
 * `call_offer` hint, and NO push. Enough for a visible tab; nothing like enough
 * for a backgrounded one, whose EventSource is throttled and whose AudioContext is
 * suspended, or for a backgrounded WebView, whose JS is frozen outright.
 *
 * WHAT IS AND IS NOT PROVEN HERE, SAID UP FRONT. The invite ROUTING is driven
 * behaviourally against the real registry, because "does the live branch get taken
 * for an idle callee" is the premise the whole fix rests on and a source pin cannot
 * answer it. The hook's own body is pinned at source: it needs MySQL (a presence
 * read and a push-subscription lookup) and there is none here, so no test in this
 * repo can watch a real push leave. That limit is stated rather than papered over.
 * ────────────────────────────────────────────────────────────────────────── */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { presenceNeedsNotification } from "./v2db";
import { codeOnly } from "./testing/codeOnly";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const CORE = read("server/_core/index.ts");
const RELAY = read("server/relay.ts");

/** The hooks are anonymous positional arrows, so locate them by CODE, never prose. */
function relayHooks(src: string): string[] {
  const out: number[] = [];
  let i = src.indexOf("attachRelay(");
  for (;;) {
    const j = src.indexOf("async (info) => {", i);
    if (j < 0) break;
    out.push(j);
    i = j + 1;
  }
  return out.map((start, n) => src.slice(start, out[n + 1] ?? src.length));
}
const HOOKS = relayHooks(CORE);
const ON_INVITE = HOOKS.find((h) => h.includes('kind: "call_offer"')) ?? "";

describe("v2.105.18 — the rule that decides whether the OS must be told", () => {
  it("IDLE needs the notification even though isOnline is TRUE", () => {
    // The whole premise. v2.99.92 keeps isOnline true while minimised — the stream
    // is open and a call still routes — so `!isOnline` alone answers "no" for
    // exactly the case the owner reported.
    expect(presenceNeedsNotification({ identityId: 1, isOnline: true, idle: true, lastSeenAt: null })).toBe(true);
  });

  it("a VISIBLE callee does NOT — they are looking at the app", () => {
    // An OS notification on top of a ring already sounding in a visible tab is
    // noise, and this is the line that keeps it out.
    expect(presenceNeedsNotification({ identityId: 1, isOnline: true, idle: false, lastSeenAt: null })).toBe(false);
  });

  it("offline needs it, and so does an UNKNOWN presence row", () => {
    expect(presenceNeedsNotification({ identityId: 1, isOnline: false, idle: false, lastSeenAt: null })).toBe(true);
    // FAILS TOWARD RINGING: a spurious notification costs a moment's noise, a
    // missed one costs the call.
    expect(presenceNeedsNotification(undefined)).toBe(true);
    expect(presenceNeedsNotification(null)).toBe(true);
  });
});

describe("v2.105.18 — onInvite raises the OS-level ring for an idle callee", () => {
  it("the hook was found by code, so every assertion below reads the right region", () => {
    // Asserted first: if this is wrong the rest fail confusingly rather than
    // usefully. The old E4 pins anchored on comment text and broke exactly here.
    expect(HOOKS.length).toBeGreaterThanOrEqual(3);
    expect(ON_INVITE).not.toBe("");
    expect(ON_INVITE).toContain("getIdentityByNumber(info.toPin)");
  });

  it("reads presence and gates the push on the SHARED rule", () => {
    // Reusing `presenceNeedsNotification` rather than re-deriving `!isOnline ||
    // idle` here is what keeps the call path and the message path agreeing about
    // what "away" means — two copies is how they come to disagree.
    expect(ON_INVITE).toContain("getPresenceForIds([callee.id])");
    expect(ON_INVITE).toMatch(/if \(!presenceNeedsNotification\(pres\)\) return;/);
  });

  it("the gate RETURNS before the push, so a visible callee is not pushed", () => {
    const gate = ON_INVITE.indexOf("presenceNeedsNotification");
    const push = ON_INVITE.indexOf("sendPushToIdentity(");
    expect(gate).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(push);
  });

  it("the SSE hint is sent UNCONDITIONALLY — a visible tab still rings instantly", () => {
    /* The push is additive. Putting the hint behind the idle gate would break the
       fast in-page path for the common case.
       FOUND BY MUTATION: this first compared INDEXES (`hint < gate`), which
       `if (false) publishToIdentity(...)` satisfies untouched — the pin froze the
       call's LOCATION while saying nothing about whether it still runs. So it now
       asserts the call is a BARE STATEMENT, which is the actual property. */
    const line = ON_INVITE.split("\n").find((l) => l.includes("publishToIdentity(callee.id, {"));
    expect(line, "found the hint's own line").toBeTruthy();
    expect(line!).toMatch(/^\s*publishToIdentity\(callee\.id, \{$/);
    // …and still ahead of the idle gate, so ordering is pinned as well as reach.
    const hint = ON_INVITE.indexOf("publishToIdentity(");
    const gate = ON_INVITE.indexOf("presenceNeedsNotification");
    expect(hint).toBeGreaterThan(-1);
    expect(hint).toBeLessThan(gate);
  });

  it("sends kind:\"incoming-call\" — the one kind every ring transport routes", () => {
    // sw.js renders this with requireInteraction + sound, the Android shell turns
    // it into a full-screen intent, and an apns-voip token becomes CallKit.
    expect(ON_INVITE).toMatch(/kind: "incoming-call"/);
  });

  it("carries the ROOM, or the phone rings and then cannot connect", () => {
    // The callee answers by joining the room the caller already created.
    const call = ON_INVITE.slice(ON_INVITE.indexOf("call: {"));
    expect(call).toContain("roomId: info.roomId");
    expect(call).toContain("callerPin: info.fromPin");
  });

  it("labels video correctly, defaulting to VOICE", () => {
    // A voice ring for a video dial under-promises; claiming video for a voice
    // dial would light up a camera nobody offered.
    expect(ON_INVITE).toContain("video: !!info.video");
    expect(RELAY).toMatch(/video\?: boolean;/);
    // …and the relay actually passes it, or the field is decoration.
    const invite = RELAY.slice(RELAY.indexOf("onInvite({"));
    expect(invite.slice(0, 400)).toContain("video: wantVideo");
  });

  it("shares ONE notification tag with the paged ring", () => {
    // Both hooks can fire for one call (idle now, offline a moment later). The
    // same tag means the second REPLACES the first instead of stacking two
    // "X is calling" notifications for the same call.
    expect(ON_INVITE).toMatch(/tag: "relay-call"/);
    const paged = HOOKS.find((h) => h.includes("return { exists: false }")) ?? "";
    expect(paged).toMatch(/tag: "relay-call"/);
  });

  it("goes through the ONE push funnel, never a parallel sender", () => {
    // `sendPushToIdentity` is where the user's own master push switch is enforced
    // (v2.99.40) and where every transport fans out. A ring sender that bypassed
    // it would ignore a user who turned push off.
    expect(ON_INVITE).toContain("sendPushToIdentity(callee.id, {");
    for (const bypass of ["sendVoipRing", "sendFcmData", "sendExpoPush", "webpush.sendNotification"]) {
      expect(codeOnly(ON_INVITE), bypass).not.toContain(bypass);
    }
  });

  it("stays notification-only: it records no miss and writes no call state", () => {
    // The hook's contract since it was written. A notification hook that mutates
    // call state is one that can break call setup.
    const code = codeOnly(ON_INVITE);
    expect(code).not.toContain("recordMissedCall");
    expect(code).not.toContain("recordCallStart");
    expect(code).not.toContain("pendingRings");
  });

  it("cannot break call setup — every await is inside the try, and the push cannot reject", () => {
    // The relay calls this hook without awaiting and wraps it, but an unhandled
    // rejection is still noise, and a throw here must never surface as a failed
    // dial.
    expect(ON_INVITE).toMatch(/\}\)\.catch\(\(\) => 0\);/);
    expect(ON_INVITE).toMatch(/getPresenceForIds\(\[callee\.id\]\)\.catch\(\(\) => \[\]\)/);
    expect(ON_INVITE).toContain("/* swallow — the call still completes via the relay channel */");
  });

  it("the BLOCK gate still precedes both alerts", () => {
    // E4 (v2.98.6) exists because a blocked caller must not be able to pop the
    // callee's ring, and a push is the loudest form of that. Asserted here too,
    // not only in enumBlockHardening, because this release is what added the
    // second sender behind that gate.
    const block = ON_INVITE.indexOf("isNumberBlockedBy(callee.id, info.fromPin)");
    expect(block).toBeGreaterThan(-1);
    expect(block).toBeLessThan(ON_INVITE.indexOf("publishToIdentity("));
    expect(block).toBeLessThan(ON_INVITE.indexOf("sendPushToIdentity("));
  });
});

describe("v2.105.18 — the live branch really is what an idle callee gets", () => {
  /* THE PREMISE, PINNED. The fix only matters if an IDLE callee takes the LIVE
   * branch rather than the paged one — because if idle callees were already being
   * paged, the push would already have been sent and the owner's report would have
   * a different cause. The relay decides that on `reg.clients` + socket liveness,
   * which knows nothing about presence, so an idle-but-connected callee is rung
   * live. Pinned at source: the alternative is asserting a negative about a code
   * path, and this is the code that chooses.
   */
  it("reachability is decided by the registry and the socket, NOT by presence", () => {
    const at = RELAY.indexOf("const targetReachable =");
    expect(at).toBeGreaterThan(-1);
    const decl = RELAY.slice(at, RELAY.indexOf(";", at));
    expect(decl).toContain("pinIsAddressable(target)");
    expect(decl).toContain("target.socket.alive");
    // If this ever consulted presence, an idle callee would be PAGED instead and
    // this release's push would be redundant rather than the fix.
    expect(decl).not.toContain("idle");
    expect(decl).not.toContain("presence");
  });

  it("the live branch is the one that calls onInvite", () => {
    // So the hook this release changed is genuinely the one an idle callee hits.
    const ring = RELAY.indexOf('safeSend(callerSocket, { type: "ringing"');
    const invite = RELAY.indexOf("onInvite({");
    expect(ring).toBeGreaterThan(-1);
    expect(invite).toBeGreaterThan(ring);
  });
});
