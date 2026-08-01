/**
 * RELAY login & registration redesign (RELAY_LOGIN_HANDOFF.md).
 *
 * Two kinds of check here, deliberately:
 *
 *   • BEHAVIOURAL for the pure logic the page depends on — the name splitter,
 *     the id formatter, the email rule, and the background's device tiering.
 *     These can actually be wrong at runtime.
 *   • SOURCE PINS for the spec's own values — the copy the owner signed off, the
 *     tokens, and (most importantly) the capabilities the spec does NOT mention
 *     but which must survive the redesign. A redesign that silently dropped the
 *     PIN pad or the guest-recovery card would look fine and lock people out;
 *     that is exactly the class of loss worth pinning.
 */
import { describe, it, expect } from "vitest";
import { copyOnScreen, whyCopyMissing } from "../../../server/testing/copyOnScreen";
import fs from "node:fs";
import path from "node:path";
import { splitDisplayName, fmtId, EMAIL_RE, T } from "./LoginScreen";
import { RELAY_PALETTE, RELAY_ACCENT, RELAY_BUSINESS_GOLD } from "@/lib/relayBackground";

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), "utf8");
/** Source with comments removed. A pin that greps raw source can match the very
 *  comment explaining why the thing is absent — which is how a test ends up
 *  asserting its own prose instead of the code. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const SCREEN = read("./LoginScreen.tsx");
const BG = read("../lib/relayBackground.ts");
const GATE = read("./OnboardingGate.tsx");

/* ── behavioural ──────────────────────────────────────────────────────────── */

describe("display-name splitting (spec asks for ONE name field, server wants two)", () => {
  it("splits on the FIRST space so surnames keep their spaces", () => {
    expect(splitDisplayName("Alex Mercer")).toEqual({ firstName: "Alex", lastName: "Mercer" });
    expect(splitDisplayName("Ada van der Berg")).toEqual({ firstName: "Ada", lastName: "van der Berg" });
  });
  it("a single word is a mononym, not an error", () => {
    expect(splitDisplayName("Prince")).toEqual({ firstName: "Prince", lastName: "" });
  });
  it("collapses runs of whitespace and trims", () => {
    expect(splitDisplayName("  Alex   Mercer  ")).toEqual({ firstName: "Alex", lastName: "Mercer" });
  });
});

describe("six-digit id formatting (spec §3: `### ###`)", () => {
  it("formats a real id", () => expect(fmtId("601586")).toBe("601 586"));
  it("passes anything else through untouched", () => {
    expect(fmtId("60158")).toBe("60158");
    expect(fmtId("")).toBe("");
  });
});

describe("email rule is the spec's exact regex", () => {
  it("accepts ordinary addresses", () => {
    expect(EMAIL_RE.test("a@b.co")).toBe(true);
    expect(EMAIL_RE.test("alex.mercer+relay@example.org")).toBe(true);
  });
  it("rejects the shapes the spec's regex rejects", () => {
    for (const bad of ["", "a", "a@b", "a b@c.d", "@b.co", "a@.co"]) {
      expect(EMAIL_RE.test(bad), bad).toBe(false);
    }
  });
});

describe("background palette + tokens match the spec", () => {
  it("carries all twelve cycling colours, in order", () => {
    expect(RELAY_PALETTE).toHaveLength(12);
    expect(RELAY_PALETTE[0]).toBe("#35e0b4");
    expect(RELAY_PALETTE[11]).toBe("#8fd94f");
  });
  it("accent and business gold are the spec's", () => {
    expect(RELAY_ACCENT).toBe("#35e0b4");
    expect(RELAY_BUSINESS_GOLD).toBe("#f0b45a");
    expect(T.accent).toBe("#35e0b4");
    expect(T.gold).toBe("#f0b45a");
    expect(T.bg).toBe("#04070a");
    expect(T.onAccent).toBe("#04211a");
  });
});

/* ── the spec's copy, verbatim ────────────────────────────────────────────── */

