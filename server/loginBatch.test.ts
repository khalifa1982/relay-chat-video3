/**
 * The sign-in screen batch (#120–#122), from the owner's 2026-07-29 message.
 *
 *   #120  Guest asks for the FULL name, the six-digit identity section moves ABOVE
 *         the card, tapping through reserves a number and reveals it, and Back is
 *         visible enough to find.
 *   #121  An email that already has an account says so and cannot be registered
 *         again; the email echoes your own number back — MASKED.
 *   #122  Move freely between the three ways in, each with a countdown.
 *
 * The rules that can be stated as functions are tested as functions; everything
 * else is a source pin, because the flow itself was driven end to end in a real
 * browser (four branches, 27 checks) and a unit test cannot repeat that.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { maskNumber } from "./v2routers";
import { signInMethodOptions, OTP_RESEND_SECONDS, APPROVAL_NUDGE_SECONDS } from "../client/src/app/LoginScreen";
import { codeOnly } from "./testing/codeOnly";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const LOGIN = read("client/src/app/LoginScreen.tsx");
const ROUTERS = read("server/v2routers.ts");
const CSS = read("client/src/index.css");

describe("#121 — the number is echoed back, and it is MASKED", () => {
  it("keeps only the leading group", () => {
    expect(maskNumber("777777")).toBe("777-•••");
    expect(maskNumber("235680")).toBe("235-•••");
  });

  it("never returns a dialable number", () => {
    // The property, not the format: whatever it returns must not contain six digits
    // in a row, or somebody who knows an email address could call you.
    for (const n of ["777777", "000001", "999999", "123456"]) {
      const out = maskNumber(n)!;
      expect(out).not.toMatch(/\d{6}/);
      expect(out.replace(/\D/g, "").length).toBeLessThan(6);
    }
  });

  it("answers null rather than guessing for anything that is not a 6-digit number", () => {
    // A wrong hint is worse than none — it would tell somebody they had reached the
    // wrong account.
    expect(maskNumber(null)).toBe(null);
    expect(maskNumber(undefined)).toBe(null);
    expect(maskNumber("")).toBe(null);
    expect(maskNumber("12345")).toBe(null);
    expect(maskNumber("1234567")).toBe(null);
    expect(maskNumber("77a777")).toBe(null);
  });

  it("the probe returns the field on BOTH branches, so a client never reads undefined", () => {
    const q = ROUTERS.slice(
      ROUTERS.indexOf("loginProbe: publicProcedure"),
      ROUTERS.indexOf("loginWithPin: publicProcedure"),
    );
    expect(q.length).toBeGreaterThan(400);
    expect(q).toMatch(/unregistered: true[^}]*numberHint: null/);
    expect(q).toMatch(/numberHint: await maskedNumberForUser\(u\.id\)/);
  });

  it("the read fails to null rather than breaking a sign-in", () => {
    const fn = ROUTERS.slice(
      ROUTERS.indexOf("async function maskedNumberForUser"),
      ROUTERS.indexOf("* Offline-message email"),
    );
    expect(fn).toMatch(/catch \{\s*\n\s*return null;/);
  });
});

describe("#121 — an existing address cannot be registered again", () => {
  const choose = LOGIN.slice(LOGIN.indexOf("function ChooseStep"), LOGIN.indexOf("function CodeBoxes"));
  it("the slice really is the step", () => {
    expect(choose.length).toBeGreaterThan(500);
    expect(choose).toMatch(/probeUnregistered/);
  });

  it("offers exactly ONE forward action, never both", () => {
    // Two buttons with one dimmed is what let somebody pick the branch that cannot
    // work; a control that is always going to refuse should not be there at all.
    const ctas = choose.match(/<Cta\b/g) ?? [];
    expect(ctas.length).toBe(3); // checking / register / log-in — one per branch
    expect(choose).toMatch(/p\.probeUnregistered === null \?/);
    expect(choose).toMatch(/\) : unreg \? \(/);
  });

  it("says out loud that the email already has an account", () => {
    expect(choose).toMatch(/already has a RELAY account/);
    expect(choose).toMatch(/can't be registered again/);
  });

  it("asserts nothing while the probe is still in flight", () => {
    expect(choose).toMatch(/Checking that address…/);
  });

  it("shows the masked number, and only for an address that HAS an account", () => {
    expect(choose).toMatch(/!unreg && p\.numberHint/);
    expect(choose).toMatch(/YOUR RELAY ID/);
  });

  it("the number is LTR and bidi-isolated", () => {
    const block = choose.slice(choose.indexOf("YOUR RELAY ID"));
    expect(block).toMatch(/dir="ltr"/);
    expect(block).toMatch(/unicodeBidi: "isolate"/);
  });
});

describe("#122 — every way in, from anywhere", () => {
  it("omits a method that cannot work rather than offering it disabled", () => {
    expect(signInMethodOptions(false, false)).toEqual(["code"]);
    expect(signInMethodOptions(true, false)).toEqual(["code", "pin"]);
    expect(signInMethodOptions(false, true)).toEqual(["code", "device"]);
    expect(signInMethodOptions(true, true)).toEqual(["code", "pin", "device"]);
  });

  it("the email code is always available, so the picker can never be empty", () => {
    for (const [a, b] of [[false, false], [true, false], [false, true], [true, true]] as const) {
      expect(signInMethodOptions(a, b)).toContain("code");
    }
  });

  it("a single option renders NO picker — one way in is not a choice", () => {
    const picker = LOGIN.slice(LOGIN.indexOf("function MethodPicker"), LOGIN.indexOf("/** The spec's panel shell"));
    expect(picker).toMatch(/if \(opts\.length < 2\) return null;/);
  });

  it("the picker is on the code, passcode AND waiting steps", () => {
    for (const [fn, next] of [
      ["function CodeStep", "* #122 — \"wait N seconds\""],
      ["function PinStep", "* Not in the spec — preserved. New-device approval"],
      ["function WaitingStep", ""],
    ] as const) {
      const start = LOGIN.indexOf(fn);
      expect(start).toBeGreaterThan(-1);
      const body = next ? LOGIN.slice(start, LOGIN.indexOf(next)) : LOGIN.slice(start);
      expect(body).toMatch(/<MethodPicker/);
    }
  });

  it("choosing the code method SENDS one — it never just navigates", () => {
    // A picker that walks to a code screen without mailing anything leaves somebody
    // waiting for a code nobody sent.
    const fn = LOGIN.slice(LOGIN.indexOf("function pickMethod"), LOGIN.indexOf("async function submitRegister"));
    expect(fn).toMatch(/void sendCode\(\);/);
    expect(fn).toMatch(/if \(m === "pin"\)/);
    expect(fn).toMatch(/if \(m === "device"\)/);
  });

  it("switching clears the previous method's error, via go()", () => {
    const fn = LOGIN.slice(LOGIN.indexOf("function pickMethod"), LOGIN.indexOf("async function submitRegister"));
    expect(fn.match(/go\("/g)?.length).toBe(2); // pin + device; the code path goes through sendCode
    const go = LOGIN.slice(LOGIN.indexOf("const go = useCallback"), LOGIN.indexOf("async function submitGuest"));
    expect(go).toMatch(/setError\(null\); setNotice\(null\)/);
  });

  it("both waits are 30 seconds, as asked", () => {
    expect(OTP_RESEND_SECONDS).toBe(30);
    expect(APPROVAL_NUDGE_SECONDS).toBe(30);
  });

  it("the countdown is keyed on WHEN the wait started, so a resend restarts it", () => {
    const fn = LOGIN.slice(LOGIN.indexOf("function useCountdown"), LOGIN.indexOf("/** How long before an emailed code"));
    expect(fn).toMatch(/\}, \[startedAt, seconds\]\);/);
    // Not waiting ⇒ no timer at all, so the picker's other states cost nothing.
    expect(fn).toMatch(/if \(startedAt == null\) \{ setLeft\(0\); return; \}/);
  });

  it("a resend re-arms the clock rather than leaving the old one running", () => {
    const fn = LOGIN.slice(LOGIN.indexOf("async function sendCode"), LOGIN.indexOf("function pickMethod"));
    expect(fn).toMatch(/setWaitStartedAt\(Date\.now\(\)\)/);
  });

  it("the retry is ABSENT during the countdown, not disabled", () => {
    const fn = LOGIN.slice(LOGIN.indexOf("function ResendRow"), LOGIN.indexOf("function RegisterStep"));
    expect(fn).toMatch(/if \(left > 0\) \{/);
    expect(fn).toMatch(/return \(\s*\n\s*<p/);
  });

  it("second-device approval is offered only once it has actually happened", () => {
    // It is not a client choice — it is what the server answers when a code verify
    // lands on an unrecognised device.
    expect(LOGIN).toMatch(/setApprovalPending\(true\)/);
    const verify = LOGIN.slice(LOGIN.indexOf("async function verifyCode"), LOGIN.indexOf("async function submitPin"));
    expect(verify).toMatch(/\?\.pending\)/);
  });

  it("a DECLINED approval says so and still offers a way in", () => {
    const w = LOGIN.slice(LOGIN.indexOf("function WaitingStep"));
    expect(w).toMatch(/status\.data\?\.status === "denied"/);
    expect(w).toMatch(/APPROVAL DECLINED/);
    expect(w).toMatch(/<MethodPicker/);
  });
});

describe("#120 — guest entry", () => {
  const guest = LOGIN.slice(LOGIN.indexOf("function GuestStep"), LOGIN.indexOf("function EmailStep"));
  it("asks for the FULL name", () => {
    expect(guest).toMatch(/YOUR FULL NAME/);
    expect(guest).toMatch(/aria-label="Full name"/);
    expect(guest).toMatch(/autoComplete="name"/);
  });

  it("says a number is reserved, and the CTA is the owner's own words", () => {
    expect(guest).toMatch(/reserved for you on the spot/);
    expect(guest).toMatch(/I am a guest — reserve my number/);
  });

  it("the reserved number is revealed matrix-style", () => {
    // This half already worked (v2.94.6) — pinned so the copy above cannot come to
    // promise a reveal that no longer happens.
    const fn = LOGIN.slice(LOGIN.indexOf("async function submitGuest"), LOGIN.indexOf("async function submitEmail"));
    expect(fn).toMatch(/if \(num\) setReveal\(\{ name, number: num \}\)/);
    expect(LOGIN).toMatch(/<MatrixReveal/);
  });
});

describe("#120 — the identity section moved above the card", () => {
  it("is mounted exactly ONCE", () => {
    // It used to sit below the card; a mount left in both places would print six
    // animated digits twice on one screen.
    expect(LOGIN.match(/<IdentitySection\b/g)?.length).toBe(1);
  });

  it("comes BEFORE the auth card", () => {
    const id = LOGIN.indexOf("<IdentitySection");
    const card = LOGIN.indexOf("<AuthCard");
    expect(id).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(-1);
    expect(id).toBeLessThan(card);
  });

  it("its height is constrained, because it is now charged against reaching the card", () => {
    // MEASURED: unconstrained, six 50px tiles wrapped to two rows and the note ran
    // to five lines, which put the access buttons BELOW THE FOLD at 320/360/375.
    expect(CSS).toMatch(/\.relay-idstrip-tile \{/);
    expect(CSS).toMatch(/width: clamp\(/);
    expect(CSS).toMatch(/@media \(max-width: 399px\) \{\s*\n\s*\.relay-idstrip-note \{ display: none; \}/);
    expect(LOGIN).toMatch(/className="relay-idstrip-tile"/);
    expect(LOGIN).toMatch(/className="relay-idstrip-note"/);
  });
});

describe("#120 — Back is findable", () => {
  const back = LOGIN.slice(LOGIN.indexOf("function BackLink"), LOGIN.indexOf("* #122 — seconds left"));
  it("is a bordered, accent-coloured control rather than grey micro-text", () => {
    expect(back).toMatch(/border: `1px solid \$\{accent\}99`/);
    expect(back).toMatch(/<ArrowLeft/);
    expect(back).toMatch(/fontWeight: 600/);
  });

  it("its glow animates OPACITY only, never box-shadow", () => {
    // It sits on the card's backdrop-filter surface — the most expensive host in the
    // app to repaint over (v2.99.86).
    expect(back).toMatch(/boxShadow: `0 0 18px/);
    expect(back).toMatch(/opacity: 0\.35/);
    const kf = CSS.slice(CSS.indexOf("@keyframes relayBackGlow"));
    const block = kf.slice(0, kf.indexOf("}", kf.indexOf("}") + 1) + 1);
    expect(block).toMatch(/opacity/);
    expect(block).not.toMatch(/box-shadow/);
  });

  it("is reduced-motion safe", () => {
    expect(back).toMatch(/motion-safe:\[animation:relayBackGlow/);
  });

  it("names where it goes", () => {
    expect(codeOnly(LOGIN)).toMatch(/label=\{step === "guest" \|\| step === "email" \? "Back" : "Back to email"\}/);
  });
});
