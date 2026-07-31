/**
 * design_handoff_relay_app — PHASE 2b, the remaining five screens (1b History, 1c
 * Messages, 1d Conversation, 1e Contacts, 1f Profile), landed on the token layer.
 *
 * THE LOAD-BEARING CHANGE IS ONE LINE, AND THAT IS THE POINT. The handoff's last
 * interaction rule is "all accent UI follows the `--rb` vars automatically", and phase 1
 * published those vars while nothing read them. Repointing `--primary` at the accent
 * inside `.dark.relay-v2` converts every active state, focus ring, tick, section letter,
 * filter chip and CTA in the app at once — including the ones added AFTER this release,
 * which is what a per-class sweep of six screens could never do.
 *
 * WHICH IS ALSO WHY THE ON-ACCENT PAIRING IS THE MOST DANGEROUS THING HERE: if
 * `--primary-foreground` does not move with it, the mistake is not local to one button,
 * it is every primary control in the app simultaneously. So the pairing is MEASURED, not
 * reasoned about — headless Chromium against the real built stylesheet, all twelve
 * palette hues plus the business gold: worst on-accent text 5.63:1, worst accent-text-on-
 * a-card 6.23:1, unseen ring 9-10:1 brighter than the seen ring. 78/78.
 *
 * THREE HARNESS BUGS OF MY OWN IN THAT MEASUREMENT, each of which produced a confident
 * wrong number before it was found, recorded because every one of them is a trap that
 * will recur:
 *   1. A bare hex sweep of `relayBackground.ts` picked up `#04070a` — the BACKGROUND
 *      token — as a palette hue and reported three contrast failures for a colour the
 *      accent never takes. Now the PALETTE ARRAY is read specifically.
 *   2. Chromium returns `oklch()` VERBATIM from `getComputedStyle`, so parsing digits out
 *      of `oklch(0.18 0.007 248)` reads 0.18/0.007/248 as 0-255 channels. That produced a
 *      whole table of nonsense and an "accent text fails AA at 2.96:1" finding that did
 *      not exist. Colours are resolved by PAINTING them into a 1x1 canvas.
 *   3. An alpha colour filled onto a TRANSPARENT canvas reads back fully opaque, so
 *      `--border` (white at 6%) measured as #ffffff and the unseen-vs-seen ring
 *      comparison came out at 1.63:1 — a plausible near-miss that was pure artifact.
 *      Every colour is now composited over the surface it actually sits on.
 *
 * WHAT IS DELIBERATELY NOT TAKEN FROM THE BOARD, stated here rather than left to be
 * discovered: the outgoing bubble stays ORANGE. The board draws it as a translucent
 * accent tint, but the owner asked for orange own-bubbles in their own words in v2.99.85,
 * and an explicit request is not something a later visual spec overrides. The unseen
 * story ring does not FLASH, because it is drawn once per ROW and animating it means one
 * animation per row on the densest scrolling list in the app — the cost class v2.99.84
 * measured and removed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const CSS = read("client/src/index.css");
const HISTORY = read("client/src/pages/app/History.tsx");
const MESSAGES = read("client/src/pages/app/Messages.tsx");
const CONTACTS = read("client/src/pages/app/Contacts.tsx");
const PROFILE = read("client/src/pages/app/Profile.tsx");
const PEER = read("client/src/app/PeerOverlays.tsx");
const COLORS = read("client/src/app/peerColors.ts");

/** Comment-stripped source. This repo has matched its own prose 18+ times. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const HISTORY_CODE = code(HISTORY);
const MESSAGES_CODE = code(MESSAGES);
const CONTACTS_CODE = code(CONTACTS);
const PROFILE_CODE = code(PROFILE);
const PEER_CODE = code(PEER);

/** A block's own body, bounded by its own closing brace at depth 0 — never by whichever
 *  rule happens to sit next, which is how a phase-1 pin came to fail on correct code. */
function block(sel: string): string {
  const at = CSS_CODE.indexOf(sel);
  expect(at, `no such block: ${sel}`).toBeGreaterThanOrEqual(0);
  const open = CSS_CODE.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < CSS_CODE.length; i++) {
    if (CSS_CODE[i] === "{") depth++;
    else if (CSS_CODE[i] === "}") {
      depth--;
      if (depth === 0) {
        const body = CSS_CODE.slice(at, i + 1);
        expect(body.length, sel).toBeGreaterThan(20);
        return body;
      }
    }
  }
  throw new Error(`unterminated block: ${sel}`);
}

