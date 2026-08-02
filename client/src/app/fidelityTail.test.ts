/**
 * v2.107.4 — the last three MEASURED gaps between the app and the design board.
 *
 * `design_handoff_relay_app/MISSING-FRAMES.md` was re-audited at v2.107.1 and its
 * conclusion is the premise of this file: **all 42 frames have their layout built, and
 * what remains is FIDELITY** — the class of thing only a per-frame comparison finds,
 * where every source pin passes and the screen is still wrong.
 *
 * Three of those, each verified against the board's own markup before anything moved:
 *
 *  1. **2a/2b — the speaking sound-wave was PRESENCE GREEN under reduced motion.** The
 *     five rainbow hues lived INSIDE `prefers-reduced-motion: no-preference` together
 *     with the bounce, over a flat `#22c55e` base. Colour is not motion: a viewer who
 *     asked for less of it got five bars in the one colour this app reserves for ONLINE
 *     (v2.106.9 moved the speaking TILE off green for exactly that reason and left this),
 *     which is also the Registered badge's own hex, rendering on the same screen.
 *
 *  2. **1j — the desktop thread list was 340px against the board's 360.** That 20px was
 *     the whole remaining delta once 1j's "88px icon rail" was settled as SUPERSEDED.
 *
 *  3. **4h — the invite landing card hand-rolled the glass material.** `.rglass` is that
 *     recipe, and v2.106.40 had to fix it in place precisely because a private copy at
 *     one call site left the other four broken.
 *
 * TWO BOARD ITEMS ARE DECLINED HERE RATHER THAN BUILT, with the reason pinned so the
 * next audit does not re-raise them — see the last describe.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const ASSETS = read("client/src/lib/relayAssets.ts");
const MESSAGES = read("client/src/pages/app/Messages.tsx");
const INVITE = read("client/src/app/InviteCard.tsx");
const HISTORY = read("client/src/pages/app/History.tsx");

describe("2a/2b — the speaking wave keeps its colours under reduced motion", () => {
  /** The `@media (prefers-reduced-motion: no-preference)` block that gates the bounce. */
  const motionBlock = () => {
    const at = ASSETS.indexOf("@media (prefers-reduced-motion: no-preference){\n  .relay-root .relay-tile.speaking .sound-wave i{animation:relayWave");
    expect(at, "the sound-wave motion gate exists").toBeGreaterThan(-1);
    return ASSETS.slice(at, ASSETS.indexOf("\n}", at) + 2);
  };

  it("all five hues are declared OUTSIDE the reduced-motion gate", () => {
    const gate = motionBlock();
    for (const hex of ["#f43f5e", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7"]) {
      expect(
        ASSETS.includes(`.sound-wave i:nth-child(1){background:${hex}}`) ||
          ASSETS.includes(`{background:${hex}}`),
        `${hex} is declared`,
      ).toBe(true);
      expect(gate, `${hex} is NOT trapped behind the motion gate`).not.toContain(hex);
    }
  });

  it("the gate carries motion and nothing else", () => {
    // If a colour ever moves back inside it, the still frame stops matching the moving
    // one — the v2.99.86 class, and the reason this was wrong in the first place.
    expect(motionBlock()).not.toMatch(/background:/);
    expect(motionBlock()).toMatch(/animation:relayWave/);
  });

  it("the base is the accent, so a sixth bar reads as ACTIVE and never as ONLINE", () => {
    const base = ASSETS.slice(
      ASSETS.indexOf(".relay-root .relay-tile .sound-wave i{width:3px"),
    ).split("}")[0];
    expect(base, "the base bar exists").toContain("transform-origin");
    expect(base, "the base is the cycling accent").toMatch(/background:var\(--rb/);
    expect(base, "the base is NOT the presence/Registered green").not.toContain("#22c55e");
  });

  it("green survives as ONE of five hues, which is not the same claim", () => {
    // A rainbow that contains green does not make green mean "speaking"; five green bars
    // did. The third bar keeps its hue so the owner's palette (v2.99.85) is unchanged.
    expect(ASSETS).toContain(".sound-wave i:nth-child(3){background:#22c55e}");
  });
});

