/**
 * A CALL THAT WAS ANSWERED AND NEVER CONNECTED MUST END, AND MUST SAY WHY.
 *
 * THE OWNER'S REPORT, with a screenshot: an outgoing voice call to a callee shown "Online now"
 * sat on "Securing connection…" for 00:17 with no error and no timeout, and the previous attempt
 * 27 seconds earlier had failed the same way. They ended it by hand.
 *
 * WHAT THE SCREENSHOT PROVES, before any speculation. `STATUS_LABEL.encrypting` is
 * "Securing connection…" and its ONLY setter is `runConnSequence`, whose only caller on an
 * outgoing dial is `onCalleeAnswered()`. So the callee answered. And the pre-connect dial card was
 * still up, so `markEstablished()` never ran: no media ever arrived.
 *
 * WHY NOTHING BOUNDED IT — two independent guarantees, both certain from the code:
 *
 *   1. `onCalleeAnswered()` calls `clearDialTimeout()`, cancelling the 65s no-answer backstop.
 *      Even had it not, that callback opens `if (!inCall || callAnswered) return;` — so it would
 *      have declined to fire anyway.
 *   2. the SFU join watchdog retired itself before the callee had even answered
 *      and on an OUTGOING dial the caller joins the SFU room at dial time, so `lkConnected` is
 *      already true when it first ticks at 4.5s. It retires itself before the callee has answered.
 *
 * So "we are in the room, they answered, no remote media" had no timer, no error, and no way out
 * but the End button. This file pins that it now does, and that the fix cannot mislabel the outcome.
 *
 * SOURCE-PINNED, and honest about it: this module is a ~7,000-line closure that acquires media and
 * opens a socket on init, so it cannot be imported and driven here. These assertions are chosen for
 * the cases where a plausible edit silently restores an unbounded wait.
 *
 * WHAT THIS DELIBERATELY DOES NOT CLAIM: the root cause of why media did not arrive. That is a
 * separate question — this bounds and names the failure either way.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "relayClient.ts"), "utf8");
/** Comment-stripped: this fix EXPLAINS in prose exactly what it must not do, and this repo has
 *  matched its own prose fifteen times. */
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function fnBody(name: string): string {
  const at = code.indexOf(`function ${name}(`);
  expect(at, `${name} must exist`).toBeGreaterThan(-1);
  let i = code.indexOf("{", at);
  let depth = 0;
  for (; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(at, i + 1);
    }
  }
  throw new Error(`unbalanced body for ${name}`);
}

