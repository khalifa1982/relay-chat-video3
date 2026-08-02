import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.82 — Contacts list redesign (reference screenshot), static pins.
 * Rich rows (avatar + presence + name/PIN/verified), inline Voice/Video/
 * Message + a 3-dot menu (favorite / category / block / edit / delete),
 * and category grouping (VIP / Family / Friends / Team).
 * v2.96 (owner spec): row tap opens the peer PROFILE POPUP (with one-tap
 * Voice/Video/Message inside); the green circle still voice-dials directly.
 */
const ROOT = path.resolve(__dirname, "../../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const PAGE = read("client/src/pages/app/Contacts.tsx");
const ROUTERS = read("server/v2routers.ts");
const V2DB = read("server/v2db.ts");
const SCHEMA = read("drizzle/schema.ts");
const ENGINE = read("client/src/lib/relayClient.ts");
const PROVIDER = read("client/src/app/RelayEngine.tsx");

describe("Contacts — rich rows + inline actions", () => {
  it("each row taps into the profile popup, and exposes Voice/Video/Message buttons", () => {
    expect(PAGE).toMatch(/function ContactRow/);
    // v2.96: the main tap opens the profile popup (avatar + status + actions).
    /* The label is the SHARED phrase now (`peer.viewNamedProfile`), which History's rows
       use too. That is not just localisation bookkeeping: the possessive has no Arabic
       equivalent, so "X's profile" becomes "the profile of X" and the NAME has to move
       within the sentence — which only a whole key can express, and which a template
       literal chopped at the English apostrophe never could. The property is that the
       control is LABELLED with the person it opens. */
    expect(PAGE).toMatch(
      /aria-label=\{t\("peer\.viewNamedProfile", \{ name: c\.displayName \|\| c\.number \}\)\}/,
    );
    expect(PAGE).toMatch(/onClick=\{\(\) => openPeerProfile\(c\.number\)\}/);
    expect(PAGE).toMatch(/aria-label=\{t\("contacts\.voiceCall"\)\}/);
    expect(PAGE).toMatch(/aria-label=\{t\("contacts\.videoCall"\)\}/);
    expect(PAGE).toMatch(/aria-label=\{t\("contacts\.message"\)\}/);
    // Voice deep-link carries the voice intent; video its own.
    expect(PAGE).toMatch(/dialer\?to=\$\{encodeURIComponent\(c\.number\)\}&voice=1/);
    expect(PAGE).toMatch(/dialer\?to=\$\{encodeURIComponent\(c\.number\)\}&video=1/);
  });

  it("the 3-dot menu offers favorite, category, block, edit, delete", () => {
    expect(PAGE).toMatch(/onToggleFavorite/);
    expect(PAGE).toMatch(/onToggleBlock/);
    expect(PAGE).toMatch(/onSetCategory/);
    expect(PAGE).toMatch(/\{c\.blocked \? t\("contacts\.unblock"\) : t\("contacts\.block"\)\}/);
  });

  it("shows the PIN (formatted), presence LED, and verified badge", () => {
    expect(PAGE).toMatch(/c\.number\.slice\(0, 3\) \+ "-" \+ c\.number\.slice\(3\)/);
    // v2.99.92 moved the LED's rule into the SHARED `presenceDot` helper, because a
    // third state (idle) meant eight separate dots across four screens each had to
    // learn it — and that is how two surfaces end up disagreeing about the same
    // person (v2.99.77 was exactly that bug). So this no longer pins Contacts' own
    // inline ternary; it pins that Contacts reads the shared rule, and the COLOURS
    // are pinned once, in the helper's own test.
    expect(PAGE).toMatch(/import \{ presenceDot \} from "@\/app\/presenceDot"/);
    expect(PAGE).toMatch(/const dot = presenceDot\(c\);/);
    expect(PAGE).toMatch(/style=\{\{ background: dot\.color, boxShadow: dot\.glow \|\| undefined \}\}/);
    expect(PAGE).toMatch(/aria-label=\{dot\.label\}/);
    // v2.99.6: the verified-only badge became the three-tier RoleBadge
    // (Guest/Registered/Admin) rendered for EVERY contact.
    expect(PAGE).toMatch(/<RoleBadge role=\{roleFromFlags\(c\.role, c\.verified\)\}/);
  });
});

describe("Contacts — category grouping", () => {
  it("defines VIP / Family / Friends / Team and renders grouped sections", () => {
    expect(PAGE).toMatch(/const CATEGORY_ORDER: Category\[\] = \["vip", "family", "friend", "team"\]/);
    expect(PAGE).toMatch(/vip: \{ labelKey: "contacts\.tag\.vip"/);
    expect(PAGE).toMatch(/const sections = useMemo/);
    // Favorites is its own leading section.
    expect(PAGE).toMatch(/labelKey: "contacts\.favorites"/);
  });

  it("the dialog's label picker is wired into the save payload — and sends the WHOLE set", () => {
    /* REWRITTEN, because the shape it froze was the bug. The dialog held one
       `Category | null` and saved `category` alone; `contactUpdateKeys` couples the two
       columns, so that single value re-derived `tags` FROM itself and destroyed every
       other label the contact had. Saving somebody's phone number dropped them out of
       their sections and changed their row chip, silently.
       The picker is multi-select over the real 0..n model now, and what this pin protects
       is unchanged and stronger: the picker's state is what the save payload carries. */
    expect(PAGE).toMatch(/const \[tags, setTags\] = useState<ContactTag\[\]>/);
    expect(PAGE, "the picker toggles the list rather than replacing it").toMatch(
      /setTags\(toggleContactTag\(tags, cat\)\)/,
    );
    expect(PAGE).toMatch(/tags,\s*\n\s*\}\)\s*\n\s*\}\s*\n\s*disabled=\{number\.length !== 6 \|\| saving\}/);
    expect(PAGE, "the mirror must not be the thing written").not.toMatch(
      /birthday: birthday\.trim\(\) \|\| null,\s*\n\s*category,/,
    );
  });

  it("the page fills the shell with flex-1 (no stale pb-24; docked nav since v2.73)", () => {
    expect(PAGE).toMatch(/className="flex-1 min-h-0 md:p-6 flex flex-col gap-4"/);
    expect(PAGE).not.toMatch(/pb-24/);
  });
});

