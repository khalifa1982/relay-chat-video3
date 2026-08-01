/* ──────────────────────────────────────────────────────────────────────────
 * v2.106.78 — the Dialer's idle marquee.
 *
 * THE ENGINE IS DRIVEN, NOT PINNED. Whether an empty category can ever put a
 * number on screen, whether a full-but-untagged address book shows anybody at
 * all, whether the six cells resolve to the number they were given — none of
 * those are questions a source assertion can answer, and all three are the
 * feature. The wiring (no setState, no keyframes, the loop's guards, tap fills
 * rather than dials) is source-pinned, because those are properties of the
 * shape rather than of the output.
 * ────────────────────────────────────────────────────────────────────────── */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { RELAY_ACCENT_CYCLE_MS } from "@/lib/relayBackground";
import {
  MARQUEE_TIMING,
  MARQUEE_MIN_VIEWPORT_H,
  MARQUEE_COPY_MAX,
  SLIDE_CONTACT_MS,
  SETTLE_MS,
  ROUND_PROMPT,
  HINT_LINES,
  UNTAGGED_ROUND,
  MATRIX_GLYPHS,
  DIGIT_GLYPHS,
  buildRotations,
  eligibleForMarquee,
  frameAt,
  marqueeSignature,
  slideDuration,
  type MarqueeContactRow,
  type MarqueeSlide,
} from "./dialerMarquee";

const HERE = path.resolve(__dirname);
const read = (p: string) => fs.readFileSync(path.join(HERE, p), "utf8");
const PAINTER = read("./DialerMarquee.tsx");
const ENGINE = read("./dialerMarquee.ts");
const DIALER = read("../pages/app/Dialer.tsx");
const CSS = read("../index.css");

/** A saved contact the marquee should accept. */
const row = (over: Partial<MarqueeContactRow> = {}): MarqueeContactRow => ({
  number: "777777",
  displayName: "Amira",
  tags: [],
  blocked: false,
  identityId: 42,
  ...over,
});

/** Deterministic "random": always the first candidate. */
const first = () => 0;

/** Walk a slide's whole timeline at the flick cadence. */
function walk(slide: MarqueeSlide) {
  const out: ReturnType<typeof frameAt>[] = [];
  for (let t = 0; t <= slideDuration(slide) + 60; t += 11) out.push(frameAt(slide, t));
  return out;
}

describe("v2.106.78 — the untagged round, which the feature cannot ship without", () => {
  it("a full address book with NO tags still shows a real contact", () => {
    /* THE FINDING THAT WOULD HAVE MADE THE WHOLE FEATURE INERT.
       Every add-contact call site in the app sends {number, displayName} and
       nothing else, and nothing backfills tags — so UNTAGGED IS THE DEFAULT
       STATE OF EVERY CONTACT. A marquee that rotated only the four tags would
       tell somebody with five hundred saved contacts that they have no family,
       no friends and no team: the exact failure the owner described for the
       ZERO-contact case, delivered to the fullest address book in the fleet, as
       the DEFAULT experience. Their own clause is "if you have saved contacts,
       it will appear there".

       Driven at the scale that matters rather than with one row. */
    const rows = Array.from({ length: 500 }, (_, i) =>
      row({ number: String(100000 + i), displayName: `Person ${i}`, identityId: i + 1 })
    );
    const slides = buildRotations(rows, {}, first);
    const contacts = slides.filter((s) => s.kind === "contact");
    expect(contacts.length, "at least one real contact is offered").toBeGreaterThan(0);
    expect(contacts[0].kind === "contact" && contacts[0].round).toBe(UNTAGGED_ROUND);
    // …and it LEADS, so a two-second visit still sees it.
    expect(slides[0].kind).toBe("contact");
  });

  it("a vip-only contact appears in the VIP round and NOT in the untagged one", () => {
    /* The reason this is not `sectionsFor`'s `other` bucket. That predicate means
       "in no SECTION", and VIP has no section — so borrowing it would show a
       vip-only contact twice, once under VIP and once under everyone-else. */
    const slides = buildRotations([row({ tags: ["vip"] })], {}, first);
    const rounds = slides.filter((s) => s.kind === "contact").map((s) => s.kind === "contact" && s.round);
    expect(rounds).toContain("vip");
    expect(rounds).not.toContain(UNTAGGED_ROUND);
  });

  it("there is no EMPTY untagged slide — that would be a fifth way of saying the same thing", () => {
    const slides = buildRotations([], {}, first);
    const empties = slides.filter((s) => s.kind === "empty").map((s) => s.kind === "empty" && s.round);
    expect(empties).not.toContain(UNTAGGED_ROUND);
    // The four the owner named ARE still prompted when empty — their words:
    // "it will show the other categories empty, but without showing numbers".
    expect(empties.sort()).toEqual(["family", "friend", "team", "vip"]);
  });
});

