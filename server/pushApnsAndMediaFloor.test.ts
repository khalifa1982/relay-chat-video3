/* ──────────────────────────────────────────────────────────────────────────
 * v2.105.11 — two gates that did not apply a rule they already owned.
 *
 * (1) An APNs device token was classified as `fcm`, so FCM answered 400 and
 *     `sendFcmData` PRUNED the row — the device deregistered itself on its first
 *     push. Tested behaviourally, because the classifier IS the bug.
 * (2) `getAttachmentForIdentity` is a FOURTH reader of the join watermark and
 *     never learned it, so an invite-link joiner could read pre-join media by
 *     walking sequential attachment ids. Pinned at source: no MySQL here.
 * ────────────────────────────────────────────────────────────────────────── */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { classifyNativeToken, ROUTABLE_PUSH_KINDS } from "./expoPush";
import { codeOnly } from "./testing/codeOnly";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** An APNs device token: pure hex. 32 bytes classically, up to 100 on newer iOS. */
const APNS_64 = "a".repeat(64);
const APNS_160 = "0123456789abcdef".repeat(10);
/** A real FCM registration token always carries a `:` and is never pure hex. */
const FCM = "fMEr8xKqTz0:APA91bH-Yk_9vQ2xLm3nOp4rStUvWxYz01234567890abcdefGHIJKLMNOP";

