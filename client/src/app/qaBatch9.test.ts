import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const DRAFT = read("client/src/app/draftStore.ts");
const AUTH = read("client/src/app/AuthPanel.tsx");

/**
 * v2.99.31 — heavy-QA sweep fixes, batch 9 (draft + auth edges).
 *
 *   M6 (MED): useDraft debounced the localStorage save 500ms and its
 *             conversation-change cleanup CLEARED the pending timer without
 *             flushing — so typing then switching threads within 500ms lost the
 *             draft. The cleanup (and pagehide/visibility) now FLUSH first.
 *   L2 (LOW): the approval poll's react-query cache kept a stale "denied", so a
 *             legitimate retry (new pending session) was instantly bounced back
 *             to email with a false "declined" before the server evaluated it.
 *             The cache is reset when (re)entering the waiting stage.
 *   L3 (LOW): the code input auto-fires verifyCode at 6 digits and a wrong code
 *             wasn't cleared, so correcting one digit re-fired and burned an OTP
 *             attempt (5-attempt budget). The code is now cleared on error.
 *
 * Source-pinned (no DOM/react-query harness here).
 */
describe("v2.99.31 QA M6 — draft flushes instead of dropping on thread switch", () => {
  it("useDraft has a flush() that writes the pending draft via the refs", () => {
    expect(DRAFT).toMatch(/function flush\(\)/);
    expect(DRAFT).toMatch(/saveDraftNow\(convRef\.current, draftRef\.current\)/);
  });
  it("the conversation-change cleanup flushes (not just clearTimeout)", () => {
    // the [conversationId] effect's cleanup calls flush()
    const eff = DRAFT.slice(DRAFT.indexOf("convRef.current = conversationId"), DRAFT.indexOf("convRef.current = conversationId") + 120);
    expect(eff).toMatch(/flush\(\)/);
  });
  it("also flushes on pagehide / visibilitychange (reload safety)", () => {
    expect(DRAFT).toMatch(/addEventListener\("pagehide", onHide\)/);
    expect(DRAFT).toMatch(/addEventListener\("visibilitychange", onHide\)/);
  });
});

describe("v2.99.31 QA L2/L3 — auth code + approval edges", () => {
  it("L2: resets the approval-status cache before entering the waiting stage", () => {
    const idx = AUTH.indexOf("utils.otpAuth.sessionApprovalStatus.reset()");
    expect(idx).toBeGreaterThan(0);
    // the reset sits immediately before setStage("waiting")
    expect(AUTH.slice(idx, idx + 120)).toMatch(/setStage\("waiting"\)/);
  });
  it("L3: verifyCode clears the code on a wrong-code error", () => {
    const fn = AUTH.slice(AUTH.indexOf("async function verifyCode"), AUTH.indexOf("async function verifyCode") + 2400);
    /* v2.106.84 — the message moved into the dictionary, so the anchor is the
       expression rather than the words. The PROPERTY is unchanged and is asserted
       below: the wrong-code catch also clears the field, so a correction is one
       fresh 6-digit entry rather than one server attempt burned per keystroke. */
    const catchIdx = fn.indexOf('setError(messageOf(err, t("auth.err.badCode")))');
    expect(catchIdx).toBeGreaterThan(0);
    expect(fn.slice(catchIdx, catchIdx + 600)).toMatch(/setCode\(""\)/);
  });
});