describe("v2.106.78 — an empty category can never show a number", () => {
  it("no cell is ever non-empty across the ENTIRE timeline of an empty slide", () => {
    /* The owner said this twice. Asserted by walking every frame rather than by
       reading the branch, because "without showing numbers" is a claim about
       what appears on screen at any instant. */
    const slides = buildRotations([], {}, first);
    const empty = slides.find((s) => s.kind === "empty");
    expect(empty, "an empty-category slide exists").toBeTruthy();
    for (const f of walk(empty!)) {
      expect(f.cells.every((c) => c.digit === "")).toBe(true);
      expect(f.cells.every((c) => c.alphabet === null)).toBe(true);
      expect(f.nameText).toBe("");
    }
  });

  it("the same holds for the hint slide", () => {
    for (const f of walk({ kind: "hint" })) {
      expect(f.cells.every((c) => c.alphabet === null)).toBe(true);
    }
  });

  it("only the contact variant can carry a pin AT THE TYPE LEVEL", () => {
    /* Stronger than the behavioural walk above and deliberately kept alongside
       it: a test says today's code does not do it, a type says tomorrow's
       cannot. `empty` and `hint` have no field a number could be put in. */
    const empty: MarqueeSlide = { kind: "empty", round: "family", prompt: "x" };
    expect(Object.keys(empty)).not.toContain("pin");
    expect(Object.keys(empty)).not.toContain("contact");
    expect(ENGINE).toMatch(/\{ kind: "hint" \}/);
    // The `own` variant carries a pin — it is the VIEWER'S OWN number, which is
    // the one number this slot is allowed to assert without a contact.
    expect(ENGINE).toMatch(/kind: "own"; pin: string/);
  });
});

