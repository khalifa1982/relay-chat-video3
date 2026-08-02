/**
 * BOARD 5d — THE SIGN-IN METHOD SWITCHER (AuthPanel).
 *
 * The frame draws the three ways in as a list of rows with the current one lit.
 * The rows are the easy half; the properties worth pinning are the ones that made
 * this frame necessary in the first place:
 *
 *   1. A METHOD THAT CANNOT WORK IS OMITTED, NEVER SHOWN DISABLED. That is the
 *      board's rule and the v2.103.3 rule, and it is the whole reason the picker
 *      cannot just render three static rows.
 *   2. THE OFFER RULE HAS EXACTLY ONE IMPLEMENTATION. `LoginScreen` already owns
 *      it (#122). A second copy here is how two sign-in surfaces come to disagree
 *      about which methods exist — one offering a control that always refuses, the
 *      other hiding one that works. This repo has paid for that twice already.
 *   3. NO WAY IN IS A DEAD END. Before this, the code step had no switcher at all.
 *
 * WHAT THIS DOES NOT PROVE, said plainly: nothing here is measured. `AuthPanel` is
 * mounted from three places behind an identity and a dozen tRPC queries, and its
 * styles live in an inline block rather than the built stylesheet — the same
 * situation `registerSheetFrame.test.ts` records for board 2e. Nobody has opened
 * this picker on a phone. What is proven is the offer rule (behaviourally, against
 * the real shared function) and the wiring.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { signInMethodOptions } from "./LoginScreen";

/* Resolved from this file's own location — never a machine-specific absolute path,
   which passes locally and can never pass on a CI runner (v2.99.60). */
const ROOT = resolve(__dirname, "../../..");
const PATH = "client/src/app/AuthPanel.tsx";
const SRC = readFileSync(resolve(ROOT, PATH), "utf8");
const CODE = codeOnly(SRC);

/** The picker component's own body, bounded by the next declaration rather than a
 *  fixed character count — a fixed slice silently shrinks as the code above it
 *  grows and then asserts nothing (the recurring v2.99.78 fragility). */
const SWITCHER = (() => {
  const a = CODE.indexOf("function MethodSwitcher");
  expect(a, "the switcher must exist").toBeGreaterThan(0);
  const b = CODE.indexOf("export function AuthPanel", a);
  expect(b, "the switcher's end anchor must FOLLOW its start").toBeGreaterThan(a);
  const s = CODE.slice(a, b);
  expect(s.length, "the switcher slice must be real").toBeGreaterThan(200);
  return s;
})();

/** One stage's JSX, bounded by the next stage guard (or the end of the render). */
function stageBlock(stage: string): string {
  const a = CODE.indexOf(`{stage === "${stage}" && (`);
  expect(a, `stage ${stage} must be rendered`).toBeGreaterThan(0);
  const next = CODE.indexOf("{stage === ", a + 10);
  const s = next > a ? CODE.slice(a, next) : CODE.slice(a);
  expect(s.length, `the ${stage} slice must be real`).toBeGreaterThan(120);
  return s;
}

