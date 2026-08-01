/**
 * "I CANNOT SEND MESSAGES" AND "THE CONTACTS SECTION IS NOT SHOWING".
 *
 * THE FIRST THING ESTABLISHED, because it changes what the rest of this file is for: the
 * fleet was serving v2.106.22 while these fixes sat unmerged on a branch. Four of the
 * owner's reports were already-fixed-and-undeployed bugs — the keyboard-viewport write
 * (v2.106.29), the voice-note lock-out (v2.106.30), the canvas painting over unpositioned
 * content (v2.106.27) and the missing Contacts error arm (v2.106.25). That is a DEPLOY
 * problem and no test can fix it.
 *
 * What IS in scope is everything a 12-designer audit found still wrong on the branch, and
 * the two groups it falls into are the owner's own two sentences:
 *
 *   THE COMPOSER can still be replaced, or entered dead:
 *     - `recording` stayed true across the UPLOAD, and while it is true the composer is
 *       REPLACED by the recording bar, whose three controls are all disabled mid-upload.
 *       The v2.106.30 lock-out, one step downstream: a 60s note on a slow uplink left no
 *       text field, no send and no way out; a hung transfer left it indefinitely.
 *     - the mic did not read `uploading` while the field beside it did, so tapping it
 *       during a photo upload opened the bar with a LIVE MIC and every control dead.
 *     - nothing reset it on a thread change, so the bar sat over the NEW conversation with
 *       a take belonging to the old one — the sibling of a reset `pendingUpload` has had
 *       300 lines away for releases.
 *     - the composer and header rely on the flex automatic-minimum-size DEFAULT, which
 *       stops applying the moment either becomes a scroll container.
 *     - `--relay-vh` reverted to `window.innerHeight` under a pinch-zoom (reinstating the
 *       keyboard bug at exactly the moment somebody is typing carefully), and its 320px
 *       floor made it LARGER than a genuine landscape-with-keyboard viewport.
 *
 *   CONTACTS could not be read, or lost data when it was:
 *     - every section heading was the raw accent as text: MEASURED 1.59:1 on the light
 *       card, i.e. ONLINE / FAVORITES / FAMILY / FRIENDS / TEAM did not show in the theme
 *       the app ships.
 *     - the four tag chips were 1.53-1.71:1 in light, fixed to 4.65-4.81:1.
 *     - BOTH writers sent `category` alone. `contactUpdateKeys` couples the two columns, so
 *       that one value re-derived `tags` from itself and destroyed the rest: saving a
 *       contact's phone number dropped them out of their sections.
 *     - a presence-table hiccup threw out of `contacts.list` and took the whole address
 *       book with it, while the two sibling decoration reads were already guarded.
 *     - "All contacts" excluded favourites and everybody tagged.
 *
 * SOURCE-PINNED where the claim is structural and MEASURED where it is a number: the
 * contrast figures were computed from pixels painted in a real browser (Chromium hands
 * `oklch()` back verbatim, and an alpha fill on a transparent canvas reads back opaque —
 * both traps this repo has recorded), and they live in `contactTags.test.ts` beside the
 * recipes. What is NOT claimed: that any of this was watched happen on the owner's phone.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
/** Comment-stripped. Every fix below EXPLAINS in prose what it must not do, and this repo
 *  has matched its own prose sixteen times. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const MSG = strip(root("client/src/pages/app/Messages.tsx"));
const CONTACTS = strip(root("client/src/pages/app/Contacts.tsx"));
const SHELL = strip(root("client/src/app/AppShell.tsx"));
const ROUTERS = strip(root("server/v2routers.ts"));
const CSS = root("client/src/index.css");

/** A function body located by BRACE MATCHING, not a fixed slice — the v2.99.78 fragility,
 *  which has bitten this repo six times. */
function fnBody(src: string, decl: string): string {
  const at = src.indexOf(decl);
  expect(at, `${decl} must exist`).toBeGreaterThan(-1);
  let i = src.indexOf("{", at + decl.length - 1);
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error(`unbalanced body for ${decl}`);
}

