import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Regression tests for the 2026-07-23 cross-surface re-check (E1–E4): the
 * "system-wide application" gap where the messages router missed the
 * directory-enumeration throttle (F5/S3–S5) and the S6 membership discipline,
 * plus server-side block enforcement on the call-notification path. DB/router
 * code isn't reachable in the unit env, so — per repo precedent — pin by source.
 */

describe("E1/E2 — message-initiation endpoints inherit the directory throttle", () => {
  const src = read("server/v2routers.ts");
  it("openThread calls directoryGate (existence oracle + name/avatar leak + inbox write)", () => {
    const seg = src.slice(src.indexOf("openThread: publicProcedure"), src.indexOf("openSelfThread:"));
    expect(seg).toMatch(/directoryGate\(ctx\)/);
  });
  it("createGroup calls directoryGate (existence oracle + forced group inbox write)", () => {
    const seg = src.slice(src.indexOf("createGroup: publicProcedure"), src.indexOf("conversationInfo:"));
    expect(seg).toMatch(/directoryGate\(ctx\)/);
  });
});

describe("E3 — typing is membership-gated (missed sibling of the S6 markRead fix)", () => {
  const src = read("server/v2routers.ts");
  it("only a participant may emit a typing indicator", () => {
    const seg = src.slice(src.indexOf("typing: publicProcedure"), src.indexOf("typing: publicProcedure") + 900);
    expect(seg).toMatch(/const participants = await getConversationParticipantIds/);
    expect(seg).toMatch(/if \(!participants\.includes\(me\.id\)\) return \{ ok: true \};/);
  });
});

describe("E4 — a blocked caller cannot notify the callee's devices", () => {
  const src = read("server/_core/index.ts");
  it("imports the block helper", () => {
    expect(src).toMatch(/isNumberBlockedBy/);
  });
  /*
   * THE HOOKS ARE SLICED BY CODE, NOT BY COMMENT TEXT (rewritten v2.105.18).
   *
   * Both of the assertions below used to anchor on prose — `"onInvite:"`,
   * `"desktop-notify the callee"`, `src.indexOf("onPageCallee")` — because the
   * hooks are ANONYMOUS positional arrows passed to `attachRelay`, so there is no
   * `onPageCallee:` identifier in the code to find. That made them fragile in the
   * two ways this repo keeps re-learning:
   *
   *   • Rewording a comment collapsed a slice to `""` and the assertion failed for
   *     a reason unrelated to blocking (v2.105.18 reworded the onInvite comment
   *     when the idle push landed, and this went red on an intact gate).
   *   • Writing `onPageCallee` inside an EARLIER hook's comment moved the anchor
   *     backwards, so the window spanned two hooks and compared one hook's gate
   *     against another hook's send.
   *
   * Splitting on `async (info) => {` gives the hooks positionally, which no
   * comment can move, and each region is then identified by its own unique CODE.
   */
  const hookStarts: number[] = (() => {
    const out: number[] = [];
    let i = src.indexOf("attachRelay(");
    expect(i).toBeGreaterThan(-1);
    for (;;) {
      const j = src.indexOf("async (info) => {", i);
      if (j < 0) break;
      out.push(j);
      i = j + 1;
    }
    return out;
  })();
  const hook = (n: number) => src.slice(hookStarts[n], hookStarts[n + 1] ?? src.length);

  it("finds the relay hooks positionally, so no comment can move the window", () => {
    // If this ever fails, every assertion below is reading the wrong region — so
    // it is asserted FIRST rather than left to produce a confusing failure later.
    expect(hookStarts.length).toBeGreaterThanOrEqual(3);
    expect(hook(0)).toContain('kind: "call_offer"'); // onInvite
    expect(hook(1)).toContain("recordMissedCall("); // onMissedCall
  });

  it("suppresses BOTH of onInvite's alerts when blocked — the SSE hint and the push", () => {
    /* v2.105.18 made this hook push as well as fan an SSE hint, because a
       MINIMISED callee cannot act on the hint. So the gate now has to precede TWO
       senders, and asserting only the first would leave the louder one open. */
    const seg = hook(0);
    expect(seg).toMatch(/isNumberBlockedBy\(callee\.id, info\.fromPin\)/);
    const gate = seg.indexOf("isNumberBlockedBy");
    const hint = seg.indexOf("publishToIdentity(");
    const push = seg.indexOf("sendPushToIdentity(");
    expect(gate).toBeGreaterThan(-1);
    expect(hint).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(hint);
    expect(gate).toBeLessThan(push);
  });

  it("a BLOCKED caller cannot wake the callee's phone through onPageCallee", () => {
    // THIS PIN EARNED ITS KEEP IN v2.105.12. E4's fix put a block gate in
    // onPageCallee; v2.99.11 then deleted the push, and the assertion was
    // rewritten to "there is no push here" — which made the pin pass for a
    // reason unrelated to blocking. Restoring the incoming-call push in
    // v2.105.12 therefore re-opened the bypass, and this test went red: a
    // blocked person waking a locked phone with a full-screen CallKit ring is
    // the loudest possible form of the very thing E4 closed.
    //
    // Pinned as the GATE and its POSITION, not as the absence of a sender, so it
    // cannot go quiet again the next time the push moves.
    // Located by its OWN code — the `{exists}` verdict only this hook returns —
    // and BOUNDED by the hook boundaries, so it can neither be moved by a comment
    // nor run past its own function (the unbounded-slice trap).
    const idx = hookStarts.findIndex((_, n) => hook(n).includes("return { exists: false }"));
    expect(idx, "found the onPageCallee hook").toBeGreaterThan(-1);
    const seg = hook(idx);
    expect(seg).toMatch(/isNumberBlockedBy\(callee\.id, info\.callerPin\)/);
    // The gate must precede the send, or it decides nothing.
    const gate = seg.indexOf("isNumberBlockedBy");
    const send = seg.indexOf("sendPushToIdentity(");
    expect(gate).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(send);
    // …and the refusal must be INDISTINGUISHABLE from an ordinary unreachable
    // callee (`pushed: 0` ⇒ the relay's normal "they're offline"), or the reply
    // becomes an oracle for having been blocked.
    expect(seg).toMatch(/return \{ exists: true, name: callee\.displayName \?\? undefined, pushed: 0 \}/);
    expect(seg).toMatch(/return \{ exists: false \}/);
  });
});