describe("board 5d — a method that cannot work is omitted, never disabled", () => {
  it("the offer rule really does omit, driven rather than read", () => {
    // The property the frame's rule states, over the whole truth table. Driven
    // against the SAME function the sheet imports, so this cannot pass for a
    // lookalike.
    expect(signInMethodOptions(false, false)).toEqual(["code"]);
    expect(signInMethodOptions(true, false)).toEqual(["code", "pin"]);
    expect(signInMethodOptions(false, true)).toEqual(["code", "device"]);
    expect(signInMethodOptions(true, true)).toEqual(["code", "pin", "device"]);
  });

  it("the sheet reaches that rule instead of re-deriving it", () => {
    // The load-bearing assertion of this file. Two implementations of "which ways
    // in do we offer" is how the two sign-in surfaces drift apart, and the drift
    // is invisible until somebody is offered a method that refuses them.
    expect(CODE).toMatch(
      /import\s*\{\s*signInMethodOptions\s*,\s*type SignInMethod\s*\}\s*from\s*"\.\/LoginScreen"/,
    );
    expect(SWITCHER).toMatch(/signInMethodOptions\(hasPin,\s*hasPending\)/);
    // ...and carries no second copy of the list-building it would replace.
    expect(SWITCHER).not.toMatch(/"pin"\s*\]\s*:\s*\[\s*\]/);
    expect(SWITCHER).not.toMatch(/"device"\s*\]\s*:\s*\[\s*\]/);
  });

  it("a LOCKED passcode does not count as having one", () => {
    // `loginProbe` reports a spent-attempt account as locked (v2.99.47) and
    // `loginWithPin` refuses it — so offering that row would be exactly the
    // control that can only ever refuse. The locked NOTICE already points at the
    // email code, which is the way back in.
    expect(CODE).toMatch(/setProbeHasPin\(Boolean\(p\.hasPin\)\s*&&\s*!p\.locked\)/);
    // An unregistered address has nothing either.
    expect(CODE).toMatch(/p\.unregistered\)\s*\{[^}]*setProbeHasPin\(false\)/);
  });

  it("second-device approval appears only once the SERVER has parked a session", () => {
    // It is not a client choice. The only thing that may set it is the pending
    // answer from verifyOtp; a declined session takes the row away again.
    const setsTrue = CODE.match(/setApprovalPending\(true\)/g) ?? [];
    expect(setsTrue.length, "exactly one thing may make the device row real").toBe(1);
    const verify = CODE.slice(
      CODE.indexOf("async function verifyCode"),
      CODE.indexOf("async function resend"),
    );
    expect(verify).toMatch(/\?\.pending\)/);
    expect(verify).toMatch(/setApprovalPending\(true\)/);
    expect(CODE).toMatch(/s === "denied"[\s\S]{0,220}setApprovalPending\(false\)/);
  });

  it("one way in is not a choice — a single option renders nothing", () => {
    expect(SWITCHER).toMatch(/if \(opts\.length < 2\) return null;/);
  });
});

describe("board 5d — no way in is a dead end", () => {
  it("the picker is on the code, passcode AND waiting steps — and is UNGATED", () => {
    // The code step is the one that had NO switcher at all: somebody who reached
    // it and then remembered their passcode had to go Back and be re-probed.
    //
    // ASSERTING THE ELEMENT IS PRESENT IS NOT ENOUGH, and a mutation proved it:
    // wrapping the mount in `{false && …` leaves the text exactly where it was, so
    // a bare `toMatch(/<MethodSwitcher/)` stayed green while the dead end was
    // back. That is the pin-the-presence-not-the-property class this repo keeps
    // rediscovering. The real property is that the mount is UNCONDITIONAL — the
    // picker decides its own visibility (`opts.length < 2`), so a gate at the call
    // site would be a second, rival decision.
    for (const s of ["code", "pin", "waiting"]) {
      const block = stageBlock(s);
      expect(block, `stage ${s} offers no way to switch`).toMatch(/<MethodSwitcher/);
      expect(block, `stage ${s} gates its switcher`).toMatch(/^\s*<MethodSwitcher$/m);
      expect(block, `stage ${s} has a constant-false gate`).not.toMatch(/false\s*&&/);
    }
  });

  it("the passcode step keeps its email-code escape, now as a row", () => {
    // The property v2.87 owed a person who has forgotten their passcode. It must
    // survive the one-off button being folded into the picker.
    const pin = stageBlock("pin");
    expect(pin).toMatch(/current="pin"/);
    // `hasPin` is asserted, not passed through: standing on this step IS the
    // evidence there is one, and the picker hides itself below two options — so a
    // false here would leave this step with no exit at all.
    expect(pin).toMatch(/\n\s*hasPin\n/);
    expect(CODE).toMatch(/async function pinToEmailCode/);
  });

  it("switching to the code row SENDS one — it never just navigates", () => {
    // A picker that walks to a code screen without mailing anything leaves
    // somebody waiting for a code nobody sent.
    const fn = CODE.slice(
      CODE.indexOf("async function pickMethod"),
      CODE.indexOf("async function submitSetup"),
    );
    expect(fn.length).toBeGreaterThan(80);
    expect(fn).toMatch(/if \(m === "pin"\)/);
    expect(fn).toMatch(/if \(m === "device"\)/);
    // ...through the SAME sender the passcode step has always used, so there is
    // one place a code is requested rather than two that can diverge.
    expect(fn).toMatch(/await pinToEmailCode\(\)/);
    expect(fn).toMatch(/setError\(null\)/);
  });

  it("changing the address drops what the probe learned about the old one", () => {
    // Back is how the email is changed. A picker row describing another account's
    // passcode, or another account's pending session, would be worse than none.
    const back = CODE.slice(CODE.indexOf('aria-label={t("auth.back")}') - 700, CODE.indexOf('aria-label={t("auth.back")}'));
    expect(back).toMatch(/setProbeHasPin\(false\)/);
    expect(back).toMatch(/setApprovalPending\(false\)/);
    expect(back).toMatch(/setCodeSent\(false\)/);
  });
});

