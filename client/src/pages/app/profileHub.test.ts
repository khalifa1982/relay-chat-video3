/* ============================================================
   v2.99.89 — the Profile page becomes the control centre.

   Owner, twice, with two mockups: "you build the profile page to be more advanced.
   Everything controlled entire things from there. Also, put the barcode, put your
   number, put the badge, put your status, put the things that you have it, which is
   not in the picture."

   THE ONE INVARIANT THAT MATTERS HERE IS COMPLETENESS. Restructuring a page that
   held sixteen sections and roughly sixty controls is exactly the change where a
   control quietly stops being reachable — and an unreachable setting is worse than an
   ugly one, because nothing tells you it is gone. So the load-bearing test does not
   check any layout: it ENUMERATES every `*Section` component defined across the two
   Profile files and asserts each is rendered. Delete a pane, or forget to route a
   section, and the count no longer matches — the test names the missing one.

   The rest pins the decisions that were easy to get wrong: panes are LOCAL STATE
   (wouter's useLocation is pathname-only, so a `#pane` would be a dead tap), the
   overlays sit OUTSIDE the pane switch, the "Saved" pill sits outside the ANIMATED
   wrapper (`animate-in` animates `filter`, which establishes a containing block for
   `position: fixed`), and "Choose my number" is withheld from a guest the server
   would refuse anyway.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
/* This page now renders through `dict/profile.ts`, so a pin that froze an English
   literal would forbid the translation while saying nothing about the words. Each of
   those is rewritten to the PROPERTY it always stood for — this sentence reaches this
   screen — which `copyOnScreen` satisfies by the literal OR by a key whose English half
   is that sentence, and which is strictly STRONGER, because reaching the dictionary also
   proves an Arabic half exists. */
import { copyOnScreen, whyCopyMissing } from "../../../../server/testing/copyOnScreen";

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const PROFILE = read("client/src/pages/app/Profile.tsx");
const HUB_SECTIONS = read("client/src/pages/app/ProfileHubSections.tsx");
const TOPBAR = read("client/src/app/TopBar.tsx");

/** Strips comment LINES so an assertion cannot pass on prose that merely mentions
 *  the pattern it forbids — the mistake this repo has made five releases running. */
