/**
 * BOARD 2f (passcode lock) + 5e (wrong-passcode / locked-out states).
 *
 * This screen arrived with NO tests at all — not "tests that pinned the old shape",
 * none. So this file is not a rewrite of stale pins; it is the first coverage the
 * app lock has ever had, and it is written around the two things that would hurt a
 * real person rather than around the styling.
 *
 * THE TWO THAT MATTER, said first:
 *
 *  1. A LOCK SCREEN NOBODY CAN GET PAST is the worst outcome in this file. The
 *     cooldown is new behaviour — before it, you could try forever — so every
 *     assertion about it is really an assertion about the owner still getting in:
 *     a backwards clock must read as expired rather than as a multi-year hold, a
 *     biometric refusal must never spend a try, and the expiry must clear the
 *     error, because `error` is what disables the Unlock button.
 *
 *  2. A COOLDOWN HELD ONLY IN COMPONENT STATE IS NO COOLDOWN, because a reload
 *     undoes it and a reload is the first thing anybody trying codes does.
 *
 * The rest is the vocabulary rule this repo keeps re-learning: green means ONLINE
 * and nothing else, so a locked device cannot be painted in it.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { codeOnly } from "../../../server/testing/codeOnly";

const PATH = "client/src/app/PasscodeGate.tsx";
const SRC = readFileSync(PATH, "utf8");
const CODE = codeOnly(SRC);

/** The body of a named function, found by matching braces from the brace that is
 *  reached with parens, braces and angles all closed — so a destructured parameter
 *  object or a `Promise<{…}>` return type cannot be mistaken for the body (the
 *  v2.105.9 / v2.105.27 / v2.106.4 trap). */
function fnBody(src: string, name: string): string {
  const at = src.search(new RegExp(`function\\s+${name}\\b`));
  expect(at, `${name} must exist`).toBeGreaterThanOrEqual(0);
  let i = at,
    paren = 0,
    angle = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "<") angle++;
    else if (c === ">") angle--;
    else if (c === "{" && paren === 0 && angle <= 0) break;
  }
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = src.slice(start, i + 1);
  expect(body.length, `${name}'s body must be a real slice`).toBeGreaterThan(20);
  return body;
}

