/**
 * BOARD 1e — THE CONTACTS ROW, AND THE MEASUREMENT THAT DECIDED ITS SHAPE.
 *
 * The owner: *"Also the contacts section is not showing mmso many bugs"*. The most literal
 * reading of that turned out to be arithmetic rather than a missing feature, and it was
 * invisible in the source:
 *
 *   AT 390px THE SINGLE-LINE ROW SPENT 32px ON LIST PADDING, 42 ON THE AVATAR, 114 ON
 *   QUICK-ACTION BUTTONS AND 33 ON THE TAG CHIP — leaving the NAME 119px of the 228 that
 *   "Abdulrahman Alhammadi" needs, and 49px of it at 320. So a contact's name was cut off at
 *   EVERY width, and the row spent more of itself on chrome than on the one thing it is for.
 *
 * The fix is the shape v2.99.39 gave the Messages rows after the owner reported this exact
 * truncation ("A…"): line 1 is the name's, line 2 carries the PIN, the presence line and the
 * actions. Re-measured after: 228px and NOT truncated at 390 and 430, and the 320px overflow
 * fell from 179px to 53px.
 *
 * AND IT BROUGHT A CONTROL BACK. The video action was `hidden xs:grid` and `--breakpoint-xs`
 * is 480px, so board 1e's third quick action was absent on EVERY iPhone, reachable only from
 * the ⋮ menu. That was a defensible trade while four controls shared line 1 with the name; on
 * line 2 there is room, so nothing is hidden and the duplicate menu item is gone.
 *
 * These are STRUCTURAL pins. The numbers above come from driving the built bundle in a real
 * browser at 320/390/430 in both themes; what a test can hold is the arrangement that
 * produced them, so that is what it holds.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

const SRC = codeOnly(readFileSync(resolve(process.cwd(), "client/src/pages/app/Contacts.tsx"), "utf8"));
const CSS = readFileSync(resolve(process.cwd(), "client/src/index.css"), "utf8");

/** The `<li>` element's own className expression. */
function rowLi(): string {
  const at = SRC.indexOf("    <li\n      className={");
  expect(at, "the row's <li>").toBeGreaterThan(-1);
  const end = SRC.indexOf(">", SRC.indexOf("}", at));
  return SRC.slice(at, end);
}

