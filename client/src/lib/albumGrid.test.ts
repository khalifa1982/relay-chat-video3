/**
 * ALBUMS (v2.107.32) — the grid plan where it is pure, and the WIRING pinned
 * at every hop, because an album is a chain: picker caps → send validation →
 * join rows → list projection → bubble grid → pager. Any single silent break
 * degrades to "the cover arrived alone", which LOOKS like a working message —
 * the exact failure a manual test misses.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ALBUM_GRID_MAX_TILES, albumGridPlan } from "./albumGrid";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("albums — the bubble grid plan", () => {
  it("caps at four tiles and veils the remainder", () => {
    expect(ALBUM_GRID_MAX_TILES).toBe(4);
    expect(albumGridPlan(2)).toEqual({ shown: 2, overflow: 0 });
    expect(albumGridPlan(4)).toEqual({ shown: 4, overflow: 0 });
    expect(albumGridPlan(57)).toEqual({ shown: 4, overflow: 53 });
    expect(albumGridPlan(200)).toEqual({ shown: 4, overflow: 196 });
  });

  it("junk counts collapse to an empty plan, never a negative veil", () => {
    expect(albumGridPlan(0)).toEqual({ shown: 0, overflow: 0 });
    expect(albumGridPlan(-3)).toEqual({ shown: 0, overflow: 0 });
    expect(albumGridPlan(NaN)).toEqual({ shown: 0, overflow: 0 });
  });
});

describe("albums — the chain, source-pinned", () => {
  const routers = read("server/v2routers.ts");
  const v2db = read("server/v2db.ts");
  const messages = read("client/src/pages/app/Messages.tsx");

  it("send validates with the SHARED rules and derives kind + cover from item 0", () => {
    expect(routers).toContain('from "../shared/albumRules"');
    expect(routers).toContain("albumCounts(atts.map((a) => a.mimeType))");
    expect(routers).toContain("effectiveAttachmentId = ids[0]");
    expect(routers).toContain("albumKindFor(atts[0].mimeType)");
    // A disappearing album is a promise the burn path cannot keep.
    expect(routers).toContain("Albums can't be disappearing messages.");
  });

  it("every item passes the same gate a single attachment does — batch with per-item fallback", () => {
    expect(routers).toContain("getAttachmentsForIdentityBatch(ids, me.id)");
    expect(v2db).toMatch(/getAttachmentsForIdentityBatch[\s\S]{0,1500}getAttachmentForIdentity\(id, identityId\)/);
  });

  it("both message projections ship the album (list AND search render the same bubbles)", () => {
    const fetches = routers.match(/const albumByMsg = await getAlbumsForMessages/g) ?? [];
    expect(fetches.length).toBe(2);
    expect(routers).toContain("album: locked ? null : (albumByMsg.get(r.id) ?? null)");
    expect(routers).toContain("album: albumByMsg.get(r.id) ?? null");
  });

  it("an unsent album takes its item rows with it", () => {
    expect(v2db).toMatch(/deleteMessage[\s\S]{0,2500}delete\(messageAttachments\)\.where\(eq\(messageAttachments\.messageId, input\.messageId\)\)/);
  });

  it("the picker multi-selects and the strip enforces the shared caps before any bytes move", () => {
    expect(messages).toMatch(/accept="image\/\*,video\/\*"\s+multiple/);
    expect(messages).toContain("albumCounts([...existing, ...single, ...files.map((f) => f.type ||");
  });

  it("the bubble prefers the grid and the tap opens the PAGER at that tile", () => {
    expect(messages).toContain("<AlbumGrid items={m.album!} onOpen={openAlbumAt(m)} />");
    expect(messages).toMatch(/items,\s*\n\s*index: at,/);
    // The pager's ends do not wrap — an album has a first and a last page.
    expect(messages).toContain("Math.min(items.length - 1, Math.max(0, i + d))");
  });

  it("a forwarded album forwards WHOLE — items, captions, order", () => {
    expect(messages).toMatch(/album:\s*\n\s*\(m\.album\?\.length \?\? 0\) >= 2/);
  });
});