describe("board 5d — the switch replaced the one-off exits rather than joining them", () => {
  it("the passcode step no longer carries a separate email-code BUTTON", () => {
    // Two ways to do one thing is dead weight, and the harder one to find wins
    // nothing (the v2.106.41 rule). The sentence itself survives as the code row's
    // subtitle, so nothing was taken away.
    const pin = stageBlock("pin");
    expect(pin).not.toMatch(/<Button[^>]*onClick=\{pinToEmailCode\}/);
    expect(CODE).toMatch(/t\("auth\.emailCodeInstead"\)/);
  });

  it("the waiting step no longer carries a separate use-your-PIN BUTTON", () => {
    const w = stageBlock("waiting");
    expect(w).not.toMatch(/\{t\("auth\.usePinInstead"\)\}\s*<\/Button>/);
    // The copy survives as the passcode row's subtitle — which also keeps the key
    // read, so folding the button in cannot orphan it (dictCoverage).
    expect(SWITCHER).toMatch(/t\("auth\.usePinInstead"\)/);
  });

  it("the waiting step keeps its Cancel, which is a different act", () => {
    // Cancel abandons the sign-in; the picker changes method. Folding one into the
    // other would remove the only way to back out.
    expect(stageBlock("waiting")).toMatch(/t\("common\.cancel"\)/);
  });

  it("a passcode-less account is never told to use a passcode", () => {
    // `auth.waitStalled` ends "you can sign in with your 4-digit PIN instead",
    // which is FALSE for an account with none — and the button beneath it used to
    // render unconditionally, so such a person was pointed at a pad the server
    // refuses. This is the fix, not a restyle.
    expect(stageBlock("waiting")).toMatch(
      /probeHasPin \? t\("auth\.waitStalled"\) : t\("login\.passcodeNoApproval"\)/,
    );
  });
});

