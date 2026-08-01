import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * OFFLINE CALL BEHAVIOR — two owner directives that read as opposites, and the
 * one rule that satisfies both.
 *
 * v2.99.11, verbatim: "if the user is offline and you try to call him it should
 * NOT ring automatically. It will tell you he's offline but you can keep for him
 * an SMS message or voice message." That retired the v2.83 paging model.
 *
 * v2.105.12, verbatim: "build the incoming-call push path and restore ringing."
 *
 * Reconciled by making the decision depend on whether a push ACTUALLY LANDED:
 *   • a device was woken (`pushed > 0`) → PAGE. The dial is held open, the ring
 *     is redeliverable, and the caller sees "Reaching their phone…".
 *   • nothing was reachable → the v2.99.11 behaviour, UNCHANGED: a fast
 *     error{offline} (real identity) / error{nonexistent}, the miss recorded so
 *     it lands on the callee's History + (pref-gated) email, and the caller's
 *     leave-a-message card. Paging somebody no push can wake would put the
 *     caller on a status line for 65 seconds to no purpose, which is exactly
 *     what v2.99.11 was right to remove.
 *
 * So this file pins BOTH branches — the surviving v2.99.11 rule and the gate
 * that decides. The behavioural half lives in server/relayPaging.test.ts,
 * because a source read cannot tell you whether a ring survives to be answered.
 *
 * DB/router/DOM aren't reachable in the unit env, so — per repo precedent — the
 * cross-file wiring is pinned by source read. The pure protocol behavior is
 * exercised behaviorally in server/relayPaging.test.ts.
 */

