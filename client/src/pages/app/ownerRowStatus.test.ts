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
    /* BOUNDED BY THE FUNCTION'S OWN END, not by a character count. This window was
       1400 chars, then widened to 2400 in v2.99.55 when an "everyone" branch was
       added, and v2.105.5's group branch outgrew it again — a fixed length is a
       pin that breaks on every unrelated addition while never asserting anything
       about where the function actually ends. The end is now found by matching
       the brace, and the window is asserted non-empty so it cannot collapse to ""
       and pass vacuously. */
    const fnAt = V2DB.indexOf("export async function statusAudienceAuthorized");
    expect(fnAt).toBeGreaterThan(0);
    let fnEnd = V2DB.indexOf("{\n", V2DB.indexOf(")", fnAt));
    for (let depth = 0; fnEnd < V2DB.length; fnEnd++) {
      if (V2DB[fnEnd] === "{") depth++;
      else if (V2DB[fnEnd] === "}" && --depth === 0) break;
    }
    const fn = V2DB.slice(fnAt, fnEnd + 1);
    expect(fn.length).toBeGreaterThan(600);
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