describe("Contacts — backend (category + block)", () => {
  it("schema + migrator carry category and blocked columns", () => {
    expect(SCHEMA).toMatch(/category: varchar\("category", \{ length: 16 \}\)/);
    expect(SCHEMA).toMatch(/blocked: boolean\("blocked"\)/);
    expect(V2DB).toMatch(/ADD COLUMN `category` varchar\(16\)/);
    expect(V2DB).toMatch(/ADD COLUMN `blocked` boolean/);
  });

  it("upsert accepts category (enum) + blocked; list returns them", () => {
    expect(ROUTERS).toMatch(/category: z\.enum\(\["vip", "family", "friend", "team"\]\)\.nullable\(\)\.optional\(\)/);
    expect(ROUTERS).toMatch(/blocked: z\.boolean\(\)\.optional\(\)/);
    expect(ROUTERS).toMatch(/blocked: r\.blocked === true/);
  });

  it("blocking is ENFORCED: blocked numbers can't message you, and their calls are silently declined", () => {
    // v2.88: the roster is fetched once as `peerIds` (send-path dedupe).
    expect(ROUTERS).toMatch(/const blocked = await isNumberBlockedBy\(peerIds\[0\], me\.number\)/);
    expect(V2DB).toMatch(/export async function isNumberBlockedBy/);
    expect(ENGINE).toMatch(/if \(m\.from && blockedPins\.has\(m\.from\)\) \{ sendWS\(\{ type: "reject", to: m\.from \}\); return; \}/);
    expect(PROVIDER).toMatch(/handleRef\.current\?\.setBlockedPins\(blocked\)/);
  });
});