describe("the composer cannot be replaced by a bar with no way out", () => {
  it("the recording flags are cleared BEFORE the upload, not after it", () => {
    /* The recording is over by the time `.then` runs — the take is in hand and the mic is
       released — so the bar, which exists to represent a LIVE recording, must not outlive
       one. Ordering is the whole assertion: after the await, the composer is gone for the
       duration of the transfer. */
    const start = fnBody(MSG, "async function startRecording()");
    const then = start.slice(start.indexOf(".then(async (result)"), start.indexOf(".finally("));
    expect(then, "the reset must be inside the then-handler").toMatch(/setRecording\(false\)/);
    expect(
      then.indexOf("setRecording(false)") < then.indexOf("await uploadBlob"),
      "the composer must come back before the upload is awaited",
    ).toBe(true);
    expect(then, "…and the ref too, or Discard has nothing to cancel").toMatch(
      /recordingRef\.current = null/,
    );
  });

  it("…and the .finally() is KEPT, so one mechanism is never the only one", () => {
    /* These are cheap flag writes and setting them twice is idempotent. Relying on a
       single mechanism is how the original lock-out happened. */
    const start = fnBody(MSG, "async function startRecording()");
    const fin = start.slice(start.indexOf(".finally("));
    expect(fin).toMatch(/setRecording\(false\)/);
    expect(fin).toMatch(/setRecPaused\(false\)/);
  });

  it("whatever STARTS a recording reads `uploading`, as the text field beside it does", () => {
    /* Without it, a tap opened a live microphone into a bar whose three controls were
       already disabled by that same flag — a recording nobody could stop, discard or send.
       v2.106.64 moved the entry point from the mic BUTTON into the + menu (the owner's
       ask), and the old pin also required `!recording` — a clause that only made sense
       while one button did both jobs. Pinned on the property: every control that calls
       `startRecording` is gated on `uploading`. */
    const starters = MSG.match(/<button[\s\S]{0,600}?startRecording\(\)[\s\S]{0,600}?<\/button>/g) ?? [];
    expect(starters.length, "something must start a recording").toBeGreaterThan(0);
    for (const b of starters) {
      expect(b, "a recording starter must be gated on `uploading`").toMatch(
        /disabled=\{[^}]*uploading[^}]*\}/,
      );
      expect(b, "…and on recorder support").toMatch(/!recorderSupported\(\)/);
    }
  });

  it("leaving the thread ends the recording", () => {
    /* `pendingUpload` is reset on a conversation change for exactly this reason. A
       recording had no such reset, so the bar sat over the NEW conversation with a live
       mic and a take belonging to the old one. */
    const effects = MSG.match(/useEffect\(\(\) => \{[\s\S]{0,240}?\}, \[conversationId\]\);/g) ?? [];
    expect(
      effects.some((e) => /discardRecording\(\)/.test(e)),
      "a [conversationId] effect must discard the recording",
    ).toBe(true);
  });

  it("the composer and the header declare that they do not shrink", () => {
    /* Both survived only on the flex automatic-minimum-size DEFAULT (an item's min-height
       is its content), which stops applying the moment either becomes a scroll container
       or takes a min-h-0 — at which point the list, which legitimately grows, wins. */
    const composer = MSG.match(/<div className="shrink-0 px-3 md:px-5 py-3 border-t border-border bg-card/);
    expect(composer, "the composer row must be shrink-0").toBeTruthy();
    expect(MSG).toMatch(/<header className="shrink-0 flex items-center gap-2 px-2 md:px-4 py-2 border-b/);
  });

  it("the conversation column paints its own surface on MOBILE, so a gap reads as a gap", () => {
    /* Both the list and the composer are fully opaque, so a region of this column showing
       the background CANVAS is by definition a region neither covers — a layout shortfall.
       This does not fix a shortfall; it makes one look like a gap in the app rather than
       like the app having ended, which is the difference between a screenshot that is
       diagnostic and the one the owner sent. */
    const m = CONTACTS === MSG ? null : MSG.match(/"flex-1 min-w-0 flex-col min-h-0 ([^"]*)"/);
    expect(m, "the conversation column's class string must exist").toBeTruthy();
    const cls = (m as RegExpMatchArray)[1];
    expect(cls, "an unprefixed background, not md: only").toMatch(/(^|\s)bg-background(\s|$)/);
    expect(cls, "desktop keeps the card surface").toMatch(/md:bg-card/);
  });
});

