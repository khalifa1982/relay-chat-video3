/**
 * APPLE APP STORE COMPLIANCE (v2.107.52) — the two guideline blockers that
 * needed real code, not App Store Connect toggles:
 *
 *   • 5.1.1(v) — self-serve account deletion (an app that creates accounts must
 *     let the user delete their own).
 *   • 1.2      — user-generated-content safety: a mechanism to flag objectionable
 *     content, and a durable record so the developer can act within 24h.
 *
 * House style: source-string pins over codeOnly()-stripped source, so an
 * assertion can never pass on a COMMENT that merely describes the behaviour.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./testing/codeOnly";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const routers = codeOnly(read("./v2routers.ts"));
const db = codeOnly(read("./v2db.ts"));
const mount = codeOnly(read("./routers.ts"));
const profile = codeOnly(read("../client/src/pages/app/Profile.tsx"));
const messages = codeOnly(read("../client/src/pages/app/Messages.tsx"));
const msgDict = read("../client/src/app/dict/messages.ts");
const profileDict = read("../client/src/app/dict/profile.ts");

/* ─────────────────── 5.1.1(v): self-serve account deletion ─────────────────── */

describe("Apple 5.1.1(v) — self-serve account deletion", () => {
  it("exposes deleteMyAccount and it is reachable under trpc.identity", () => {
    expect(routers).toMatch(/deleteMyAccount: publicProcedure\.mutation/);
    // identity: v2AuthRouter is the mount, and deleteMyAccount must live in the
    // auth router (not admin) so the client's trpc.identity.deleteMyAccount resolves.
    expect(mount).toMatch(/identity: v2AuthRouter/);
    // The procedure sits between signOutGuest and the recovery block, i.e. in
    // v2AuthRouter — assert it is BEFORE the admin router opens.
    const idxDelete = routers.indexOf("deleteMyAccount: publicProcedure");
    const idxAdminRouter = routers.indexOf("export const v2AdminRouter");
    expect(idxDelete).toBeGreaterThan(0);
    expect(idxDelete).toBeLessThan(idxAdminRouter);
  });

  it("deletes the CALLER's own identity — never a client-supplied target", () => {
    // requireIdentity gives me.id; the purge runs on me.id, and there is no
    // identityId input on this procedure by construction.
    const start = routers.indexOf("deleteMyAccount: publicProcedure");
    // End at the next procedure key so the window is exactly this proc's body.
    const end = routers.indexOf("reportContent: publicProcedure", start);
    const block = routers.slice(start, end);
    expect(block).toMatch(/const me = requireIdentity\(ctx\)/);
    expect(block).toMatch(/adminPurgeIdentity\(me\.id, null\)/);
    expect(block).not.toMatch(/input\.identityId/);
  });

  it("passes actingIdentityId=null so the self-delete guard is bypassed on purpose", () => {
    // adminPurgeIdentity refuses actingIdentityId === identityId; null skips it.
    expect(routers).toMatch(/adminPurgeIdentity\(me\.id, null\)/);
  });

  it("tears down the session cookies after the erase", () => {
    const block = routers.slice(
      routers.indexOf("deleteMyAccount: publicProcedure"),
      routers.indexOf("deleteMyAccount: publicProcedure") + 1800,
    );
    expect(block).toMatch(/clearCookie\(GUEST_COOKIE/);
    expect(block).toMatch(/clearCookie\(LOCAL_SESSION_COOKIE/);
    expect(block).toMatch(/clearCookie\(COOKIE_NAME/);
  });

  it("Profile has a delete-account control behind a typed-number confirmation", () => {
    expect(profile).toMatch(/trpc\.identity\.deleteMyAccount\.useMutation/);
    expect(profile).toMatch(/t\("profile\.deleteAccount"\)/);
    // Armed only when the typed digits equal the account number (dash-agnostic).
    expect(profile).toMatch(/deleteConfirm\.replace\(\/\\D\/g, ""\) !== me\.number/);
    // On success it hard-navigates away — the identity is gone, so no refresh().
    expect(profile).toMatch(/window\.location\.href = "\/app"/);
  });

  it("carries the deletion strings in both locales", () => {
    expect(profileDict).toMatch(/"profile\.deleteAccount": \{ en: "Delete account", ar: "حذف الحساب" \}/);
    expect(profileDict).toMatch(/"profile\.deleteConfirm":/);
    expect(profileDict).toMatch(/"profile\.deleteTypeToEnable":/);
  });
});

/* ─────────────────────── 1.2: content reporting ─────────────────────── */

describe("Apple 1.2 — content reporting", () => {
  it("has a content_reports table with a review-status index", () => {
    expect(db).toMatch(/name: "content_reports"/);
    expect(db).toMatch(/CREATE TABLE IF NOT EXISTS \\`content_reports\\`/);
    expect(db).toMatch(/report_status_time_idx/);
  });

  it("fileContentReport fails LOUD (throws), unlike fail-open telemetry", () => {
    const fn = db.slice(
      db.indexOf("export async function fileContentReport"),
      db.indexOf("export async function fileContentReport") + 900,
    );
    // No DB ⇒ throw, so a report the user believes they filed is never silently dropped.
    expect(fn).toMatch(/if \(!db\) throw new Error\("database unavailable"\)/);
    expect(fn).toMatch(/INSERT INTO \\`content_reports\\`/);
  });

  it("clamps reason and context to their closed enums", () => {
    expect(db).toMatch(/REPORT_REASONS = \[/);
    expect(db).toMatch(/REPORT_CONTEXTS = \[/);
    const fn = db.slice(
      db.indexOf("export async function fileContentReport"),
      db.indexOf("export async function fileContentReport") + 900,
    );
    expect(fn).toMatch(/\? r\.reason\s*\n?\s*: "other"/);
  });

  it("reportContent files AS the caller and refuses self-reports", () => {
    const block = routers.slice(
      routers.indexOf("reportContent: publicProcedure"),
      routers.indexOf("reportContent: publicProcedure") + 1800,
    );
    expect(block).toMatch(/const me = requireIdentity\(ctx\)/);
    expect(block).toMatch(/input\.reportedId === me\.id/);
    expect(block).toMatch(/reporterId: me\.id/);
    // reportedId is the client's (you report someone you're looking at) but the
    // reporter is always the session identity.
    expect(block).toMatch(/reportedId: input\.reportedId/);
  });

  it("reportContent throws on a storage failure rather than reporting success", () => {
    const block = routers.slice(
      routers.indexOf("reportContent: publicProcedure"),
      routers.indexOf("reportContent: publicProcedure") + 1800,
    );
    expect(block).toMatch(/INTERNAL_SERVER_ERROR/);
  });

  it("admin can list and resolve reports; the queue defaults to open", () => {
    expect(routers).toMatch(/listReports: publicProcedure/);
    expect(routers).toMatch(/resolveReport: publicProcedure/);
    const list = routers.slice(
      routers.indexOf("listReports: publicProcedure"),
      routers.indexOf("listReports: publicProcedure") + 700,
    );
    expect(list).toMatch(/await requireAdmin\(ctx\)/);
    expect(list).toMatch(/input\.status \?\? "open"/);
    const resolve = routers.slice(
      routers.indexOf("resolveReport: publicProcedure"),
      routers.indexOf("resolveReport: publicProcedure") + 800,
    );
    expect(resolve).toMatch(/await requireAdmin\(ctx\)/);
    expect(resolve).toMatch(/setReportStatus\(input\.id, input\.status\)/);
  });

  it("the message menu offers Report on received messages only", () => {
    // The prop exists, and is wired at the received call site (setReporting), and
    // the button is gated `!mine && onReport`.
    expect(messages).toMatch(/onReport\?: \(\) => void/);
    expect(messages).toMatch(/onReport=\{\(\) => \{ setReportReason\(""\); setReporting\(m\); \}\}/);
    expect(messages).toMatch(/!mine && onReport &&/);
    // My-own bubble call site passes no onReport — assert the mine branch's
    // MessageMenu block does not mention onReport.
    const mineMenu = messages.slice(
      messages.indexOf("<MessageMenu\n                    mine"),
      messages.indexOf("<MessageMenu\n                    mine") + 700,
    );
    expect(mineMenu).not.toMatch(/onReport/);
  });

  it("submits a reason plus a text snapshot that survives an unsend", () => {
    const dlg = messages.slice(
      messages.indexOf("reportMutation.mutate({"),
      messages.indexOf("reportMutation.mutate({") + 700,
    );
    expect(dlg).toMatch(/reportedId: reporting\.senderIdentityId/);
    expect(dlg).toMatch(/messageId: reporting\.id/);
    expect(dlg).toMatch(/context: "message"/);
    expect(dlg).toMatch(/snapshot: reporting\.body \? reporting\.body\.slice\(0, 2000\) : null/);
  });

  it("the submit is inert until a reason is chosen", () => {
    // disabled on !reportReason AND a preventDefault guard, because
    // AlertDialogAction closes on click — greying alone would not stop the submit.
    expect(messages).toMatch(/reportMutation\.isPending \|\| !reportReason/);
    expect(messages).toMatch(/if \(!reporting \|\| !reportReason\) \{\s*\n?\s*e\.preventDefault\(\);/);
  });

  it("carries every report string in both locales", () => {
    // Read the dict as data: find each key, then confirm en: and ar: follow it
    // before the next top-level key. Robust to entries that wrap across lines,
    // where a single-line regex would miss the ar: half.
    const hasBilingualKey = (src: string, key: string): boolean => {
      const at = src.indexOf(`"${key}":`);
      if (at < 0) return false;
      // The entry runs to the next `"msg.` key or the closing satisfies.
      const rest = src.slice(at + key.length);
      const nextKey = rest.indexOf('"msg.', 3);
      const entry = nextKey > 0 ? rest.slice(0, nextKey) : rest.slice(0, 400);
      return /\ben:/.test(entry) && /\bar:/.test(entry);
    };
    for (const key of [
      "msg.reportAction",
      "msg.reportTitle",
      "msg.reportSpam",
      "msg.reportHarassment",
      "msg.reportCsam",
      "msg.reportSubmit",
      "msg.reportThanks",
    ]) {
      expect(hasBilingualKey(msgDict, key)).toBe(true);
    }
  });
});
