import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "../../../../server/testing/codeOnly";

/**
 * BOARD 5a — PARTY LINES (v2.106.22).
 *
 * Every assertion here is bounded by `PartyLinesSection`'s OWN start and end,
 * and the window is asserted non-empty AND asserted to contain a known needle
 * before anything is checked against it. That is not ceremony: this repo has
 * been bitten by a fixed-length slice going stale six times (v2.99.78), by a
 * prose anchor returning -1 and running to end-of-file, and most recently by
 * `slice(-1 - 900)` silently reading the LAST 901 characters of a file and
 * matching an unrelated span for nineteen releases (v2.106.20).
 *
 * The region scoping is ALSO load-bearing for the colour sweep specifically:
 * the picker's contact rows in this same file legitimately call `presenceDot`,
 * which returns `--relay-online`. A file-wide sweep would either fail on
 * correct code or (worse) be relaxed until it said nothing.
 */

const FILE = path.resolve(__dirname, "GroupCallScreen.tsx");
const RAW = fs.readFileSync(FILE, "utf8");
const SRC = codeOnly(RAW);

/**
 * The `PartyLinesSection` body, bounded by the region's own end — the next
 * top-level declaration after it — never by a fixed character count.
 */
function region(): string {
  const start = SRC.indexOf("function PartyLinesSection(");
  expect(start).toBeGreaterThan(-1);
  // The section is followed by the cap fallback const; that is the region's own
  // end. If it ever moves, `end` is -1 and the guards below fail loudly rather
  // than the window silently swallowing the rest of the file.
  const end = SRC.indexOf("const MAX_PARTY_LINES_FALLBACK", start);
  expect(end).toBeGreaterThan(start);
  const body = SRC.slice(start, end);
  // The window is real, and it is the window we think it is.
  expect(body.length).toBeGreaterThan(500);
  expect(body).toContain("trpc.partyLines.list.useQuery");
  return body;
}

const R = region();

describe("board 5a: the region guard itself", () => {
  it("the window is bounded by the section's own end, not the file's", () => {
    // A guard on the guard: the slice must NOT reach the picker's contact rows,
    // which are what would make the colour sweep below vacuous or wrong.
    expect(R).not.toContain("presenceDot(");
    // …and those rows really do exist in the file, so the exclusion is doing work.
    expect(SRC).toContain("presenceDot(");
  });
});

