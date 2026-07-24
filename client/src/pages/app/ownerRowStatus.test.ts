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
describe("v2.99.33 — Messages thread row is two-line (full name + actions below)", () => {
  it("the row is a vertical stack (flex-col), not a single cramped line", () => {
    expect(MESSAGES).toMatch(/"flex flex-col px-4 md:px-5 py-2\.5 border-b/);
  });
  it("the action buttons sit on their own line, indented past the avatar", () => {
    expect(MESSAGES).toMatch(/flex items-center gap-1\.5 pl-\[52px\] mt-1\.5/);
  });
  it("the full name still renders with badge + PIN + typing indicator", () => {
    expect(MESSAGES).toMatch(/<span className="font-semibold text-\[14\.5px\] truncate">\{t\.peerDisplayName \|\| t\.peerNumber\}<\/span>/);
    expect(MESSAGES).toMatch(/typingConvos\.includes\(t\.conversationId\)/);
  });
});

describe("v2.99.33 — status visibility is either-direction (post reaches your contacts)", () => {
  it("statusAudienceAuthorized authorizes when EITHER side saved the other", () => {
    const fn = V2DB.slice(V2DB.indexOf("export async function statusAudienceAuthorized"), V2DB.indexOf("export async function statusAudienceAuthorized") + 1400);
    expect(fn).toMatch(/if \(iSavedThem\) return true;/);
    expect(fn).toMatch(/return !!theySavedMe;/);
    // block either way still hides both directions
    expect(fn).toMatch(/isNumberBlockedBy\(ownerId, requester\.number\)/);
    expect(fn).toMatch(/isNumberBlockedBy\(requesterId, owner\.number\)/);
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
