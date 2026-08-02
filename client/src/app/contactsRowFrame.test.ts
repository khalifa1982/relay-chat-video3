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
import { translate, DICT } from "./i18n";
import { onlineCountKey, contactCountKey, tagLabelKey } from "../pages/app/Contacts";

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

  it("line 1 holds the avatar, name, badge and PIN; line 2 the presence line and actions", () => {
    /* Ordering by index, because the whole point is which line each thing is on.
       THE PIN MOVED TO LINE 1 in v2.106.43, and the owner's reason was arithmetic: on line 2
       it was `shrink-0` while the presence text was the only shrinkable thing, so at 375px
       the presence line got 72px of the 99 that "last seen 3h ago" needs and every row read
       "last seen …". */
    const l1 = SRC.indexOf('<div className="flex items-center gap-3">');
    const name = SRC.indexOf("{c.displayName || c.number}");
    const badge = SRC.indexOf("<RoleBadge role={roleFromFlags(c.role, c.verified)}");
    const pin = SRC.indexOf('{c.number.length === 6 ? c.number.slice(0, 3)');
    const l2 = SRC.indexOf('<div className="flex items-center gap-2 ps-[54px]">');
    const seen = SRC.indexOf("last seen {relativeTime(c.lastSeenAt)}");
    const acts = SRC.indexOf('aria-label={t("contacts.voiceCall")}');
    for (const [n, i] of Object.entries({ l1, name, badge, pin, l2, seen, acts }))
      expect(i, n).toBeGreaterThan(-1);
    expect(l1 < name, "the name is on line 1").toBe(true);
    expect(name < badge && badge < pin, "the PIN comes AFTER the badge — the owner's words").toBe(true);
    expect(pin < l2, "…and therefore on line 1, above the second row").toBe(true);
    expect(l2 < seen && seen < acts, "line 2 is the presence line then the actions").toBe(true);
  });

  it("the PIN is the ONE thing rendered once, and it is not still on line 2", () => {
    /* A move that leaves a copy behind is the shape that reads as done and is not: the row
       would show the number twice and line 2 would get none of its cell back. */
    expect((SRC.match(/\{c\.number\.length === 6 \? c\.number\.slice\(0, 3\)/g) ?? []).length).toBe(1);
    const line2 = SRC.slice(SRC.indexOf('<div className="flex items-center gap-2 ps-[54px]">'));
    expect(line2, "line 2 no longer holds a mono number").not.toMatch(/shrink-0 font-mono/);
  });

  it("the PIN wears the app's own AA-measured green, not the LED hue", () => {
    /* GREEN IS NOT A NEW MEANING HERE. The top bar has rendered the viewer's OWN number in
       this exact token since v2.99.86 — which is where the token came from: the LED green
       measures 4.46:1 as small text and FAILS AA, so `--relay-green-text` exists for a number
       at this size (measured here again: 5.92:1 light / 9.27:1 dark). A contact's number now
       matches the reader's own. */
    const at = SRC.indexOf('{c.number.length === 6 ? c.number.slice(0, 3)');
    const el = SRC.slice(SRC.lastIndexOf("<span", at), at);
    expect(el).toMatch(/text-\[color:var\(--relay-green-text\)\]/);
    expect(el, "the LED hue fails AA at this size").not.toMatch(/var\(--relay-online\)/);
    expect(CSS, "and the token really is the darker sibling").toMatch(
      /--relay-green-text:\s*oklch\(0\.4[0-9]/,
    );
  });

  it("the presence line is now the only occupant of its span", () => {
    // Which is the whole fix: nothing `shrink-0` sits between the indent and the buttons.
    const l2 = SRC.slice(
      SRC.indexOf('<div className="flex items-center gap-2 ps-[54px]">'),
      SRC.indexOf('<div className="ms-auto flex items-center gap-1.5 shrink-0">'),
    );
    expect(l2.length).toBeGreaterThan(200);
    expect(l2).toMatch(/className="min-w-0 truncate text-xs text-muted-foreground"/);
    expect(l2, "nothing unshrinkable may come back in front of it").not.toMatch(/shrink-0/);
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
    /* The second half of this used to read "…and the PIN is not [shrinkable]", which was
       correct while the PIN lived here and is exactly what the owner asked to change: it was
       `shrink-0` in front of the only shrinkable thing, so it took its cell out of the
       presence line's budget at every width. The PIN's own properties are pinned above, at
       its new home on line 1. */
  });

  it("the PIN keeps its LTR isolation, which matters more beside a possibly-RTL name", () => {
    /* v2.99.77: a 6-digit number inside an RTL paragraph has its groups reordered. It now sits
       INLINE with the display name rather than on the line below it, so an Arabic name is a
       direct neighbour. Measured on a real Arabic row after the move: dir=ltr,
       unicode-bidi=isolate, text "737-582", positioned after the badge. */
    const at = SRC.indexOf('{c.number.length === 6 ? c.number.slice(0, 3)');
    const el = SRC.slice(SRC.lastIndexOf("<span", at), at);
    expect(el).toMatch(/\[unicode-bidi:isolate\]/);
    expect(el).toMatch(/dir="ltr"/);
    expect(el, "and it cannot be squeezed by the name beside it").toMatch(/shrink-0/);
  });
});