describe("server: an unreachable callee still fails fast; a WOKEN one is paged", () => {
  const relay = read("server/relay.ts");
  const core = read("server/_core/index.ts");
  const branch = relay.slice(relay.indexOf("if (!targetReachable)"), relay.indexOf("if (!target) return;"));

  it("the slice really is the offline branch", () => {
    // Every assertion below reads this window; an anchor that moved would make
    // them pass vacuously (the fragility this repo has been bitten by repeatedly).
    expect(branch.length).toBeGreaterThan(500);
    expect(branch).toContain("onPageCallee(");
  });

  it("the room is created BEFORE the hook, so the push can carry something answerable", () => {
    // A ring whose payload names no room is a phone that rings and then cannot
    // connect. The ordering is the property; `roomId: ""` was the old shape.
    expect(branch).toMatch(/const pagingRoom = ensureDialRoom\(\);/);
    expect(branch).toMatch(/onPageCallee\(\{ calleePin: to, callerPin, callerName: me\.name, roomId: pagingRoom, video: wantVideo \}\)/);
    expect(branch.indexOf("const pagingRoom")).toBeLessThan(branch.indexOf("onPageCallee("));
  });

  it("PAGES only when a push actually landed", () => {
    expect(branch).toMatch(/if \(\(info\.pushed \?\? 0\) > 0\) \{/);
    // The ring must be redeliverable AND the caller must be recorded as ringing
    // this pin — deliverPendingRing refuses an entry the caller is not offering,
    // so one without the other pages into a void.
    expect(branch).toMatch(/callerNow\.ringing\.add\(to\);/);
    /* 2026-08-01 REWRITTEN TO THE PROPERTY. This froze the exact ONE-LINE object
       literal `{ from: callerPin, roomId: pagingRoom, video: wantVideo, at: Date.now() }`,
       so it broke the moment a field legitimately joined it (`pushed: true`, which is
       what tells the hang-up path this callee's handset needs a pushed cancel) while
       saying nothing about the rule it stands for: the pending ring must name THIS
       caller and THE ROOM the push just advertised, or `deliverPendingRing` hands the
       callee a ring into a room the caller is not in. */
    const set = branch.slice(branch.indexOf("reg.pendingRings.set(to, {"));
    expect(set.length, "the pending ring is gone").toBeGreaterThan(40);
    const record = set.slice(0, set.indexOf("});") + 3);
    expect(record).toMatch(/from: callerPin/);
    expect(record).toMatch(/roomId: pagingRoom/);
    expect(record).toMatch(/video: wantVideo/);
    expect(record).toMatch(/at: Date\.now\(\)/);
    /* And it must be MARKED as pushed. Without this the caller hanging up sends only
       the websocket `ring-cancel`, which by definition cannot reach a handset that
       was woken by a push — so it rings out its full 45s expiry into a dead call. */
    expect(record).toMatch(/pushed: true/);
    expect(branch).toMatch(/paging: true/);
    // NO miss is recorded on the paging branch — the call is still ringing, and a
    // missed-call row for a call about to be answered is simply wrong.
    const pagingStart = branch.indexOf("if ((info.pushed ?? 0) > 0)");
    const pagingEnd = branch.indexOf("Nothing could be woken");
    expect(pagingEnd).toBeGreaterThan(pagingStart);
    expect(branch.slice(pagingStart, pagingEnd)).not.toMatch(/onMissedCall/);
  });

  it("…and otherwise keeps the v2.99.11 fast error + recorded miss", () => {
    expect(branch).toMatch(/code: "offline",\s*\n\s*pin: to,(?:[\s\S]{0,900}?)verifiedPin\s*\n?\s*\? \(info\.name \|\| "They"\) \+ " is offline right now\."/);
    // v2.99.47 added `pin: to` here: a group dial drains its outstanding set BY
    // PIN, so a reply without one left the caller on "Ringing…" for 65s.
    expect(branch).toMatch(/code: "nonexistent", pin: to, message: "That number doesn't exist\."/);
    expect(branch).toMatch(/onMissedCall\?\.\(\{ calleePin: to, callerPin, callerName: me\.name, reason: "cancelled" \}\)/);
  });

  it("the paging ack withholds the NAME from an unverified caller", () => {
    // Same reasoning as the offline reply (v2.99.49): this branch is reachable by
    // the same number-space probe, so a named ack would be name-harvesting.
    expect(branch).toMatch(/name: callerNow\.verifiedPin \? info\.name : undefined/);
  });

  it("_core's onPageCallee wakes the device and REPORTS whether it reached one", () => {
    const hook = core.slice(core.indexOf("onPageCallee"), core.indexOf("onResolveDial"));
    expect(hook).toMatch(/kind: "incoming-call"/);
    expect(hook).toMatch(/sendPushToIdentity\(/);
    // `pushed` is the whole contract with the relay.
    expect(hook).toMatch(/return \{ exists: true, name: callee\.displayName \?\? undefined, pushed \}/);
    expect(hook).toMatch(/return \{ exists: false \}/);
    // A push failure must never break call setup — `pushed` stays 0 and the
    // caller is bounced honestly instead of the invite throwing.
    expect(hook).toMatch(/} catch \{/);
    // It goes through the ONE funnel that enforces the user's master push switch.
    // A parallel ring sender would bypass it however well-intentioned.
    expect(hook).not.toMatch(/sendVoipRing\(/);
  });
});

describe("v2.99.11 — client: offline raises the leave-a-message card", () => {
  const client = read("client/src/lib/relayClient.ts");

  it("error{offline} and error{nonexistent} are both fatal to a still-dialing 1:1 caller", () => {
    expect(client).toMatch(/m\.code === "offline".*m\.code === "nonexistent"/s);
  });

  it("only a provably-existing offline callee (server-error:offline) raises the voicemail/SMS card", () => {
    // NONEXISTENT is excluded — there's no thread to send a message to.
    const failDial = client.slice(client.indexOf("function failDial("), client.indexOf("function runConnSequence"));
    expect(failDial).toMatch(/reason === "no-answer" \|\| reason === "peer-rejected" \|\| reason === "server-error:offline"/);
    expect(failDial).toMatch(/onDialFailed\?\.\(\{ pin: d\.pin, name: d\.name \?\? null, reason \}\)/);
  });

  it("the retired paging status line is gone (a `ringing` ack now always means a live ring)", () => {
    expect(client).not.toMatch(/setCallStatus\("ringing", "Reaching their phone…"\)/);
  });
});

describe("v2.99.11 — the offline card offers BOTH a voice message and a written SMS", () => {
  const vm = read("client/src/app/VoicemailPrompt.tsx");

  it("names the reason honestly for an offline callee", () => {
    expect(vm).toMatch(/if \(reason === "server-error:offline"\) return "They're offline right now\.";/);
  });

  it("has a text composer that drops a written message into the DM thread", () => {
    expect(vm).toMatch(/async function sendText\(\)/);
    expect(vm).toMatch(/openThread\.mutateAsync\(\{ number: info\.pin \}\)/);
    expect(vm).toMatch(/sendMessage\.mutateAsync\(\{ conversationId: thread\.conversationId, kind: "text", body \}\)/);
    // …alongside the existing voice-message path.
    expect(vm).toMatch(/Leave a voice message/);
  });
});
