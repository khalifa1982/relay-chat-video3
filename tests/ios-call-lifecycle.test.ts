import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
/** Prose in these files names the very constructs under test; strip it. */
const codeOnly = (src: string) =>
  src
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\/\/|\/\*)/.test(l))
    .join("\n");

/* ────────────────────────────────────────────────────────────────────────────
 * 1. A hang-up push got the app KILLED.
 *
 * iOS 13+ terminates an app that returns from `didReceiveIncomingPushWith`
 * without reporting an incoming call to CallKit, and after repeated offences the
 * system stops delivering VoIP pushes to it at all — the app then never rings
 * again until it is reinstalled.
 *
 * The `call_cancel` branch called `reportCall(with:endedAt:reason:)`. Ending a
 * call is not reporting one. Worse, it was ending a call this process usually
 * had no record of: the interesting case is precisely the one where the app was
 * evicted between the ring and the hang-up, so `callIdToUUID` is empty and the
 * call being "ended" never existed. Zero reports, guaranteed termination.
 * ────────────────────────────────────────────────────────────────────────── */
describe("every VoIP push reports a call to CallKit", () => {
  const SRC = codeOnly(read("plugins/with-ios-voip-callkit.js"));

  it("a cancel for a call this process never saw still reports one", () => {
    const fn = SRC.slice(SRC.indexOf("private func handleCancelPush"));
    const body = fn.slice(0, fn.indexOf("\n  /// Remove a callId"));
    expect(body).toMatch(/reportNewIncomingCall\(with: callUUID, update: update\)/);
    // …and ends it immediately, so no ring is left on screen.
    expect(body).toMatch(/reportCall\(with: callUUID, endedAt: nil, reason: \.remoteEnded\)/);
  });

  it("the report comes first and the end happens in its completion", () => {
    const fn = SRC.slice(SRC.indexOf("callKitProvider?.reportNewIncomingCall(with: callUUID, update: update) { error in"));
    const cb = fn.slice(0, fn.indexOf("\n    }"));
    // Ending outside the callback can run before the report lands.
    expect(cb).toMatch(/self\.callKitProvider\?\.reportCall\(with: callUUID, endedAt: nil/);
    expect(cb).toMatch(/completion\(\)/);
  });

  it("completion() is called on every path, including the failure one", () => {
    const fn = SRC.slice(SRC.indexOf("private func handleCancelPush"));
    const body = fn.slice(0, fn.indexOf("\n  /// Remove a callId"));
    // Once for the known-call path, once inside the report completion. PushKit
    // holds the app alive until it is called.
    expect((body.match(/completion\(\)/g) ?? []).length).toBe(2);
    // The error is logged, not used to skip the teardown.
    expect(body).toMatch(/if let error = error \{/);
  });

  it("`wasReported` is read BEFORE uuid(for:) mints an entry", () => {
    // uuid(for:) stores the mapping it creates, so after that call every id
    // looks known and the unknown-call path would be dead code.
    const handler = SRC.slice(SRC.indexOf("public func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith"));
    const wasReportedAt = handler.indexOf("let wasReported = callIdToUUID[callId] != nil");
    const uuidAt = handler.indexOf("let callUUID = uuid(for: callId)");
    expect(wasReportedAt).toBeGreaterThan(-1);
    expect(uuidAt).toBeGreaterThan(-1);
    expect(wasReportedAt).toBeLessThan(uuidAt);
  });

  it("the old end-without-report shape is gone from the push handler", () => {
    const handler = SRC.slice(
      SRC.indexOf("public func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith"),
    );
    const branch = handler.slice(handler.indexOf('if pushType == "call_cancel"'), handler.indexOf("} else {"));
    expect(branch).toMatch(/handleCancelPush\(/);
    expect(branch).not.toMatch(/reportCall\(with: callUUID, endedAt: nil/);
  });

  it("the plugin still parses and loads", () => {
    // A backtick in a Swift doc comment terminates the JS template literal that
    // holds it — this repo has been bitten three times now.
    expect(() => require("../plugins/with-ios-voip-callkit.js")).not.toThrow();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Declining a cold-start ring was silently dropped.
 * ────────────────────────────────────────────────────────────────────────── */
describe("a CallKit action taken before the WebView is up is not lost", () => {
  const SRC = read("lib/voip-call-manager.ts");
  const CODE = codeOnly(SRC);

  it("end is queued when the WebView is not ready, exactly like answer", () => {
    // injectCallDeclined returns early when !isWebViewReady, and nothing retried:
    // the decline vanished and the caller rang on at somebody who had refused.
    expect(CODE).toMatch(/queueCallEvent\(\{ kind: "end", callId \}\)/);
    expect(CODE).toMatch(/queueCallEvent\(\{ kind: "answer", callId, mode \}\)/);
  });

  it("the didLoadWithEvents end branch queues too — those events are early by definition", () => {
    const early = CODE.slice(CODE.indexOf('name === "RNCallKeepPerformEndCallAction"'));
    expect(early.slice(0, 400)).toMatch(/queueCallEvent\(\{ kind: "end"/);
    expect(early.slice(0, 400)).not.toMatch(/injectCallDeclined\(callId\)/);
  });

  it("the queue is drained when the WebView reports ready", () => {
    expect(CODE).toMatch(/function flushPendingCallEvents\(\)/);
    const ready = CODE.slice(CODE.indexOf("export function onVoipWebViewReady()"));
    expect(ready.slice(0, 600)).toMatch(/flushPendingCallEvents\(\)/);
  });

  it("an answer that was later ended is dropped rather than replayed", () => {
    // Answering navigates the WebView; navigating only to immediately tell the
    // fresh page the call is over races the load.
    expect(CODE).toMatch(/const ended = new Set\(queued\.filter\(\(e\) => e\.kind === "end"\)\.map\(\(e\) => e\.callId\)\)/);
    expect(CODE).toMatch(/if \(ended\.has\(e\.callId\)\) continue;/);
  });

  it("the queue is bounded, so a wedged WebView cannot grow it forever", () => {
    expect(CODE).toMatch(/MAX_PENDING_CALL_EVENTS = \d+/);
    expect(CODE).toMatch(/pendingCallEvents\.shift\(\)/);
  });

  it("draining empties the queue first, so a re-entrant ready cannot double-fire", () => {
    const fn = CODE.slice(CODE.indexOf("function flushPendingCallEvents()"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body.indexOf("pendingCallEvents = []")).toBeGreaterThan(-1);
    expect(body.indexOf("pendingCallEvents = []")).toBeLessThan(body.indexOf("for (const e of queued)"));
  });

  it("the single-slot pendingCallAnswer is gone", () => {
    // One slot could only ever hold the newest answer and no end at all.
    expect(SRC).not.toMatch(/pendingCallAnswer/);
  });
});
