/**
 * RTL SPACING SWEEP — the four shadcn/ui MENU + INPUT-GROUP primitives.
 *
 * WHAT THIS PINS
 * --------------
 * The app renders Arabic and `dir` is written on the ROOT, so every LOGICAL spacing
 * utility flips for free and every PHYSICAL one silently does not. These four files
 * are VENDOR primitives, so a physical `pl-8` here is not one screen's bug — it is
 * every dropdown, context menu, menubar and input addon in the app, wrong in Arabic,
 * with nothing on screen saying so.
 *
 * The load-bearing assertion is a SWEEP, not an enumeration of the 35 sites this
 * change converted. An enumeration goes stale the moment somebody re-runs the shadcn
 * generator or pastes a new primitive in, which is precisely the occurrence that would
 * not be caught.
 *
 * WHY THE ANIMATION CLASSES ARE EXEMPT, AND WHY THE EXEMPTION IS NAMED
 * -------------------------------------------------------------------
 * `data-[side=left]:slide-in-from-right-2` is the one physical direction token that
 * MUST stay physical. Radix resolves `data-side` to a real VIEWPORT side — it flips
 * the panel to whichever side has room, independently of text direction — so the
 * animation has to slide in from the physical edge the panel is actually anchored to.
 * Making it logical would decouple the motion from the anchor and send the panel
 * sliding the wrong way whenever it flipped.
 *
 * That exemption is asserted rather than assumed: the classes must still EXIST and
 * must still be PAIRED with the `data-[side=…]` attribute that earns them. An
 * exemption left in place after the thing it protects has gone is how a guard rots
 * into a comment (the v2.106.31 / v2.106.66 pattern).
 *
 * WHY `codeOnly`
 * --------------
 * Two of the conversions carry comments that NAME the classes they are about
 * (`order-first`, `inline-start`). A `not.toMatch` over raw source would match the
 * English explaining why a pattern is absent — the prose trap this repo has hit
 * roughly twenty times. Every sweep here runs on comment-stripped source, with a
 * companion check proving the strip removes something real so it can never be hiding
 * a live offender instead.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

const UI = resolve(__dirname, "../components/ui");

/** The four primitives this sweep owns. */
const FILES = [
  "dropdown-menu.tsx",
  "context-menu.tsx",
  "menubar.tsx",
  "input-group.tsx",
] as const;

const RAW = Object.fromEntries(
  FILES.map(f => [f, readFileSync(resolve(UI, f), "utf8")])
) as Record<(typeof FILES)[number], string>;

const CODE = Object.fromEntries(
  FILES.map(f => [f, codeOnly(RAW[f])])
) as Record<(typeof FILES)[number], string>;

/**
 * A Tailwind class token starts after a quote, whitespace or a variant `:` — never
 * after a word character or a hyphen. That lookbehind is what tells a real positioning
 * `left-2` apart from the `left-2` buried inside `slide-in-from-left-2`, whose
 * preceding character is `-`.
 */
const BOUNDARY = "(?<![-\\w])";
const VALUE = "[\\w.[\\]()/%+-]+";

const PHYSICAL_SPACING = new RegExp(`${BOUNDARY}-?(?:pl|pr|ml|mr)-${VALUE}`, "g");
const PHYSICAL_INSET = new RegExp(`${BOUNDARY}-?(?:left|right)-${VALUE}`, "g");
const PHYSICAL_ALIGN = new RegExp(`${BOUNDARY}text-(?:left|right)(?![-\\w])`, "g");

function physicalHits(src: string): string[] {
  return [
    ...(src.match(PHYSICAL_SPACING) ?? []),
    ...(src.match(PHYSICAL_INSET) ?? []),
    ...(src.match(PHYSICAL_ALIGN) ?? []),
  ];
}