describe("every string the owner signed off is on the page", () => {
  /* THREE ENTRIES REWRITTEN TO THE PROPERTY IN #120-#122, because the owner has
     since changed the copy they froze. Each is now a rule rather than a sentence:
       - the tagline named both paths and ENDED with "register your permanent
         six-digit ID", which the identity heading — moved directly beneath it —
         now says outright, so it was cut for repetition and for the three wrapped
         lines it cost above the card at 320px;
       - the guest label said DISPLAY NAME and the owner asked for the FULL name;
       - the guest CTA said "Enter as guest" and now says what it actually does,
         which is reserve a number.
     Frozen as literals they would have forbidden exactly what was asked for while
     saying nothing about whether the screen still offers both ways in. */
  const COPY = [
    "CHOOSE YOUR ACCESS",
    "Just a display name",
    "Login / register with email",
    "Full name — e.g. Alex Mercer",
    "REGISTERED ACCESS · EMAIL",
    "ACCOUNT TYPE",
    "COMING SOON",
    "Business accounts bring team lines, shared numbers and an admin console",
    "Existing users log in · new users register a permanent six-digit ID",
    "SIGN-IN CODE",
    "We sent a 6-digit code to",
    "Verify & sign in",
    "PERMANENT DISPLAY NAME",
    "Full name — shown to everyone",
    "This name is permanent — it can never be changed.",
    "Create private account",
    "Guest sessions end when you close your browser",
    "One encrypted line for everything — talk, see and type with the same people, at once.",
    "Your identity is six digits.",
    "Not your email. Not your phone. Not even your name.",
    "All calls, video and messages are end-to-end encrypted.",
    "© 2026 RELAY · ENCRYPTED COMMUNICATIONS",
  ];
  /* v2.106.84 — asked THROUGH the dictionary now, and that is strictly stronger
     than the literal search it replaces rather than a relaxation of it. These
     sentences moved into `dict/` when the app learned Arabic; a screen that
     renders `t("login.createAccount")` no longer contains the English, so a raw
     `toContain` would have gone red on every one of them.

     The two obvious reactions are both wrong: deleting the pin leaves the
     owner's signed-off wording unguarded, and matching the KEY freezes an
     implementation detail while saying nothing about what the words are.
     `copyOnScreen` asks the property these pins always stood for — this sentence
     reaches this screen — and reaching it via the dictionary ALSO proves an
     Arabic half exists, because `Entry` requires both. A screen that stops
     saying the sentence at all still fails. */
  for (const c of COPY) {
    it(`has: ${c.slice(0, 52)}`, () =>
      expect(copyOnScreen(SCREEN, c), whyCopyMissing(SCREEN, c)).toBe(true));
  }

  it("the tagline still names BOTH ways in", () => {
    // The property the frozen sentence was standing in for.
    expect(SCREEN).toMatch(/Jump straight in as a guest — or register/);
  });

  it("the guest step asks for a name and its CTA enters as a guest", () => {
    const guest = SCREEN.slice(SCREEN.indexOf("function GuestStep"), SCREEN.indexOf("function EmailStep"));
    // #120: the FULL name, per the owner — via the dictionary since v2.106.84.
    expect(copyOnScreen(guest, "GUEST ACCESS · YOUR FULL NAME")).toBe(true);
    expect(copyOnScreen(guest, "I am a guest — reserve my number")).toBe(true);
  });

  it("labels every LIVE NETWORK tile", () => {
    for (const l of ["REGISTERED", "GUESTS SERVED", "CALL PARTIES", "MESSAGES", "ONLINE NOW"]) {
      expect(copyOnScreen(SCREEN, l), whyCopyMissing(SCREEN, l)).toBe(true);
    }
  });
});

describe("layout tokens (spec §2 and §5)", () => {
  it("every column on the page shares ONE width", () => {
    // Was "the card is 560, the security section 640". #120 moved that section
    // directly ABOVE the card, where a second width would read as a misalignment —
    // so the property is now that they agree, which is stricter than either literal.
    expect(SCREEN).toContain("maxWidth: 560");
    expect(SCREEN).not.toContain("maxWidth: 640");
  });
  it("page padding, card radius and the tilt are the spec's", () => {
    expect(SCREEN).toContain('padding: "64px 20px 72px"');
    expect(SCREEN).toContain("borderRadius: 26");
    expect(SCREEN).toContain("perspective(900px)");
    expect(SCREEN).toContain('transition: "transform .18s"');
  });
  it("the stat grid is the spec's auto-fit track", () => {
    expect(SCREEN).toContain("repeat(auto-fit, minmax(118px,1fr))");
  });
  it("the pop uses the spec's spring easing and 1.22 scale", () => {
    expect(SCREEN).toContain("scale(1.22)");
    expect(SCREEN).toContain("cubic-bezier(.34,1.56,.64,1)");
  });
  it("the six id tiles reach the spec's 50×62 and re-roll on its 2600ms", () => {
    // Was a frozen `width: 50, height: 62`. #120 moved this section above the card,
    // where six fixed 50px tiles wrapped to two rows on a 320px phone and MEASURABLY
    // pushed the access buttons below the fold — so they are clamped, with the spec's
    // size as the upper bound. The property is the maximum, plus the re-roll cadence.
    const css = read("../index.css");
    const rule = css.slice(css.indexOf(".relay-idstrip-tile {"));
    expect(rule.slice(0, rule.indexOf("}"))).toMatch(/width: clamp\([^)]*50px\)/);
    expect(rule.slice(0, rule.indexOf("}"))).toMatch(/height: clamp\([^)]*62px\)/);
    expect(SCREEN).toContain("2600");
  });
});

