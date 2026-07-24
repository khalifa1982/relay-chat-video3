import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * v2.99.13 — EMAIL-NOTIFICATION PREFERENCES (owner, offline batch): "if he's a
 * registered user and put his email, he'll get an email for a missed call OR
 * when somebody sends a message while he's offline — but WITHOUT the content,
 * just 'you received a message, log in to see it'. He can enable/disable it."
 *
 * DB/router/DOM aren't reachable in the unit env, so — per repo precedent — the
 * cross-file wiring is pinned by source read.
 */

describe("v2.99.13 — schema + migrator add the pref columns additively", () => {
  const schema = read("drizzle/schema.ts");
  const v2db = read("server/v2db.ts");
  it("users gains emailNotifyMissedCall / emailNotifyMessage / lastMessageEmailAt", () => {
    expect(schema).toMatch(/emailNotifyMissedCall: boolean\("emailNotifyMissedCall"\)/);
    expect(schema).toMatch(/emailNotifyMessage: boolean\("emailNotifyMessage"\)/);
    expect(schema).toMatch(/lastMessageEmailAt: timestamp\("lastMessageEmailAt"\)/);
  });
  it("the boot migrator adds all three columns", () => {
    expect(v2db).toMatch(/ADD COLUMN `emailNotifyMissedCall` boolean/);
    expect(v2db).toMatch(/ADD COLUMN `emailNotifyMessage` boolean/);
    expect(v2db).toMatch(/ADD COLUMN `lastMessageEmailAt` timestamp NULL/);
  });
});

describe("v2.99.13 — v2db helpers", () => {
  const v2db = read("server/v2db.ts");
  it("setUserNotificationPrefs writes only the provided keys", () => {
    const seg = v2db.slice(v2db.indexOf("export async function setUserNotificationPrefs"), v2db.indexOf("export async function claimOfflineMessageEmail"));
    expect(seg).toMatch(/prefs\.emailNotifyMissedCall !== undefined/);
    expect(seg).toMatch(/prefs\.emailNotifyMessage !== undefined/);
    expect(seg).toMatch(/db\.update\(users\)\.set\(set\)\.where\(eq\(users\.id, userId\)\)/);
  });
  it("claimOfflineMessageEmail is an ATOMIC pref+cooldown claim (single conditional UPDATE)", () => {
    const seg = v2db.slice(v2db.indexOf("export async function claimOfflineMessageEmail"), v2db.indexOf("export interface PresenceLite"));
    // one UPDATE guarded on: pref on (NULL default = on) AND cooldown elapsed
    expect(seg).toMatch(/\.update\(users\)/);
    expect(seg).toMatch(/or\(isNull\(users\.emailNotifyMessage\), eq\(users\.emailNotifyMessage, true\)\)/);
    expect(seg).toMatch(/or\(isNull\(users\.lastMessageEmailAt\), lt\(users\.lastMessageEmailAt, cutoff\)\)/);
    // verdict from affectedRows (won the claim) — the race-safe S1 pattern
    expect(seg).toMatch(/affectedRows/);
  });
  it("the offline-message email cooldown is exported", () => {
    expect(v2db).toMatch(/export const OFFLINE_MESSAGE_EMAIL_COOLDOWN_MS/);
  });
});

describe("v2.99.13 — missed-call email is preference-gated (push + History stay unconditional)", () => {
  const core = read("server/_core/index.ts");
  it("gates the EMAIL send on emailNotifyMissedCall !== false, AFTER the email presence check", () => {
    const seg = core.slice(core.indexOf("onMissedCall"), core.indexOf("onConferenceEnd") > -1 ? core.indexOf("onConferenceEnd") : core.length);
    expect(seg).toMatch(/if \(user\.emailNotifyMissedCall === false\) return;/);
    // the push + recordMissedCall must NOT be gated by the pref (they're above the gate)
    expect(seg.indexOf("recordMissedCall")).toBeLessThan(seg.indexOf("emailNotifyMissedCall === false"));
    expect(seg.indexOf('kind: "missed-call"')).toBeLessThan(seg.indexOf("emailNotifyMissedCall === false"));
  });
});