describe("the answered-but-silent call is bounded", () => {
  it("a deadline is armed in the SAME function that cancels the 65s backstop", () => {
    /* Coverage has to pass from one to the other without a gap. Arming it anywhere else leaves a
       window in which the call is bounded by nothing — which is the bug. */
    const answered = fnBody("onCalleeAnswered");
    expect(answered).toMatch(/clearDialTimeout\(\)/);
    expect(answered).toMatch(/armEstablishDeadline\(\)/);
    expect(
      answered.indexOf("clearDialTimeout()") < answered.indexOf("armEstablishDeadline()"),
      "the hand-over must be in order",
    ).toBe(true);
  });

  it("it is armed only BEFORE establishment, so it cannot touch a live call", () => {
    /* A call that was live and dropped is the reconnect window's business
       (RECONNECT_WINDOW_MS), not this deadline's. */
    const answered = fnBody("onCalleeAnswered");
    expect(answered).toMatch(/if \(!establishedOnce\) \{/);
  });

  it("the deadline REALLY fires a failure, rather than only logging", () => {
    const arm = fnBody("armEstablishDeadline");
    expect(arm).toMatch(/failDial\(/);
    expect(arm).toMatch(/MEDIA_ESTABLISH_MS/);
  });

  it("it re-checks on fire instead of trusting the arm", () => {
    /* Twenty seconds is long enough for the call to have established, ended, or turned into
       something that is not a dial. A timer that acts on a world it last saw 20s ago is how a
       live call gets torn down by a stale fuse. */
    const arm = fnBody("armEstablishDeadline");
    expect(arm).toMatch(/if \(!inCall \|\| establishedOnce \|\| !outgoingDial\) return;/);
  });

  it("it is CLEARED the moment media is real", () => {
    expect(fnBody("markEstablished")).toMatch(/clearEstablishDeadline\(\)/);
  });

  it("…and on every teardown, so an ended call cannot fire a stale failure", () => {
    /* The sibling `clearDialTimeout` is cleared at two teardown points and carries a comment
       saying exactly why. This must be cleared at both of the same ones. */
    const clears = code.match(/clearEstablishDeadline\(\)/g) ?? [];
    expect(clears.length, "declaration + arm + established + 2 teardowns").toBeGreaterThanOrEqual(5);
    for (const anchor of ["clearDialTimeout(); ", "clearFailDial();\n      clearConnSeq();"]) {
      const at = code.indexOf(anchor);
      if (at < 0) continue;
      expect(
        code.slice(Math.max(0, at - 200), at + 300),
        `teardown near "${anchor.slice(0, 24)}" must clear the deadline`,
      ).toMatch(/clearEstablishDeadline\(\)/);
    }
  });
});

describe("the outcome is not mislabelled — they DID answer", () => {
  it("the reason is its own, not 'no-answer'", () => {
    /* Recording it as no-answer would write a false history row about somebody who picked up. */
    const arm = fnBody("armEstablishDeadline");
    expect(arm).toMatch(/"media-timeout"/);
    expect(arm, "they answered; this is not a no-answer").not.toMatch(/"no-answer"/);
  });

  it("and that reason is NOT voicemail-eligible", () => {
    /* `failDial` offers "leave a voice message" for a 1:1 that never connected because nobody
       picked up. Somebody who answered and whose audio failed is a different case, and offering to
       leave them a message would be the wrong offer. The eligible set is an explicit list — this
       reason must be absent from it. */
    const fail = fnBody("failDial");
    const cond = fail.slice(fail.indexOf("d && !d.group"), fail.indexOf("onDialFailed"));
    expect(cond, "the voicemail-eligible set must be reachable").toMatch(/no-answer/);
    expect(cond, "media-timeout must not be voicemail-eligible").not.toMatch(/media-timeout/);
  });

  it("the message says what actually failed", () => {
    const arm = fnBody("armEstablishDeadline");
    expect(arm).toMatch(/answered/i);
    expect(arm, "a generic 'try again' tells the caller nothing").not.toMatch(
      /check your connection/i,
    );
  });
});

describe("the status stops claiming a phase it may never have reached", () => {
  it("the flip to 'encrypting' takes its text from real transport state", () => {
    /* It used to announce "Securing connection…" on a 600ms timer with no relation to any DTLS or
       ICE state, so a stuck call reported a specific-sounding phase and the caller could not tell
       what had failed. */
    const run = fnBody("runConnSequence");
    expect(run).toMatch(/setCallStatus\("encrypting", establishingLabel\(\)\)/);
    expect(run, "the bare timer-driven claim is what this replaced").not.toMatch(
      /setCallStatus\("encrypting"\)\s*;/,
    );
  });

  it("the label is DERIVED, so a transport that is not securing anything can say so", () => {
    /* The original defect: a caller who had already joined an SFU room at dial time
       was told "Securing connection…", which was simply false and named the wrong
       problem — it was waiting for the other side's media. That branch went with the
       transport (v2.106.53), and the reason this is a FUNCTION rather than the bare
       constant is what survives: the claim CAN be false, so whichever transport
       comes next must be able to say something truer rather than inheriting a
       sentence about a phase it is not in. */
    const lbl = fnBody("establishingLabel");
    expect(lbl).toMatch(/STATUS_LABEL\.encrypting/);
    expect(SRC).toMatch(/setCallStatus\("encrypting", establishingLabel\(\)\)/);
  });

  it("…and it still says 'Securing connection' when that IS true", () => {
    /* On the mesh, or while the SFU room is still coming up, a transport really is in the ICE/DTLS
       phase. Replacing the wording everywhere would trade one wrong label for another. */
    const lbl = fnBody("establishingLabel");
    expect(lbl).toMatch(/return STATUS_LABEL\.encrypting;/);
  });

  it("the state is unchanged, so the styling is not collateral damage", () => {
    // `st-encrypting` drives the dial card's appearance; only the TEXT moved.
    expect(code).toMatch(/"st-calling", "st-ringing", "st-connecting", "st-encrypting"/);
  });
});

describe("the deadline is generous enough not to kill a slow-but-working call", () => {
  it("longer than the SFU family's own give-up, and well under the unanswered budget", () => {
    /* The SFU watchdog gives up on a room CONNECTION after ~16.5s (4.5s + 3x4s). A post-answer
       media wait must be at least as patient. And an UNANSWERED dial still gets its full 65s —
       this must not shorten that, because the two are different questions. */
    const m = code.match(/const MEDIA_ESTABLISH_MS = ([0-9_]+);/);
    expect(m, "the constant must be named, not inline").toBeTruthy();
    const ms = Number((m as RegExpMatchArray)[1].replace(/_/g, ""));
    expect(ms).toBeGreaterThanOrEqual(16_500);
    expect(ms).toBeLessThan(65_000);
  });

  it("the 65s no-answer backstop is untouched", () => {
    /* Different question, different budget. Shortening it here would make an unanswered call give
       up sooner as a side effect of fixing a connected one. */
    expect(fnBody("armDialTimeout")).toMatch(/\}, 65_000\)/);
  });
});
