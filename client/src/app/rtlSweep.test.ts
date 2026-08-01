/**
 * #156 — THE PHYSICAL-PROPERTY SWEEP.
 *
 * The app renders Arabic, so a box that pads or pins itself to a fixed SIDE is wrong in
 * one of the two languages. Tailwind's logical utilities (`ps-`/`pe-`, `ms-`/`me-`,
 * `start-`/`end-`, `border-s-`/`border-e-`) follow the text direction; the physical ones
 * (`pl-`, `mr-`, `left-0`, `border-l-`) do not.
 *
 * ── WHY A SWEEP RATHER THAN A CONVERSION AND A NOTE ──────────────────────────────────
 * The conversion is a one-off; the RULE is not. Every screen added after this reintroduces
 * the question, and "we converted 90 sites once" is exactly the shape that decays — so this
 * walks the app's own source and fails on a new physical property, which is what actually
 * keeps the property true.
 *
 * ── THE EXEMPTIONS ARE NAMED, NOT A THRESHOLD ────────────────────────────────────────
 * A count-based tolerance ("fewer than N physical sites") is how a real one hides among the
 * accepted ones (the v2.106.91 rule). There are exactly two accepted shapes and each is
 * accepted for a reason that would be WRONG to convert:
 *
 *   • CENTRING. `left-1/2` paired with `-translate-x-1/2` is direction-INDEPENDENT — the
 *     box is centred either way — so the logical `start-1/2` would push it off-centre in
 *     RTL. v2.106.79 recorded exactly this for the dialer's add-contact label, and the
 *     mistake it prevents is subtle: `start-1/2` LOOKS more correct.
 *
 *   • `components/ui/`. Those are vendored shadcn primitives. Converting them diverges
 *     from upstream, so every future `npx shadcn add` re-introduces the physical spelling
 *     with no signal — a per-component decision, not a sweep's call. They are outside this
 *     rule deliberately, and the fact is recorded here rather than left to be rediscovered.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

/* `client/src/app` and `client/src/pages` — the app's OWN screens. `components/ui` is
   excluded for the reason above, and `pages/Home.tsx` (the marketing landing) carries its
   own hand-written stylesheet with its own RTL rules (v2.99.16) rather than Tailwind
   utilities, so a class sweep says nothing about it. */
const FILES = [
  ...walk(path.join(ROOT, "client/src/app")),
  ...walk(path.join(ROOT, "client/src/pages")),
].filter((p) => !p.includes(`${path.sep}components${path.sep}ui${path.sep}`));

