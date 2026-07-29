/* ──────────────────────────────────────────────────────────────────────────
 * v2.105.19 — the avatar menu's header is the BUILD, not a third copy of the
 * name, the badge and the PIN.
 *
 * THE ASK, AND WHY IT TOOK TWO GOES. The owner asked for this in v2.103.1 —
 * *"when you click on the profile remove this one the first name, badge and pin
 * number because it's already repeated on the bar on the top bar"* — and that
 * release applied it to the Profile PAGE hero. Wrong surface. They meant the
 * top bar's AVATAR MENU, said so again with a screenshot circling exactly this
 * header (*"the profile icon on the main page … when you click on the right"*),
 * and the Profile hero is restored in this release.
 *
 * The generalisable mistake is worth writing down where it will be read: a
 * request phrased by what you TAP does not name a screen. "Click on the
 * profile" fit two surfaces and I picked the one whose FILENAME matched.
 *
 * WHAT IS PINNED HERE is the property, not the markup: the header carries the
 * build from the one version constant, and it carries it INSTEAD of three
 * things the bar behind it still shows. Both halves matter — the removal is
 * only defensible while the bar keeps them, so the bar is asserted too. If a
 * later change strips the IdentityStrip, this test goes red and the menu has to
 * be reconsidered rather than silently leaving the user with nowhere to read
 * their own number.
 * ────────────────────────────────────────────────────────────────────────── */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { APP_VERSION } from "../../../shared/version";
import { codeOnly } from "../../../server/testing/codeOnly";

const HERE = path.resolve(__dirname);
const read = (p: string) => fs.readFileSync(path.join(HERE, p), "utf8");
const SHELL = read("./AppShell.tsx");
const TOPBAR = read("./TopBar.tsx");

/**
 * The menu's own region. Anchored on the JSX element that opens it, and bounded
 * by the first item inside it, because everything asserted below is about the
 * HEADER — running to end-of-file would let a later `RoleBadge` anywhere in the
 * component satisfy a `not.toMatch` (the unbounded-slice trap, which has now
 * bitten this repo in five files).
 */
const MENU_HEADER = (() => {
  const open = SHELL.indexOf("<DropdownMenuContent align=\"end\"");
  expect(open, "found the account menu").toBeGreaterThan(-1);
  const end = SHELL.indexOf("<DropdownMenuSeparator />", open);
  expect(end, "found the separator that ends the header").toBeGreaterThan(open);
  return SHELL.slice(open, end);
})();

describe("v2.105.19 — the account menu header shows the build", () => {
  it("the header region was located, so the assertions below read the right slice", () => {
    // Asserted FIRST: a collapsed slice makes every `not.toMatch` below pass
    // vacuously, which is worse than no test because it reports safety.
    expect(MENU_HEADER.length).toBeGreaterThan(80);
    expect(MENU_HEADER).toContain("<DropdownMenuLabel");
  });

  it("renders RELAY + the version from the ONE version constant", () => {
    // Owner: *"you need to put the rely and the version number of the current
    // built whenever it's updated."*
    expect(MENU_HEADER).toMatch(/RELAY v\{APP_VERSION\}/);
    expect(SHELL).toMatch(/import \{ APP_VERSION \} from "@shared\/version"/);
  });

  it("that constant is the one the server serves and the updater compares", () => {
    // BEHAVIOURAL, not a source pin: the whole point of reading
    // `shared/version.ts` rather than hardcoding a string is that the stamp
    // cannot disagree with what is deployed. A literal in the JSX would satisfy
    // the pin above and break this promise.
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(codeOnly(MENU_HEADER)).not.toMatch(/RELAY v\d/);
  });

  it("the version is bidi-isolated, so an RTL locale cannot reorder it", () => {
    // `2.105.19` in an RTL paragraph can render with its dot-separated parts
    // reordered — the v2.99.77 lesson, applied to a version rather than a PIN.
    //
    // ON STRIPPED CODE, and that is not incidental: my own comment above the
    // element explains WHY `dir="ltr"` is there, so the first cut of this
    // assertion was satisfied by its own prose and would have stayed green with
    // the attribute deleted. The sixteenth appearance of that trap here, caught
    // this time by counting the anchor before mutating rather than by the
    // mutation run.
    expect(codeOnly(MENU_HEADER)).toMatch(/dir="ltr"/);
  });

  it("does NOT repeat the name, the badge or the PIN", () => {
    // The three things the owner circled. Asserted on stripped code so the
    // comment that EXPLAINS their removal cannot satisfy the search — the
    // prose-anchor trap, for the sixteenth time in this repo.
    const code = codeOnly(MENU_HEADER);
    expect(code).not.toMatch(/<RoleBadge/);
    expect(code).not.toMatch(/me\.displayName/);
    expect(code).not.toMatch(/formatNumber\(me\.number\)/);
  });

  it("the top bar behind the menu still carries all three — that is what makes the removal safe", () => {
    /* The removal is a de-duplication argument and it is only true while the bar
       holds the originals. If a later release strips the strip, this goes red and
       the menu has to be reconsidered, rather than quietly leaving somebody with
       nowhere to read their own number.

       FOUND BY MUTATION: this first read `toMatch(/<IdentityStrip/)`, which
       `{false && <IdentityStrip …}` satisfies untouched — the pin froze the
       element's PRESENCE while saying nothing about whether it renders. So it now
       requires the element to open a line of its own, which a gate cannot do.
       Pin-the-location-not-the-property, for the second release running. */
    const mount = SHELL.split("\n").filter((l) => l.includes("<IdentityStrip"));
    expect(mount, "exactly one mount").toHaveLength(1);
    expect(mount[0]).toMatch(/^\s*<IdentityStrip$/);
    const strip = SHELL.slice(SHELL.indexOf("<IdentityStrip"));
    expect(strip.slice(0, 400)).toMatch(/displayName=\{me\.displayName\}/);
    expect(strip.slice(0, 400)).toMatch(/number=\{me\.number\}/);
    // …and the component really renders each of them.
    expect(TOPBAR).toMatch(/firstNameOf\(displayName\)/);
    expect(TOPBAR).toMatch(/<RoleBadge role=\{roleFromFlags\(role, verified\)\}/);
    expect(TOPBAR).toMatch(/\{formatPin\(number\)\}/);
  });

  it("the menu keeps every ACTION it had — only the header changed", () => {
    // The header is a label, not a control, so nothing tappable may go with it.
    // A menu that lost Sign out to a cosmetic edit is the failure mode here.
    for (const item of ["Add a story", "openPeerStatus(me.number)", "requestProfilePane"]) {
      expect(SHELL, item).toContain(item);
    }
    expect(SHELL).toMatch(/signOut/);
  });

  it("the sidebar's own account link is untouched — it is a different surface", () => {
    // The DESKTOP sidebar (`hidden md:flex`) shows the same identity in a link to
    // /app/profile. It is not behind the avatar the owner circled and it is the
    // only place that carries the device chip, so it keeps name + badge + number.
    const side = SHELL.slice(SHELL.indexOf('href="/app/profile"'));
    expect(side.slice(0, 1600)).toMatch(/<RoleBadge role=\{roleFromFlags\(me\.role, me\.verified\)\}/);
    expect(side.slice(0, 1600)).toMatch(/formatNumber\(me\.number\)/);
    // Exactly ONE badge remains in the file, so the menu's copy is really gone
    // rather than merely moved out of the slice above.
    expect((codeOnly(SHELL).match(/<RoleBadge/g) || []).length).toBe(1);
  });
});
