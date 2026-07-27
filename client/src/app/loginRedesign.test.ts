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
  const COPY = [
    "Jump straight in as a guest — or register your permanent six-digit ID.",
    "CHOOSE YOUR ACCESS",
    "Just a display name",
    "Login / register with email",
    "GUEST ACCESS · DISPLAY NAME",
    "Full name — e.g. Alex Mercer",
    "Enter as guest",
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
  for (const c of COPY) {
    it(`has: ${c.slice(0, 52)}`, () => expect(SCREEN).toContain(c));
  }

  it("labels every LIVE NETWORK tile", () => {
    for (const l of ["REGISTERED", "GUESTS SERVED", "CALL PARTIES", "MESSAGES", "ONLINE NOW"]) {
      expect(SCREEN).toContain(l);
    }
  });
});

describe("layout tokens (spec §2 and §5)", () => {
  it("card + stats column is 560, the security section 640", () => {
    expect(SCREEN).toContain("maxWidth: 560");
    expect(SCREEN).toContain("maxWidth: 640");
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
  it("the six id tiles are 50×62 and re-roll on the spec's 2600ms", () => {
    expect(SCREEN).toContain("width: 50, height: 62");
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
    expect(SCREEN).toContain("never needs approval");
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
    // The only timer on this page is the id-digit re-roll (spec §4, 2600ms);
    // no interval may fabricate a stat.
    const intervals = src.match(/setInterval\(/g) ?? [];
    expect(intervals).toHaveLength(1);
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