/* ── the state machine ────────────────────────────────────────────────────── */

describe("auth flow", () => {
  it("has all six steps the spec names", () => {
    for (const s of ["idle", "guest", "email", "choose", "login", "register"]) {
      expect(SCREEN).toContain(`"${s}"`);
    }
  });

  it("selecting Business sweeps the accent across the page AND the canvas", () => {
    // Spec §3: "Selecting it also crossfades the WHOLE page accent (background
    // canvas, panel borders, CTAs)". The canvas half is the easy one to lose.
    expect(SCREEN).toContain("business ? T.gold : T.accent");
    expect(SCREEN).toContain("<RelayBackground business={business} />");
    expect(read("./RelayBackground.tsx")).toContain("setBusiness(business)");
  });

  it("the code step renders six boxes driven by one invisible input", () => {
    expect(SCREEN).toContain("CodeBoxes");
    expect(SCREEN).toContain('autoComplete="one-time-code"');
    expect(SCREEN).toContain("opacity: 0"); // the real input sits over the boxes
    expect(SCREEN).toContain("width: 44, height: 54");
  });
});

/* ── what the redesign must NOT have dropped ──────────────────────────────── */

describe("shipped capabilities the spec never mentions are still wired", () => {
  const MUST_CALL = [
    ["identity minting", "startGuest"],
    ["email probe", "otpAuth.loginProbe"],
    ["OTP issue", "otpAuth.requestOtp"],
    ["registration", "otpAuth.register"],
    ["OTP verify", "otpAuth.verifyOtp"],
    ["4-digit passcode login", "otpAuth.loginWithPin"],
    ["new-device approval", "otpAuth.sessionApprovalStatus"],
  ] as const;
  for (const [what, call] of MUST_CALL) {
    it(`still calls ${call} (${what})`, () => expect(SCREEN).toContain(call));
  }

  it("keeps the PIN step — dropping it would strand everyone with a passcode", () => {
    // RENDERED, not merely defined: a mutation that deletes the render site
    // leaves the component in the file, so `toContain("PinStep")` alone is a
    // pin that cannot fail for the reason it was written.
    expect(SCREEN).toContain('{step === "pin" && <PinStep');
    expect(SCREEN).toContain("function PinStep");
    // …the probe must actually route to it,
    expect(SCREEN).toContain('go("pin")');
    // …and there is an escape hatch when the passcode is forgotten.
    expect(SCREEN).toContain("email me a code instead");
  });

  it("keeps the new-device approval step and names the PIN escape", () => {
    expect(SCREEN).toContain('{step === "waiting" && <WaitingStep');
    expect(SCREEN).toContain("function WaitingStep");
    expect(SCREEN).toContain('go("waiting")');
    expect(copyOnScreen(SCREEN, "A 4-digit passcode never needs approval — you can set one from Profile once you're in.")).toBe(true);
  });

  it("keeps the guest-recovery card (v2.99.69) on the entry screen", () => {
    // For a returning guest this IS the primary action: typing a name mints a
    // SECOND identity and strands the first.
    expect(SCREEN).toContain("<GuestRestore");
  });

  it("keeps the matrix reveal, and it outlasts identity landing", () => {
    expect(SCREEN).toContain("MatrixReveal");
    expect(SCREEN).toContain("if (reveal)");
  });

  it("does NOT hijack the /i/<pin> call-link join screen", () => {
    // v2.94.5 made that one focused field so a shared link connects in one tap.
    expect(GATE).toContain("if (!showJoin) return <LoginScreen />;");
    expect(GATE).toContain("showJoin = !!callTarget");
  });
});

/* ── stats are real, not theatre ──────────────────────────────────────────── */

