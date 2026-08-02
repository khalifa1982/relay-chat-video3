/**
 * "THE CONTACT IS NOT SHOWING. MANY THINGS IS NOT SHOWING THERE." — the owner, twice.
 *
 * A 90-agent design-vs-built audit over every screen returned 67 adversarially-verified
 * findings, and the ones that answer that report are ONE CLASS: something the user
 * should be able to see, that the app decides not to draw, without saying why. Six of
 * them ship here.
 *
 * The class is worth naming, because it is what makes these bugs so hard to report: in
 * every case the screen looks FINISHED. A failed query renders as an empty address book;
 * a narrowed list renders as an empty one; a failed group read renders as an admin who
 * has lost their adminship; an account-only pane renders as a blank; an unreadable label
 * renders as a chip with no word on it; and a nav with nothing lit renders as a nav.
 * None of them looks like an error, so none of them gets reported as one.
 *
 * These are pins, not measurements — the layout and the queries need a browser and a
 * database. The one arithmetic claim (the chip's contrast) is COMPUTED here rather than
 * asserted, and the converter is validated against a figure this repo measured in a real
 * browser two releases ago.
 */
import { describe, expect, it } from "vitest";
import { copyOnScreen, keysForEnglish, whyCopyMissing } from "../../../server/testing/copyOnScreen";
import { DICT } from "./i18n";
import { readFileSync } from "node:fs";
import { codeOnly } from "../../../server/testing/codeOnly";

const CONTACTS = readFileSync("client/src/pages/app/Contacts.tsx", "utf8");
const SHELL = readFileSync("client/src/app/AppShell.tsx", "utf8");
const APP = readFileSync("client/src/App.tsx", "utf8");
const GROUP = readFileSync("client/src/app/GroupInfoSheet.tsx", "utf8");
const PROFILE = readFileSync("client/src/pages/app/Profile.tsx", "utf8");
const SUGGEST = readFileSync("client/src/app/contactSuggest.ts", "utf8");
const CSS = readFileSync("client/src/index.css", "utf8");

describe("a failed contacts read says so — it is not an empty address book", () => {
  /* THE OWNER'S LITERAL REPORT. There was no error arm at all, so any failure of
     `contacts.list` fell through to `filtered.length === 0` and rendered "No contacts
     yet" plus an "Add a contact" button — a confident false claim about somebody's own
     directory. Messages has rendered `threads.isError` with a Retry for releases and
     that is pinned as "not blank-forever"; this screen never got it. */
  const code = codeOnly(CONTACTS);

  it("renders an error state with a Retry", () => {
    expect(code).toMatch(/contacts\.isError \?/);
    expect(code).toMatch(/contacts\.refetch\(\)/);
  });

  it("the error arm comes BEFORE the loading arm", () => {
    /* Load-bearing ordering: a background retry on an errored query sets `isFetching`,
       so with the arms the other way round the screen would drop back to the skeleton
       and hide the failure again, on a loop. */
    expect(code.indexOf("contacts.isError")).toBeGreaterThanOrEqual(0);
    expect(code.indexOf("contacts.isError")).toBeLessThan(code.indexOf("contacts.isLoading"));
  });

  it("the error copy never claims the directory is empty", () => {
    // That wording IS the defect. The contacts still exist; this device could not
    // reach them.
    const arm = code.slice(code.indexOf("contacts.isError"), code.indexOf("contacts.isLoading"));
    // Matched against the COPY, not the markup — the shadcn primitives are themselves
    // named `Empty*`, so a bare /empty/i sweep fails on correct code.
    expect(arm).not.toMatch(/No contacts yet/);
    expect(arm).not.toMatch(/Add a contact/);
    /* The reassurance is a dictionary entry now, so it is asked for as the PROPERTY —
       satisfied by the literal OR by a key whose English carries it, which additionally
       proves an Arabic half exists. */
    expect(
      copyOnScreen(arm, "Your saved contacts are still there"),
      whyCopyMissing(arm, "Your saved contacts are still there"),
    ).toBe(true);
  });
});