describe("v2.106.78 — the decode resolves to the number it was given", () => {
  const slide: MarqueeSlide = {
    kind: "contact",
    round: "family",
    prompt: "Contact your family",
    contact: { number: "314159", name: "Amira" },
  };

  it("every cell locks to the right digit, left to right", () => {
    const settled = frameAt(slide, MARQUEE_TIMING.IN + MARQUEE_TIMING.PROMPT + MARQUEE_TIMING.DECODE);
    expect(settled.cells.map((c) => c.digit).join("")).toBe("314159");
    expect(settled.cells.every((c) => c.locked)).toBe(true);
  });

  it("cells lock in order, never all at once", () => {
    const mid = frameAt(
      slide,
      MARQUEE_TIMING.IN + MARQUEE_TIMING.PROMPT + MARQUEE_TIMING.LOCK_START + MARQUEE_TIMING.LOCK_STEP * 2 + 1
    );
    expect(mid.cells[0].locked).toBe(true);
    expect(mid.cells[2].locked).toBe(true);
    expect(mid.cells[5].locked).toBe(false);
  });

  it("a scrambling cell CONVERGES alien → numeric", () => {
    const base = MARQUEE_TIMING.IN + MARQUEE_TIMING.PROMPT;
    // Far from its lock: the alien alphabet.
    expect(frameAt(slide, base + 1).cells[5].alphabet).toBe(MATRIX_GLYPHS);
    // Within the last few flicks of its lock: digits, so it settles as a number
    // rather than snapping from katakana in one frame.
    const nearLock = base + MARQUEE_TIMING.LOCK_START + MARQUEE_TIMING.LOCK_STEP * 5 - MARQUEE_TIMING.FLICK;
    expect(frameAt(slide, nearLock).cells[5].alphabet).toBe(DIGIT_GLYPHS);
  });

  it("a SETTLED cell is never dimmed — the ramp is decoration and must not touch AA", () => {
    /* The 0.42 floor applies ONLY to scrambling glyphs, which carry no
       information. A settled digit at 0.55 on the light theme's measured 4.85:1
       accent would land near 2.9:1 and fail. */
    const settled = frameAt(slide, MARQUEE_TIMING.IN + MARQUEE_TIMING.PROMPT + MARQUEE_TIMING.DECODE);
    expect(settled.cells.every((c) => c.opacity === 1)).toBe(true);
  });

  it("the prompt and the contact CROSS-FADE — they are a sequence, not a stack", () => {
    /* Both the owner's description ("then it will say contact your family. It
       will show the family contact") and the thing that keeps the marquee inside
       ONE row: stacking a prompt line above the digits would add height the
       keypad's hardcoded 422px budget does not shrink to absorb. */
    const early = frameAt(slide, MARQUEE_TIMING.IN + 10);
    expect(early.promptOpacity).toBeGreaterThan(0.9);
    expect(early.nameOpacity).toBeLessThan(0.1);
    const late = frameAt(slide, MARQUEE_TIMING.IN + MARQUEE_TIMING.PROMPT + MARQUEE_TIMING.IN + 10);
    expect(late.promptOpacity).toBeLessThan(0.1);
    expect(late.nameOpacity).toBeGreaterThan(0.9);
  });

  it("every slide ends on a FULLY BLANK gap — the owner's 'blinking showing in out'", () => {
    for (const s of [
      slide,
      { kind: "hint" } as MarqueeSlide,
      { kind: "empty", round: "team", prompt: "x" } as MarqueeSlide,
      { kind: "own", pin: "777777" } as MarqueeSlide,
    ]) {
      const atGap = frameAt(s, slideDuration(s) - MARQUEE_TIMING.GAP / 2);
      expect(atGap.promptOpacity).toBe(0);
      expect(atGap.nameOpacity).toBe(0);
      expect(atGap.cells.every((c) => c.opacity === 0)).toBe(true);
    }
  });
});

describe("v2.106.78 — which contacts are eligible", () => {
  it("drops a malformed stored number", () => {
    expect(eligibleForMarquee([row({ number: "77" })])).toHaveLength(0);
    expect(eligibleForMarquee([row({ number: "7a7777" })])).toHaveLength(0);
  });

  it("drops a saved number that resolves to NO identity", () => {
    /* A purged person (v2.100.0 deliberately KEEPS third-party contact rows,
       because `blocked` lives on them) or a number that never registered. Without
       this the marquee advertises a dead number, the user taps it, the lookup
       resolves to null and the Dialer disables every action — the screen invited
       a call and then refused it. */
    expect(eligibleForMarquee([row({ identityId: null })])).toHaveLength(0);
  });

  it("drops a blocked contact", () => {
    /* LOAD-BEARING: contacts.list RETURNS blocked rows rather than dropping them,
       so the Contacts screen can render them visible-but-disabled. */
    expect(eligibleForMarquee([row({ blocked: true })])).toHaveLength(0);
  });

  it("drops a contact with no name", () => {
    expect(eligibleForMarquee([row({ displayName: null })])).toHaveLength(0);
    expect(eligibleForMarquee([row({ displayName: "   " })])).toHaveLength(0);
  });

  it("keeps an ordinary one", () => {
    expect(eligibleForMarquee([row()])).toHaveLength(1);
  });
});