// ---------------------------------------------------------------------------
// A stubbed localStorage, so the persisted-cooldown claims can be DRIVEN rather
// than read. This suite runs in the node environment: without a stub every
// storage access takes its guarded catch and returns 0, which would make each of
// these cases pass by doing nothing.
// ---------------------------------------------------------------------------
let store: Record<string, string> = {};
const stub = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => {
    store[k] = v;
  },
  removeItem: (k: string) => {
    delete store[k];
  },
};
beforeEach(() => {
  store = {};
  (globalThis as { localStorage?: unknown }).localStorage = stub;
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("board 2f — the cooldown cannot strand the owner (driven)", () => {
  it("a clock that has gone BACKWARDS reads as expired, not as a multi-year hold", async () => {
    const { cooldownLeft } = await import("./PasscodeGate");
    // The stored deadline is a year out — which cannot be real for a 5-minute
    // hold, so it can only mean the clock moved or the value was edited. Holding
    // the owner out of their own app for a year is the failure this guard exists
    // to prevent, and it is the one nobody would ever debug from the symptom.
    store["relay_pass_until"] = String(Date.now() + 365 * 24 * 3600_000);
    expect(cooldownLeft()).toBe(0);
  });

  it("a deadline exactly at the full cooldown is still honoured", async () => {
    const { cooldownLeft } = await import("./PasscodeGate");
    const now = 1_800_000_000_000;
    store["relay_pass_until"] = String(now + 5 * 60_000);
    // The guard is `> COOLDOWN_MS`, not `>=`: the instant a hold is armed its
    // remainder IS the whole cooldown, so a `>=` here would expire every
    // cooldown at the moment it started and the hold would never apply at all.
    expect(cooldownLeft(now)).toBe(5 * 60_000);
  });

  it("an elapsed deadline, an absent one and a garbage one all read as not held", async () => {
    const { cooldownLeft } = await import("./PasscodeGate");
    const now = 1_800_000_000_000;
    store["relay_pass_until"] = String(now - 1);
    expect(cooldownLeft(now)).toBe(0);
    delete store["relay_pass_until"];
    expect(cooldownLeft(now)).toBe(0);
    store["relay_pass_until"] = "not-a-number";
    expect(cooldownLeft(now)).toBe(0);
    store["relay_pass_until"] = "-5";
    expect(cooldownLeft(now)).toBe(0);
  });

  it("a live hold reports its real remainder", async () => {
    const { cooldownLeft } = await import("./PasscodeGate");
    const now = 1_800_000_000_000;
    store["relay_pass_until"] = String(now + 92_000);
    expect(cooldownLeft(now)).toBe(92_000);
  });

  it("the countdown the owner reads keeps its leading zero", async () => {
    const { mmss } = await import("./PasscodeGate");
    expect(mmss(272_000)).toBe("4:32"); // the board's own figure
    expect(mmss(9_000)).toBe("0:09"); // NOT "0:9"
    expect(mmss(60_000)).toBe("1:00");
    expect(mmss(0)).toBe("0:00");
    expect(mmss(-1)).toBe("0:00"); // never a negative clock
  });
});

describe("board 2f — the cooldown survives the reload that defeats it", () => {
  it("the deadline and the attempt count are PERSISTED, not component state", () => {
    // A cooldown held in useState is undone by a refresh, which is the first
    // thing anybody trying codes does — so this is the difference between the
    // hold existing and merely appearing to.
    expect(CODE).toMatch(/const TRIES_KEY = "relay_pass_tries"/);
    expect(CODE).toMatch(/const UNTIL_KEY = "relay_pass_until"/);
    const attempt = fnBody(CODE, "attempt");
    expect(attempt).toMatch(/writeNum\(UNTIL_KEY/);
    expect(attempt).toMatch(/writeNum\(TRIES_KEY/);
  });

  it("it uses its OWN keys and never touches the passcode hash", () => {
    // `passcode.ts` owns `relay_pass_hash` / `relay_pass_salt`. Writing either
    // from here would make a failed attempt able to destroy the credential.
    expect(CODE).not.toMatch(/relay_pass_hash|relay_pass_salt/);
  });

  it("every storage access fails toward NOT locked out", () => {
    // This is friction rather than a security boundary — anyone who can clear
    // storage clears the hash too, which unlocks — so a storage error must never
    // be the reason somebody cannot get into their own app.
    for (const name of ["readNum", "writeNum", "clearAttempts"]) {
      expect(fnBody(CODE, name)).toMatch(/catch/);
    }
    expect(fnBody(CODE, "readNum")).toMatch(/catch\s*\{[\s\S]*return 0/);
  });
});

describe("board 5e — a refused biometric is not a wrong passcode", () => {
  it("a biometric failure spends no try", () => {
    const bio = fnBody(CODE, "tryBiometric");
    // The OS gate cannot be guessed, so counting a cancel would only ever
    // strand the owner — four cancelled Face ID prompts must not lock the pad.
    expect(bio).not.toMatch(/setTries|writeNum|MAX_TRIES/);
    expect(bio).toMatch(/if \(ok\) succeed\(\)/);
  });

  it("both unlock paths forgive the attempts through ONE exit", () => {
    // Two copies of "forgive the cooldown" is how one of them comes to forget:
    // whoever just proved they own the device does not deserve to inherit a hold
    // from whoever was guessing.
    const succeed = fnBody(CODE, "succeed");
    expect(succeed).toMatch(/clearAttempts\(\)/);
    expect(succeed).toMatch(/unlockApp\(\)/);
    // Exactly one caller of unlockApp, and it is inside succeed().
    expect(CODE.match(/unlockApp\(\)/g)).toHaveLength(1);
    expect(fnBody(CODE, "tryBiometric")).toMatch(/succeed\(\)/);
    expect(fnBody(CODE, "attempt")).toMatch(/succeed\(\)/);
  });

  it("the hold lifting clears the error as well as the code", () => {
    // `error` is what disables Unlock, so an expiry that left it set would greet
    // the owner with a dead button and an error about an attempt five minutes ago.
    const lock = fnBody(CODE, "LockScreen");
    const at = lock.indexOf("clearAttempts()");
    expect(at).toBeGreaterThan(0);
    const expiry = lock.slice(at, lock.indexOf("}, 1000)", at));
    expect(expiry.length).toBeGreaterThan(20);
    expect(expiry).toMatch(/setError\(false\)/);
    expect(expiry).toMatch(/setCode\(""\)/);
  });

  it("a second tap on Unlock cannot spend another try on the same code", () => {
    expect(fnBody(CODE, "attempt")).toMatch(/if \([^)]*\berror\b[^)]*\) return/);
  });
});

describe("board 2f — the vocabulary fix", () => {
  it("no presence green survives anywhere on the lock screen", () => {
    // Green means ONLINE — it is what every presence LED is painted with, which
    // is why v2.99.86 moved DND off it, v2.106.9 the speaking tile, v2.106.11 the
    // push banner and v2.106.18 the voice waveform. "Locked" is not a presence
    // statement, so it takes the accent.
    expect(CODE).not.toMatch(/relay-online|emerald|#34d399|#10b981|#22c55e/);
  });

  it("the accent's fallback is a LITERAL, never a self-referencing cycle", () => {
    // `var(--rb, var(--rb))` is a custom-property CYCLE: it resolves to the
    // guaranteed-invalid value and the browser DROPS the declaration, so the
    // screen renders with no accent at all rather than a plain one (v2.106.7).
    expect(CODE).toMatch(/var\(--rb,\s*#[0-9A-Fa-f]{6}\)/);
    expect(CODE).not.toMatch(/var\(--rb[a-z-]*,\s*var\(--rb/);
    expect(CODE).toMatch(/rgba\(var\(--rb-rgb,\s*\d+,\s*\d+,\s*\d+\)/);
  });

  it("gold means locked, and is not borrowed from the DND token", () => {
    // `--relay-dnd` already means "alerts are silenced"; one token carrying two
    // meanings is how a colour stops carrying information.
    expect(CODE).toMatch(/const GOLD = "#e8c94a"/);
    expect(CODE).not.toMatch(/--relay-dnd/);
  });

  it("no accent is a runtime-composed Tailwind class", () => {
    // A class name assembled at render time is invisible to the JIT and comes
    // out unstyled — the trap recorded for the tab-bar accents.
    expect(CODE).not.toMatch(/className=\{`[^`]*\$\{/);
  });
});

describe("board 2f — structure", () => {
  it("the dot row is derived from the real code length, not a fixed four", () => {
    // Profile enforces 4–8 digits, so a fixed row of four placeholders would
    // assert a length this app does not have.
    const lock = fnBody(CODE, "LockScreen");
    expect(lock).toMatch(/Math\.min\(MAX_LEN,\s*Math\.max\(MIN_LEN,\s*code\.length\)\)/);
  });

  it("a physical keyboard still drives the pad", () => {
    // The text input this keypad replaces was the only way to type on a desktop.
    const lock = fnBody(CODE, "LockScreen");
    expect(lock).toMatch(/addEventListener\("keydown"/);
    expect(lock).toMatch(/"Backspace"/);
    expect(lock).toMatch(/\/\^\[0-9\]\$\/\.test\(e\.key\)/);
  });

  it("Enter on a focused button does not also submit", () => {
    // The browser is already clicking THAT control; submitting as well would
    // append a digit and unlock in one press.
    const lock = fnBody(CODE, "LockScreen");
    const at = lock.indexOf('"Enter"');
    expect(at).toBeGreaterThan(0);
    const branch = lock.slice(at, at + 420);
    expect(branch).toMatch(/activeElement/);
    expect(branch).toMatch(/tagName === "BUTTON"/);
    expect(branch).toMatch(/return/);
  });

  it("exactly one canvas: the gate renders the lock INSTEAD of its children", () => {
    // This screen mounts its own RelayBackground, which is only free of the
    // v2.99.67 cost class because the shell's canvas lives in `Inner`, BELOW
    // this gate — so when locked it never renders. If the gate ever rendered
    // both, the app would run two rAF loops behind a screen showing one.
    const gate = fnBody(CODE, "PasscodeGate");
    expect(gate).toMatch(/if \(!locked\) return <>\{children\}<\/>/);
    expect(gate).toMatch(/return <LockScreen \/>/);
    // ...and the claim it rests on: the shell's own canvas is inside Inner,
    // which PasscodeGate wraps.
    const shell = codeOnly(readFileSync("client/src/app/AppShell.tsx", "utf8"));
    // Matched on the ELEMENT, not `<Inner>` exactly: `Inner` legitimately took a prop
    // in v2.106.25 (the route's own tab, so both navs share one active-tab value), and
    // the property here is only that the canvas-owning component is nested inside the
    // gate — not that it is propless.
    expect(shell).toMatch(/<PasscodeGate>[\s\S]*<Inner[\s>]/);
    const inner = fnBody(shell, "Inner");
    expect(inner).toMatch(/<RelayBackground \/>/);
    expect(CODE.match(/<RelayBackground/g)).toHaveLength(1);
  });

  it("the notch cannot sit on the brand row", () => {
    // Installed to the home screen there is no browser chrome above this screen.
    expect(CODE).toMatch(/env\(safe-area-inset-top/);
    expect(CODE).toMatch(/env\(safe-area-inset-bottom/);
  });
});