describe("v2.105.11 — an APNs token is not an FCM token", () => {
  it("classifies a pure-hex device token as apns, NOT fcm", () => {
    // THE BUG. Returning "fcm" here sent it to FCM v1 `messages:send`, which takes a
    // REGISTRATION token; the 400 was then read as a stale token and the row pruned.
    expect(classifyNativeToken(APNS_64)).toBe("apns");
    expect(classifyNativeToken(APNS_160)).toBe("apns");
    expect(classifyNativeToken(APNS_64.toUpperCase())).toBe("apns");
  });

  it("still classifies a real FCM registration token as fcm", () => {
    // The narrow discriminator must not swallow Android. An FCM token carries a `:`
    // and `-`/`_`, so it is never pure hex.
    expect(classifyNativeToken(FCM)).toBe("fcm");
    expect(classifyNativeToken("c9J-_kAbcdef0123456789012345678901234567")).toBe("fcm");
  });

  it("still classifies both Expo spellings as expo", () => {
    expect(classifyNativeToken("ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe("expo");
    expect(classifyNativeToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe("expo");
  });

  it("still refuses junk at the door", () => {
    for (const v of [null, undefined, 42, {}, "", "short", "has space here"]) {
      expect(classifyNativeToken(v as unknown)).toBeNull();
    }
  });

  it("apns is NOT a routable kind", () => {
    expect(ROUTABLE_PUSH_KINDS).not.toContain("apns");
    for (const k of ["webpush", "fcm", "expo"]) expect(ROUTABLE_PUSH_KINDS).toContain(k);
  });
});

describe("v2.105.11 — an unroutable token must not suppress the email fallback", () => {
  const db = read("server/v2db.ts");

  it("hasPushSubscription counts only routable kinds", () => {
    // THE LOAD-BEARING CONJUNCT. `pushReachable` → the offline-message email is SKIPPED
    // when a subscription exists (v2.99.42 GAP3). Counting an apns row would leave the
    // recipient with neither a push nor an email — worse than the bug being fixed.
    const at = db.indexOf("export async function hasPushSubscription");
    expect(at).toBeGreaterThan(-1);
    const fn = db.slice(at, db.indexOf("\n}", db.indexOf("return rows.length > 0", at)));
    expect(fn).toMatch(/IN \('webpush','fcm','expo'\)/);
    // A legacy NULL kind must still count — it reads as webpush, the same reading the
    // sender takes, so pre-release browsers are unaffected.
    expect(fn).toMatch(/kind\} IS NULL OR/);
    expect(fn).not.toMatch(/'apns'/);
  });

  it("an apns token is deliverable for a RING ONLY (v2.105.12)", () => {
    // This assertion used to read "nothing sends an apns token to a transport",
    // which was true when it was written and is deliberately no longer true:
    // v2.105.12 added the VoIP transport so a locked iPhone rings. What must stay
    // true is the NARROWNESS — a VoIP push carries no `aps.alert`, so iOS hands
    // it to PushKit rather than the notification centre. Using it for a message
    // would produce a notification nobody ever sees, and Apple terminates apps
    // that send VoIP pushes without reporting a call.
    const wp = read("server/webPush.ts");
    expect(wp).toMatch(/s\.kind === "fcm"/);
    expect(wp).toMatch(/s\.kind === "expo"/);
    expect(wp).toMatch(/s\.kind === "apns"/);
    // Gated on the KIND and on the call payload being present, both.
    expect(wp).toMatch(/apnsTokens\.length > 0 && payload\.kind === "incoming-call" && payload\.call/);
    expect(codeOnly(wp)).toMatch(/sendVoipRing\(apnsTokens, payload\.call\)/);
  });

  it("…and is STILL not routable for the email-fallback decision", () => {
    // The v2.105.11 property that must survive the new transport. `pushReachable`
    // is what suppresses the offline-message EMAIL, and a ring-only transport
    // cannot deliver a message — counting it would leave the recipient with
    // neither, which is strictly worse than the bug v2.105.11 fixed.
    expect(ROUTABLE_PUSH_KINDS).not.toContain("apns");
    const db = read("server/v2db.ts");
    const at = db.indexOf("export async function hasPushSubscription");
    const fn = db.slice(at, db.indexOf("\n}", db.indexOf("return rows.length > 0", at)));
    expect(fn).not.toMatch(/'apns'/);
  });
});

describe("v2.105.11 — the media gate is the FOURTH reader of the join floor", () => {
  const db = read("server/v2db.ts");
  const at = db.indexOf("export async function getAttachmentForIdentity");
  const fn = db.slice(at, db.indexOf("\n}", db.indexOf("return ref.length > 0", at)));

  it("the attachment authorization applies the join watermark", () => {
    // Without it, a member who joined later could read every photo, voice note and video
    // posted BEFORE they joined, while listMessages correctly withheld the messages.
    expect(at).toBeGreaterThan(-1);
    expect(fn).toMatch(/joinedAtMessageId/);
  });

  it("…and the per-person clear watermark, composed by GREATEST", () => {
    // Both rules say "everything at or below this id is not yours", so obeying both means
    // obeying the higher one — the same composition `visibleFloorFor` performs in JS.
    expect(fn).toMatch(/GREATEST\(/);
    expect(fn).toMatch(/clearedUpToMessageId/);
  });

  it("NULL on either watermark reads as 0, so nothing pre-existing changes", () => {
    // Every founding member and every pre-release row has NULL. Without COALESCE the
    // comparison would be NULL and authorize NOBODY — the fail-shut direction, which
    // would render every group attachment as a broken image.
    const coalesces = (fn.match(/COALESCE\(/g) || []).length;
    expect(coalesces).toBe(2);
  });

  it("the floor is compared against the MESSAGE's id, not the attachment's", () => {
    // The watermark is a message id. Comparing the attachment id would be meaningless —
    // attachments and messages are separate sequences.
    expect(fn).toMatch(/\$\{messages\.id\} >/);
  });

  it("the uploader's own early return is untouched", () => {
    // A sender must always reach their own attachment, and they have no watermark
    // relationship to it at all.
    const whole = db.slice(at, db.indexOf("\n}", db.indexOf("return ref.length > 0", at)));
    const early = whole.indexOf("att.uploadedByIdentityId === identityId");
    expect(early).toBeGreaterThan(-1);
    expect(early).toBeLessThan(whole.indexOf("GREATEST("));
  });

  it("the view-once guard still stands beside the new floor", () => {
    // M28: a still-LOCKED expiring message must not serve as authorization. The new
    // conjunct must be additive, not a replacement.
    expect(fn).toMatch(/JSON_EXTRACT\(.*'\$\.expire'\) IS NULL/);
    expect(fn).toMatch(/'\$\.consumedAt'\) IS NOT NULL/);
  });
});
