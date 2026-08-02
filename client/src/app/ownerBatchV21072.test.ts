/**
 * v2.107.2 — the owner's four-screenshot batch.
 *
 *   1. *"Redesign these screens to make sure that it's showing because it's overlapping
 *       and cannot see"*  → the group roster's member rows.
 *   2. *"For this group call area, make it more friendly, more clear because you're so
 *       much talks routine and it's not clear"*  → the party-lines section's prose.
 *   3. *"my own status if I click on it, if you see the top bar doesn't show because
 *       it's over lap on the top navigation bar, so make it low"*  → the story viewer.
 *   4. *"When I record the voice, it doesn't show me that it's, uh, like the wave
 *       volume. When I talk, it's, like, balding. It doesn't work."*  → the level meter.
 *
 * These are SOURCE pins for four structural properties. Two of the four (the roster's
 * widths and the section's prose height) were established by MEASUREMENT against the
 * real built stylesheet at 320/360/375/390/430 rather than by reading — the numbers are
 * recorded in the code comments, because a source assertion cannot say whether a name
 * fits. What is pinned here is the SHAPE that produced those numbers, so a later change
 * that reverts the shape goes red rather than silently re-truncating.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const SHEET = read("client/src/app/GroupInfoSheet.tsx");
const GROUPCALL = read("client/src/pages/app/GroupCallScreen.tsx");
const DICT = read("client/src/app/dict/groupcall.ts");
const STATUS = read("client/src/pages/app/Status.tsx");
const VOICE = read("client/src/lib/voiceNote.ts");
const SHELL = read("client/src/app/AppShell.tsx");

/* ══ 1 — THE GROUP ROSTER ROW IS TWO LINES ═══════════════════════════════════════ */