describe("an empty NARROWED list is not an empty directory", () => {
  const code = codeOnly(CONTACTS);

  it("the empty state reads the tag filter, not only the search box", () => {
    /* Tapping a label chip that matches nothing said "No contacts yet" and offered
       contact creation — the same defect v2.106.2 fixed in Messages, where an
       unfiltered count made the page render `No conversations match ""`. Every
       pre-v2.106.14 contact with no category matches none of the four chips, so on a
       typical account this fired on the first tap. */
    // Anchored on the EMPTY branch specifically: the error arm added above this
    // release also renders an `<EmptyTitle>`, and it is the first one in the file.
    const at = code.indexOf("filtered.length === 0");
    expect(at).toBeGreaterThan(0);
    const title = code.slice(at).match(/<EmptyTitle>[\s\S]{0,240}?<\/EmptyTitle>/);
    expect(title).toBeTruthy();
    expect(title![0]).toMatch(/tagFilter/);
  });

  it("the Add-a-contact CTA is withheld while a filter is narrowing the list", () => {
    // The useful action there is clearing the filter, which the chip row above already
    // offers in one tap; "Add a contact" answers a question nobody asked.
    expect(code).toMatch(/!search && !tagFilter &&/);
  });
});

describe("the nav marks where you are — including on /app", () => {
  it("both navs read ONE derived value, not two copies of a path rule", () => {
    /* It was `location.startsWith(tab.path)` computed independently in the bottom bar
       and the sidebar, and NO tab path is a prefix of `/app` — so on `/app`, the URL all
       five landing-page CTAs point at, nothing was lit in either nav. Two copies of the
       rule is also how the two navs could come to disagree. */
    const code = codeOnly(SHELL);
    expect(code).not.toMatch(/startsWith\(tab\.path\)/);
    const hits = [...code.matchAll(/const active = tab\.key === activeTab;/g)];
    expect(hits.length, "both navs must read the shared value").toBe(2);
  });

  it("the route's own declared tab wins, and the path is only the fallback", () => {
    // App.tsx already writes `tab="dialer"` for both `/app` and `/app/dialer`, so the
    // prop is the truth; the derivation exists so a caller that omits it degrades to
    // today's behaviour rather than losing its highlight.
    expect(SHELL).toMatch(/routeTab \?\?/);
    expect(APP).toMatch(/<AppShell tab=\{tab\}>/);
  });

  it("/app still resolves to the dialer even with no prop", () => {
    expect(SHELL).toMatch(/location === "\/app" \|\| location === "\/app\/"/);
  });

  it("a drill-in route is derived, not a hardcoded prefix", () => {
    /* `/app/admin` is pushed from Profile and rendered with NO Back arrow and no lit
       tab — reachable, but with no way to RETURN, worst of all in an installed PWA with
       no browser back chrome. Deriving "not one of the five tabs" means the next
       drill-in route gets its Back affordance without this string being updated. */
    const code = codeOnly(SHELL);
    expect(code).not.toMatch(/isSubPage = location\.startsWith\("\/app\/profile"\)/);
    expect(code).toMatch(/isSubPage = activeTab != null && !TABS\.some\(/);
  });
});

describe("a failed group read does not look like losing your adminship", () => {
  const code = codeOnly(GROUP);

  it("the sheet reads the query's failure, not only its data", () => {
    /* It read only `info.data`, and `iAmAdmin` derives from the same value — so a failed
       `conversationInfo` showed an unexplained empty Members card AND silently removed
       the add-by-number row, the "all members can add" switch and the invite-link
       section from a REAL admin, who would reasonably conclude they had been demoted.
       Nothing else says a read failed: main.tsx only console.errors. */
    expect(code).toMatch(/info\.isError \?/);
    expect(code).toMatch(/info\.refetch\(\)/);
  });

  it("it says the controls are hidden rather than letting them vanish silently", () => {
    expect(copyOnScreen(code, "controls are hidden")).toBe(true);
    expect(copyOnScreen(code, "nothing has changed")).toBe(true);
  });

  it("in flight it says loading rather than asserting an empty group", () => {
    // A group with no members in it is a claim; "loading" is not.
    expect(copyOnScreen(code, "Loading members")).toBe(true);
  });
});

describe("no row is a dead end — the two guest panes explain themselves", () => {
  const code = codeOnly(PROFILE);

  it("neither account-only section returns bare null for a guest", () => {
    /* The Sign-in PIN and Devices rows are drawn for everyone while their sections
       returned `null` for anyone with no `users` row — every guest, permanently — so
       tapping either landed on a pane with a title and nothing under it. That breaks
       the rule this file's own header states (v2.99.89). */
    expect(code).not.toMatch(/status\.data\?\.signedIn\) return null/);
    expect(code).not.toMatch(/list\.data\?\.signedIn\) return null/);
    const notes = [...code.matchAll(/<AccountOnlyNote /g)];
    expect(notes.length, "both panes must explain themselves").toBe(2);
  });

  it("ONE component carries the requirement, so the two panes cannot describe it differently", () => {
    expect([...code.matchAll(/function AccountOnlyNote\(/g)].length).toBe(1);
  });

  it("it names the way forward and promises nothing is lost", () => {
    /* The reason a guest cannot use these is the one thing they can act on — hiding the
       rows would satisfy the letter of the rule and leave the feature undiscoverable.

       THE SENTENCE MOVED TO THE CALL SITES, and that is the point rather than an
       inconvenience: it used to be `{what} needs a registered account.` with `what` a
       caller-supplied English fragment, and a sentence chopped at an English seam cannot
       be re-assembled in Arabic, where the word order differs. So each caller names a
       WHOLE-sentence key, and what is asserted is that every key the component can be
       given really does carry both promises. */
    const i = code.indexOf("function AccountOnlyNote(");
    const body = code.slice(i, i + 1400);
    expect(copyOnScreen(body, "Register this number")).toBe(true);

    const noteKeys = [...code.matchAll(/noteKey="([\w.]+)"/g)].map((m) => m[1]);
    expect(noteKeys.length, "both panes name a note").toBe(2);
    const explains = keysForEnglish("needs a registered account");
    const reassures = keysForEnglish("carry over when you register");
    for (const k of noteKeys) {
      expect(explains, `${k} states the requirement`).toContain(k);
      expect(reassures, `${k} promises nothing is lost`).toContain(k);
      /* AND THE ARABIC MAKES BOTH PROMISES TOO. `keysForEnglish` reads the ENGLISH half
         by construction, so on its own it lets the Arabic say anything — a mutation that
         cut the reassurance out of the Arabic survived the first version of this pin
         untouched. The promise is the substance here (somebody deciding whether to
         register), so it is asserted in both languages. */
      const ar = DICT[k as keyof typeof DICT].ar;
      expect(ar, `${k} states the requirement in Arabic`).toMatch(/حسابًا مسجّلًا/);
      expect(ar, `${k} promises nothing is lost in Arabic`).toMatch(/لا يُفقد شيء/);
    }
  });
});

