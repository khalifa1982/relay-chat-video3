import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * v2.99.11 — OFFLINE CALL BEHAVIOR (owner directive, verbatim): "if the user is
 * offline and you try to call him it should NOT ring automatically. It will tell
 * you he's offline but you can keep for him an SMS message or voice message."
 *
 * The v2.83 PAGING model (keep the dial alive on "Reaching their phone…", push a
 * full-screen incoming-call ring to wake the pocketed device, redeliver the ring
 * when the app opens) is RETIRED for a cold offline dial. Now:
 *   • the server resolves the callee identity and returns a FAST error{offline}
 *     (real identity) / error{nonexistent} — no keep-alive, no auto-ring;
 *   • the miss is recorded so it lands on the callee's History + notification /
 *     (pref-gated) email when they return;
 *   • the caller's client raises the leave-a-message card (voice OR text) for a
 *     provably-existing offline identity.
 *
 * DB/router/DOM aren't reachable in the unit env, so — per repo precedent — the
 * cross-file wiring is pinned by source read. The pure protocol behavior is
 * exercised behaviorally in server/relayPaging.test.ts.
 */

describe("v2.99.11 — server: offline dial is a fast error, not a paged keep-alive", () => {
  const relay = read("server/relay.ts");
  const core = read("server/_core/index.ts");

  it("the offline branch resolves the identity via onPageCallee and returns error{offline}/error{nonexistent}", () => {
    const branch = relay.slice(relay.indexOf("if (!targetReachable)"), relay.indexOf("if (!target) return;"));
    // Resolve identity, then a fast honest error — NO ensureDialRoom / pendingRings.
    expect(branch).toMatch(/onPageCallee\(\{ calleePin: to, callerPin, callerName: me\.name, roomId: "", video: wantVideo \}\)/);
    expect(branch).toMatch(/code: "offline",\s*\n\s*message: \(info\.name \|\| "They"\) \+ " is offline right now\."/);
    expect(branch).toMatch(/code: "nonexistent", message: "That number doesn't exist\."/);
    // The miss is recorded for a real identity (History + email-on-return).
    expect(branch).toMatch(/onMissedCall\?\.\(\{ calleePin: to, callerPin, callerName: me\.name, reason: "cancelled" \}\)/);
    // No paging keep-alive: the retired ack is gone.
    expect(branch).not.toMatch(/paging: true/);
    expect(branch).not.toMatch(/ensureDialRoom\(\)/);
  });

  it("_core's onPageCallee is a pure identity resolver — no incoming-call push wake", () => {
    const hook = core.slice(core.indexOf("onPageCallee"), core.indexOf("onResolveDial"));
    expect(hook).not.toMatch(/kind: "incoming-call"/);
    expect(hook).not.toMatch(/sendPushToIdentity\(/);
    expect(hook).toMatch(/return \{ exists: true, name: callee\.displayName/);
    expect(hook).toMatch(/return \{ exists: false \}/);
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