describe("v2.106.78 — the deck does not reshuffle under the reader", () => {
  it("the signature ignores presence and row order", () => {
    /* contacts.list carries isOnline/idle/lastSeenAt/inCall and is polled every
       60s, so memoising on the ARRAY would reshuffle the deck — and swap the
       slide currently on screen — about once a minute for anyone with an online
       contact. listContacts also orders by favourite then updatedAt, so editing
       any contact reorders the whole list. */
    const a = [row({ number: "111111" }), row({ number: "222222" })];
    const b = [row({ number: "222222" }), row({ number: "111111" })];
    expect(marqueeSignature(a)).toBe(marqueeSignature(b));
  });

  it("but a rename or a retag DOES rebuild it", () => {
    expect(marqueeSignature([row()])).not.toBe(marqueeSignature([row({ displayName: "Other" })]));
    expect(marqueeSignature([row()])).not.toBe(marqueeSignature([row({ tags: ["family"] })]));
    expect(marqueeSignature([row()])).not.toBe(marqueeSignature([row({ blocked: true })]));
  });
});

describe("v2.106.78 — the rotation list", () => {
  it("leads with a populated round, so a two-second visit sees the payload", () => {
    /* Most Dialer visits end before a slow opening sequence ever reaches a
       contact: somebody who opens it to dial is typically gone in two or three
       seconds. A list that opens on a generic prompt spends the whole visit on
       copy they have read a hundred times. */
    const slides = buildRotations([row({ tags: ["family"] })], {}, first);
    expect(slides[0].kind).toBe("contact");
    // The hint still appears — after the payload, not in front of it.
    expect(slides.some((s) => s.kind === "hint")).toBe(true);
    const hintAt = slides.findIndex((s) => s.kind === "hint");
    const emptyAt = slides.findIndex((s) => s.kind === "empty");
    expect(hintAt).toBeLessThan(emptyAt);
  });

  it("a FAILED contacts read yields the hint ALONE — never a category prompt", () => {
    /* Rendering "Contact your family" with nothing in it over a read that FAILED
       is a confident claim about somebody's own address book — v2.106.25
       verbatim ("ANY failure of contacts.list … rendered No contacts yet"). */
    const slides = buildRotations([row({ tags: ["family"] })], { contactsUnavailable: true }, first);
    expect(slides).toEqual([{ kind: "hint" }]);
  });

  it("the viewer's own number appears ONLY on a short viewport, and leads there", () => {
    /* index.css hides the MY NUMBER card below 660px and after v2.106.77 the top
       bar carries no number either — so on such a phone this is the only copy on
       the screen. Above it, showing it here is the third copy the owner asked to
       remove. */
    const tall = buildRotations([row()], { ownNumber: "601586" }, first);
    expect(tall.some((s) => s.kind === "own")).toBe(false);

    const short = buildRotations([row()], { ownNumber: "601586", shortViewport: true }, first);
    expect(short[0]).toEqual({ kind: "own", pin: "601586" });
  });

  it("a guest whose number is not minted yet gets no own slide, and the marquee still runs", () => {
    const slides = buildRotations([], { ownNumber: null, shortViewport: true }, first);
    expect(slides.some((s) => s.kind === "own")).toBe(false);
    expect(slides.length).toBeGreaterThan(0);
  });

  it("a malformed own number is refused rather than rendered", () => {
    expect(
      buildRotations([], { ownNumber: "60", shortViewport: true }, first).some((s) => s.kind === "own")
    ).toBe(false);
  });

  it("never renders an em-dash placeholder — that glyph already means something else here", () => {
    /* `— — —` means "this viewer has no 6-digit number yet" in the dial readout.
       Reusing it for "this category is empty" would give one glyph two meanings
       on one screen, which is the vocabulary collision this repo keeps removing. */
    const all = [...buildRotations([], {}, first), ...buildRotations([row()], {}, first)];
    for (const s of all) for (const f of walk(s)) {
      expect(f.promptText).not.toContain("—");
      expect(f.cells.some((c) => c.digit === "—")).toBe(false);
    }
  });

  it("survives a rand() that returns exactly 1", () => {
    const slides = buildRotations([row(), row({ number: "888888" })], {}, () => 1);
    const c = slides.find((s) => s.kind === "contact");
    expect(c?.kind === "contact" && /^\d{6}$/.test(c.contact.number)).toBe(true);
  });

  it("a one-contact deck does not hang", () => {
    // A redraw-until-different loop would spin forever on a one-element deck.
    const slides = buildRotations([row({ tags: ["family"] })], {}, () => Math.random());
    expect(slides.length).toBeGreaterThan(0);
  });
});