describe("a starred contact is not dropped from the picker", () => {
  it("the favourite key is spelled the way the wire spells it", () => {
    /* The server emits `favourite` and so does the schema column; this module read
       `favorite`, so `!!c.favorite` was false for every real contact and the tiebreak
       was a permanent no-op. With `.slice(0, limit)` that is not a mis-rank, it is a
       DROP: a starred contact who is offline and late alphabetically vanished from the
       suggestion list. TypeScript could not see it — the caller passes whole objects,
       and excess-property checks do not apply to a variable. */
    // On comment-stripped source: the comment recording this defect necessarily
    // contains the wrong spelling, so a raw sweep fails on correct code.
    const code = codeOnly(SUGGEST);
    expect(code).not.toMatch(/\bfavorite\b/);
    expect([...code.matchAll(/!!\w+(?:\.c)?\.favourite/g)].length).toBe(4);
  });
});

/* ── the chip label, computed rather than asserted ─────────────────────────────
 * `oklch()` cannot be read out of a browser numerically (Chromium hands the string
 * back verbatim — the trap that produced a whole table of nonsense in v2.106.4), so
 * the conversion is done here. It is VALIDATED against a figure this repo measured in
 * a real browser: light `--relay-green-text` on the light card came out at 5.92:1 in
 * v2.99.86, and this converter must reproduce it before any other number it produces
 * is worth believing. */
function oklchToSrgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const enc = (u: number) => {
    const v = Math.max(0, Math.min(1, u));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  };
  return [
    enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    enc(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
const lumOf = (p: [number, number, number]) => {
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2]);
};
const contrast = (x: [number, number, number], y: [number, number, number]) => {
  const a = lumOf(x);
  const b = lumOf(y);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const over = (
  fg: [number, number, number],
  alpha: number,
  bg: [number, number, number],
): [number, number, number] => [
  fg[0] * alpha + bg[0] * (1 - alpha),
  fg[1] * alpha + bg[1] * (1 - alpha),
  fg[2] * alpha + bg[2] * (1 - alpha),
];

/** Pull a token's value out of a named block in the real stylesheet. */
function token(selector: string, name: string): string {
  const at = CSS.indexOf(selector + " {");
  expect(at, `${selector} must exist`).toBeGreaterThanOrEqual(0);
  const block = CSS.slice(at, CSS.indexOf("\n}", at));
  const m = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  expect(m, `${name} must be declared in ${selector}`).toBeTruthy();
  return m![1].trim();
}
function parseOklch(v: string): [number, number, number] {
  const m = v.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/);
  expect(m, `not an oklch() value: ${v}`).toBeTruthy();
  return oklchToSrgb(Number(m![1]), Number(m![2]), Number(m![3]));
}
/** The accent's static fallback. Declared once in the file, and read that way rather
 *  than by scoping to `:root`, whose block contains nested rules that end a naive
 *  brace slice early. */
function accentFallback(): string {
  const m = CSS.match(/--rb:\s*([^;]+);/);
  expect(m, "--rb must be declared").toBeTruthy();
  return m![1].trim();
}
function parseHex(v: string): [number, number, number] {
  const m = v.match(/#([0-9a-f]{6})/i);
  expect(m, `not a hex value: ${v}`).toBeTruthy();
  const n = parseInt(m![1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

describe("the selected filter chip's own word is readable in light theme", () => {
  it("the converter reproduces this repo's own browser measurement", () => {
    // If this drifts, every other number below is worthless.
    const card = parseOklch(token(".relay-v2:not(.dark)", "--card"));
    const green = parseOklch(token(".relay-v2:not(.dark)", "--relay-green-text"));
    expect(contrast(green, card)).toBeCloseTo(5.91, 1);
  });

  it("`.rchip-accent` has a light-theme override, like every other accent recipe", () => {
    /* `.rkey` and `.rstoryring` both branch on theme; this one did not. `<html>` carries
       `relay-v2` unconditionally, the app defaults to LIGHT, and the accent engine is
       dark-gated — so `--rb` is the static `#35e0b4` there, and `color: var(--rb)` made
       the SELECTED chip's label the one word on the row you could not read while its
       unselected neighbours were fine. */
    expect(CSS).toMatch(/\.relay-v2:not\(\.dark\) \.rchip-accent \{[\s\S]{0,120}?color: var\(--relay-green-text\)/);
  });

  it("the selected label clears AA on its own fill, where it did not before", () => {
    const card = parseOklch(token(".relay-v2:not(.dark)", "--card"));
    const rb = parseHex(accentFallback());
    const green = parseOklch(token(".relay-v2:not(.dark)", "--relay-green-text"));
    // The chip's own background is the accent at 14% over the card, so the text is read
    // against THAT, not against the page.
    const fill = over(rb, 0.14, card);
    expect(contrast(rb, fill), "the old accent-as-text was the defect").toBeLessThan(2);
    expect(contrast(green, fill)).toBeGreaterThan(4.5);
  });

  it("dark theme is untouched — the accent is legible on near-black, which is its purpose", () => {
    // The override is scoped `:not(.dark)`, so nothing about the cycling accent changes
    // where the redesign actually lives.
    const i = CSS.indexOf(".relay-v2:not(.dark) .rchip-accent");
    const block = CSS.slice(i, CSS.indexOf("}", i));
    expect(block).not.toMatch(/background|border/);
  });
});
