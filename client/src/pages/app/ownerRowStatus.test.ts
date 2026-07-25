import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const MESSAGES = read("client/src/pages/app/Messages.tsx");
const V2DB = read("server/v2db.ts");
const ROUTERS = read("server/v2routers.ts");

/**
 * v2.99.33 — owner feedback (screenshot):
 *   (1) Messages thread rows were cramped — the name truncated to "A…" because
 *       the badge + PIN + time + 4 action buttons all shared one line. The row
 *       is now two lines: a full-width top line (avatar + full name/badge/PIN/
 *       time + preview/typing) and the action buttons on their OWN line below.
 *   (2) Status "when you post it, it doesn't appear on anyone" — visibility is
 *       now EITHER-DIRECTION: a status reaches the people you saved AND anyone
 *       who saved you (was: only people who saved you), so posting appears to
 *       your contacts. Authorization, realtime fan-out, and the feed all match.
 */
// NOTE: v2.99.33's "two lines with the action buttons on row 2" is SUPERSEDED by
// the v2.99.37 redesign below — the owner removed the per-row buttons entirely
// ("no need to put message, dial, voice … you will see it in the top bar"), so
// the row is now avatar + two TEXT lines and nothing else. The redesign is
// pinned in messagesRowRedesign.test.ts; this file keeps only the status half.

describe("v2.99.33 — status visibility is either-direction (post reaches your contacts)", () => {
  it("statusAudienceAuthorized authorizes when EITHER side saved the other", () => {
    // Slice widened for v2.99.55: the function grew an "everyone" branch, which
    // pushed `return !!theySavedMe;` past the old 1400-char window. The
    // either-direction rule below is UNCHANGED — it is now the "contacts" option.
    const fn = V2DB.slice(V2DB.indexOf("export async function statusAudienceAuthorized"), V2DB.indexOf("export async function statusAudienceAuthorized") + 2400);
    expect(fn).toMatch(/if \(iSavedThem\) return true;/);
    expect(fn).toMatch(/return !!theySavedMe;/);
    // block either way still hides both directions
    expect(fn).toMatch(/isNumberBlockedBy\(ownerId, requester\.number\)/);
    expect(fn).toMatch(/isNumberBlockedBy\(requesterId, owner\.number\)/);
    // v2.99.55: and the either-direction rule is still what an unspecified or
    // "contacts" audience evaluates — the everyone branch must not swallow it.
    expect(fn).toMatch(/normalizeStatusAudience\(audience\) === "everyone"/);
  });
  it("getStatusAudienceIds fans to savers AND the owner's own saved contacts", () => {
    const fn = V2DB.slice(V2DB.indexOf("export async function getStatusAudienceIds"), V2DB.indexOf("export async function getStatusAudienceIds") + 1400);
    expect(fn).toMatch(/const saverIds =/);
    expect(fn).toMatch(/People the OWNER saved/);
    expect(fn).toMatch(/\[\.\.\.saverIds, \.\.\.savedIdents\.map/);
  });
  it("the feed includes people who saved me (getIdentityIdsWhoSaved)", () => {
    expect(V2DB).toMatch(/export async function getIdentityIdsWhoSaved/);
    expect(ROUTERS).toMatch(/const savedMeIds = await getIdentityIdsWhoSaved\(me\.number\)/);
    expect(ROUTERS).toMatch(/\[me\.id, \.\.\.contactIdents\.map\(\(i\) => i\.id\), \.\.\.savedMeIds\]/);
  });
});