describe("the row is two lines, so the name gets the width", () => {
  it("the <li> stacks rather than laying its children out in one row", () => {
    const li = rowLi();
    expect(li).toMatch(/flex flex-col/);
    expect(li, "a single-line row is what cut the name in half").not.toMatch(/flex items-center gap-3 px/);
  });

  it("line 1 holds the avatar and the name, and line 2 the PIN, presence and actions", () => {
    // Ordering by index, because the whole point is which line each thing is on.
    const l1 = SRC.indexOf('<div className="flex items-center gap-3">');
    const name = SRC.indexOf("{c.displayName || c.number}");
    const l2 = SRC.indexOf('<div className="flex items-center gap-2 ps-[54px]">');
    const pin = SRC.indexOf('{c.number.length === 6 ? c.number.slice(0, 3)');
    const acts = SRC.indexOf('aria-label="Voice call"');
    for (const [n, i] of Object.entries({ l1, name, l2, pin, acts })) expect(i, n).toBeGreaterThan(-1);
    expect(l1 < name, "the name is on line 1").toBe(true);
    expect(name < l2, "line 2 comes after the name").toBe(true);
    expect(l2 < pin && pin < acts, "the PIN and the actions are both on line 2").toBe(true);
  });

  it("the name can shrink and the things beside it cannot", () => {
    /* This is the property the measurement rests on: `truncate` needs a `min-w-0` chain to
       shrink at all, and every sibling must be `shrink-0` or flex takes the space from the
       name instead — which is how 228px of name became 119. */
    const at = SRC.indexOf("{c.displayName || c.number}");
    const l1 = SRC.slice(SRC.lastIndexOf('<div className="flex items-center gap-3">', at), at + 1400);
    expect(l1).toMatch(/className="flex-1 min-w-0"/);
    expect(l1).toMatch(/className="font-semibold truncate"/);
    expect(l1, "the tag chip must not be allowed to take from the name").toMatch(/shrink-0/);
  });

  it("line 2 indents past the avatar, so the two lines read as one row", () => {
    // `ps-`, not `pl-`: an Arabic display name flips the row, and a physical padding would
    // indent from the wrong side.
    expect(SRC).toMatch(/className="flex items-center gap-2 ps-\[54px\]"/);
    expect(SRC).not.toMatch(/className="flex items-center gap-2 pl-\[54px\]"/);
  });

  it("the actions are pinned to the trailing edge and the presence text is what yields", () => {
    const at = SRC.indexOf('<div className="ms-auto flex items-center gap-1.5 shrink-0">');
    expect(at, "`ms-auto`, not `ml-auto` — the trailing edge swaps in RTL").toBeGreaterThan(-1);
    const l2 = SRC.slice(SRC.indexOf('<div className="flex items-center gap-2 ps-[54px]">'), at);
    expect(l2, "the presence line is the only shrinkable thing on line 2").toMatch(
      /className="min-w-0 truncate text-xs text-muted-foreground"/,
    );
    expect(l2, "…and the PIN is not").toMatch(/className="shrink-0 font-mono/);
  });

  it("the PIN keeps its LTR isolation now that it sits under a possibly-RTL name", () => {
    /* v2.99.77: a 6-digit number inside an RTL paragraph has its groups reordered. Measured
       on a real Arabic row: dir=ltr, unicode-bidi=isolate, text "737-582". */
    const at = SRC.indexOf('className="shrink-0 font-mono');
    const el = SRC.slice(at, at + 260);
    expect(el).toMatch(/\[unicode-bidi:isolate\]/);
    expect(el).toMatch(/dir="ltr"/);
  });
});

describe("the video quick action is on screen on every phone", () => {
  it("it is no longer hidden below the xs breakpoint", () => {
    const at = SRC.indexOf('aria-label="Video call"');
    expect(at).toBeGreaterThan(-1);
    const btn = SRC.slice(at, at + 700);
    expect(btn, "`--breakpoint-xs` is 480px, i.e. wider than every iPhone").not.toMatch(
      /hidden xs:grid/,
    );
    expect(btn).toMatch(/className="grid place-items-center size-\[34px\]/);
  });

  it("that breakpoint really is wider than a phone, so the fix is not cosmetic", () => {
    // Read from the stylesheet rather than assumed: 30rem = 480px > 430 (iPhone Pro Max).
    const m = CSS.match(/--breakpoint-xs:\s*([\d.]+)rem/);
    expect(m, "the token this depended on").toBeTruthy();
    expect(Number((m as RegExpMatchArray)[1]) * 16).toBeGreaterThan(430);
  });

  it("the ⋮ menu no longer carries a duplicate of it", () => {
    /* A second way to do one thing, and the one that is harder to find. It existed only
       because the button was hidden; with the button always on screen it is dead weight. */
    expect(SRC).not.toMatch(/onClick=\{onVideo\} className="xs:hidden"/);
    expect((SRC.match(/onClick=\{onVideo\}/g) ?? []).length, "exactly one video action").toBe(1);
  });

  it("all four controls are still there — nothing was traded away for the room", () => {
    for (const label of ["Message", "Video call", "Voice call", "More options"]) {
      expect((SRC.match(new RegExp(`aria-label="${label}"`, "g")) ?? []).length, label).toBe(1);
    }
  });
});

describe("the section header's online count says what it is counting", () => {
  it("it carries the word, not a bare integer", () => {
    /* Rendered as two bare numbers this header read "10 3", and what the second one meant
       lived only in a `title` — which a phone has no way to show. */
    const at = SRC.indexOf("{onlineCount > 0 && (");
    expect(at).toBeGreaterThan(-1);
    const arm = SRC.slice(at, at + 420);
    expect(arm).toMatch(/\{onlineCount\} online/);
    expect(arm, "a presence dot beside it, in the presence green").toMatch(
      /bg-\[color:var\(--relay-online\)\]/,
    );
  });

  it("the ONLINE section does NOT repeat the word its own label already says", () => {
    /* Measured with the word in place and the header read "Online … 3 online". */
    const at = SRC.indexOf("{section.allActive ? (");
    expect(at).toBeGreaterThan(-1);
    const arm = SRC.slice(at, SRC.indexOf(") : (", at));
    expect(arm, "the count it stands for is still announced").toMatch(/title=\{`\$\{total\} online`\}/);
    /* Scoped to what is RENDERED, not to the whole arm — the `title` legitimately spells the
       word, so a bare `not.toMatch` here fails on correct code. That is the same shape as the
       prose trap, one attribute along. */
    const rendered = arm
      .slice(arm.indexOf(">", arm.indexOf("title=")), arm.lastIndexOf("</span>"))
      // …and with the ATTRIBUTES stripped, because the presence dot's own class names
      // `--relay-online` — matching that would fail on correct code too.
      .replace(/className="[^"]*"/g, "");
    expect(rendered.length).toBeGreaterThan(20);
    expect(rendered).toMatch(/\{total\}/);
    expect(rendered, "the label already says Online").not.toMatch(/online/i);
  });

  it("the green is the AA-measured TEXT token, never the LED hue", () => {
    /* v2.99.86 measured the LED green at 4.46:1 as small text and gave it a darker sibling
       for exactly this. The dot may use the LED; the words may not. */
    const at = SRC.indexOf("{section.allActive ? (");
    const counts = SRC.slice(at, SRC.indexOf("{!isCollapsed && (", at));
    expect(counts).toMatch(/text-\[color:var\(--relay-green-text\)\]/);
    expect(counts, "the LED hue only ever paints the dot").not.toMatch(
      /text-\[color:var\(--relay-online\)\]/,
    );
  });

  it("both counts come from the same predicate the Online section uses", () => {
    // A header that counted differently from the rows under it is worse than no count.
    expect(SRC).toMatch(/const onlineCount = section\.rows\.filter\(isActiveContact\)\.length;/);
    expect(SRC).toMatch(/const total = section\.rows\.length;/);
  });
});
