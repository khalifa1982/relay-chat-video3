/**
 * "WHEN YOU OPEN THE PROFILE PAGE IT SHOWS ALL AREAS FOR 2 SECONDS THEN IT DISAPPEARS."
 *
 * The owner's report, and the timing is what identified it: the page rendered FULLY and
 * was then covered. Measured in a real browser at 390px against the built bundle — at
 * 400ms the element at the page centre was a real Profile row; by ~900ms it was the
 * background CANVAS, opaque, and hiding the canvas changed the painted pixel. Nothing
 * threw (the error boundary is loud, with a stack trace, so a throw would not have been
 * described as things disappearing) and the DOM stayed intact at 90+ buttons — the
 * content was still there, painted underneath.
 *
 * TWO PRE-EXISTING BUGS COMPOUNDED, and each is separately sufficient to cause it.
 *
 * (1) A SECOND, NESTED `ThemeProvider`. `main.tsx` wraps <App /> in the real one
 *     (`defaultTheme="dark" switchable`); `App.tsx` then nested ANOTHER that was NOT
 *     switchable, so it ignored localStorage and its `theme` was permanently "dark".
 *     Everything below it — including `AppShell` — read that, so
 *     `liveBackground = theme === "dark"` was TRUE for a LIGHT-theme user: the near-black
 *     live canvas mounted and the shell was given `bg-transparent`. Worse, BOTH providers
 *     ran the effect toggling `.dark` on <html>, and React flushes child effects before
 *     parent ones — so the inner added the class and the outer removed it. CSS said
 *     LIGHT while JS said DARK. Measured: `html="relay-v2 relay-app-lock"` (no `.dark`)
 *     with a canvas mounted and the shell computing to `rgba(0,0,0,0)`.
 *
 * (2) THE CANVAS PAINTS ABOVE UNPOSITIONED CONTENT. It is `position: fixed; z-index: 0`,
 *     and per CSS painting order a POSITIONED element with `z-index: 0` paints in the
 *     positioned-descendants step — AFTER in-flow non-positioned content. So any page
 *     whose content sits in no positioned ancestor is painted UNDER it. Measured:
 *     Profile, Messages and Contacts were covered; Dialer survived only because its
 *     keypad happens to live inside `relative` wrappers. Three of five tabs broken by
 *     accident and two working by accident.
 *
 * These are SOURCE pins plus one real relationship check. The measurement itself needs a
 * browser and `playwright` is deliberately not a dependency of this repo, so the probe
 * lives outside it — what is pinned here is the structure that measurement proved.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { codeOnly } from "../../../server/testing/codeOnly";

const APP = readFileSync("client/src/App.tsx", "utf8");
const MAIN = readFileSync("client/src/main.tsx", "utf8");
const SHELL = readFileSync("client/src/app/AppShell.tsx", "utf8");
const BG = readFileSync("client/src/app/RelayBackground.tsx", "utf8");

describe("exactly ONE ThemeProvider, and it is the switchable one", () => {
  it("no component mounts a second provider", () => {
    /* The count is the property. A nested provider does not merely duplicate state — it
       SHADOWS the user's choice for everything below it, and both copies fight over the
       `.dark` class, so the CSS theme and the JS theme can disagree. */
    const mounts: string[] = [];
    for (const f of globSync("client/src/**/*.tsx")) {
      if (f.includes("ThemeContext")) continue;
      const src = codeOnly(readFileSync(f, "utf8"));
      if (/<ThemeProvider[\s>]/.test(src)) mounts.push(f);
    }
    expect(mounts, `ThemeProvider is mounted in ${mounts.length} places`).toHaveLength(1);
    expect(mounts[0]).toMatch(/main\.tsx$/);
  });

  it("that one provider is `switchable`, so the stored choice is honoured", () => {
    // Without `switchable` the provider ignores localStorage entirely and pins itself to
    // its default — which is what made the inner one permanently "dark".
    expect(codeOnly(MAIN)).toMatch(/<ThemeProvider[^>]*\bswitchable\b/);
  });

  it("App.tsx does not import it either, so it cannot come back by reflex", () => {
    expect(codeOnly(APP)).not.toMatch(/ThemeProvider/);
  });
});