describe("1j — the desktop thread list is the board's 360px", () => {
  it("the aside is md:w-[360px]", () => {
    expect(MESSAGES).toContain("md:w-[360px]");
    expect(MESSAGES).not.toContain("md:w-[340px]");
  });

  it("the width is desktop-only, so no phone layout moved", () => {
    // 1200 = 280 sidebar + 360 list + pane is a DESKTOP spec; a bare `w-[360px]` would
    // pin the phone's full-bleed list to a fixed width and break every narrow screen.
    const at = MESSAGES.indexOf("md:w-[360px]");
    const cls = MESSAGES.slice(MESSAGES.lastIndexOf('"', at), MESSAGES.indexOf('"', at + 5));
    expect(cls).not.toMatch(/(^|\s)w-\[\d/);
  });
});

describe("4h — the invite landing uses the shared glass recipe", () => {
  it("the card carries .rglass rather than a private copy of its values", () => {
    expect(INVITE).toMatch(/className="rglass /);
  });

  it("the hand-rolled material is gone from that element", () => {
    const at = INVITE.indexOf('className="rglass ');
    const cls = INVITE.slice(at, INVITE.indexOf('"', at + 12));
    expect(cls, "no private surface colour").not.toContain("bg-card/");
    expect(cls, "no private hairline").not.toContain("border-border/");
  });

  it("the blur stays — this card is over the canvas, never over live video", () => {
    // The no-backdrop-filter rule (v2.99.84) is scoped to CALL surfaces, where the
    // backdrop changes every frame and nothing can be cached. An invite landing is not one.
    expect(INVITE).toMatch(/rglass[^"]*backdrop-blur/);
  });
});

describe("two board items are DECLINED, with the reason pinned", () => {
  it("1b's swipe tray is not built: both its actions are already inline on every row", () => {
    /* Board 1b's tray reveals exactly two accent pucks — message and call. This app
       renders BOTH (and video) as always-visible round actions on every History row, so a
       gesture would be a second way to do one thing, and the harder one to find. That is
       the opposite of the v2.99.85 finding that made the message ⋮ permanently visible
       because "appears on hover" is what made it undiscoverable.

       Pinned as the REASON rather than as an absence: if these ever stop being inline,
       this goes red and the swipe has to be reconsidered. */
    /* Pinned on the ELEMENT, not on the string. A file-wide match for
       `t("history.callBack")` is satisfied four times over in this file, so it would
       still pass with a row's own action deleted — the mutation run is what showed
       that, by aborting on a needle that occurs four times. The property is that BOTH
       row kinds (conference and solo) carry the action as a `RoundAction`. */
    const code = codeOnly(HISTORY);
    // The cap is generous because the conference row's disc carries a two-branch label
    // AND title (group vs solo wording); non-greedy still stops at the FIRST close tag,
    // so a wider bound can only let it reach that tag, never swallow a sibling.
    const discs = code.match(/<RoundAction\b[\s\S]{0,900}?<\/RoundAction>/g) ?? [];
    expect(discs.length, "the row's actions are RoundAction discs").toBeGreaterThanOrEqual(4);
    /* Matched on the disc's `label=` line specifically. A bare `.includes` counts the
       `title=` line too, which is a DIFFERENT prop — a mutation that repointed the label
       and left the tooltip alone survived on exactly that. */
    const labelled = (k: string) =>
      discs.filter((d) => new RegExp(`label=\\{[^\\n]*t\\("history\\.${k}"\\)`).test(d)).length;
    expect(labelled("message"), "message is inline on both row kinds").toBeGreaterThanOrEqual(2);
    expect(labelled("callBack"), "call-back is inline on both row kinds").toBeGreaterThanOrEqual(2);
    expect(code, "no swipe row on a call log").not.toMatch(/<SwipeRow/);
  });

  it("the call-back disc keeps its green, because that is the owner's own dial language", () => {
    /* The obvious fidelity move is to take this disc off `#22c55e` — board 1b draws its
       swipe pucks in the accent, and a History row also renders a presence LED and a
       Registered badge in that same green, which is three greens on one row.

       It is NOT taken, and that is a decision rather than an oversight: green-means-CALL
       is the hue language the owner chose for the Dialer's own action row (v2.77,
       v2.99.90 — green Voice / sky Video / violet Group), and History's three discs are
       that row repeated. Changing it here alone would make two screens disagree about
       what the call button looks like, which is worse than the collision it fixes.
       Flagged for the owner instead. */
    expect(HISTORY).toContain('accent="#22c55e"');
    expect(HISTORY, "…and the sibling hues it has to stay consistent with").toContain(
      'accent="#38bdf8"',
    );
  });
});