describe("the measured viewport height cannot revert to the value that caused the bug", () => {
  it("a pinch-zoom CONVERTS the visible height rather than bailing to innerHeight", () => {
    /* Bailing sounds cautious and is not: it falls back to `window.innerHeight`, the value
       that does not shrink for the keyboard on iOS — so a zoom silently reinstated the
       exact bug this effect exists to fix, at the moment somebody is typing carefully.
       `vv.height` is in the zoomed viewport's CSS px, so × scale recovers layout px; at
       scale 1 it is byte-identical to reading `vv.height`. */
    const m = SHELL.match(/const visible = [^;]+;/);
    expect(m, "the visible-height derivation must exist").toBeTruthy();
    const expr = (m as RegExpMatchArray)[0];
    expect(expr).toMatch(/vv\.height \* vv\.scale/);
    expect(expr, "the scale must no longer gate it to Infinity").not.toMatch(/scale <= 1\.01/);
  });

  it("a viewport MOVE is read, so the scroll listener is not inert", () => {
    /* The listener beside `resize` carries a comment saying iOS MOVES the visual viewport
       and that a move with no resize still changes what is on screen — and `set()` read
       only height, scale and innerHeight, none of which a move changes. It fired and wrote
       a byte-identical value. The visible band is [offsetTop, offsetTop + height] and the
       scroll-locked shell starts at 0, so its bottom must REACH the band's bottom: without
       the term the shell is short by exactly `offsetTop`, which puts the composer below the
       fold while the tab bar — the last child — can still be on screen. */
    expect(SHELL, "the moved quantity must actually be read").toMatch(/vv\.offsetTop/);
    const m = SHELL.match(/const visible = [^;]+;/);
    expect((m as RegExpMatchArray)[0]).toMatch(/vv\.height \* vv\.scale \+ vv\.offsetTop/);
    // and the listener that the term exists for is still subscribed
    expect(SHELL).toMatch(/vv\?\.addEventListener\("scroll", set\)/);
  });

  it("the floor catches only an IMPLAUSIBLE reading, never a small real one", () => {
    /* A hard 320 floor makes `--relay-vh` LARGER than the viewport in landscape with the
       keyboard up, where ~220px visible is genuine — and being taller than the visible
       area is how the composer ends up under the keyboard. A non-positive reading is the
       one that cannot be true, so that is what falls back. */
    expect(SHELL).toMatch(/const measured = Math\.round\(Math\.min\(window\.innerHeight, visible\)\)/);
    expect(SHELL).toMatch(/const h = measured > 0 \? measured : Math\.max\(320, window\.innerHeight\)/);
    expect(SHELL, "the unconditional floor is what this replaced").not.toMatch(
      /Math\.max\(320, Math\.round\(Math\.min\(window\.innerHeight, visible\)\)\)/,
    );
  });
});

