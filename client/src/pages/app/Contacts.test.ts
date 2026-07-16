import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.82 — Contacts list redesign (reference screenshot), static pins.
 * Rich rows (avatar + presence + name/PIN/verified), inline Voice/Video/
 * Message + a 3-dot menu (favorite / category / block / edit / delete),
 * row tap → voice call, and category grouping (VIP / Family / Friends / Team).
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
  it("each row taps into a VOICE call, and exposes Voice/Video/Message buttons", () => {
    expect(PAGE).toMatch(/function ContactRow/);
    expect(PAGE).toMatch(/aria-label=\{`Call \$\{c\.displayName \|\| c\.number\}`\}/);
    expect(PAGE).toMatch(/aria-label="Voice call"/);
    expect(PAGE).toMatch(/aria-label="Video call"/);
    expect(PAGE).toMatch(/aria-label="Message"/);
    // Voice deep-link carries the voice intent; video its own.
    expect(PAGE).toMatch(/dialer\?to=\$\{encodeURIComponent\(c\.number\)\}&voice=1/);
    expect(PAGE).toMatch(/dialer\?to=\$\{encodeURIComponent\(c\.number\)\}&video=1/);
  });

  it("the 3-dot menu offers favorite, category, block, edit, delete", () => {
    expect(PAGE).toMatch(/onToggleFavorite/);
    expect(PAGE).toMatch(/onToggleBlock/);
    expect(PAGE).toMatch(/onSetCategory/);
    expect(PAGE).toMatch(/\{c\.blocked \? "Unblock" : "Block"\}/);
  });

  it("shows the PIN (formatted), presence LED, and verified badge", () => {
    expect(PAGE).toMatch(/c\.number\.slice\(0, 3\) \+ "-" \+ c\.number\.slice\(3\)/);
    // v2.88: LED is amber "on a call" / green online / grey offline
    // (var(--relay-offline) — red used to read as busy/error).
    expect(PAGE).toMatch(/c\.inCall\s*\?\s*"bg-amber-400"/);
    expect(PAGE).toMatch(/bg-\[color:var\(--relay-online\)\]/);
    expect(PAGE).toMatch(/bg-\[color:var\(--relay-offline\)\]/);
    expect(PAGE).toMatch(/c\.verified && <VerifiedBadge/);
  });
});

describe("Contacts — category grouping", () => {
  it("defines VIP / Family / Friends / Team and renders grouped sections", () => {
    expect(PAGE).toMatch(/const CATEGORY_ORDER: Category\[\] = \["vip", "family", "friend", "team"\]/);
    expect(PAGE).toMatch(/vip: \{ label: "VIP"/);
    expect(PAGE).toMatch(/const sections = useMemo/);
    // Favorites is its own leading section.
    expect(PAGE).toMatch(/label: "Favorites"/);
  });

  it("the dialog has a category picker wired into the save payload", () => {
    expect(PAGE).toMatch(/const \[category, setCategory\] = useState<Category \| null>/);
    expect(PAGE).toMatch(/category,\s*\n\s*\}\)\s*\n\s*\}\s*\n\s*disabled=\{number\.length !== 6 \|\| saving\}/);
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