describe("board 5d — the countdown and the retry survive", () => {
  it("the resend control and its countdown are untouched", () => {
    const code = stageBlock("code");
    expect(code).toMatch(/onClick=\{resend\}/);
    expect(code).toMatch(/disabled=\{resendIn > 0\}/);
    expect(code).toMatch(/t\("auth\.resendIn", \{ seconds: resendIn \}\)/);
    // The 1Hz tick that drives it.
    expect(CODE).toMatch(/setResendIn\(\(s\) => \(s > 0 \? s - 1 : 0\)\)/);
  });

  it("the countdown is never stated twice on one screen", () => {
    // The frame puts it on the code row; this sheet also has a dedicated Resend
    // button carrying the same sentence. So the row shows it only when the code
    // row is NOT the current method — where it is new information ("a code is
    // already out, and when you could ask for another").
    expect(SWITCHER).toMatch(/k === "code" && !on && resendIn > 0/);
  });

  it("the device row shows a live dot, not a countdown to nothing", () => {
    // The frame's "1:52" counts down to a retry. Re-asking the other device means
    // re-sending the code — which is the code row — so a second timer here would
    // be a promise this sheet does not keep.
    expect(SWITCHER).toMatch(/k === "device" && <span aria-hidden className="rauth-method-dot"/);
    expect(SWITCHER).not.toMatch(/approvalWait|APPROVAL_NUDGE/);
  });

  it("it does not claim that switching cancels the pending code, because it does not", () => {
    // The frame's footer reads "Codes expire after 10 minutes · switching methods
    // cancels the pending code". The first half is true (OTP_TTL_MS is 10 min);
    // the second is FALSE here — nothing invalidates a prior code, and v2.99.81
    // (F2) records that superseding only SHADOWS. Shipping the sentence would be a
    // claim the app cannot keep, so it is not shipped. The expiry is not restated
    // either: `OTP_TTL_MS` is server-only, so a client-side "10 minutes" would be
    // an unpinnable literal free to drift from the constant it describes.
    expect(CODE).not.toMatch(/cancels the pending code/i);
    expect(CODE).not.toMatch(/expire after 10 minutes/i);
  });
});

describe("board 5d — the frame's own values", () => {
  const STYLE = (() => {
    const a = SRC.indexOf("<style>{`");
    const b = SRC.indexOf("</style>", a);
    expect(b).toBeGreaterThan(a);
    return SRC.slice(a, b);
  })();

  it("the lit row is the accent tint, hairline and 3px ring", () => {
    const on = STYLE.slice(STYLE.indexOf(".rauth-method-on"), STYLE.indexOf(".rauth-method-off"));
    expect(on.length).toBeGreaterThan(60);
    expect(on).toMatch(/background:\s*rgba\(var\(--rb-rgb[^)]*\),\s*\.1\)/);
    expect(on).toMatch(/border:\s*1px solid rgba\(var\(--rb-rgb[^)]*\),\s*\.45\)/);
    expect(on).toMatch(/box-shadow:\s*0 0 0 3px rgba\(var\(--rb-rgb[^)]*\),\s*\.1\)/);
  });

  it("the icon tile is the frame's 36px accent square", () => {
    const ico = STYLE.slice(
      STYLE.indexOf(".rauth-method-ico"),
      STYLE.indexOf(".rauth-method-text"),
    );
    expect(ico).toMatch(/width:\s*36px;\s*height:\s*36px/);
    expect(ico).toMatch(/border-radius:\s*12px/);
    // The glyph inherits this as currentColor, and the fallback is a LITERAL —
    // var(--rb, var(--rb)) is a cycle the browser drops, leaving no accent at all.
    expect(ico).toMatch(/color:\s*var\(--rb,\s*#[0-9A-Fa-f]{6}\)/);
  });

  it("the row can shrink, so a long subtitle cannot push the countdown off it", () => {
    // A flex child defaults to min-width:auto and refuses to shrink below its
    // content — the same trap that has bitten this repo's layouts repeatedly.
    expect(STYLE).toMatch(/\.rauth-method-text \{[^}]*min-width:\s*0/);
    expect(STYLE).toMatch(/\.rauth-method-meta \{[^}]*flex-shrink:\s*0/);
  });

  it("the pulse is motion-gated and namespaced", () => {
    // A keyframe declared in a component-local block is GLOBAL by construction, so
    // the property is that its name cannot collide.
    expect(STYLE).toMatch(/@keyframes rauthPulse/);
    expect(STYLE).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.relay-auth \.rauth-method-dot \{ animation: rauthPulse/,
    );
  });

  it("no presence green reaches the picker — green means ONLINE", () => {
    expect(SWITCHER).not.toMatch(/relay-online|emerald|#34d399|#10b981|#22c55e/);
  });
});