describe("contacts can be read", () => {
  it("no section heading sets the raw accent in a colour position", () => {
    expect(CONTACTS, "1.59:1 on the light card").not.toMatch(/color:\s*["'`]?\s*var\(--rb/);
    expect(CONTACTS).toMatch(/text-primary/);
  });

  it("each tag recipe exists AND carries its own light-theme text colour", () => {
    /* The light value is an OVERRIDE rather than a replacement, and that split is why this
       needed CSS at all: the darker same-hue text measures ~2:1 on the DARK chip, i.e.
       worse than what it replaces. One value cannot serve both themes, and an inline style
       cannot branch on one. */
    for (const t of ["vip", "family", "friend", "team"]) {
      expect(CSS).toMatch(new RegExp(`\\.relay-v2 \\.rtag-${t}\\s*\\{[^}]*color`));
      expect(CSS).toMatch(new RegExp(`\\.relay-v2:not\\(\\.dark\\) \\.rtag-${t}\\s*\\{[^}]*color`));
    }
    // the FILL and the HAIRLINE stay the board's — only the word became readable
    expect(CSS).toMatch(/\.rtag-vip\s*\{[^}]*background: #e8c94a21/);
    expect(CSS).toMatch(/\.rtag-vip\s*\{[^}]*border-color: #e8c94a73/);
  });

  it("a presence or busy-line failure costs the LED, never the address book", () => {
    /* `getRolesByIdentityIds` above already swallows its own failure by design. These two
       did not, and `getPresenceForIds` has no try/catch of its own — so one hiccup on the
       `presence` table threw out of the resolver and the caller got NOTHING. A contact row
       is worth serving without its green dot. */
    const listBody = ROUTERS.slice(
      ROUTERS.indexOf("export const v2ContactsRouter"),
      ROUTERS.indexOf("upsert:", ROUTERS.indexOf("export const v2ContactsRouter")),
    );
    expect(listBody.length, "the list resolver slice must be real").toBeGreaterThan(400);
    /* `[^;]` rather than `[\s\S]` — and that is not pedantry, it is the fix for a real gap
       this file's own mutation run exposed. The first version allowed any 200 characters
       between the call and a `.catch(`, and the very NEXT statement is
       `pinsInCallAsync(...).catch(...)` — so reinstating the unguarded presence read
       SURVIVED, because the regex happily matched its neighbour's catch. A statement
       boundary is what makes the handler provably attached to THIS call. */
    expect(listBody).toMatch(/getPresenceForIds\(ids\)[^;]{0,200}\.catch\(/);
    /* …and the identity read too, which was missed on the first pass. Same blast radius,
       different table, and decoration by the same test: every field the row shows comes
       from `rows`, while this supplies the live avatar, role and verified flag. */
    expect(listBody).toMatch(/getIdentitiesByNumbers\([^;]{0,120}\.catch\(/);
    expect(listBody).toMatch(/pinsInCallAsync\([^;]{0,120}\.catch\(/);
    expect(listBody, "the bare read is what took the address book down").not.toMatch(
      /const presList = await getPresenceForIds\(ids\);/,
    );
  });

  it("the 'everybody else' section does not claim to be everybody", () => {
    /* This bucket is `!favourite && no tags`, so "All contacts" was a false claim about
       somebody's own directory — a VIP, a favourite and anybody labelled are excluded. */
    expect(CONTACTS).not.toMatch(/label: "All contacts"/);
    expect(CONTACTS).toMatch(/key: "other", labelKey: "contacts\.everyoneElse"/);
  });

  it("the empty state names BOTH narrowings when both are active", () => {
    /* The three-way version blamed the search alone, so it never mentioned the lit chip
       and never offered the one-tap recovery — leaving somebody retyping a query that was
       never the reason. */
    expect(CONTACTS).toMatch(/search && tagFilter/);
    expect(CONTACTS).toMatch(/is labelled \$\{TAG_LABEL\[tagFilter\]\}/);
  });
});

describe("editing a contact cannot destroy their labels", () => {
  it("BOTH writers send the whole tag set, never the `category` mirror", () => {
    /* `category` is the derived mirror of `tags[0]`, and `contactUpdateKeys` couples the
       two — so a category-only write re-derived `tags` FROM it and silently destroyed
       every label after the first. Two writers, so both are asserted: a fix to one is
       exactly how the other comes to be forgotten. */
    expect(CONTACTS, "the row menu").toMatch(
      /onSetCategory=\{\(category\) =>[\s\S]{0,320}tags: toggleContactTag\(/,
    );
    expect(CONTACTS, "the edit dialog").toMatch(/birthday: birthday\.trim\(\) \|\| null,\s*\n\s*tags,/);
    expect(CONTACTS, "neither may write the mirror alone").not.toMatch(
      /upsert\.mutate\(\{ number: c\.number, category:/,
    );
  });

  it("the dialog is seeded from the RESOLVED list, so a save cannot narrow it", () => {
    expect(CONTACTS).toMatch(/tags: contactTagsOf\(\{ tags: c\.tags\?\.join\(","\) \?\? null/);
    expect(CONTACTS).toMatch(/const \[tags, setTags\] = useState<ContactTag\[\]>\(editing\.tags \?\? \[\]\)/);
  });

  it("the row menu's tick reads the resolved tags, not the mirror", () => {
    /* `category` is only `tags[0]`, so a contact tagged VIP + Family had Family sitting
       unticked in a menu whose row above it rendered a Family chip and whose section
       header said FAMILY. */
    const m = CONTACTS.match(/const active = contactTagsOf\(\{[\s\S]{0,140}\}\)\.includes\(cat\)/);
    expect(m, "the tick must derive from the resolved list").toBeTruthy();
    expect(CONTACTS).not.toMatch(/const active = c\.category === cat/);
  });
});