describe("RTL: the shadcn menu + input-group primitives use logical spacing", () => {
  // ---------------------------------------------------------------- the sweep
  it.each(FILES)("%s carries no physical reading-order spacing", file => {
    expect(physicalHits(CODE[file])).toEqual([]);
  });

  // -------------------------------------------------- the detector really bites
  it("the sweep catches a planted violation, so a clean file means something", () => {
    // Every shape this change converted, plus the negative-margin arbitrary value.
    const planted = [
      `className="px-2 pl-8 text-sm"`,
      `className="absolute left-2 flex"`,
      `className="text-muted-foreground ml-auto"`,
      `className="order-last pr-3 has-[>button]:mr-[-0.45rem]"`,
      `className="text-left"`,
    ].join("\n");
    const hits = physicalHits(planted);
    expect(hits).toContain("pl-8");
    expect(hits).toContain("left-2");
    expect(hits).toContain("ml-auto");
    expect(hits).toContain("pr-3");
    expect(hits).toContain("mr-[-0.45rem]");
    expect(hits).toContain("text-left");
  });

  it("the sweep does NOT flag direction-neutral or already-logical spacing", () => {
    // A guard that cries wolf on correct code is as useless as one that never fires.
    const legal = `className="-mx-1 my-1 ps-8 pe-2 ms-auto me-1 start-2 end-0 justify-start order-first"`;
    expect(physicalHits(legal)).toEqual([]);
  });

  // ------------------------------------------- the exemption is named and earned
  it.each(["dropdown-menu.tsx", "context-menu.tsx", "menubar.tsx"] as const)(
    "%s keeps its slide-in animation physical, paired to the physical data-side",
    file => {
      // Radix resolves `data-side` to a real viewport side, so the motion must match
      // the physical anchor. Both halves of each pair must survive together.
      const pairs = CODE[file].match(
        /data-\[side=left\]:slide-in-from-right-2 data-\[side=right\]:slide-in-from-left-2/g
      );
      expect(pairs?.length).toBeGreaterThan(0);

      // …and no slide-in direction token may exist OUTSIDE such a pair, which is what
      // stops this exemption widening into "physical is fine here".
      const allSlides =
        CODE[file].match(/slide-in-from-(?:left|right)-\d+/g) ?? [];
      expect(allSlides.length).toBe((pairs?.length ?? 0) * 2);
    }
  );

  // ------------------------------------------------------- the pairing invariant
  it.each(["dropdown-menu.tsx", "context-menu.tsx", "menubar.tsx"] as const)(
    "%s: the indicator sits in the gutter its item reserves, on the same logical side",
    file => {
      const src = CODE[file];

      // The item reserves a start-side gutter for the check/radio mark…
      const gutters = src.match(/(?<![-\w])ps-8(?![-\w])/g) ?? [];
      expect(gutters.length).toBeGreaterThan(0);

      // …and every absolutely-positioned indicator span is inset from that same
      // logical edge. Converting one half without the other is the failure that
      // matters: the checkmark lands on top of the label in Arabic.
      const indicators =
        src.match(/className="[^"]*\babsolute\b[^"]*"/g) ?? [];
      expect(indicators.length).toBeGreaterThan(0);
      for (const cls of indicators) {
        expect(cls).toMatch(/(?<![-\w])start-\d/);
        expect(physicalHits(cls)).toEqual([]);
      }
    }
  );

  it.each(["dropdown-menu.tsx", "context-menu.tsx", "menubar.tsx"] as const)(
    "%s pushes the shortcut and the submenu chevron to the trailing edge logically",
    file => {
      // `ml-auto` is what put the shortcut and the chevron on the right; in Arabic the
      // trailing edge is the left, so the auto margin has to be logical.
      expect(CODE[file]).toMatch(/(?<![-\w])ms-auto(?![-\w])/);
      expect(CODE[file]).not.toMatch(/(?<![-\w])ml-auto(?![-\w])/);
    }
  );

  // -------------------------------------------------- input-group's own contract
  it("input-group's inline-start/inline-end variants are implemented logically", () => {
    const src = CODE["input-group.tsx"];

    // These variants are named for the CSS LOGICAL inline axis. Implementing them with
    // physical padding makes the addon's own name a lie in RTL, so the property worth
    // pinning is that the implementation agrees with the name.
    const inlineStart = /"inline-start":\s*\n?\s*"([^"]+)"/.exec(src)?.[1];
    const inlineEnd = /"inline-end":\s*\n?\s*"([^"]+)"/.exec(src)?.[1];
    expect(inlineStart, "inline-start variant not found").toBeTruthy();
    expect(inlineEnd, "inline-end variant not found").toBeTruthy();

    expect(physicalHits(inlineStart!)).toEqual([]);
    expect(physicalHits(inlineEnd!)).toEqual([]);
    expect(inlineStart!).toMatch(/(?<![-\w])ps-\d/);
    expect(inlineEnd!).toMatch(/(?<![-\w])pe-\d/);

    // The negative pull that tucks a button/kbd back under the addon has to travel
    // with it; an arbitrary value is still a physical class if it says `ml-`.
    expect(inlineStart!).toMatch(/ms-\[-0\.\d+rem\]/);
    expect(inlineEnd!).toMatch(/me-\[-0\.\d+rem\]/);

    // The input's clearance for the addon must be on the same logical side as the
    // addon itself, or the text runs under it in Arabic.
    expect(src).toMatch(/data-align=inline-start\]\]:\[&>input\]:ps-\d/);
    expect(src).toMatch(/data-align=inline-end\]\]:\[&>input\]:pe-\d/);
  });

  it("input-group leaves flex ORDER physical-free by leaving it alone", () => {
    // `order-first`/`order-last` run along the container's main axis, which already
    // reverses with the direction — converting them would be the bug, not the fix.
    const src = CODE["input-group.tsx"];
    expect(src).toMatch(/(?<![-\w])order-first(?![-\w])/);
    expect(src).toMatch(/(?<![-\w])order-last(?![-\w])/);
  });

  // ------------------------------------------------------------- non-vacuity
  it("the sweep is reading real class content, not an empty or swallowed file", () => {
    for (const f of FILES) {
      // A `codeOnly` that ate the file would make every `not.toMatch` above vacuous.
      expect(CODE[f].length).toBeGreaterThan(RAW[f].length * 0.5);
      // …and each file must genuinely carry a substantial number of class tokens.
      const classNames = CODE[f].match(/className=|cn\(/g) ?? [];
      expect(classNames.length).toBeGreaterThan(3);
      const logical =
        CODE[f].match(/(?<![-\w])(?:ps|pe|ms|me)-|(?<![-\w])(?:start|end)-\d/g) ??
        [];
      expect(logical.length).toBeGreaterThan(0);
    }
  });

  it("codeOnly strips something real in the files whose comments name classes", () => {
    // Otherwise the prose guard is decoration: the strip must be doing work.
    expect(CODE["input-group.tsx"].length).toBeLessThan(
      RAW["input-group.tsx"].length
    );
    expect(RAW["input-group.tsx"]).toMatch(/order-first.*direction/s);
    expect(CODE["input-group.tsx"]).not.toMatch(
      /reverses with the direction/
    );
  });
});
