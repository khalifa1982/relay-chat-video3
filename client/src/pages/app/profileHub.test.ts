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
    expect(PAGE).toMatch(/Keep this number forever/);
    expect(PAGE).toMatch(/onClick=\{requestSignOut\}/);
    expect(PAGE).toMatch(/RELAY v\{APP_VERSION\}/);
    // GuestRestore is deliberately a self-hiding BLOCK rather than a row: it renders
    // null unless this browser holds a recovery record that still resolves, and a row
    // that is usually a dead end is worse than a block that is usually absent.
    expect(PAGE).toMatch(/<GuestRestore heading="Restore a previous number"/);
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

  it("the barcode — and it opens the real share sheet, not a picture of one", () => {
    expect(HERO).toMatch(/<QrCode className="size-4" \/>/);
    const qr = HERO.slice(HERO.indexOf("<QrCode") - 700, HERO.indexOf("<QrCode"));
    expect(qr).toMatch(/onClick=\{\(\) => setQrOpen\(true\)\}/);
    expect(PAGE).toMatch(/<ShareNumberSheet open=\{qrOpen\}/);
  });

  it("the status, and it is TAPPABLE rather than merely described", () => {
    const status = HERO.slice(HERO.indexOf("{st.label}") - 900);
    expect(status).toMatch(/onClick=\{\(\) => openPane\("status"\)\}/);
    expect(status).toMatch(/\{st\.label\}/);
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
    expect(PAGE).toMatch(/aria-label="Back to profile"/);
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
    for (const needle of [
      /\{showAuth && <AuthPanel/,
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
    const pillAt = PAGE.indexOf("<span>Saved</span>");
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

  it("Choose my number is withheld from a guest the server would refuse", () => {
    // `identity.setNumber` throws FORBIDDEN for a guest: a chosen number is
    // first-come and permanent while a guest identity is session-scoped, so a guest
    // claim would squat a memorable number and then strand it. Offering the button
    // meant a guest typing a number and being refused for who they are.
    const num = PROFILE.slice(PROFILE.indexOf("function NumberAndFlag("));
    expect(num).toMatch(/isGuest: boolean;/);
    // Exactly ONE gate, so its extent below is unambiguous.
    expect([...num.matchAll(/\{!isGuest && \(/g)]).toHaveLength(1);
    const gateStart = num.indexOf("{!isGuest && (");
    // The gate's own closing `)}` at its own indentation — the first one after it.
    const gateEnd = num.indexOf("\n          )}", gateStart);
    expect(gateEnd).toBeGreaterThan(gateStart);
    const gate = num.slice(gateStart, gateEnd);
    expect(gate).toMatch(/Choose my number/);
    // A REGENERATE stays available to a guest: it hands out a random number and
    // always has, so hiding it would take away the only number control they have.
    // Asserting on the gate's CONTENTS rather than on the text around the regenerate
    // button, because the 900 characters before it include this very gate — a slice
    // that read backwards was this test's own first bug.
    expect(gate).not.toMatch(/Random number/);
    expect(num).toMatch(/Random number/);
    expect(PAGE).toMatch(/isGuest=\{!!me\.isGuest\}/);
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
    // The icon chip and the chevron are atomic; if either could shrink the row would
    // degrade into an unreadable smear instead of an ellipsis.
    expect(ROW).toMatch(/size-9 shrink-0/);
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
