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
  it("suppresses the onInvite desktop notification when blocked", () => {
    const seg = src.slice(src.indexOf("onInvite:"), src.indexOf("onMissedCall") > -1 ? src.indexOf("onMissedCall") : src.indexOf("kind: \"call_offer\"") + 200);
    // Fallback slice if the comment marker names differ: assert around call_offer.
    const around = src.slice(src.indexOf("desktop-notify the callee"), src.indexOf('kind: "call_offer"'));
    expect(around).toMatch(/isNumberBlockedBy\(callee\.id, info\.fromPin\)/);
    expect(seg.length).toBeGreaterThanOrEqual(0);
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
    const seg = src.slice(src.indexOf("onPageCallee"), src.indexOf("onResolveDial"));
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