describe("v2.106.78 — constants that must not drift", () => {
  it("the contact slide's length is DERIVED from the accent cycle", () => {
    /* The owner asked for colours that "match to the background colouring, which
       is keep changing". Half the cycle means every other contact arrives under
       a visibly different accent — a property with a test behind it rather than
       a coincidence that survives until somebody retunes one of the two. */
    expect(SLIDE_CONTACT_MS).toBe(RELAY_ACCENT_CYCLE_MS / 2);
    expect(slideDuration({ kind: "contact", round: "vip", prompt: "x", contact: { number: "111111", name: "n" } })).toBe(
      RELAY_ACCENT_CYCLE_MS / 2
    );
    // The settle absorbs whatever is left, so no constant can silently break it.
    expect(SETTLE_MS).toBeGreaterThan(1200);
  });

  it("the 660px cut-off agrees with the CSS rule it mirrors", () => {
    /* The v2.99.71 class — a value duplicated in two languages, where a checker
       that re-derived it came to disagree with the thing it checked. There is no
       way to share a number between a @media query and a matchMedia call, so it
       is compared. */
    expect(CSS).toMatch(new RegExp(`@media \\(max-height: ${MARQUEE_MIN_VIEWPORT_H}px\\)`));
    expect(PAINTER).toMatch(/max-height: \$\{MARQUEE_MIN_VIEWPORT_H\}px/);
  });

  it("every copy string fits the row", () => {
    // A wrap grows the row, and the row's height is part of the keypad's budget.
    for (const s of [...Object.values(ROUND_PROMPT), ...HINT_LINES]) {
      expect(s.length, s).toBeLessThanOrEqual(MARQUEE_COPY_MAX);
    }
    // The owner's own words, verbatim.
    expect(ROUND_PROMPT.family).toBe("Contact your family");
  });

  it("the whole PIN resolves inside the decode window", () => {
    const lastLock = MARQUEE_TIMING.LOCK_START + MARQUEE_TIMING.LOCK_STEP * 5;
    expect(lastLock).toBeLessThan(MARQUEE_TIMING.DECODE);
  });
});