/** Strip comments — prose ABOUT a physical property is not one (the recurring trap). */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** A class token, so `pl-4` matches and `xpl-4` / `--relay-pl` do not. */
const SPACING = /(?<![\w-])(?:pl|pr|ml|mr)-(?:\[|\d|px|auto)/g;
const POSITION = /(?<![\w-])(?:left|right)-(?:\[|\d|px|auto|full)/g;
const BORDER = /(?<![\w-])border-(?:l|r)-(?:\[|\d|px)/g;

/* How far past a `left-1/2` the paired `-translate-x-1/2` may sit. A long className is
   routinely broken across several lines — Profile's save pill puts the two halves on
   different ones — so a LINE-scoped exemption flags correct centring, which is a guard
   crying wolf. Deliberately small: it has to reach the rest of one className, not the
   next element. */
const CENTRING_WINDOW = 160;

function offendersIn(src: string): string[] {
  const c = code(src);
  const hits: string[] = [];
  for (const re of [SPACING, POSITION, BORDER]) {
    re.lastIndex = 0;
    for (const m of c.matchAll(re)) {
      const at = m.index ?? 0;
      /* CENTRING IS EXEMPT — see the header — and ONLY when the transform that makes it
         direction-independent is actually there. A bare `left-1/2` is not centring. */
      /* Tested against the SOURCE at the match, not against `m[0]`: the pattern stops at
         the first digit, so the match is the string "left-1" and a `^left-1/2` test on it
         can never fire — the exemption would be dead and every centred element flagged. */
      const window = c.slice(at, at + CENTRING_WINDOW);
      if (/^(left|right)-1\/2\b/.test(window) && window.includes("-translate-x-1/2")) {
        continue;
      }
      const lineStart = c.lastIndexOf("\n", at) + 1;
      let lineEnd = c.indexOf("\n", at);
      if (lineEnd < 0) lineEnd = c.length;
      hits.push(`${m[0]} … ${c.slice(lineStart, lineEnd).trim().slice(0, 90)}`);
    }
  }
  return hits;
}

describe("#156 — physical CSS properties do not survive in the app's own screens", () => {
  it("no directional padding, margin, inset or border is spelled physically", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const h of offendersIn(fs.readFileSync(f, "utf8"))) {
        offenders.push(`${path.relative(ROOT, f)}: ${h}`);
      }
    }
    expect(
      offenders,
      `these are fixed to one side and will be wrong in Arabic — use the logical\n` +
        `equivalent (ps-/pe-, ms-/me-, start-/end-, border-s-/border-e-):\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the sweep is not vacuous — it really reads the screens and really matches", () => {
    /* A sweep that passes because it found no FILES, or because its pattern matches
       nothing, reports safety. Both halves are checked: a real corpus, and a pattern
       proven to fire on a planted offender. */
    expect(FILES.length, "the sweep found no screens to read").toBeGreaterThan(20);
    expect(FILES.some((f) => f.endsWith("Messages.tsx"))).toBe(true);
    expect(offendersIn('<div className="pl-4" />')).toHaveLength(1);
    expect(offendersIn('<div className="absolute left-3" />')).toHaveLength(1);
    expect(offendersIn('<div className="border-l-2" />')).toHaveLength(1);
    // …and does NOT fire on the logical spellings it exists to encourage.
    expect(offendersIn('<div className="ps-4 me-2 start-3 border-s-2" />')).toHaveLength(0);
  });

  it("centring stays physical, and the exemption is EARNED rather than assumed", () => {
    /* `left-1/2 -translate-x-1/2` is exempt — but only because that pairing genuinely is
       direction-independent. A bare `left-1/2` with no transform is NOT centring and must
       still be caught, or the exemption becomes a hole. */
    expect(offendersIn('<div className="absolute left-1/2 -translate-x-1/2" />')).toHaveLength(0);
    expect(offendersIn('<div className="absolute left-1/2" />')).toHaveLength(1);
    // And the exemption is not hypothetical: real centring sites exist and are passing.
    const centred = FILES.filter((f) => /left-1\/2[\s\S]{0,80}-translate-x-1\/2/.test(fs.readFileSync(f, "utf8")));
    expect(centred.length, "no centring site found — has the exemption gone stale?").toBeGreaterThan(0);
  });

  it("a mirrored control moves its travel with its anchor, not just its anchor", () => {
    /* Profile's three toggle knobs are the case where converting HALF is worse than not
       converting at all: `start-1` parks the knob at the leading edge in both directions,
       but `translate-x-5` always moves it RIGHT, so in Arabic the "on" state would carry
       it out of its own track. Anchor and travel are asserted together. */
    const src = fs.readFileSync(path.join(ROOT, "client/src/pages/app/Profile.tsx"), "utf8");
    const anchors = src.match(/absolute top-1 start-1 size-5 rounded-full bg-white/g) ?? [];
    const travels = src.match(/translate-x-5 rtl:-translate-x-5/g) ?? [];
    expect(anchors.length, "the knob anchors moved or changed shape").toBe(3);
    expect(travels.length, "a knob anchor mirrors but its travel does not").toBe(anchors.length);
  });

  it("the story viewer's prev/next mirror, GLYPH included", () => {
    /* A reel is read in the page's own direction, so in Arabic "next" is to the LEFT. A
       fixed ChevronRight-on-the-right would send somebody backwards through a story every
       time they meant to go on — the position and the arrow have to move together. */
    const src = fs.readFileSync(path.join(ROOT, "client/src/pages/app/Status.tsx"), "utf8");
    expect(src).toMatch(/const PrevIcon = rtl \? ChevronRight : ChevronLeft;/);
    expect(src).toMatch(/const NextIcon = rtl \? ChevronLeft : ChevronRight;/);
    expect(src).toMatch(/<PrevIcon className="size-5" \/>/);
    expect(src).toMatch(/<NextIcon className="size-5" \/>/);
  });
});
