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
import { classifyNativeToken, isVoipDeclaration, ROUTABLE_PUSH_KINDS } from "./expoPush";
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

  it("a PUSHKIT token is deliverable for a RING ONLY (v2.105.12/.13)", () => {
    // This assertion used to read "nothing sends an apns token to a transport",
    // which was true when written and is deliberately no longer true: v2.105.12
    // added the VoIP transport so a locked iPhone rings. What must stay true is
    // the NARROWNESS — a VoIP push carries no `aps.alert`, so iOS hands it to
    // PushKit rather than the notification centre. Using it for a message would
    // produce a notification nobody ever sees, and Apple terminates apps that
    // send VoIP pushes without reporting a call.
    const wp = read("server/webPush.ts");
    expect(wp).toMatch(/s\.kind === "fcm"/);
    expect(wp).toMatch(/s\.kind === "expo"/);
    // Gated on the KIND and on the call payload being present, both.
    expect(wp).toMatch(/apnsTokens\.length > 0 && payload\.kind === "incoming-call" && payload\.call/);
    expect(codeOnly(wp)).toMatch(/sendVoipRing\(apnsTokens, payload\.call\)/);
  });

  it("the ring targets apns-voip and NEVER a plain apns alert token", () => {
    // v2.105.13, and this is destructive rather than merely ineffective if wrong.
    // iOS issues TWO hex tokens: PushKit (topic <bundle>.voip) and the ordinary
    // ALERT token (topic <bundle>). A VoIP push sent to an alert token earns
    // BadDeviceToken, which sendVoipRing's caller reads as stale and PRUNES —
    // deleting the very row v2.105.11 kept so the push doctor could report it.
    const wp = read("server/webPush.ts");
    const sel = wp.match(/const apnsTokens = subs\.filter\(([^)]*)\)/)?.[1] ?? "";
    expect(sel).toContain('s.kind === "apns-voip"');
    // The plain alert kind must not be selected — as a whole token, so that
    // matching the "apns" prefix inside "apns-voip" cannot satisfy it.
    expect(sel).not.toMatch(/s\.kind === "apns"(?!-)/);
  });

  it("a plain apns alert row is not handed to the WEBPUSH sender either", () => {
    // It is a bare device token, not a Web Push subscription with keys.
    const wp = read("server/webPush.ts");
    expect(wp).toMatch(/subs = subs\.filter\(s => s\.kind !== "apns-voip" && s\.kind !== "apns"\);/);
  });

  it("neither hex kind counts as reachable for the email fallback", () => {
    // apns-voip can deliver a CALL and nothing else, so counting it would cost an
    // iPhone user the offline-message email as well — strictly worse than the bug
    // v2.105.11 fixed.
    expect(ROUTABLE_PUSH_KINDS).not.toContain("apns");
    expect(ROUTABLE_PUSH_KINDS).not.toContain("apns-voip");
    const db = read("server/v2db.ts");
    const at = db.indexOf("export async function hasPushSubscription");
    const fn = db.slice(at, db.indexOf("\n}", db.indexOf("return rows.length > 0", at)));
    expect(fn).toMatch(/IN \('webpush','fcm','expo'\)/);
    expect(fn).not.toMatch(/'apns/);
  });

  it("the VoIP declaration is the ONE thing the shape cannot decide", () => {
    // Both tokens are pure hex, so `classifyNativeToken` physically cannot tell
    // them apart — the client's label is the only signal. Safe because a shell
    // that mislabels breaks only its own ring.
    expect(isVoipDeclaration("apns-voip", "apns")).toBe(true);
    // A declaration on a non-hex token must NOT relabel it: an Expo or FCM token
    // claiming to be VoIP would otherwise be routed to a transport that cannot
    // carry it.
    expect(isVoipDeclaration("apns-voip", "expo")).toBe(false);
    expect(isVoipDeclaration("apns-voip", "fcm")).toBe(false);
    expect(isVoipDeclaration("apns-voip", null)).toBe(false);
    // …and every other label leaves the shape alone.
    for (const d of [undefined, null, "apns", "expo", "fcm", "webpush", 1, {}]) {
      expect(isVoipDeclaration(d, "apns"), `${String(d)}`).toBe(false);
    }
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
