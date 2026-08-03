/* ──────────────────────────────────────────────────────────────────────────────
 * BOARD 4i — THE LOCKED-GROUP GATE.
 *
 * The frame: a 64px group avatar wearing a gold lock puck · "This group is locked" ·
 * four gold PIN dots · a 3x4 glass keypad with a gold hover · the app-passcode escape
 * in the accent · "Locked groups never show previews in the thread list".
 *
 * ── WHAT IS DRIVEN AND WHAT IS PINNED, AND WHY THE SPLIT IS THERE ────────────────
 * The frame's own requirement is the RECOVERY state, and the only question that
 * matters about it is behavioural: *can a person actually get back in*. So the
 * routing decision is a pure exported function and is driven over every length
 * Profile can produce, and the two module facts the split rests on are driven
 * against the REAL `groupLock` module with a real `crypto.subtle`.
 *
 * The rest — which colour carries which meaning, that the gate is still a full early
 * return, that the pad has a physical-keyboard path — is source-pinned, because those
 * are properties of the markup rather than of a value.
 * ────────────────────────────────────────────────────────────────────────────── */
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "../../../../server/testing/codeOnly";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const MSG_PATH = "client/src/pages/app/Messages.tsx";
const MSG = read(MSG_PATH);
const CODE = codeOnly(MSG);

/** The gate's own markup, so a pin cannot be satisfied by an unrelated part of a
 *  5,900-line file. Bounded by the component's own end rather than a fixed slice —
 *  the recurring fixed-window fragility (v2.99.78). */
const GATE = (() => {
  const start = CODE.indexOf("function LockedGroupGate(");
  expect(start, "the gate component exists").toBeGreaterThan(-1);
  const end = CODE.indexOf("\nfunction AccentCircle(", start);
  expect(end, "…and something follows it, so the slice is bounded").toBeGreaterThan(start);
  return CODE.slice(start, end);
})();