describe("v2.99.13 — offline-message email on the send path (content-free + throttled)", () => {
  const routers = read("server/v2routers.ts");
  it("messageWaitingHtml is CONTENT-FREE — no body/sender interpolation", () => {
    const seg = routers.slice(routers.indexOf("function messageWaitingHtml"), routers.indexOf("export const NumberSchema"));
    expect(seg).toMatch(/You have a new message waiting on RELAY/);
    expect(seg).toMatch(/we don't include message contents in email/i);
    // the ONLY interpolation is the appUrl button — no ${body}, ${sender}, etc.
    const interpolations = seg.match(/\$\{[^}]+\}/g) || [];
    expect(interpolations.every((s) => /appUrl|button/.test(s))).toBe(true);
  });
  it("the send procedure emails every OFFLINE recipient with an account email, atomically throttled", () => {
    const seg = routers.slice(routers.indexOf("Offline-message EMAIL"), routers.indexOf("Offline auto-reply"));
    expect(seg).toMatch(/emailEnabled\(\) && peerIds\.length > 0/);
    expect(seg).toMatch(/getPresenceForIds\(peerIds\)/);
    expect(seg).toMatch(/if \(onlineById\.get\(pid\)\) continue;/); // offline only
    expect(seg).toMatch(/if \(!peer\?\.userId\) continue;/); // guests skipped
    expect(seg).toMatch(/if \(!user\?\.email\) continue;/); // email required
    expect(seg).toMatch(/claimOfflineMessageEmail\(\s*peer\.userId,\s*OFFLINE_MESSAGE_EMAIL_COOLDOWN_MS\s*\)/);
    expect(seg).toMatch(/sendEmail\(\{/);
    expect(seg).toMatch(/html: messageWaitingHtml\(\{ appUrl \}\)/);
  });
});

describe("v2.99.13 — tRPC get/set notification prefs", () => {
  const routers = read("server/v2routers.ts");
  it("getNotificationPrefs normalizes NULL to ENABLED and reports hasEmail", () => {
    const seg = routers.slice(routers.indexOf("getNotificationPrefs: publicProcedure"), routers.indexOf("setNotificationPrefs: publicProcedure"));
    expect(seg).toMatch(/hasEmail: Boolean\(user\.email\)/);
    expect(seg).toMatch(/missedCall: user\.emailNotifyMissedCall !== false/);
    expect(seg).toMatch(/message: user\.emailNotifyMessage !== false/);
  });
  it("setNotificationPrefs is auth-guarded and writes via setUserNotificationPrefs", () => {
    const seg = routers.slice(routers.indexOf("setNotificationPrefs: publicProcedure"), routers.indexOf("device list + remote logout"));
    expect(seg).toMatch(/if \(!user\) throw new TRPCError\(\{ code: "UNAUTHORIZED"/);
    expect(seg).toMatch(/setUserNotificationPrefs\(user\.id, \{/);
  });
});

describe("v2.99.13 — Profile email-notifications section", () => {
  const profile = read("client/src/pages/app/Profile.tsx");
  it("renders an EmailNotificationsSection with two toggles, gated on a registered email", () => {
    expect(profile).toMatch(/function EmailNotificationsSection/);
    expect(profile).toMatch(/<EmailNotificationsSection \/>/);
    // hides for guests / email-less accounts
    expect(profile).toMatch(/if \(!prefs\.data\?\.signedIn \|\| !prefs\.data\.hasEmail\) return null;/);
    // two toggles wired to the mutation
    expect(profile).toMatch(/setPrefs\.mutate\(\{ missedCall: v \}\)/);
    expect(profile).toMatch(/setPrefs\.mutate\(\{ message: v \}\)/);
    // optimistic update + rollback
    expect(profile).toMatch(/onError: \(_e, _v, ctx\) =>/);
  });
});
