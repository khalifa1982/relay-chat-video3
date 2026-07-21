import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { statuses, statusViews } from "../drizzle/schema";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Rich user status (v2.95). DB/router run against MySQL (not available in the
 * unit env), so these pin the wiring + the security-relevant invariants:
 * ownership gate on media, 24h expiry, no-attachment-row media upload, and
 * router registration. The schema tables are asserted as real exports.
 */
describe("status schema", () => {
  it("exports statuses + status_views tables", () => {
    expect(statuses).toBeTruthy();
    expect(statusViews).toBeTruthy();
  });
  it("is created additively by the boot migrator (no destructive migration)", () => {
    const db = read("server/v2db.ts");
    expect(db).toMatch(/CREATE TABLE IF NOT EXISTS \\`statuses\\`/);
    expect(db).toMatch(/CREATE TABLE IF NOT EXISTS \\`status_views\\`/);
    expect(db).toMatch(/status_view_pair_unique/); // one view per (status, viewer)
  });
});

describe("status router", () => {
  const src = read("server/v2routers.ts");

  it("registers all six procedures", () => {
    expect(src).toMatch(/export const v2StatusRouter = router\(\{/);
    for (const p of ["post:", "feed:", "mine:", "remove:", "markViewed:", "viewers:"]) {
      expect(src).toMatch(new RegExp(`\\n  ${p}`));
    }
  });

  it("gates media on the caller's own upload namespace (no key forgery)", () => {
    // Same ownership gate as attachments.register.
    expect(src).toMatch(/keyInOwnerNamespace\(input\.mediaKey, me\.id/);
  });

  it("expires statuses after 24h", () => {
    expect(src).toMatch(/STATUS_TTL_MS = 24 \* 60 \* 60 \* 1000/);
  });

  it("only the owner can see who viewed (viewers is owner-gated)", () => {
    expect(src).toMatch(/st\.identityId !== me\.id\) return \{ viewers: \[\] \}/);
  });

  it("self-views are not recorded", () => {
    expect(src).toMatch(/if \(st\.identityId === me\.id\) return \{ ok: true \}/);
  });

  it("is mounted on appRouter as `status`", () => {
    const routers = read("server/routers.ts");
    expect(routers).toMatch(/status: v2StatusRouter/);
  });
});

describe("status media upload (no-row `?bare=1`)", () => {
  it("stores image/video/audio WITHOUT an attachment row (public-servable to contacts)", () => {
    const up = read("server/v2upload.ts");
    expect(up).toMatch(/req\.query\.bare === "1"/);
    expect(up).toMatch(/\^\(image\|video\|audio\)\\\//);
    // Key lands in the owner's namespace so status.post's ownership check passes.
    expect(up).toMatch(/relay-chat\/\$\{identityId\}\/status_/);
  });
  it("client helper posts to ?bare=1", () => {
    const client = read("client/src/lib/uploadAttachment.ts");
    expect(client).toMatch(/export async function uploadStatusMedia/);
    expect(client).toMatch(/bare: "1"/);
  });
});