describe("the shell's content is painted ABOVE the background canvas", () => {
  /** The numeric z-index a source declares, so the two sides can be COMPARED rather
   *  than each frozen as a literal. */
  const canvasZ = () => {
    const m = BG.match(/zIndex:\s*(-?\d+)/);
    expect(m, "RelayBackground must declare a numeric zIndex").toBeTruthy();
    return Number(m![1]);
  };
  const contentZ = () => {
    const m = SHELL.match(/className="relative z-(\d+) flex-1 min-h-0 overflow-y-auto/);
    expect(m, "the scroll container must declare a z-index").toBeTruthy();
    return Number(m![1]);
  };

  it("the content's z-index is strictly greater than the canvas's", () => {
    /* THE RELATIONSHIP IS THE PROPERTY, not either number. A fixed element with
       `z-index: 0` beats unpositioned content, so the content must be positioned AND
       above it — asserting only "the canvas is 0" or only "the content is 10" would let
       a future change to the other side reopen the bug silently. */
    expect(contentZ()).toBeGreaterThan(canvasZ());
  });

  it("the canvas is still FIXED and full-bleed — the fix must not have moved it", () => {
    // The bug is fixed by lifting the content, not by shrinking or unpinning the
    // background; it is meant to sit behind the whole app.
    /* COUNTED, not merely present. There are TWO fixed layers here — the canvas and a
       non-interactive vignette over it — so a bare `toMatch` was satisfied by the
       vignette while the CANVAS had been changed to `absolute`; the mutation survived
       and proved it. An absolute canvas is scoped to its nearest positioned ancestor
       and would scroll away from the viewport, which looks like a fix and is not. */
    const fixed = [...BG.matchAll(/position: "fixed"/g)].length;
    expect(fixed, "every background layer must stay viewport-fixed").toBe(2);
    expect([...BG.matchAll(/inset: 0/g)].length).toBe(2);
  });

  it("the desktop sidebar is lifted too, being unpositioned content as well", () => {
    expect(SHELL).toMatch(/relay-appshell-chrome relative z-10 hidden md:flex/);
  });

  it("the lift is on the ONE wrapper above children, not per page", () => {
    /* Fixed at the shell so a page added later cannot inherit the bug. Three of the five
       tabs were covered and two were fine purely by accident of their own markup — a
       per-page fix would have repeated that accident. */
    const code = codeOnly(SHELL);
    const at = code.indexOf('className="relative z-10 flex-1 min-h-0 overflow-y-auto');
    expect(at).toBeGreaterThan(0);
    /* `lastIndexOf`, because `{children}` occurs TWICE — `AppShell` passes it down to
       `Inner` long before `Inner` renders it, and the FIRST occurrence sits above the
       scroll container. Taking the first made this fail on correct code. */
    expect(code.lastIndexOf("{children}")).toBeGreaterThan(at);
    expect([...code.matchAll(/\{children\}/g)].length).toBe(2);
  });
});

describe("one theme read decides both the mount and the surface", () => {
  it("`liveBackground` is derived once and drives the canvas AND the shell's fill", () => {
    /* v2.106.0's own comment: "two theme reads is how you get an opaque shell over a
       running canvas". Both reads here agreed with each other — and both were wrong,
       because the context they read was not the user's. The single-derivation rule is
       still right and is kept; what was missing was that the context be correct. */
    const code = codeOnly(SHELL);
    expect(code).toMatch(/const liveBackground = theme === "dark";/);
    expect(code).toMatch(/\{liveBackground && <RelayBackground \/>\}/);
    expect(code).toMatch(/liveBackground \? "bg-transparent" : "bg-background"/);
    /* ONE DERIVATION, not one mention. Counting `theme === "dark"` across the file was
       wrong about the code — the sidebar's own Dark/Light toggle legitimately reads it
       for `aria-pressed` and its label, which is a rendering question rather than a
       "which design is live" question. CLAUDE.md already records this exact mistake
       being made once before in this file; what matters is that the FLAG is derived
       once and that both consumers read the flag rather than re-deriving it. */
    expect([...code.matchAll(/const liveBackground = /g)].length).toBe(1);
    const bgUse = code.slice(code.indexOf("{liveBackground && <RelayBackground"));
    expect(bgUse).not.toMatch(/^\{theme === "dark" && <RelayBackground/);
    expect(code).not.toMatch(/theme === "dark" \? "bg-transparent"/);
  });
});