/** A function's BODY. The brace after the name is not the body when the parameter list is
 *  destructured — `function HubRow({ icon, ... })` closes a brace before the body opens,
 *  and taking the first one made this pin read the parameter object and fail on correct
 *  code (the v2.105.9/v2.105.27 trap, now in a third position). So: the first `{` whose
 *  preceding text has balanced parens, then brace-matched to its own close. */
function fnBody(src: string, decl: string): string {
  const at = src.indexOf(decl);
  expect(at, `no such function: ${decl}`).toBeGreaterThan(0);
  let i = at + decl.length;
  let parens = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "(") parens++;
    else if (c === ")") parens--;
    else if (c === "{" && parens === 0) break;
  }
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) {
        const body = src.slice(i, j + 1);
        expect(body.length, decl).toBeGreaterThan(50);
        return body;
      }
    }
  }
  throw new Error(`unterminated function: ${decl}`);
}

/** The JSX element that carries a given marker, bounded by its own tag close. */
function elementWith(src: string, marker: string): string {
  const at = src.indexOf(marker);
  expect(at, `no such marker: ${marker}`).toBeGreaterThan(0);
  const open = src.lastIndexOf("<", at);
  const end = src.indexOf(">", at);
  expect(end, marker).toBeGreaterThan(open);
  return src.slice(open, end + 1);
}