describe("v2.106.78 — the painter's shape", () => {
  it("owns no React state — it would re-render the whole Dialer 18 times a second", () => {
    const code = codeOnly(PAINTER);
    expect(code).not.toMatch(/useState/);
    expect(code).not.toMatch(/setState/);
    expect(code).toMatch(/requestAnimationFrame/);
  });

  it("re-arms the rAF BEFORE any early return", () => {
    /* Returning first kills the loop permanently on the first hidden frame —
       the v2.99.67 bug, recorded in place inside relayBackground.ts. */
    const body = PAINTER.slice(PAINTER.indexOf("const loop = () => {"));
    expect(body.length, "found the loop").toBeGreaterThan(80);
    const arm = body.indexOf("raf = requestAnimationFrame(loop)");
    const firstReturn = body.indexOf("return;");
    expect(arm).toBeGreaterThan(-1);
    expect(firstReturn).toBeGreaterThan(-1);
    expect(arm).toBeLessThan(firstReturn);
  });

  it("stops during a call and while the tab is hidden", () => {
    /* The call UI is a fixed overlay and the Dialer stays MOUNTED beneath it. The
       accent engine already stops during a call; the marquee must not become the
       only thing still ticking on the one screen where every cycle belongs to
       the video encoder (v2.106.56). */
    const body = PAINTER.slice(PAINTER.indexOf("const loop = () => {"));
    expect(body).toMatch(/document\.hidden/);
    expect(body).toMatch(/dataset\.relayInCall === "1"/);
  });

  it("adds no @keyframes — every fade is an imperative opacity write", () => {
    /* Stronger than satisfying the standing guard: that guard slices
       client/src/index.css only, so a component-local keyframe would inherit no
       coverage at all. */
    /* ON STRIPPED CODE — the prose trap, for the seventeenth time in this repo,
       and caught here by the assertion failing on CORRECT source: the painter's
       own header comment says "NO @keyframes ANYWHERE" to explain the decision,
       which a search FOR that string happily matches. The companion assertion
       below proves the strip is doing real work rather than hiding a defect. */
    expect(codeOnly(PAINTER)).not.toMatch(/@keyframes/);
    expect(PAINTER, "the strip really removed something").toMatch(/@keyframes/);
    const marqueeCss = CSS.slice(CSS.indexOf(".relay-v2 .rmarquee-name"), CSS.indexOf(".relay-v2 .rbadge-accent"));
    expect(marqueeCss.length, "found the marquee CSS").toBeGreaterThan(200);
    expect(marqueeCss).not.toMatch(/@keyframes|animation:/);
    // …and it does bound invalidation, which is what makes 18Hz text writes over
    // a backdrop-blurred card acceptable.
    expect(marqueeCss).toMatch(/contain: layout paint/);
  });

  it("reduced motion yields the HINT, never a frozen contact", () => {
    /* A JS-driven animation cannot be stopped by the CSS gate, so the gate is in
       JS — and the consequence is that whatever the skeleton holds at mount is
       PERMANENT for such a viewer. Freezing on a contact would be arbitrary (why
       that person, forever?) and would leave a real name and a dialable number
       standing on the app's default screen for the one user who cannot have it
       rotate away. Driven, not just pinned: the still frame must carry no
       number and no name at all. */
    expect(PAINTER).toMatch(/if \(prefersReducedMotion\(\)\) return;/);
    expect(PAINTER).toMatch(/const still = frameAt\(\{ kind: "hint" \}/);
    const still = frameAt({ kind: "hint" }, MARQUEE_TIMING.IN + MARQUEE_TIMING.PROMPT - 1);
    expect(still.promptText).toBe(HINT_LINES[0]);
    expect(still.promptOpacity).toBeGreaterThan(0.9);
    expect(still.nameText).toBe("");
    expect(still.cells.every((c) => c.digit === "" && c.alphabet === null)).toBe(true);
    // Imported from the ONE canonical implementation rather than hand-rolled: a
    // private copy is how two surfaces come to disagree about reduced motion.
    expect(PAINTER).toMatch(/import \{ prefersReducedMotion \} from "@\/lib\/relayBackground"/);
  });

  it("tapping FILLS THE PAD and never dials", () => {
    /* The target rotates, so a mistimed tap on an auto-dialling marquee would
       place a live call to a number the user never saw — strictly worse than the
       one-click-call hole Dialer.tsx already closes for `?to=`. */
    expect(PAINTER).toMatch(/onPick\(live\.contact\.number\)/);
    const code = codeOnly(PAINTER);
    expect(code).not.toMatch(/startCallNow|programmaticDial|engine\.dial/);
    expect(DIALER).toMatch(/<DialerMarquee ownNumber=\{me\?\.number \?\? null\} onPick=\{setDialed\}/);
  });

  it("pauses on a touch or focus so the target cannot move under the finger", () => {
    for (const ev of ["pointerdown", "pointerenter", "focusin"]) {
      expect(PAINTER, ev).toContain(`addEventListener("${ev}", hold)`);
    }
    expect(PAINTER).toContain('addEventListener("pointerup", release)');
    // …and the listeners are all removed.
    for (const ev of ["pointerdown", "pointerenter", "focusin", "pointerup"]) {
      expect(PAINTER, ev).toContain(`removeEventListener("${ev}"`);
    }
  });

  it("the rotating content is decoration to a screen reader", () => {
    /* A carousel rotating every 3–5s inside a live region would announce
       forever, and would read out a rotating list of the user's contacts. */
    expect((PAINTER.match(/aria-hidden="true"/g) || []).length).toBeGreaterThanOrEqual(3);
    // It also stays OUT of the sub-line, which is the real live region.
    expect(PAINTER).not.toMatch(/aria-live/);
  });

  it("costs no new query, no new poll and no new fetch", () => {
    /* The shared cache key is real, but refetchOnMount/refetchOnWindowFocus are
       PER-OBSERVER: a new observer that omits them silently re-enables a focus
       refetch RelayEngine turned off. */
    expect(PAINTER).toMatch(/trpc\.contacts\.list\.useQuery\(undefined, \{/);
    expect(PAINTER).toMatch(/refetchOnMount: false/);
    expect(PAINTER).toMatch(/refetchOnWindowFocus: false/);
    expect(PAINTER).not.toMatch(/refetchInterval/);
  });

  it("the engine touches no DOM — Dialer.tsx is eager and its test runs in node", () => {
    /* Dialer.tsx is the one app tab that is NOT React.lazy, and Dialer.test.ts
       module-evaluates it under vitest's `node` environment. A module-scope
       window/document here would turn twenty green tests red. */
    const code = codeOnly(ENGINE);
    expect(code).not.toMatch(/\bdocument\b|\bwindow\b|requestAnimationFrame|matchMedia/);
    expect(code).not.toMatch(/from "react"/);
  });
});

describe("v2.106.78 — the Dialer's own wiring", () => {
  it("the green ghost of the viewer's own number is GONE from the readout", () => {
    /* The owner circled that slot and said their number "is mentioned down, not
       here". It was the third copy on one screenshot. */
    const code = codeOnly(DIALER);
    expect(code).not.toMatch(/aria-label=\{`Your number: \$\{ghost\.display\}`\}/);
    expect(code).not.toMatch(/--relay-online,theme\(colors\.primary\.DEFAULT\)/);
  });

  it("the readout still renders the TYPED digits unchanged", () => {
    // The marquee replaces the idle branch only — a number being typed must read
    // exactly as it always has.
    expect(DIALER).toMatch(/\{ghost\.display\}/);
    expect(DIALER).toMatch(/ghost\.mode === "typed" \?/);
  });

  it("the add-to-contacts button is inline beside the digits, not a row below the pad", () => {
    expect(DIALER).toMatch(/\{quickAddTarget \?/);
    expect(DIALER).not.toMatch(/<div className="shrink-0 flex justify-center pt-1 pb-0\.5">/);
  });

  it("Dialer.tsx came off the presence-green DEBT list in the same commit", () => {
    /* Deleting the ghost made the file clean, and the staleness guard fires on a
       DEBT entry that no longer offends. The failure names a file the diff barely
       touches, so it is recorded here too. */
    const mentions = fs.readFileSync(path.join(HERE, "../../../server/mentions.test.ts"), "utf8");
    const debt = mentions.slice(mentions.indexOf("const DEBT = new Set(["), mentions.indexOf("]);", mentions.indexOf("const DEBT")));
    expect(debt.length, "found the DEBT list").toBeGreaterThan(80);
    expect(debt).not.toMatch(/"client\/src\/pages\/app\/Dialer\.tsx"/);
  });
});