describe("the video quick action is on screen on every phone", () => {
  it("it is no longer hidden below the xs breakpoint", () => {
    const at = SRC.indexOf('aria-label={t("contacts.videoCall")}');
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
    /* v2.106.85: the labels moved into the dictionary, so the four controls are
       counted by their KEY. The property — none of the four was traded away for
       the room the two-line row bought — is unchanged. */
    for (const label of [
      "contacts.message",
      "contacts.videoCall",
      "contacts.voiceCall",
      "contacts.moreOptions",
    ]) {
      expect(
        (SRC.match(new RegExp("aria-label=\\{t\\(\"" + label.split(".").join("\\.") + "\"\\)\\}", "g")) ?? [])
          .length,
        label,
      ).toBe(1);
    }
  });
});

describe("the section header's online count says what it is counting", () => {
  it("it carries the word, not a bare integer", () => {
    /* Rendered as two bare numbers this header read "10 3", and what the second one meant
       lived only in a `title` — which a phone has no way to show. */
    const at = SRC.indexOf("{onlineCount > 0 && (");
    expect(at).toBeGreaterThan(-1);
    const arm = SRC.slice(at, at + 460);
    /* Asked as the COPY rather than as the old `{onlineCount} online` literal. The count
       selects a WHOLE KEY PER BAND now (Arabic needs the dual at 2 and two more forms
       above it), so what must hold is that the rendered words still say what is being
       counted — in every band, which is strictly more than the one literal proved. */
    expect(arm, "the count still carries its word").toMatch(/t\(onlineCountKey\(onlineCount\)/);
    for (const n of [1, 2, 5, 40]) {
      expect(translate("en", onlineCountKey(n), { count: n })).toBe(
        n === 1 ? "1 online" : `${n} online`,
      );
    }
    expect(arm, "a presence dot beside it, in the presence green").toMatch(
      /bg-\[color:var\(--relay-online\)\]/,
    );
  });

  it("the ONLINE section does NOT repeat the word its own label already says", () => {
    /* Measured with the word in place and the header read "Online … 3 online". */
    const at = SRC.indexOf("{section.allActive ? (");
    expect(at).toBeGreaterThan(-1);
    const arm = SRC.slice(at, SRC.indexOf(") : (", at));
    /* The count it stands for is still announced — through the banded key rather than the
       old `${total} online` literal, so it is announced in every plural band. */
    expect(arm, "the count it stands for is still announced").toMatch(
      /title=\{t\(onlineCountKey\(total\)/,
    );
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
    /* The property: this header renders the NUMBER ALONE, because its own label already
       says "Online" and "Online … 3 online" was measured reading exactly like that. Asked
       as "no count PHRASE is rendered here" rather than as a bare /online/i sweep — the
       word only ever arrives now via a banded key, and the key's own name contains
       "online", so the old spelling would fail on correct code. */
    expect(rendered, "the label already says Online").not.toMatch(/onlineCountKey/);
    expect(rendered, "the label already says Online").not.toMatch(/\bonline\b/i);
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

/* ============================================================================
   #156 — THE TWO THINGS THIS SCREEN'S ARABIC CAN GET SILENTLY WRONG.

   Both are invisible in English, which is exactly why they are pinned: an English
   reader sees a correct screen either way.
   ============================================================================ */
describe("the counts are banded, not one sentence with a number in it", () => {
  it("Arabic really is four DIFFERENT forms, and the dual carries no numeral", () => {
    /* This is the assertion English cannot make. `contacts.onlineCountTwo` and
       `…Few` have the SAME English ("2 online" either way), so a mutation collapsing
       the dual into the paucal is invisible to every English check — and in Arabic it
       is a grammatical error on a header the owner reads. At 2 the numeral disappears
       into the word entirely ("متصلان"), which is also why no suffix scheme can
       express this. */
    for (const key of [onlineCountKey, contactCountKey]) {
      const ar = [1, 2, 5, 40].map((n) => translate("ar", key(n), { count: n }));
      expect(new Set(ar).size, "four distinct Arabic forms, not one form four times").toBe(4);
      expect(ar[1], "the dual is a WORD, not a numeral").not.toMatch(/\d/);
      expect(ar[0], "and so is the singular").not.toMatch(/\d/);
      for (const s of ar) expect(s, "Arabic script, not transliteration").toMatch(/[؀-ۿ]/);
    }
  });

  it("every band a real count can reach is a key that exists", () => {
    // A band pointing at a missing key renders the KEY on somebody's phone — the one
    // failure `translate`'s English fallback cannot save, because there is no entry.
    for (let n = 0; n <= 60; n++) {
      for (const key of [onlineCountKey, contactCountKey]) {
        expect(DICT[key(n)], `${key(n)} (n=${n})`).toBeTruthy();
      }
    }
  });
});

describe("a tag is named ONCE — the heading, the filter chip and the row chip agree", () => {
  it("all three read the SAME key, so they cannot disagree in either language", () => {
    /* The chips used to render `TAG_LABEL[tag]` from @shared/contactTags while the
       heading rendered `CATEGORY_META[tag].labelKey` — one fact, two sources. They had
       ALREADY drifted in English ("Friend" on the chip, "Friends" on the heading), and
       in Arabic the heading was translated while the chips were not. Reading all three
       off one map is what makes them unable to disagree by construction. */
    expect(SRC, "the shared English map must not be a render source any more").not.toMatch(
      /\{TAG_LABEL\[/,
    );
    // …and each of the three render sites goes through the one selector.
    expect((SRC.match(/t\(tagLabelKey\(/g) ?? []).length, "filter chip + row chip + empty state")
      .toBeGreaterThanOrEqual(3);
    /* The selector really reads the SECTION HEADING's map — that is the structural half,
       and it is what makes "cannot disagree" true rather than merely currently-equal. */
    expect(SRC).toMatch(/function tagLabelKey\(tag: ContactTag\): TKey \{\s*\n\s*return CATEGORY_META\[tag as Category\]\.labelKey;/);
    // …and every tag really resolves to an entry that exists, in both languages.
    for (const tag of ["vip", "family", "friend", "team"] as const) {
      const key = tagLabelKey(tag);
      expect(DICT[key], `${tag} -> ${key}`).toBeTruthy();
      expect(translate("ar", key), tag).toMatch(/[؀-ۿ]/);
      expect(translate("ar", key), tag).not.toBe(translate("en", key));
    }
  });
});