describe("LIVE NETWORK reads real data", () => {
  it("uses the pushed stats hook rather than a simulated ticker", () => {
    expect(SCREEN).toContain("useLiveStats()");
    // The spec's §4 invents traffic on a 2400ms timer with random increments.
    // That must not ship — checked against the CODE, not the comments.
    const src = code(SCREEN);
    expect(src).not.toContain("2400");
    // Was a file-wide count of exactly ONE setInterval. #122 added a second (the
    // sign-in countdown), which is not a fabricated stat — so the property is now
    // scoped to the section that must not invent traffic: LIVE NETWORK reads the
    // pushed hook and starts no timer of its own.
    // Anchored on the next DECLARATION, never on the divider comment that follows
    // it: `code()` strips comments, so a comment anchor resolves to -1 and the slice
    // silently runs to the end of the file — swallowing IdentitySection's own timer
    // and failing on correct code. The prose-anchor trap, inverted.
    const live = src.slice(src.indexOf("function LiveNetwork"), src.indexOf("function IdentitySection"));
    expect(live.length).toBeGreaterThan(400);
    // The slice really is that section. Anchored on the STAT TILES, not on the
    // heading: the eyebrow reads "Live network" in the source and is uppercased by
    // CSS, so matching the rendered casing fails on correct code.
    //
    // v2.106.84: the tile labels moved into the dictionary, so the anchor is the
    // KEY rather than the words. That is the correct anchor for THIS assertion —
    // unlike the copy pins above, this one is not about what the label says, it is
    // proving the slice landed on the right function, and the key reference is
    // that function's own code. `copyOnScreen` would be wrong here: it searches the
    // whole file by design, which is exactly what a slice guard must not do.
    expect(live).toMatch(/login\.guestsServed/);
    expect(live).not.toMatch(/setInterval\(/);
    expect(live).toMatch(/useLiveStats\(\)/);
    // And the id-digit re-roll (spec §4, 2600ms) is still the only timer that
    // touches the identity strip.
    expect(src).toContain("2600");
  });
  it("shows an em-dash, never a confident 0, before data arrives", () => {
    // "0 people online" on the entry page is a claim; a cold cache must not
    // be allowed to make it (the v2.99.72 rule).
    expect(SCREEN).toContain('value == null ? "—"');
  });
  it("maps every tile to a real field on the stats payload", () => {
    for (const f of ["registeredUsers", "guestsServed", "totalParties", "messagesSent", "onlineNow"]) {
      expect(SCREEN).toContain(f);
    }
  });
});

/* ── the canvas, and the lesson from v2.99.67 ─────────────────────────────── */

describe("background engine", () => {
  it("re-arms rAF BEFORE the hidden-tab return", () => {
    // Returning first kills the loop permanently on the first hidden frame —
    // the exact bug v2.99.67 fixed on the landing page. Order is the whole test.
    const arm = BG.indexOf("raf = requestAnimationFrame(loop);");
    const hidden = BG.indexOf("document.hidden) return;");
    expect(arm).toBeGreaterThan(-1);
    expect(hidden).toBeGreaterThan(-1);
    expect(arm).toBeLessThan(hidden);
  });

  it("caps the frame rate instead of running uncapped rAF", () => {
    expect(BG).toContain("FRAME_MS");
    expect(BG).toContain("acc < FRAME_MS");
  });

  it("implements the spec's own low-power numbers", () => {
    // Spec: "drop the flow-field grid from 63×63 to 45×45 and the vortex from
    // 1e4 to 5e3".
    expect(BG).toContain("low ? 45 : 63");
    expect(BG).toContain("low ? 5_000 : 10_000");
  });

  it("under reduced motion keeps glows/grid/stars and stops before the rest", () => {
    const calm = BG.indexOf("if (calm) return;");
    expect(calm).toBeGreaterThan(-1);
    expect(BG.indexOf("---- stars ---")).toBeLessThan(calm);   // stars kept
    expect(BG.indexOf("---- flow field")).toBeGreaterThan(calm); // field skipped
    expect(BG.indexOf("---- point vortex")).toBeGreaterThan(calm);
  });

  it("tears every listener down on destroy", () => {
    for (const e of ["mousemove", "mouseout", "scroll", "resize"]) {
      expect(BG).toContain(`removeEventListener("${e}"`);
    }
    expect(BG).toContain("cancelAnimationFrame(raf)");
  });

  it("survives a missing 2D context instead of throwing on the login screen", () => {
    expect(BG).toContain("if (!ctx)");
  });
});