describe("colour vocabulary: green means ONLINE and nothing else", () => {
  it("no presence green and no green literal survives in the party-line region", () => {
    // A live ROOM is ACTIVE, which is what the accent means since v2.106.6. The
    // subline used to be painted `--relay-online` — the seventh recorded
    // instance of this defect (v2.99.86 DND, v2.106.9 speaking tile, v2.106.11
    // push banner, v2.106.12 guest restore, v2.106.18 waveform, v2.106.21 lock).
    expect(R).not.toMatch(/--relay-online/);
    expect(R).not.toMatch(/--relay-green-text/);
    expect(R).not.toMatch(/emerald|#34d399|#10b981|#22c55e|#3ddc84/i);
    // The old violet header glyph is gone too — the accent in this section is
    // spent on the three things the frame gives it.
    expect(R).not.toMatch(/text-violet-400/);
  });

  it("the live count is painted with the cycling accent and reads from liveCount", () => {
    expect(R).toMatch(/color:\s*"var\(--rb, #3FE0C5\)"/);
    expect(R).toMatch(/Live · \{l\.liveCount\} on the line/);
  });

  it("the live dot animates OPACITY only, behind a motion-safe gate", () => {
    // The standing build guard forbids box-shadow/height/width/filter keyframes;
    // `animate-pulse` is an opacity keyframe, and `motion-safe:` makes it inert
    // for a viewer who asked for less motion.
    expect(R).toMatch(/motion-safe:animate-pulse/);
    expect(R).not.toMatch(/animate-ping|animate-bounce/);
  });
});

describe("accent fallbacks are literals, never a custom-property cycle", () => {
  it("no var(--rb…) fallback in the region references --rb again", () => {
    // `var(--rb, var(--rb))` resolves to the guaranteed-invalid value and the
    // browser DROPS the declaration — the element renders with NO colour at all
    // rather than a plain one (the v2.106.7 trap).
    expect(R).not.toMatch(/var\(--rb\s*,\s*var\(/);
    expect(R).not.toMatch(/var\(--rb-rgb\s*,\s*var\(/);
    // Every accent value present IS a literal fallback.
    expect(R).toMatch(/rgba\(var\(--rb-rgb, 63, 224, 197\), 0\.35\)/);
  });
});

describe("the caption's capacity claim comes from the live transport", () => {
  it("the cap is engine.maxParticipants, not a literal 10 and not the picker's cap−1", () => {
    // Every call runs the mesh, whose room cap is 6, so a hardcoded 10 would be a
    // false claim about capacity (the v2.106.9 argument about the board's "2×4 fits
    // up to 8"). Read from the engine so it cannot go stale if the cap moves.
    expect(R).toMatch(/const lineCap = engine\.maxParticipants/);
    expect(R).toMatch(/up to \{lineCap\}/);
    // MAX_PARTICIPANTS is cap−1 because it counts INVITEES; a party line's cap
    // counts everyone who dials in, the caller included. Reusing it would
    // understate a line's capacity by one.
    expect(R).not.toMatch(/MAX_PARTICIPANTS/);
    expect(R).not.toMatch(/up to 10/);
  });
});

describe("one spelling of NNN-NNN across the app", () => {
  it("the number renders through the shared formatPin and the local fmtNum is gone", () => {
    // Two spellings of one number format is how the row pill and the copied
    // invite text come to disagree about the same line.
    expect(SRC).not.toMatch(/function fmtNum/);
    expect(SRC).not.toMatch(/\bfmtNum\(/);
    expect(RAW).toMatch(/import \{ formatPin \} from "@\/app\/TopBar"/);
    expect(R).toMatch(/formatPin\(l\.number\)/);
  });

  it("the number pill is bidi-isolated so an RTL title cannot reorder the digits", () => {
    const pill = R.slice(R.indexOf("rchip-accent"));
    expect(pill.length).toBeGreaterThan(80);
    // Both halves: `dir` alone does not stop the surrounding paragraph
    // direction from reordering the run.
    const open = R.slice(R.lastIndexOf("<span", R.indexOf("rchip-accent")), R.indexOf("rchip-accent") + 200);
    expect(open).toMatch(/dir="ltr"/);
    expect(open).toMatch(/\[unicode-bidi:isolate\]/);
  });

  it("the live count is no longer inside the same text node as the digits", () => {
    // Before this frame both shared one mono line, which is what made the
    // reordering hazard reachable at all.
    expect(R).not.toMatch(/\{fmtNum\(l\.number\)\}[\s\S]{0,120}on the line/);
  });
});

describe("delete is irreversible and confirms in red", () => {
  it("the only path to removeLine.mutate is through the confirmation", () => {
    // A bare `onClick={() => removeLine.mutate(...)}` on a row control is the
    // pre-frame shape: one tap destroyed the line AND permanently retired its
    // 6-digit number, with no prompt.
    const mutates = R.match(/removeLine\.mutate\(/g) ?? [];
    expect(mutates.length).toBe(1);
    const idx = R.indexOf("removeLine.mutate(");
    const dialogStart = R.indexOf("<AlertDialog ");
    expect(dialogStart).toBeGreaterThan(-1);
    expect(idx).toBeGreaterThan(dialogStart);
    // Its argument comes from the confirmation's own captured row, so it cannot
    // act on whatever happens to be selected.
    expect(R).toMatch(/removeLine\.mutate\(\{ id: deleting\.id \}\)/);
  });

  it("the AlertDialogAction carries `destructive` (the prop on the primitive)", () => {
    // v2.106.11's rule: the variant is decided in ONE place by a named prop,
    // never by a per-site class string.
    expect(R).toMatch(/<AlertDialogAction[^>]*\n?\s*destructive/);
  });

  it("the copy states all three true consequences", () => {
    const desc = R.slice(R.indexOf("<AlertDialogDescription"), R.indexOf("</AlertDialogDescription>"));
    expect(desc.length).toBeGreaterThan(60);
    expect(desc).toMatch(/keeps talking/);
    expect(desc).toMatch(/stops resolving for new dials/);
    // The reservation ledger is MONOTONIC and `claimedAt` is already stamped, so
    // the reaper's `claimedAt IS NULL` guard can never reclaim the number. This
    // wording is also what trips `systemAlerts.test.ts`'s standing IRREVERSIBLE
    // sweep, so the new dialog is covered by that guard rather than by a
    // hand-kept list.
    expect(desc).toMatch(/won't come back|retired for good/);
  });
});

describe("Join: a real dial, absent rather than dead when it cannot work", () => {
  it("it dials the line voice-first and closes the picker on success", () => {
    expect(R).toMatch(/engine\.dial\(l\.number, \{ voice: true/);
    expect(R).toMatch(/if \(ok\) onJoined\(\)/);
    expect(SRC).toMatch(/<PartyLinesSection onJoined=\{onClose\} \/>/);
  });

  it("the engine gate is the RENDER condition and is not a constant", () => {
    // Pinning that the gate APPEARS says nothing about whether it DECIDES —
    // the survivor class of v2.105.16, v2.106.16 and v2.106.20. So: the
    // condition itself, and it must gate the button's own render.
    expect(R).toMatch(/const canJoin = engine\.ready && engine\.phase === "idle"/);
    expect(R).not.toMatch(/canJoin = true/);
    expect(R).not.toMatch(/const canJoin = [^;]*\btrue\s*(\|\||;)/);
    expect(R).toMatch(/\{canJoin && \(/);
    // Never a disabled control (rule 5) and never a handler that returns early.
    const btn = R.slice(R.indexOf("{canJoin && ("), R.indexOf("{canJoin && (") + 700);
    expect(btn).toMatch(/Join/);
    expect(btn).not.toMatch(/disabled=\{!canJoin\}/);
  });
});

describe("the manage card is IN FLOW", () => {
  it("no portalled overlay, dialog content or sheet inside the region", () => {
    // The frame's own structure AND the safer one: this section already lives
    // inside a `fixed` modal, and an absolutely-positioned card over a row that
    // can sit at either edge needs measuring then clamping — the class that
    // clipped the ⋮ menu off the left edge (v2.99.0) and ran the video-consent
    // card off the right (v2.99.54). The delete CONFIRMATION is a real
    // AlertDialog, which is correct: it is a modal decision, not a panel — so
    // the sweep must not read `AlertDialogContent` as an overlay panel. Masking
    // it (rather than a lookbehind) keeps the pattern readable.
    expect(R).toMatch(/<AlertDialogContent>/); // the mask below is doing work
    const noAlert = R.replace(/AlertDialog/g, "AD");
    expect(noAlert).not.toMatch(/DialogContent|SheetContent|DrawerContent|createPortal/);
    expect(R).not.toMatch(/className="[^"]*\babsolute\b/);
    expect(R).not.toMatch(/className="[^"]*\bfixed\b/);
    expect(R).toMatch(/managed && \(/);
  });

  it("`.rsheet` is paired with the theme tokens, because it is dark-scoped", () => {
    // `.dark.relay-v2 .rsheet` declares NOTHING in light, so a card carrying
    // only that class would be unstyled there.
    const card = R.slice(R.indexOf('className="rsheet'), R.indexOf('className="rsheet') + 160);
    expect(card).toMatch(/border-border/);
    expect(card).toMatch(/bg-card/);
  });
});

describe("nothing claims a lock, a PIN or a host", () => {
  it("the three declined board items are pinned as ABSENCES", () => {
    // There is no party-line passcode in the schema and no admission check in
    // `joinPartyLine`; `hostPin` is set to null on purpose. A later pass cannot
    // add the chip without adding the mechanism.
    expect(R).not.toMatch(/#e8c94a/i);
    expect(R).not.toMatch(/\bLock\b/);
    expect(R).not.toMatch(/PIN required/i);
    expect(R).not.toMatch(/hosted by/i);
    expect(R).not.toMatch(/Set PIN/i);
    expect(R).not.toMatch(/Rename/i);
  });
});

describe("the owner cap is stated instead of refused", () => {
  it("above the cap the create field is ABSENT and the cap is named", () => {
    // `list` already returned `max` and nothing read it, so before this you
    // typed a name and got a server refusal (rule 5).
    expect(R).toMatch(/const atOwnerCap = rows\.length >= maxLines/);
    expect(R).toMatch(/\{atOwnerCap \? \(/);
    expect(R).toMatch(/You have all \{maxLines\} party lines/);
    expect(R).not.toMatch(/atOwnerCap = false/);
  });

  it("the cap comes from the server's own `max`, not a second copy of 10", () => {
    expect(R).toMatch(/rows\[0\]\?\.max \?\? MAX_PARTY_LINES_FALLBACK/);
  });
});

describe("the quiet subline is honest about what it knows", () => {
  it("it reports the CREATION age and never asserts the line is empty", () => {
    // `liveCount: 0` also means "the registry was unreadable", so claiming
    // "nobody on the line" would be a false statement about somebody's call —
    // the refusal v2.105.25 made on the sibling invite screen.
    expect(R).toMatch(/createdAgo\(l\.createdAt, now\)/);
    expect(R).not.toMatch(/Nobody on the line|Quiet/i);
    expect(R).not.toMatch(/last used/i);
  });

  it("it reuses the app's one duration formatter rather than rolling another", () => {
    expect(RAW).toMatch(/import \{ formatElapsedSince \} from "@shared\/profileFields"/);
    const helper = SRC.slice(SRC.indexOf("function createdAgo("));
    expect(helper.length).toBeGreaterThan(100);
    expect(helper).toMatch(/formatElapsedSince\(ms, nowMs\)/);
    // Renders nothing rather than "Created  ago" for a missing value or a clock
    // that has gone backwards (which formatElapsedSince already answers as "").
    expect(helper).toMatch(/return ago \? `Created \$\{ago\} ago` : ""/);
    expect(helper).toMatch(/if \(createdAt == null\) return ""/);
  });
});

describe("no capability was lost", () => {
  it("all three tRPC calls, the title cap, Enter-to-create and both share paths survive", () => {
    expect(R).toMatch(/trpc\.partyLines\.create\.useMutation/);
    expect(R).toMatch(/trpc\.partyLines\.list\.useQuery/);
    expect(R).toMatch(/trpc\.partyLines\.remove\.useMutation/);
    expect(R).toMatch(/\.slice\(0, 64\)/);
    expect(R).toMatch(/e\.key === "Enter" && title\.trim\(\)/);
    expect(R).toMatch(/navigator\.share/);
    expect(R).toMatch(/navigator\.clipboard/);
    expect(R).toMatch(/\/i\/\$\{l\.number\}/);
    // Every toast still exists — create, delete, and both copy paths.
    expect(R).toMatch(/Party line created/);
    expect(R).toMatch(/Party line deleted/);
    expect(R).toMatch(/Dial-in copied/);
    expect(R).toMatch(/Invite copied/);
  });

  it("the section is still collapsed by default and costs nothing while closed", () => {
    // Opening by default would add a party-lines query plus a 15s poll to every
    // open of a modal most people open to pick contacts.
    expect(R).toMatch(/useState\(false\)/);
    expect(R).toMatch(/enabled: open/);
    expect(R).toMatch(/refetchInterval: open \? 15_000 : false/);
  });

  it("each row is a DIV containing buttons, never a nested button", () => {
    const rowStart = R.indexOf('className="rglass');
    expect(rowStart).toBeGreaterThan(-1);
    // The TAG that opens the row is a div — asserted whitespace-insensitively,
    // because JSX legitimately puts the className on its own line.
    const before = R.lastIndexOf("<", rowStart);
    expect(R.slice(before, before + 20)).toMatch(/^<div\s/);
  });

  it("'on the line' survives as the phrase, so this and the Dialer state one fact one way", () => {
    expect(R).toMatch(/on the line/);
  });
});