/* ── a real-enough localStorage, installed before the modules load ───────────── */
class MemStore {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
const store = new MemStore();
vi.stubGlobal("localStorage", store);

const { attemptOpenGroup, removeGroupLock, setGroupLock, isGroupHidden, relockGroup } =
  await import("../../app/groupLock");
const { setPasscode, clearPasscode } = await import("../../app/passcode");
/* The gate's own routing decision, from the shipping file. */
const { lockGateRoute } = await import("./Messages");

const G = 4242;

beforeEach(() => {
  store.clear();
  relockGroup(G);
});

/* ══════════════════════════════════════════════════════════════════════════════
   THE RECOVERY — the frame's own requirement, and where the defect was
   ══════════════════════════════════════════════════════════════════════════════ */

describe("the app-passcode recovery works at every length Profile can produce", () => {
  /* Profile's app-lock section slices input to 8 digits and refuses under 4, so the
     passcode a person actually has is anywhere in 4-8. Every one of them has to be
     able to open a locked group, because `setGroupLock` REFUSES to lock anything
     until an app passcode exists — that passcode is the entire promise of a way
     back. */
  const PROFILE_LENGTHS = ["1234", "12345", "123456", "1234567", "12345678"];

  it("`attemptOpenGroup` alone cannot serve most of them — this is the defect", async () => {
    /* THE FIND. `attemptOpenGroup` opens with `if (!isValidLockCode(code)) return "no"`
       — exactly four digits — so for a 5-8 digit app passcode it returns "no" WITHOUT
       ever reaching `verifyPasscode`. The gate this frame replaces capped its field at
       4 and auto-submitted there, so those people had no route back at all: forget the
       group code and the chat is redacted on that device permanently, with "clear all
       site data" (which destroys a guest number) as the only way out.

       Driven rather than argued, and asserted as a CURRENT-BEHAVIOUR fact: if
       `attemptOpenGroup` is ever widened to take 4-8 itself, this goes red and the
       gate's routing should be reconsidered rather than left as a second mechanism. */
    for (const pass of PROFILE_LENGTHS) {
      store.clear();
      await setPasscode(pass);
      await setGroupLock(G, "9999");
      relockGroup(G);
      const r = await attemptOpenGroup(G, pass);
      if (pass.length === 4) expect(r, `${pass} is 4 digits`).toBe("recovered");
      else expect(r, `${pass} never reaches verifyPasscode`).toBe("no");
    }
  });

  it("…and `removeGroupLock` does serve them, which is why the gate splits by length", async () => {
    /* The fix uses the module's EXISTING public API rather than loosening its guard:
       `removeGroupLock` has no length gate ahead of `verifyPasscode`. */
    for (const pass of PROFILE_LENGTHS) {
      store.clear();
      await setPasscode(pass);
      await setGroupLock(G, "9999");
      relockGroup(G);
      expect(await removeGroupLock(G, pass), `${pass} opens it`).toBe(true);
      expect(isGroupHidden(G), `${pass} leaves the group open`).toBe(false);
    }
  });

  it("the gate routes every one of those lengths somewhere that can serve it", () => {
    for (const pass of PROFILE_LENGTHS) {
      const route = lockGateRoute(pass);
      expect(route, `${pass} must not be dropped`).not.toBe("too-short");
      expect(route).toBe(pass.length === 4 ? "group-code" : "app-passcode");
    }
  });

  it("a partial entry submits nothing, so typing towards a longer code cannot fire early", () => {
    for (const partial of ["", "1", "12", "123"]) {
      expect(lockGateRoute(partial), `"${partial}"`).toBe("too-short");
    }
  });

  it("nothing beyond Profile's own ceiling is routed", () => {
    // 9+ digits cannot be an app passcode, so treating it as one would send a value
    // to `verifyPasscode` that Profile can never have stored.
    expect(lockGateRoute("123456789")).toBe("too-short");
    expect(lockGateRoute("12a4")).toBe("too-short");
    expect(lockGateRoute("١٢٣٤")).toBe("too-short");
  });
});

describe("the group code keeps its priority — the recovery never front-runs it", () => {
  it("a 4-digit entry goes through the module's try-the-group-code-first rule", async () => {
    /* If a group's code happened to EQUAL the app passcode, routing four digits at
       `removeGroupLock` would silently unlock-and-REMOVE the lock on every ordinary
       open. `attemptOpenGroup` exists to stop that, so four digits must go there. */
    expect(lockGateRoute("1234")).toBe("group-code");

    await setPasscode("1234");
    await setGroupLock(G, "1234");
    relockGroup(G);
    expect(await attemptOpenGroup(G, "1234")).toBe("unlocked"); // opened, NOT removed
    relockGroup(G);
    expect(isGroupHidden(G), "the lock survived an ordinary open").toBe(true);
  });

  it("the source really takes that branch, and the two routes are not swapped", () => {
    const route = GATE.slice(GATE.indexOf("const route = lockGateRoute"));
    expect(route).toMatch(/route === "group-code"[\s\S]{0,80}attemptOpenGroup\(conversationId, value\)/);
    expect(route).toMatch(/removeGroupLock\(conversationId, value\)/);
    // The escape hatch must not be reachable for a four-digit code by any path.
    expect(route).not.toMatch(/isValidLockCode\([^)]*\)[\s\S]{0,60}removeGroupLock/);
  });

  it("a wrong four digits is NOT cleared, or a fifth could never be typed", () => {
    /* The load-bearing half of the fix. Auto-submit fires at four; if that also wiped
       the entry, somebody whose app passcode is 6 digits would be reset to zero on
       every fourth keypress and could never reach the sixth. */
    expect(GATE).toMatch(/setWrong\(true\);/);
    const onFail = GATE.slice(GATE.indexOf("setWrong(true);"));
    expect(onFail.slice(0, 120)).not.toMatch(/setCode\(""\)/);
  });

  it("entry is capped at Profile's ceiling rather than at the group code's length", () => {
    // A `>= 4` cap here is the original defect; the pad has to hold 8.
    expect(GATE).toMatch(/c\.length >= 8/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   THE GATE STILL SITS WHERE NO ROUTE CAN GO ROUND IT
   ══════════════════════════════════════════════════════════════════════════════ */

describe("the gate replaces the whole conversation view", () => {
  /* POSITIONS ARE MEASURED ON THE RAW FILE, not on `CODE`. A first draft anchored the
     ordinary header on its own `{/* conversation header —` comment while reading
     comment-STRIPPED source, so `indexOf` answered -1 and the comparison was against
     nothing — the inverted prose-anchor trap (v2.105.26). The presence/shape pins stay
     on `CODE`, where a commented-out copy must not count. */
  const gateAt = MSG.indexOf("if (isGroup && isGroupHidden(conversationId))");
  const headerAt = MSG.indexOf("{/* conversation header —");

  it("is a full early return, ahead of the ordinary header", () => {
    /* This is the property `groupLock.test.ts` stands for, re-pinned here because
       4i changes WHICH component renders the body. Pinned as the condition itself
       rather than by index: `if (false && …)` satisfies a position comparison while
       the gate has stopped deciding anything. */
    const stmt = CODE.split("\n").filter((l) => l.includes("isGroupHidden(conversationId)"));
    expect(stmt, "exactly one gate").toHaveLength(1);
    expect(stmt[0]).toMatch(/^\s*if \(isGroup && isGroupHidden\(conversationId\)\) \{$/);

    expect(gateAt, "the gate is there").toBeGreaterThan(-1);
    expect(headerAt, "and the ordinary header is what follows it").toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(headerAt);
  });

  it("and it is the 4i frame that gets rendered there", () => {
    expect(CODE).toMatch(/<LockedGroupGate\s+conversationId=\{conversationId\}/);
    const mount = MSG.indexOf("<LockedGroupGate");
    expect(mount).toBeGreaterThan(gateAt);
    expect(mount).toBeLessThan(headerAt);
  });

  it("the view still SUBSCRIBES, or a correct code leaves the gate on screen", () => {
    /* There is deliberately no success callback: the module notifies and this
       re-renders. Two mechanisms for one transition is how the forgotten one sticks. */
    expect(CODE).toMatch(/useGroupLocks\(\);/);
    expect(GATE).not.toMatch(/onUnlocked/);
  });

  it("BACK survives — a deep link into a locked group must not be a dead end", () => {
    /* The board draws 4i as a whole phone screen with no app chrome. Dropping our
       lock header to match would strand a phone user who arrived by deep link or
       notification tap, so the header is kept and the deviation is deliberate. */
    const block = CODE.slice(
      CODE.indexOf("if (isGroup && isGroupHidden(conversationId))"),
      CODE.indexOf("<LockedGroupGate")
    );
    expect(block).toMatch(/aria-label=\{t\("msg\.back"\)\}/);
    expect(block).toMatch(/setLocation\(basePath\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   THE FRAME
   ══════════════════════════════════════════════════════════════════════════════ */

describe("board 4i's own furniture", () => {
  it("a 64px group avatar wearing the gold lock puck", () => {
    expect(GATE).toMatch(/<GroupAvatar url=\{avatarUrl\} name=\{title\} size=\{64\} \/>/);
    // The puck: 26px, near-black, gold hairline, gold glyph.
    expect(GATE).toMatch(/size-\[26px\][\s\S]{0,200}background: "#0d1316"[\s\S]{0,60}lockGold\(0\.5\)/);
  });

  it("the avatar is the SHARED component, not a private copy", () => {
    /* A second implementation of a group's photo is how a changed one comes to render
       on one surface and not another (v2.106.89), and it is also what loses the
       degrade-to-glyph behaviour when a url fails. */
    expect(GATE).not.toMatch(/<img/);
    expect(GATE).not.toMatch(/display\s*=\s*"none"/);
  });

  it("four PIN dots, gold when filled and a hairline ring when not", () => {
    expect(GATE).toMatch(/Math\.max\(4, code\.length\)/);
    expect(GATE).toMatch(/background: LOCK_GOLD, boxShadow: `0 0 10px \$\{lockGold\(0\.6\)\}`/);
    expect(GATE).toMatch(/border: "1\.5px solid rgba\(255,255,255,\.3\)"/);
  });

  it("a 3x4 keypad of square keys — BLANK · 0 · ERASE, the app's own bottom row", () => {
    expect(GATE).toMatch(/gridTemplateColumns: "repeat\(3, 1fr\)"/);
    // aspect-square, so the cell is square BY CONSTRUCTION at any width — sizing rows
    // independently is what made the Dialer's "circles" ovals by 18px (v2.106.3).
    const KEY = CODE.slice(CODE.indexOf("function LockPadKey("), CODE.indexOf("function LockedGroupGate("));
    expect(KEY).toMatch(/aspect-square/);
    // 1-9 from the list, then the inert cell, 0 and erase.
    expect(GATE).toMatch(/\["1", "2", "3", "4", "5", "6", "7", "8", "9"\]/);
    expect(GATE).toMatch(/<span aria-hidden="true" \/>/);
    const bottom = GATE.slice(GATE.indexOf('<span aria-hidden="true" />'));
    expect(bottom.indexOf('push("0")')).toBeLessThan(bottom.indexOf("onPress={back}"));
  });

  it("the erase key dims rather than disappearing, and it is labelled", () => {
    // A key that comes and goes makes the grid jump.
    expect(GATE).toMatch(/onPress=\{back\} disabled=\{code\.length === 0\} label=\{t\("dialer\.eraseLast"\)\}/);
  });

  it("the footer note and the explainer come from the dictionary, not new literals", () => {
    /* Both already exist with an Arabic half, written for the group-info sheet. A
       private twin would be a second Arabic word for one fact. */
    expect(GATE).toMatch(/t\("groups\.lockNoPreviews"\)/);
    expect(GATE).toMatch(/t\("groups\.lockExplain"\)/);
    expect(GATE).toMatch(/t\("groups\.lockWrongCode"\)/);
  });

  it("…and those keys really carry both halves", () => {
    const dict = read("client/src/app/dict/groups.ts");
    for (const k of ["groups.lockNoPreviews", "groups.lockExplain", "groups.lockWrongCode"]) {
      const at = dict.indexOf(`"${k}"`);
      expect(at, k).toBeGreaterThan(-1);
      const entry = dict.slice(at, at + 400);
      expect(entry, `${k} has an Arabic half`).toMatch(/ar:\s*"/);
    }
  });
});

describe("the colour vocabulary — gold is locked, the accent is the way out", () => {
  it("gold carries every lock affordance", () => {
    expect(GATE + CODE.slice(CODE.indexOf("const LOCK_GOLD"), CODE.indexOf("function LockPadKey("))).toMatch(
      /#e8c94a/
    );
    expect(CODE).toMatch(/const LOCK_GOLD = "#e8c94a"/);
  });

  it("the keypad's hover is GOLD, and it is applied where nothing can outrank it", () => {
    /* The shipped `.rkey` recipe would give the glass for free, but its hover is
       `.relay-v2 .rkey:hover` — three class selectors — so a utility (two) loses and
       the key would hover ACCENT, which on this screen is the wrong word. A class that
       silently loses the cascade is indistinguishable from one that does not exist
       (v2.106.78), so the tint is applied directly. */
    const KEY = CODE.slice(CODE.indexOf("function LockPadKey("), CODE.indexOf("function LockedGroupGate("));
    expect(KEY).toMatch(/backgroundColor: hot && !disabled \? lockGold\(0\.12\)/);
    expect(KEY).not.toMatch(/\brkey\b/);
    expect(KEY).not.toMatch(/hover:bg-/);
  });

  it("the escape is the ONLY accent, and never the raw variable", () => {
    /* 4i gives the accent to exactly one thing. The raw variable measures 1.59:1 as
       text on a light card, which is why this is `text-primary`. */
    expect(GATE).toMatch(/text-primary/);
    expect(GATE).not.toMatch(/color:\s*["'`]?\s*var\(--rb/);
    expect(GATE).not.toMatch(/color:\s*["'`]?\s*rgba\(var\(--rb-rgb/);
  });

  it("green appears nowhere — it means ONLINE and nothing else", () => {
    expect(GATE).not.toMatch(/--relay-online/);
    expect(GATE).not.toMatch(/--relay-green-text/);
  });

  it("the puck is pinned with a LOGICAL edge, so it mirrors in Arabic", () => {
    expect(GATE).toMatch(/-end-1\.5/);
    expect(GATE).not.toMatch(/-right-/);
    expect(GATE).not.toMatch(/\bml-|\bmr-|\bpl-|\bpr-/);
  });
});

describe("the escape never promises a recovery that cannot work", () => {
  it("it is withheld when this device has no app passcode", () => {
    /* `setGroupLock` requires one, but Profile can CLEAR it afterwards — so a locked
       group with no passcode is reachable, and there the sentence would be a lie. */
    expect(GATE).toMatch(/const \[canRecover\] = useState\(\(\) => hasPasscode\(\)\)/);
    expect(GATE).toMatch(/\{canRecover && \(/);
  });

  it("…and the explainer swaps to the honest sentence in that state", () => {
    expect(GATE).toMatch(/canRecover[\s\S]{0,140}Ask whoever set it if you don't have it\./);
  });

  it("it is a HINT about this keypad, not a second control", () => {
    /* The pad already takes both codes, so a button here would need a second field for
       a code this one accepts — two ways to do one thing. */
    const escape = GATE.slice(GATE.indexOf("{canRecover && ("));
    expect(escape.slice(0, 400)).not.toMatch(/<button|onClick=/);
  });

  it("a passcode really is verified against the device, not against the group", async () => {
    await setPasscode("482913");
    await setGroupLock(G, "1111");
    relockGroup(G);
    expect(await removeGroupLock(G, "482913"), "the real passcode opens it").toBe(true);

    store.clear();
    await setPasscode("482913");
    await setGroupLock(G, "1111");
    relockGroup(G);
    expect(await removeGroupLock(G, "482914"), "a near miss does not").toBe(false);
    expect(isGroupHidden(G)).toBe(true);
  });

  it("with no passcode set, only the group's own code opens it", async () => {
    await setPasscode("482913");
    await setGroupLock(G, "1111");
    clearPasscode();
    relockGroup(G);
    expect(await removeGroupLock(G, "482913")).toBe(false);
    expect(await attemptOpenGroup(G, "1111")).toBe("unlocked");
  });
});

describe("it is usable without a touchscreen and without sight", () => {
  it("a physical keyboard drives the pad", () => {
    /* The gate this replaces was a text input — the only way to type on a desktop.
       Losing that would be a regression for everyone not on a phone. */
    expect(GATE).toMatch(/window\.addEventListener\("keydown", onKey\)/);
    expect(GATE).toMatch(/window\.removeEventListener\("keydown", onKey\)/);
    expect(GATE).toMatch(/\/\^\[0-9\]\$\/\.test\(e\.key\)/);
    expect(GATE).toMatch(/e\.key === "Backspace"/);
  });

  it("Enter on a focused key does not both press it and submit", () => {
    expect(GATE).toMatch(/el\.tagName === "BUTTON"[\s\S]{0,40}return;/);
  });

  it("the dots are decoration and the status is what a screen reader is told", () => {
    expect(GATE).toMatch(/aria-hidden="true" className="mt-6 flex justify-center gap-3"/);
    expect(GATE).toMatch(/aria-live="polite"/);
    expect(GATE).toMatch(/role="alert"/);
    // The pad is one labelled group rather than twelve unexplained buttons.
    expect(GATE).toMatch(/aria-label=\{t\("groups\.lockAnyCodeAria"\)\}/);
  });

  it("the Unlock control is absent below five digits rather than disabled", () => {
    /* A control that can only refuse should not be there (v2.103.3). Below five the
       auto-submit has already fired, so it would have nothing left to do. */
    expect(GATE).toMatch(/\{code\.length > 4 && \(/);
  });

  it("a double tap cannot submit twice", () => {
    expect(GATE).toMatch(/if \(busy \|\| route === "too-short"\) return;/);
  });

  it("switching between two locked groups does not carry digits across", () => {
    expect(GATE).toMatch(/setCode\(""\);[\s\S]{0,40}setWrong\(false\);[\s\S]{0,40}\}, \[conversationId\]\)/);
  });
});

describe("the gate is not vacuous", () => {
  it("the slice really is the component and really does contain its markup", () => {
    // A pin reading an empty string cannot fail for the reason it was written.
    expect(GATE.length).toBeGreaterThan(2000);
    expect(GATE).toContain("This group is locked");
  });

  it("the old gate component is no longer mounted from here", () => {
    /* 4i replaces the body, so the previous one has no importer left in this file.
       `client/src/app/GroupLockGate.tsx` is now orphaned — reported rather than
       deleted, because it is outside this change's files. */
    expect(CODE).not.toMatch(/<GroupLockGate/);
    expect(CODE).not.toMatch(/from "@\/app\/GroupLockGate"/);
  });
});

/**
 * THE ROW DESCRIBED ITSELF TWO DIFFERENT WAYS.
 *
 * The visible "typing…" chip is gated on `!hidden` — deliberately, and the comment
 * beside it says why: "typing" means somebody in there is active right now, which
 * is exactly the live detail a privacy screen covers. The `aria-label` on the same
 * row was not gated, so the accessible name announced "typing now" for a group
 * whose row prints the lock notice instead.
 *
 * That matters here more than most places: the lock's scenario is a phone handed to
 * somebody with the app open, and a phone with VoiceOver on reads the label aloud.
 */
describe("the locked row's accessible name matches what it prints", () => {
  const SRC = fs.readFileSync(path.resolve(__dirname, "Messages.tsx"), "utf8");

  it("the aria-label suppresses typing when the row is hidden", () => {
    const at = SRC.indexOf("`Open conversation with ${displayName}`");
    expect(at, "the thread row's aria-label moved").toBeGreaterThan(0);
    const label = SRC.slice(at, at + 900);
    expect(label).toMatch(/typing && !hidden \? ", typing now" : ""/);
  });

  it("…and it is the SAME condition the visible chip uses", () => {
    // Two spellings of one rule is how the visual and the announced come apart.
    expect(SRC).toMatch(/\{typing && !hidden \?/);
  });

  it("the accessible name still carries what the row DOES print", () => {
    // The lock hides the preview, not the group's name — redacting the label past
    // the rule would make a locked row unnavigable by screen reader.
    const at = SRC.indexOf("`Open conversation with ${displayName}`");
    expect(SRC.slice(at, at + 900)).toMatch(/unread \? `, \$\{t\.unreadCount\} unread`/);
  });
});