describe("1 — a member's name is no longer the only thing that can shrink", () => {
  it("the row is a block, with the identity on its own flex line", () => {
    /* The defect was ONE flex line holding the avatar, a `min-w-0 flex-1` name column
       and two `shrink-0` buttons: the buttons kept their width and the name absorbed
       every shortfall. Measured, its box was 0px at 320px — an ellipsis and nothing
       else, the owner's "M.." — and 15 of 20 name cells truncated, including at 430. */
    const li = SHEET.indexOf('<li key={m.id}');
    expect(li, "the member row must exist").toBeGreaterThan(0);
    const row = SHEET.slice(li, SHEET.indexOf("</li>", li));
    expect(row.length, "the slice must be real").toBeGreaterThan(600);

    // The <li> itself no longer lays the row out horizontally.
    const liTag = row.slice(0, row.indexOf(">") + 1);
    expect(liTag, "the row is no longer one flex line").not.toMatch(/\bflex\b/);
    // The identity (avatar + name column) is its own flex line.
    expect(row).toMatch(/<div className="flex items-center gap-2">/);
    // The name column still shrinks and still truncates — that is what keeps a
    // 21-character name from pushing the row sideways once it HAS the width.
    expect(row).toMatch(/className="min-w-0 flex-1"/);
    expect(row).toMatch(/min-w-0 truncate text-\[12\.5px\] font-semibold/);
  });

  it("the controls sit on their own line, indented past the avatar, logically", () => {
    const li = SHEET.indexOf('<li key={m.id}');
    const row = SHEET.slice(li, SHEET.indexOf("</li>", li));
    // 34px avatar + the identity line's own 8px gap.
    expect(row).toMatch(/className="mt-1\.5 flex flex-wrap gap-1\.5 ps-\[42px\]"/);
    /* LOGICAL, never `pl-`: an Arabic sheet must indent from the trailing edge, or the
       buttons sit under nothing. This is the standing rule `rtlSweep` enforces app-wide;
       asserted here too because it is the specific thing this row's indent depends on. */
    expect(row, "the indent must mirror in Arabic").not.toMatch(/\bpl-\[42px\]/);
  });

  it("the controls line is gated, so an ordinary member's row is unchanged", () => {
    /* The +41px this costs is paid ONLY by an admin. Without the gate every member
       would pay `mt-1.5` for an empty div — and the whole argument for accepting a
       taller row is that it is confined to the people who need the controls. */
    const li = SHEET.indexOf('<li key={m.id}');
    const row = SHEET.slice(li, SHEET.indexOf("</li>", li));
    const gate = row.indexOf("{iAmAdmin && !m.isCreator && (");
    expect(gate, "the controls line is admin-only and spares the creator").toBeGreaterThan(0);
    const line = row.indexOf('className="mt-1.5 flex flex-wrap gap-1.5 ps-[42px]"', gate);
    expect(line, "…and the gate wraps the line, not just the buttons").toBeGreaterThan(gate);
    // A constant would satisfy an indexOf while deciding nothing.
    expect(codeOnly(SHEET)).not.toMatch(/\{(true|false) && !m\.isCreator/);
  });

  it("the 44px touch floor survives — shrinking the buttons was the refused fix", () => {
    /* The cheaper fix was narrower controls, and one of the two being narrowed would
       have been Remove. `min-h-11` is the floor this codebase applies everywhere. */
    const li = SHEET.indexOf('<li key={m.id}');
    const row = SHEET.slice(li, SHEET.indexOf("</li>", li));
    expect((row.match(/min-h-11/g) || []).length, "both controls keep 44px").toBe(2);
  });
});

/* ══ 2 — THE PARTY-LINES SECTION SAYS IT ONCE ════════════════════════════════════ */

describe("2 — one sentence of explanation, not two paragraphs", () => {
  it("the mono caption is gone from the screen AND from the dictionary", () => {
    /* MEASURED at 320px: caption 29px + paragraph 64px = 93px of prose above a 36px
       field, i.e. 59% of the section was explanation saying one thing twice. Deleting
       the KEY as well as the render site matters — a key with no reader reads as
       coverage, which is what `dictCoverage` exists to catch. */
    expect(GROUPCALL, "the caption is not rendered").not.toMatch(/groupcall\.lineHint/);
    expect(DICT, "…and the key is retired, not orphaned").not.toMatch(/"groupcall\.lineHint"/);
  });

  it("the surviving line carries the capacity, from the live transport", () => {
    // A hardcoded 10 would be a false claim: every call runs the mesh, cap 6.
    expect(GROUPCALL).toMatch(/const lineCap = engine\.maxParticipants/);
    expect(GROUPCALL).toMatch(/t\("groupcall\.lineAbout", \{ max: lineCap \}\)/);
    for (const half of ["en", "ar"] as const) {
      const m = DICT.match(
        new RegExp(`"groupcall\\.lineAbout":\\s*\\{[\\s\\S]{0,400}?${half}:\\s*"([^"]+)"`),
      );
      expect(m, `lineAbout has an ${half} half`).toBeTruthy();
      expect(m![1], `the ${half} half states the capacity`).toContain("{max}");
    }
  });

  it("it is plain readable type, not the mono uppercase caption voice", () => {
    /* A mono uppercase run at .18em tracking is a three-or-four-word section LABEL.
       Asking it to carry a sentence is part of what made this hard to read, so the
       surviving line must NOT inherit that treatment. */
    const at = GROUPCALL.indexOf('t("groupcall.lineAbout"');
    expect(at).toBeGreaterThan(0);
    const el = GROUPCALL.slice(GROUPCALL.lastIndexOf("<p", at), at);
    expect(el, "plain type").not.toMatch(/font-mono/);
    expect(el, "plain type").not.toMatch(/uppercase/);
    expect(el, "plain type").not.toMatch(/tracking-\[/);
  });
});

/* ══ 3 — THE STORY VIEWER ESCAPES THE SHELL'S STACKING CONTEXT ═══════════════════ */

describe("3 — the story viewer is not painted under the navigation", () => {
  it("AppShell really does trap z-index around the page content", () => {
    /* THE PREMISE, ASSERTED RATHER THAN ASSUMED. `position` plus a non-auto `z-index`
       creates a stacking context, so a `z-[100]` descendant of this wrapper competes
       with the top bar as the wrapper's own 10 — and loses. If this ever stops being
       true the portal is merely belt-and-braces rather than load-bearing, and whoever
       changes it should see this go red and re-read the reasoning. */
    expect(SHELL, "the content wrapper creates a stacking context").toMatch(
      /className="relative z-10 flex-1 min-h-0 overflow-y-auto/,
    );
    expect(SHELL, "the top bar sits above it").toMatch(/sticky top-0 z-30/);
  });

  it("the viewer is portalled to document.body", () => {
    const fn = STATUS.indexOf("function StatusViewer(");
    expect(fn, "StatusViewer must exist").toBeGreaterThan(0);
    const body = STATUS.slice(fn, STATUS.indexOf("\nfunction ", fn + 10));
    expect(body.length, "the slice must be real").toBeGreaterThan(600);
    expect(body).toMatch(/return createPortal\(/);
    expect(body).toMatch(/document\.body,/);
    // Raising the number cannot fix a trapped context; the escape is the portal.
    expect(body).toMatch(/fixed inset-0 z-\[100\]/);
  });

  it("its chrome clears the notch, and a device with no inset is unchanged", () => {
    const fn = STATUS.indexOf("function StatusViewer(");
    const body = STATUS.slice(fn, STATUS.indexOf("\nfunction ", fn + 10));
    expect(body).toMatch(/paddingTop: "max\(12px, env\(safe-area-inset-top\)\)"/);
    // `max(12px, …)` and not a bare env(): a device with no inset must keep exactly
    // the 12px this had before, rather than losing its top padding entirely.
    expect(codeOnly(body), "no bare inset").not.toMatch(/paddingTop: "env\(safe-area-inset-top\)"/);
  });

  it("the composer stays portalled too — this fixes one of two, not one instead", () => {
    // v2.99.49 portalled the composer for the same class of reason. Both must hold.
    const code = codeOnly(STATUS);
    expect((code.match(/createPortal\(/g) || []).length).toBe(2);
    // No trailing comma required — the composer's call is a two-argument one-liner and
    // the viewer's is multi-line. Counted on comment-stripped source, because both
    // portals are ALSO explained in prose that names `document.body`.
    expect((code.match(/document\.body/g) || []).length).toBe(2);
  });
});

/* ══ 4 — THE LEVEL METER RUNS, SO THE BARS MOVE ══════════════════════════════════ */

describe("4 — the recording waveform is driven by a context that is actually running", () => {
  it("the context is constructed AND resumed before the first await", () => {
    /* WebKit starts a context created outside a user gesture SUSPENDED, and a suspended
       context does not run its graph: `getByteTimeDomainData` keeps returning the
       all-128 midpoint fill and `level()` returns exactly 0 for the whole take. The 30
       bars are driven by nothing else, so they sit flat — the owner's "balding".
       v2.106.89 diagnosed that correctly and put BOTH the construction and the resume
       AFTER `await getUserMedia`, where the gesture is spent and a resume is refused
       too — so the fix read as done and changed nothing on the one engine it targeted.
       The gesture is live only for this function's synchronous prefix. */
    const iCtor = VOICE.indexOf("ac = new Ctor();");
    const iResume = VOICE.indexOf("void ac.resume?.()");
    const iGum = VOICE.indexOf("await navigator.mediaDevices.getUserMedia");
    for (const [n, i] of [["construction", iCtor], ["resume", iResume], ["getUserMedia", iGum]] as const) {
      expect(i, `${n} must exist`).toBeGreaterThan(0);
    }
    expect(iCtor, "constructed while the gesture is live").toBeLessThan(iGum);
    expect(iResume, "resumed while the gesture is live").toBeLessThan(iGum);
  });

  it("the graph — and only the graph — is wired after the stream exists", () => {
    /* `createMediaStreamSource` genuinely needs the stream; `new AudioContext()` does
       not. Splitting them is the whole fix, so a SECOND construction after the await
       would silently reinstate the defect while this file still had a correct one. */
    expect(VOICE.match(/ac = new Ctor\(\);/g)?.length, "exactly one construction").toBe(1);
    expect(VOICE.match(/void ac\.resume\?\.\(\)/g)?.length, "exactly one resume").toBe(1);
    const iSrc = VOICE.indexOf("ac.createMediaStreamSource(stream)");
    const iGum = VOICE.indexOf("await navigator.mediaDevices.getUserMedia");
    expect(iSrc, "the graph is wired").toBeGreaterThan(0);
    expect(iSrc, "…after the stream exists").toBeGreaterThan(iGum);
  });

  it("a refused microphone still closes the context", () => {
    /* #160's rule. The context is already OPEN by the time permission is refused, and
       on iOS an open context keeps the audio session claimed — with nothing left
       holding a reference to it, since the throw leaves this function. */
    expect(VOICE).toMatch(
      /catch \(e\) \{[\s\S]{0,260}void ac\?\.close\?\.\(\)[\s\S]{0,200}throw e/,
    );
  });

  it("the meter is never a reason recording fails", () => {
    // Every failure path leaves `level()` returning 0 rather than throwing: the resume
    // is fire-and-forget, the construction is wrapped, and the graph is wrapped.
    expect(VOICE).toMatch(/void ac\.resume\?\.\(\)\.catch\(/);
    expect(VOICE).toMatch(/const level = \(\): number => \{\s*\n\s*if \(!analyser \|\| !levelBuf\) return 0;/);
  });
});
