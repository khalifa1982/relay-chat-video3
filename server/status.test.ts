import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { statuses, statusViews } from "../drizzle/schema";
import { sanitizeStatusBg } from "./v2routers";

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

describe("sanitizeStatusBg — kill the CSS url() tracking beacon (review §8)", () => {
  it("accepts a solid hex color and the safe gradient palette", () => {
    expect(sanitizeStatusBg("#0ea5e9")).toBe("#0ea5e9");
    expect(sanitizeStatusBg("linear-gradient(135deg,#0ea5e9,#2563eb)")).toBe(
      "linear-gradient(135deg,#0ea5e9,#2563eb)",
    );
    expect(sanitizeStatusBg("radial-gradient(circle, #fff, #000)")).toBe("radial-gradient(circle, #fff, #000)");
  });
  it("REJECTS url() beacons and CSS-injection attempts", () => {
    expect(sanitizeStatusBg("url(//evil.tld/x)")).toBe(null);
    expect(sanitizeStatusBg("linear-gradient(#fff), url(//evil.tld/x)")).toBe(null);
    expect(sanitizeStatusBg("#fff;background-image:url(//evil.tld)")).toBe(null);
    expect(sanitizeStatusBg("red}html{display:none")).toBe(null);
    expect(sanitizeStatusBg("image-set('//evil')")).toBe(null);
  });
  it("returns null for empty / oversized / garbage", () => {
    expect(sanitizeStatusBg(null)).toBe(null);
    expect(sanitizeStatusBg("")).toBe(null);
    expect(sanitizeStatusBg("not-a-color")).toBe(null);
  });
});

describe("status privacy hardening (review §3/§4/§5)", () => {
  const db = read("server/v2db.ts");
  const router = read("server/v2routers.ts");
  const proxy = read("server/_core/storageProxy.ts");

  it("status media is gated by an ACTIVE status row + audience (not public)", () => {
    // authorizeStorageKey recognises status keys and resolves the live row.
    expect(db).toMatch(/\/\\\/status_\/\.test\(storageKey\)/);
    expect(db).toMatch(/getActiveStatusByMediaKey/);
    expect(db).toMatch(/statusAudienceAuthorized/);
    // the proxy 403s an unauthorized status key (anonymous / expired / non-contact)
    expect(proxy).toMatch(/authz\.kind === "status" && !authz\.authorized/);
  });

  it("audience is either-direction and honors blocks both ways", () => {
    // v2.99.33 (owner): visible if EITHER side saved the other (your contacts
    // see your status without adding you back), minus a block in either direction.
    expect(db).toMatch(/isNumberBlockedBy\(ownerId, requester\.number\)/); // owner blocked me
    expect(db).toMatch(/isNumberBlockedBy\(requesterId, owner\.number\)/); // I blocked owner
    expect(db).toMatch(/if \(iSavedThem\) return true;/);
    expect(db).toMatch(/return !!theySavedMe;/);
    // feed drops owners who blocked me
    expect(router).toMatch(/ownersWhoBlockedNumber/);
  });

  it("markViewed is audience-gated + rate-limited", () => {
    // v2.99.55 — the gate now carries the PER-POST audience (`st.audience`), not
    // just the owner id. Passing the owner's current default here instead would
    // let a later privacy change retroactively decide who may register a view on
    // an already-published story; asserting the third argument is the stronger
    // invariant, so this replaces the old two-argument pin rather than relaxing it.
    /* v2.105.6 — a FOURTH argument, `st.conversationId`, joins it. Required rather
       than decorative: for a group story the author's contacts rule is the wrong
       question, so omitting it would refuse the very members it was posted for and
       their views would never be recorded (the ring would stay lit forever). Both the
       audience AND the group are asserted, so dropping either fails. */
    const mv = router.slice(router.indexOf("  markViewed: publicProcedure"), router.indexOf("  getPrivacy:"));
    expect(mv.length).toBeGreaterThan(200);
    expect(mv).toMatch(/statusAudienceAuthorized\(me\.id, st\.identityId, st\.audience, st\.conversationId, st\.audienceMembers\)/);
    expect(mv).toMatch(/return \{ ok: false \}/);
    expect(router).toMatch(/statusGate\(ctx\)/);
  });

  it("post is capped, on the SHELF being posted to (#119), and rate-limited", () => {
    // Was a frozen one-argument `countActiveStatuses(me.id)`. #119 scopes the count
    // to the shelf — a group story spends one of THAT GROUP's slots, not one of the
    // author's personal thirty — so the property is that the cap is checked against
    // the group being posted to, which is stricter than the old literal.
    expect(router).toMatch(/countActiveStatuses\(me\.id, group\?\.id \?\? null\)\) >= STATUS_MAX_ACTIVE/);
    // And the counter really does separate the two shelves rather than accepting the
    // argument and ignoring it.
    const fn = db.slice(db.indexOf("export async function countActiveStatuses"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toMatch(/isNull\(statuses\.conversationId\)/);
    expect(body).toMatch(/eq\(statuses\.conversationId, conversationId\)/);
  });

  it("expired rows are reaped", () => {
    expect(db).toMatch(/export async function reapExpiredStatuses/);
    expect(read("server/_core/index.ts")).toMatch(/reapExpiredStatuses\(\)/);
  });
});

describe("status media upload (no-row `?bare=1`)", () => {
  it("stores image/video/audio WITHOUT an attachment row (public-servable to contacts)", () => {
    const up = read("server/v2upload.ts");
    expect(up).toMatch(/req\.query\.bare === "1"/); // raw binary path (web)
    expect(up).toMatch(/body\.bare === true/); // base64 path (native app)
    expect(up).toMatch(/\^\(image\|video\|audio\)\\\//);
    // Key lands in the owner's namespace so status.post's ownership check passes.
    // v2.99.2: the bare path now names the object by kind — `status` for status
    // media, `avatar` for profile photos (the latter keeps the status gate from
    // 403'ing avatars). Status media still gets a `status_…` key (bname="status").
    expect(up).toMatch(/relay-chat\/\$\{identityId\}\/\$\{bname\}_/);
    expect(up).toMatch(/const bname = isAvatar \? "avatar" : "status"/);
  });
  it("client helper posts to ?bare=1", () => {
    const client = read("client/src/lib/uploadAttachment.ts");
    expect(client).toMatch(/export async function uploadStatusMedia/);
    expect(client).toMatch(/bare: "1"/);
  });
});