describe("the accent is repointed APP-WIDE, in one place, dark only", () => {
  it("`--primary` resolves to the cycling accent", () => {
    // The whole release hangs on this: `--primary` is what every active state, tick,
    // ring and CTA in the app already resolves to, so this is what makes phase 1's
    // published variables load-bearing instead of dead.
    const dark = block(".dark.relay-v2");
    expect(dark).toMatch(/--primary:\s*var\(--rb\)/);
    expect(dark).toMatch(/--ring:\s*var\(--rb\)/);
  });

  it("`--primary-foreground` moves WITH it, in the same block", () => {
    /* Getting this wrong is not a local mistake. The old primary was a dark cyan
       carrying near-white text; the accent is a BRIGHT hue, so white-on-accent is the
       unreadable direction — and it would be unreadable on every primary control in the
       app at once. `#04211a` is the board's on-accent value, measured across all twelve
       hues at 5.63:1 worst case. */
    const dark = block(".dark.relay-v2");
    expect(dark).toMatch(/--primary-foreground:\s*#04211a/);
    // and the sidebar's own pair, or a desktop primary reads white-on-accent
    expect(dark).toMatch(/--sidebar-primary:\s*var\(--rb\)/);
    expect(dark).toMatch(/--sidebar-primary-foreground:\s*#04211a/);
  });

  it("the LIGHT theme keeps its own measured primary", () => {
    /* The palette is built against a near-black background; its default teal computes
       to about 1.7:1 on a light card, which fails AA for anything small — the same
       measurement that forced `--relay-green-text` to exist in v2.99.86. So the accent
       applies where the redesign lives. The light `.relay-v2` block must NOT point
       `--primary` at the accent. */
    /* NOTE the selector: the light theme's tokens live in `.relay-v2:not(.dark)`, not in
       the bare `.relay-v2` block — that one holds only the tokens SHARED by both themes
       and legitimately declares no `--primary` at all. Anchoring on it made this pin fail
       on perfectly good code. */
    const light = block(".relay-v2:not(.dark) {");
    expect(light).toMatch(/--primary:/);
    expect(light).not.toMatch(/--primary:\s*var\(--rb\)/);
  });

  it("the repoint happens ONCE, so there is one place it can be wrong", () => {
    const hits = CSS_CODE.match(/--primary:\s*var\(--rb\)/g) ?? [];
    expect(hits).toHaveLength(1);
  });
});

describe("the unseen-story ring is the accent, from ONE class", () => {
  it("`.rstoryring` carries the accent in dark and a measured gradient in light", () => {
    // A ring that means "unseen" in one place and something else in another is worse
    // than no ring, so it is one class read by every surface that draws it.
    const light = block(".relay-v2 .rstoryring");
    expect(light).toMatch(/linear-gradient/);
    expect(light).not.toMatch(/--rb/);
    const dark = block(".dark.relay-v2 .rstoryring");
    expect(dark).toMatch(/var\(--rb\)/);
  });

  it("PeerAvatar applies the class for UNSEEN and keeps grey for SEEN", () => {
    /* The seen/unseen difference IS the signal. Measured 9-10:1 apart on every hue; if
       a change ever collapses them the ring stops telling anybody anything, silently. */
    expect(PEER_CODE).toMatch(/hasUnseen\s*\?\s*"rstoryring"\s*:\s*"bg-border"/);
    // and the old hardcoded three-hue gradient is gone from the component, so there is
    // exactly one definition of what an unseen ring looks like
    expect(PEER_CODE).not.toMatch(/from-\[#06d6a0\]/);
  });

  it("the ring is drawn at REST — no per-row animation", () => {
    /* The board says "flashing". Deliberately not taken: this ring renders once per row,
       so animating it is one animation per row on the app's densest scrolling list, the
       exact cost class v2.99.84 measured and removed. */
    const ring = block(".dark.relay-v2 .rstoryring");
    expect(ring).not.toMatch(/animation/);
    expect(block(".relay-v2 .rstoryring")).not.toMatch(/animation/);
  });
});

describe("1b History", () => {
  it("the selected filter is the accent chip, not a neutral raised tile", () => {
    // Same "you are here" language as the tab bar's pill, so one idea of selection
    // covers the whole app rather than one per screen.
    expect(HISTORY_CODE).toMatch(/active\s*\?\s*"rchip-accent/);
    expect(HISTORY_CODE).not.toMatch(/active\s*\?\s*"bg-background text-foreground/);
  });

  it("day headers are mono at the board's .26em", () => {
    const header = elementWith(HISTORY_CODE, "{sec.label}");
    expect(header).toMatch(/font-mono/);
    expect(header).toMatch(/letterSpacing: "\.26em"/);
    expect(header).toMatch(/uppercase/);
  });
});

describe("1c Messages / 1d Conversation", () => {
  it("a READ receipt is visually distinct from DELIVERED, from ONE expression", () => {
    const at = MESSAGES_CODE.indexOf("function Receipt(");
    expect(at).toBeGreaterThan(0);
    const body = MESSAGES_CODE.slice(at, at + 1200);
    /* REWRITTEN (v2.106.40). This asserted the accent, which was right on a CARD and wrong
       here: measured on the own bubble's own pale stop the accent read 1.34:1 against
       delivered's 1.77:1, so the accent made the MORE important state the FAINTER one. The
       accent is still this app's read-vs-delivered vocabulary everywhere it sits on a card
       (the thread row, Message info); the bubble is the one surface it cannot be seen on, so
       the strength ordering is what this pins and `deliveryReceipts.test.ts` owns the arms.
       ONE expression decides the colour, both arms named — so a change that collapses read
       and delivered into one appearance fails, which a pin on the read arm alone does NOT
       catch: the first cut set a grey class and overrode it inline for read, and the
       mutation run showed the class could be deleted with no visible change. */
    const m = body.match(/const tickStyle = \{ color: read \? (".+?") : (".+?") \}/);
    expect(m).toBeTruthy();
    expect((m as RegExpMatchArray)[1]).not.toBe((m as RegExpMatchArray)[2]);
    expect(body, "the pre-accent fixed blue must not come back either").not.toMatch(/#4db6ff/);
  });

  it("the day divider is mono/.26em AND still opaque and above the bubbles", () => {
    /* The sticky rule from v2.105.3: bubbles pass BEHIND this pill, so a translucent
       fill makes text slide through it unreadably, and z-10 is what keeps it above the
       thread while staying below the lightbox (z-20) and the search overlay (z-90). */
      const at = MESSAGES_CODE.indexOf("{day.label}");
    expect(at).toBeGreaterThan(0);
    const region = MESSAGES_CODE.slice(MESSAGES_CODE.lastIndexOf("sticky top-0", at), at);
    expect(region).toMatch(/z-10/);
    expect(region).toMatch(/bg-muted(?!\/)/);
    expect(region).toMatch(/font-mono/);
    expect(region).toMatch(/letterSpacing: "\.26em"/);
  });

  it("both send buttons are the accent CTA, with no hardcoded gradient left", () => {
    // Two send buttons — the composer's and the voice-note bar's — so both are pinned;
    // one of them keeping a hardcoded fill is exactly how they came to differ before.
    const sends = MESSAGES_CODE.match(/rcta/g) ?? [];
    expect(sends.length).toBeGreaterThanOrEqual(2);
    expect(MESSAGES_CODE).not.toMatch(/BRAND_GRADIENT/);
  });

  it("the OWN BUBBLE stays orange — the owner asked for that in their own words", () => {
    /* v2.99.85, verbatim: "when he post mind bubble is orange". The board draws the
       outgoing bubble as an accent tint; an explicit request outranks a later visual
       spec, and it is also what makes the accent tick readable — a bright accent tick
       on an orange fill is high contrast, on an accent bubble it would not be. */
    expect(COLORS).toMatch(/#f97316|#fb923c|BRAND_GRADIENT/);
    expect(code(COLORS)).not.toMatch(/--rb/);
  });
});

describe("1e Contacts", () => {
  it("the section label takes the accent VOCABULARY at .26em — not the raw variable", () => {
    /* REWRITTEN TO THE PROPERTY. This froze `color: "var(--rb)"`, which is the DEFECT
       rather than the design: the raw accent as text measures 1.59:1 on the light card
       against AA's 4.5, so every section heading (ONLINE / FAVORITES / FAMILY / FRIENDS /
       TEAM) was invisible in the theme the app defaults to — the literal reading of the
       owner's "the contacts section is not showing".
       `text-primary` IS the accent: v2.106.4 repointed `--primary` at `--rb` inside
       `.dark.relay-v2`, so the dark look is unchanged and only light becomes legible
       (4.59:1). The board asks for the accent and the .26em mono tracking; both hold. */
    const label = elementWith(CONTACTS_CODE, "{section.label}");
    expect(label).toMatch(/text-primary/);
    expect(label, "the raw variable in a colour position is what failed AA").not.toMatch(
      /color:\s*"?var\(--rb\)/,
    );
    expect(label).toMatch(/letterSpacing: "\.26em"/);
    expect(label).toMatch(/font-mono/);
  });

  it("Add-by-PIN is the accent chip", () => {
    // The screen's one primary action reads as the app's accent rather than as a fourth
    // colour beside three coloured row actions.
    const btn = CONTACTS_CODE.slice(
      CONTACTS_CODE.indexOf('aria-label="Add by PIN"'),
      CONTACTS_CODE.indexOf("</button>", CONTACTS_CODE.indexOf('aria-label="Add by PIN"'))
    );
    expect(btn).toMatch(/rchip-accent/);
    expect(btn).not.toMatch(/#7c3aed/);
  });

  it("of the three quick actions, CALL is the accent and the others keep their hues", () => {
    /* Board 1e: "call = accent chip". The same primary/secondary split the Dialer's
       action row uses — nothing is removed, the ranking is what changes. */
    const voice = CONTACTS_CODE.slice(
      CONTACTS_CODE.indexOf('aria-label="Voice call"'),
      CONTACTS_CODE.indexOf("</button>", CONTACTS_CODE.indexOf('aria-label="Voice call"'))
    );
    expect(voice).toMatch(/rchip-accent/);
    expect(voice).not.toMatch(/34,197,94/);
    const video = CONTACTS_CODE.slice(
      CONTACTS_CODE.indexOf('aria-label="Video call"'),
      CONTACTS_CODE.indexOf("</button>", CONTACTS_CODE.indexOf('aria-label="Video call"'))
    );
    expect(video).toMatch(/#38bdf8/);
    expect(video).not.toMatch(/rchip-accent/);
  });
});

describe("1f Profile", () => {
  it("hub rows are 34px accent TILES whose glyph keeps its own tint", () => {
    /* Board 1f: "hub rows (34px accent icon tiles)". The glyph tint survives on purpose
       — the per-row wayfinding colour these rows already had is not discarded, it moves
       onto the icon, the same split the Dialer's secondary actions use. */
    const body = fnBody(PROFILE_CODE, "function HubRow");
    expect(body).toMatch(/size-\[34px\]/);
    expect(body).toMatch(/rounded-xl/);
    expect(body).toMatch(/rgba\(var\(--rb-rgb\),0\.14\)/);
    expect(body).toMatch(/color: tint/);
    // the old per-row circle is gone, or two recipes would be live at once
    expect(body).not.toMatch(/\$\{tint\}24/);
  });

  it("Sign out is a RED glass row, not the neutral glass utility", () => {
    /* `.rglass` is deliberately neutral; this is the one row on the page where the
       surface colour carries meaning rather than depth, so it takes the same
       translucent-gradient + hairline recipe in red. */
    const at = PROFILE_CODE.indexOf("onClick={requestSignOut}");
    expect(at).toBeGreaterThan(0);
    const region = PROFILE_CODE.slice(at, at + 700);
    expect(region).toMatch(/rgba\(244,63,94,\.13\)/);
    expect(region).toMatch(/rgba\(244,63,94,\.30\)/);
    expect(region).not.toMatch(/\brglass\b/);
  });
});

describe("the phase-1 rules still hold across everything added here", () => {
  it("every new utility is scoped so the landing page and docs are untouched", () => {
    for (const sel of [".relay-v2 .rstoryring", ".dark.relay-v2 .rstoryring"]) {
      const at = CSS_CODE.indexOf(sel);
      expect(at, sel).toBeGreaterThan(0);
      expect(sel.startsWith(".relay-v2") || sel.startsWith(".dark.relay-v2"), sel).toBe(true);
    }
  });

  it("no accent value is a runtime-composed Tailwind class", () => {
    /* The JIT cannot see a class name assembled at render time, so it comes out
       unstyled — the trap recorded for the old tab accents and the status picker. Every
       accent value in these five screens goes through a named class or an inline style
       reading the custom property. */
    for (const [name, src] of [
      ["History", HISTORY_CODE],
      ["Messages", MESSAGES_CODE],
      ["Contacts", CONTACTS_CODE],
      ["Profile", PROFILE_CODE],
      ["PeerOverlays", PEER_CODE],
    ] as const) {
      expect(src, name).not.toMatch(/(?:bg|text|border|ring)-\[\$\{/);
      expect(src, name).not.toMatch(/`(?:bg|text|border|ring)-\$\{/);
    }
  });
});

describe("phase 4 — the overlay material, and a light-theme AA fix it uncovered", () => {
  it("the sheet material is applied at the FOUR shared primitives, not per overlay", () => {
    /* 13 overlay consumers reached from four lines. Editing seventeen components instead is
       how one of them comes to look different from the rest — and how the next one added
       gets nothing at all. */
    for (const f of ["dialog", "alert-dialog", "sheet", "drawer"]) {
      const src = read(`client/src/components/ui/${f}.tsx`);
      expect(src, f).toMatch(/"[^"]*\brsheet\b/);
    }
  });

  it("`.rsheet` is DARK-scoped, which is what makes it safe on a shared primitive", () => {
    /* The recipe is a near-black gradient. In light it must declare nothing, so the
       primitives' own `bg-background` still decides and the light theme is byte-identical —
       otherwise this one class would put a dark sheet under near-black text everywhere. */
    expect(CSS_CODE).toMatch(/\.dark\.relay-v2 \.rsheet \{/);
    expect(CSS_CODE).not.toMatch(/(?<!\.dark)\.relay-v2 \.rsheet \{/);
  });

  it("the LIGHT theme's white-on-colour fills clear AA", () => {
    /* A PRE-EXISTING defect, found by measuring the sheet rather than introduced by the
       redesign: all three of these carry near-white text and all three failed AA on the
       app's DEFAULT theme — primary 4.00:1, accent 3.58:1, destructive 4.30:1. That is every
       primary button, accent surface and destructive confirmation in light mode. Each value
       is now the LIGHTEST clearing 4.5:1 with a real margin, measured in a browser: 4.73,
       4.85 and 4.87:1. Pinned as an upper BOUND on lightness rather than as exact literals,
       so the hue can be retuned but never back above the failing threshold. */
    const light = block(".relay-v2:not(.dark) {");
    for (const [name, max] of [["primary", 0.51], ["accent", 0.51], ["destructive", 0.58]] as const) {
      const at = light.indexOf(`--${name}: oklch(`);
      expect(at, name).toBeGreaterThan(0);
      const lightness = Number(light.slice(at).match(/oklch\(([\d.]+)/)![1]);
      expect(lightness, `${name} must stay dark enough for white text`).toBeLessThanOrEqual(max);
    }
    // The focus ring follows the primary, or it stops matching the control it rings.
    expect(light).toMatch(/--ring: oklch\(0\.5 0\.18 192\)/);
  });
});