function codeOnly(src: string): string {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

/** The page component's body: from its declaration to the `type Pane` that follows. */
const PAGE = (() => {
  const start = PROFILE.indexOf("export default function ProfilePage()");
  expect(start, "ProfilePage exists").toBeGreaterThan(-1);
  const end = PROFILE.indexOf("const PANES = [", start);
  expect(end, "the Pane union follows the page component").toBeGreaterThan(start);
  return PROFILE.slice(start, end);
})();

describe("nothing was lost in the restructure", () => {
  /** Every section component that EXISTS, wherever it is declared. */
  const defined = [
    ...codeOnly(PROFILE).matchAll(/^function ([A-Za-z]+Section)\(/gm),
    ...codeOnly(HUB_SECTIONS).matchAll(/^export function ([A-Za-z]+Section)\(/gm),
  ].map((m) => m[1]);

  it("found the sections to check (the enumeration itself is not empty)", () => {
    // A test that enumerates nothing passes for the wrong reason. This is the guard
    // that makes every assertion below mean something.
    expect(defined.length).toBeGreaterThanOrEqual(12);
    expect(new Set(defined).size, "no section name is declared twice").toBe(defined.length);
  });

  it("renders EVERY defined section somewhere on the page", () => {
    const missing = defined.filter((name) => !new RegExp(`<${name}[\\s/>]`).test(PAGE));
    expect(missing, `these sections exist but are unreachable: ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps the display-name editor, the avatar controls and the number card", () => {
    // These four are NOT `*Section` components, so the enumeration above cannot see
    // them; they are the page's own inline controls and each has to be named.
    expect(PAGE).toMatch(/id="displayName"/);
    expect(PAGE).toMatch(/onClick=\{saveName\}/);
    expect(PAGE).toMatch(/onClick=\{clearAvatar\}/);
    expect(PAGE).toMatch(/<NumberAndFlag\b/);
  });

  it("keeps the guest upgrade CTA, sign-out and the build stamp on the hub", () => {
    expect(copyOnScreen(PAGE, "Keep this number forever")).toBe(true);
    expect(PAGE).toMatch(/onClick=\{requestSignOut\}/);
    /* THE STAMP SHOWS THE REAL BUILD, which is the property the old `RELAY v{APP_VERSION}`
       literal stood for: a hardcoded version string would satisfy any wording check and
       then lie about what is deployed. So the constant must reach the render, and the
       words around it must still be the stamp's. */
    expect(PAGE).toMatch(/version: APP_VERSION/);
    expect(copyOnScreen(PAGE, "auto-updates on publish")).toBe(true);
    // GuestRestore is deliberately a self-hiding BLOCK rather than a row: it renders
    // null unless this browser holds a recovery record that still resolves, and a row
    // that is usually a dead end is worse than a block that is usually absent.
    expect(PAGE).toMatch(/<GuestRestore heading=/);
    expect(copyOnScreen(PAGE, "Restore a previous number")).toBe(true);
  });
});

describe("the hero carries everything the owner listed", () => {
  const HERO = (() => {
    const at = PAGE.indexOf("{/* ── identity hero");
    expect(at, "the hero is marked").toBeGreaterThan(-1);
    return PAGE.slice(at, PAGE.indexOf("{/* ── grouped rows", at));
  })();

  it("the photo, and it opens the ONE upload path", () => {
    expect(HERO).toMatch(/onClick=\{\(\) => setPickerOpen\(true\)\}/);
    // The page's own file input and upload handler were unreachable: nothing clicked
    // the input, so `uploading` was permanently false and the button's spinner branch
    // could never render. Two upload paths for one photo is also how they drift.
    expect(codeOnly(PROFILE)).not.toMatch(/type="file"/);
    expect(codeOnly(PROFILE)).not.toMatch(/uploadAvatarImage/);
    expect(codeOnly(PROFILE)).not.toMatch(/setUploading/);
  });

  /**
   * RESTORED in v2.105.19. These three pins are the ORIGINALS, back verbatim.
   *
   * v2.103.1 replaced them with their own negations, reading the owner's *"when you
   * click on the profile remove this one the first name, badge and pin number"* as this
   * PAGE. They meant the top bar's AVATAR MENU — *"the profile icon … when you click on
   * the right"* — and told me so with a screenshot of it; the rule now lives there
   * (`appShellVersionLabel.test.ts`) and the hero is what it was.
   *
   * The lesson worth keeping is not about either surface: a request phrased by what you
   * TAP ("click on the profile") does not name a screen, and I should have asked which
   * one rather than picking the one whose name matched.
   */
  it("the badge", () => {
    expect(HERO).toMatch(/<RoleBadge role=\{roleFromFlags\(me\.role, me\.verified\)\}/);
  });

  it("the number, in the owner's NNN-NNN grouping and the green token", () => {
    // ANCHORED as a RENDERED CHILD (`>` … `</span>`), not as a bare substring. A
    // bare `{formatPin(me.number)}` also matches inside the aria-label's
    // `${formatPin(me.number)}`, so the loose form passed with the visible number
    // deleted — the mutation run caught exactly that, and it is the same
    // interpolation trap that bit v2.99.86.
    expect(HERO).toMatch(/>\s*\{formatPin\(me\.number\)\}\s*<\/span>/);
    expect(HERO).toMatch(/text-\[color:var\(--relay-green-text\)\]/);
  });

  it("the number is bidi-isolated so an Arabic name cannot reorder it", () => {
    const pin = HERO.slice(HERO.indexOf("font-mono text-base"));
    expect(pin.slice(0, 400)).toMatch(/\[unicode-bidi:isolate\]/);
    expect(HERO).toMatch(/dir="ltr"/);
  });

  it("what you can DO with the number is still here, and only the footer stamps the build", () => {
    // The controls are the reason this block exists and none of them is anywhere else.
    expect(HERO).toMatch(/openPane\("number"\)/);
    /* The chip is LABELLED WITH THE NUMBER. The old pin froze the template literal; the
       property is that the screen reader hears which number this opens, and that the
       label is built from the shared formatter rather than a second grouping rule. */
    expect(copyOnScreen(HERO, "Your RELAY number is")).toBe(true);
    expect(HERO).toMatch(/aria-label=\{t\("profile\.numberAria", \{ number: formatPin\(me\.number\) \}\)\}/);
    // The stamp is back in the FOOTER, so the hero must not carry a second copy — one
    // screen printing the version twice is the repetition v2.103.1 was right about even
    // though it removed the wrong thing.
    expect(codeOnly(HERO)).not.toMatch(/APP_VERSION/);
    expect((codeOnly(PROFILE).match(/APP_VERSION/g) || []).length).toBe(2); // the import + the one render
  });

  it("the barcode — and it opens the real share sheet, not a picture of one", () => {
    expect(HERO).toMatch(/<QrCode className="size-4" \/>/);
    const qr = HERO.slice(HERO.indexOf("<QrCode") - 700, HERO.indexOf("<QrCode"));
    expect(qr).toMatch(/onClick=\{\(\) => setQrOpen\(true\)\}/);
    expect(PAGE).toMatch(/<ShareNumberSheet open=\{qrOpen\}/);
  });

  it("the status, and it is TAPPABLE rather than merely described", () => {
    /* `selfStatus` returns a KEY now, not a finished English label — a module-level
       function cannot call a hook, and one that returns a sentence is how a screen ends
       up translated everywhere except its own status pill. The property is unchanged:
       the pill shows the live status and opens the pane. */
    const at = HERO.indexOf("{t(st.labelKey)}");
    expect(at, "the pill renders the live status").toBeGreaterThan(-1);
    const status = HERO.slice(Math.max(0, at - 900));
    expect(status).toMatch(/onClick=\{\(\) => openPane\("status"\)\}/);
  });

  it("wears the top bar's own breathing ring, anti-phased by a NEGATIVE DELAY", () => {
    // The same treatment on the thing you tap in the bar and the thing you land on.
    expect(HERO).toMatch(/relay-ring-a/);
    expect(HERO).toMatch(/relay-ring-b/);
    // `animation-direction: reverse` on this symmetric keyframe is an EXACT no-op, so
    // both rings would peak together and render as a white ring blinking — the one
    // thing the owner ruled out. The anti-phase lives in the stylesheet as a
    // half-cycle negative delay; assert it is still there.
    const css = read("client/src/index.css");
    const b = css.slice(css.indexOf(".relay-ring-b"));
    expect(b.slice(0, 300)).toMatch(/animation-delay:\s*-1\.3s/);
    expect(b.slice(0, 300)).not.toMatch(/animation-direction:\s*reverse/);
    // Ring B rests at opacity 0 so the REDUCED-MOTION still frame is the green ring,
    // not the later-declared white one covering it.
    const ringB = HERO.slice(HERO.indexOf("relay-ring-b"));
    expect(ringB.slice(0, 260)).toMatch(/opacity: 0/);
  });
});

describe("one formatter for the PIN, not two", () => {
  it("Profile imports formatPin from the top bar", () => {
    expect(PROFILE).toMatch(/import \{ formatPin \} from "@\/app\/TopBar"/);
  });

  it("and does not carry a second copy of the same rule", () => {
    // A local re-implementation is how the bar and the profile end up disagreeing
    // about how somebody's own number is written.
    expect(codeOnly(PROFILE)).not.toMatch(/function formatPin/);
    expect(TOPBAR).toMatch(/export function formatPin/);
  });
});

describe("panes are local state, not routes", () => {
  it("the open pane is React state", () => {
    expect(PAGE).toMatch(/const \[pane, setPane\] = useState<Pane \| null>\(null\)/);
  });

  it("nothing navigates to a hash or a query to open one", () => {
    // wouter's useLocation returns location.PATHNAME only, so a hash-only or
    // search-only navigation produces no re-render at all: the tap would do nothing
    // and there would be no error to explain why.
    const code = codeOnly(PAGE);
    expect(code).not.toMatch(/navigate\("\/app\/profile[#?]/);
    expect(code).not.toMatch(/window\.location\.hash/);
  });

  it("every pane in the union has a title AND a body", () => {
    // v2.101.0 made the pane set a RUNTIME array with the type derived from it, so
    // an out-of-band pane request can be validated against the real set. Reading
    // that array is strictly better than parsing the old hand-kept union: it is now
    // the single source of truth, and the type cannot disagree with it.
    const at = PROFILE.indexOf("const PANES = [");
    expect(at, "PANES exists").toBeGreaterThan(-1);
    const list = PROFILE.slice(at, PROFILE.indexOf("] as const", at));
    const names = [...list.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThanOrEqual(10);
    const titles = PAGE.slice(PAGE.indexOf("const paneTitle: Record<Pane, string>"));
    for (const n of names) {
      // A title, so the pane's header is never blank...
      expect(titles.slice(0, titles.indexOf("};")), `paneTitle covers "${n}"`).toMatch(
        new RegExp(`\\b${n}:`)
      );
      // ...and something rendered for it, so opening it is never a blank screen.
      expect(PAGE, `pane "${n}" renders something`).toMatch(
        new RegExp(`pane === "${n}" &&`)
      );
    }
  });

  it("the header of a pane reads from paneTitle, so it cannot drift from its row", () => {
    expect(PAGE).toMatch(/\{paneTitle\[pane\]\}/);
    expect(PAGE).toMatch(/label=\{paneTitle\.number\}/);
  });

  it("a pane has a way back", () => {
    expect(PAGE).toMatch(/onClick=\{\(\) => setPane\(null\)\}/);
    // The arrow is LABELLED — an icon-only control with no accessible name is a dead
    // end for a screen reader. The words themselves are pinned through the dictionary.
    expect(PAGE).toMatch(/aria-label=\{t\("profile\.back"\)\}/);
    expect(copyOnScreen(PAGE, "Back to profile"), whyCopyMissing(PAGE, "Back to profile")).toBe(
      true
    );
  });

  it("opening a pane scrolls the pane into view, not the window", () => {
    // The scroll container is the AppShell's, not the document (v2.78) — a
    // window.scrollTo would do nothing, and a pane opened from halfway down a list
    // that no longer exists starts off-screen.
    const open = PAGE.slice(PAGE.indexOf("const openPane ="));
    expect(open.slice(0, 700)).toMatch(/paneTopRef\.current\?\.scrollIntoView/);
    expect(codeOnly(PAGE)).not.toMatch(/window\.scrollTo/);
  });
});

describe("the overlays survive a pane change", () => {
  /** Everything after the pane ternary closes. */
  const ROOT_TAIL = (() => {
    const at = PAGE.indexOf("{/* The four overlays are mounted at the ROOT");
    expect(at, "the overlays are marked at the root").toBeGreaterThan(-1);
    return PAGE.slice(at);
  })();

  it("AuthPanel, AvatarPicker, the sign-out dialog and the share sheet are at the root", () => {
    // Closing a pane while one of these is open would unmount the open thing from
    // under the user.
    //
    // The AuthPanel needle tolerates a wrapping paren and a line break: the property
    // is "mounted at the root, gated on showAuth", and the original froze it as a
    // ONE-LINE mount — so it broke the moment v2.105.15 passed the panel a prop while
    // saying nothing about whether the mount had moved out of the root.
    for (const needle of [
      /\{showAuth &&\s*\(?\s*<AuthPanel\b/,
      /<AvatarPicker\b/,
      /\{signOutDialog\}/,
      /<ShareNumberSheet\b/,
    ]) {
      expect(ROOT_TAIL).toMatch(needle);
    }
  });

  it("the Saved pill sits OUTSIDE the animated wrapper", () => {
    // `animate-in` animates `filter`, and a filter establishes a containing block for
    // `position: fixed` descendants — nested, the pill would centre itself on that
    // box instead of the viewport. This exact trap has now bitten `.addpad` and the
    // video-consent card (v2.99.54).
    const pillAt = PAGE.indexOf('<span>{t("profile.saved")}</span>');
    const wrapperAt = PAGE.indexOf("motion-safe:animate-in");
    expect(pillAt).toBeGreaterThan(-1);
    expect(wrapperAt).toBeGreaterThan(-1);
    expect(pillAt, "the pill is declared BEFORE the animated wrapper").toBeLessThan(wrapperAt);
  });

  it("the error banner and the pill report from either side of the switch", () => {
    // `updateProfile` fires from more than one pane, so a confirmation that only
    // renders on the pane you happened to be on is worse than none.
    const ternaryAt = PAGE.indexOf("{pane === null ? (");
    expect(ternaryAt).toBeGreaterThan(-1);
    expect(PAGE.indexOf("{savedAt !== null && !error && (")).toBeLessThan(ternaryAt);
    expect(PAGE.indexOf("{error && (")).toBeLessThan(ternaryAt);
  });
});

describe("no row is a dead end", () => {
  it("the Admin row is drawn only for an actual admin", () => {
    expect(PAGE).toMatch(/\{amIAdmin\.data\?\.admin && \(/);
    // The rule now lives in ONE place. The old self-hiding AdminLinkSection had it
    // too, and a row plus a self-hiding section is two copies of the same predicate.
    expect(codeOnly(PROFILE)).not.toMatch(/function AdminLinkSection/);
    expect(PAGE).toMatch(/navigate\("\/app\/admin"\)/);
  });

  it("the three notification sections share ONE row", () => {
    // EmailNotificationsSection returns null without a signed-in account, so its own
    // row would open an empty pane for every guest. Folding them together keeps the
    // "is there an account" rule in exactly one place.
    const notifs = PAGE.slice(PAGE.indexOf('pane === "notifs" &&'));
    const body = notifs.slice(0, notifs.indexOf("{pane === \"theme\""));
    expect(body).toMatch(/<NotificationsSection \/>/);
    expect(body).toMatch(/<EmailNotificationsSection \/>/);
    expect(body).toMatch(/<DndSection \/>/);
  });

  it("the number section offers ONLY the random regenerate now", () => {
    /* This pin used to assert that "Choose my number" was hidden from a GUEST. The
       owner has since withdrawn the control outright — *"remove choose my number
       just keep random number option"* — so that assertion froze exactly what was
       asked to be removed.

       REWRITTEN TO THE SURVIVING PROPERTY, and it is a stronger one: there is now
       no guest/registered split in this section at all, because the only remaining
       control is the RANDOM regenerate, which a guest could always use. The old
       reasoning (a chosen number is first-come and permanent while a guest identity
       is session-scoped, so a guest claim would squat a memorable number and then
       strand it) is preserved on the SERVER side below, which still refuses a guest
       — the endpoint is deliberately left registered even though nothing calls it. */
    const num = PROFILE.slice(PROFILE.indexOf("function NumberAndFlag("));
    expect(num.length, "found NumberAndFlag").toBeGreaterThan(200);
    expect(copyOnScreen(num, "Random number"), whyCopyMissing(num, "Random number")).toBe(true);
    /* ABSENT rather than merely absent-as-a-literal: asked through `copyOnScreen`, this
       also fails if the control comes back through the dictionary, which a raw
       `not.toMatch` would have missed once the screen was swept. */
    expect(copyOnScreen(codeOnly(num), "Choose my number")).toBe(false);
    // No `{!isGuest && (` gate survives in this section — there is nothing to gate.
    expect([...codeOnly(num).matchAll(/\{!isGuest && \(/g)]).toHaveLength(0);
    // The SERVER still refuses a guest, so removing the UI weakened no rule.
    const routers = read("server/v2routers.ts");
    const sn = routers.slice(routers.indexOf("setNumber: publicProcedure"));
    expect(sn.slice(0, 900)).toMatch(/if \(me\.isGuest \|\| !ctx\.user\)/);
  });
});

describe("the rows themselves", () => {
  const ROW = (() => {
    const at = PROFILE.indexOf("function HubRow(");
    expect(at).toBeGreaterThan(-1);
    return PROFILE.slice(at, PROFILE.indexOf("\n}", PROFILE.indexOf("<ChevronRight", at)));
  })();

  it("never set a FIXED height — a subtitle can wrap in another language", () => {
    // A hard-coded 16px line clipped a badge in the Dialer's preview (v2.99.39).
    expect(ROW).toMatch(/min-h-\[60px\]/);
    // The lookbehind is load-bearing: `\bh-\[` matches INSIDE `min-h-[60px]`, so
    // without it this assertion failed against the correct code — it would have
    // forbidden the very minimum it asks for.
    expect(ROW).not.toMatch(/(?<![-a-z])h-\[\d/);
  });

  it("truncate rather than overflow, and the text is the only shrinker", () => {
    expect(ROW).toMatch(/min-w-0 flex-1/);
    expect(ROW).toMatch(/block truncate/);
    /* The icon chip and the chevron are atomic; if either could shrink the row would
       degrade into an unreadable smear instead of an ellipsis.
       REWRITTEN (v2.106.4): this froze `size-9`, the tile's exact SIZE, which board 1f
       legitimately changes to 34px — while the property is only that the tile cannot
       shrink. Now asserted as "the icon tile declares a size AND shrink-0", so a tile
       that starts competing with the label for width still fails. */
    expect(ROW).toMatch(/size-\[?\d+(?:px\])? shrink-0/);
    expect(ROW).toMatch(/<ChevronRight className="size-4 shrink-0/);
  });

  it("are real buttons with a visible focus ring", () => {
    expect(ROW).toMatch(/type="button"/);
    expect(ROW).toMatch(/focus-visible:ring-\[3px\]/);
  });

  it("the icon chip and the chevron are hidden from a screen reader", () => {
    // The label is already read; announcing "image" and "chevron right" around it is
    // noise, and the chevron carries no information a button does not already imply.
    const chip = ROW.slice(ROW.indexOf("grid size-9 shrink-0") - 200, ROW.indexOf("grid size-9 shrink-0"));
    expect(chip).toMatch(/aria-hidden="true"/);
    expect(ROW).toMatch(/<ChevronRight[^>]*aria-hidden="true"/);
  });
});
