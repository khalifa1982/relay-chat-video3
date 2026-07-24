/* ============================================================
   v2.99.44 — the last two DEFERRED follow-ups from the heavy-QA
   sweep, both flagged in their original batch and never revisited
   until an explicit "is anything still missing?" audit found them.

   H8  the missed-call email had no throttle of any kind (deferred
       in v2.99.22 as "needs a cooldown column").
   L1  a group dial where EVERY invitee declines sat on "Ringing…"
       until the 65s no-answer backstop (deferred in v2.99.27 as
       "needs outstanding-invitee tracking").
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (...p: string[]) => fs.readFileSync(path.resolve(__dirname, ...p), "utf8");
const V2DB = read("v2db.ts");
const CORE = read("_core", "index.ts");
const RELAY = read("relay.ts");
const CLIENT = read("..", "client", "src", "lib", "relayClient.ts");
const SCHEMA = read("..", "drizzle", "schema.ts");

describe("H8 — the missed-call email is throttled", () => {
  it("claims atomically, in one conditional UPDATE keyed on the cooldown", () => {
    const fn = V2DB.slice(
      V2DB.indexOf("export async function claimMissedCallEmail"),
      V2DB.indexOf("export async function releaseMissedCallEmailClaim")
    );
    expect(fn).toMatch(/\.set\(\{ lastMissedCallEmailAt: new Date\(\) \}\)/);
    expect(fn).toMatch(/or\(isNull\(users\.lastMissedCallEmailAt\), lt\(users\.lastMissedCallEmailAt, cutoff\)\)/);
    // The verdict comes from the statement that won, not from a prior read.
    expect(fn).toMatch(/affectedRows/);
    // Fails toward NOT sending: a duplicate email is what this prevents.
    expect(fn).toMatch(/catch \{\s*\n\s*return false;/);
  });

  it("runs BEFORE the send, and AFTER the block check and the preference", () => {
    const hook = CORE.slice(CORE.indexOf("isNumberBlockedBy(callee.id, info.callerPin)"), CORE.indexOf("[missed-call email]"));
    const claim = hook.indexOf("claimMissedCallEmail");
    expect(claim).toBeGreaterThan(0);
    expect(hook.indexOf("emailNotifyMissedCall === false")).toBeLessThan(claim);
    expect(claim).toBeLessThan(hook.indexOf("sendEmail("));
  });

  it("does NOT throttle the push or the History record — only the email", () => {
    const hook = CORE.slice(CORE.indexOf("isNumberBlockedBy(callee.id, info.callerPin)"), CORE.indexOf("[missed-call email]"));
    // Both must happen before the claim, so a throttled email never costs the
    // user the record of the call itself.
    expect(hook.indexOf("recordMissedCall")).toBeLessThan(hook.indexOf("claimMissedCallEmail"));
    expect(hook.indexOf("sendPushToIdentity")).toBeLessThan(hook.indexOf("claimMissedCallEmail"));
  });

  it("gives the claim back when the send fails — by RESULT, not .catch()", () => {
    const hook = CORE.slice(CORE.indexOf("isNumberBlockedBy(callee.id, info.callerPin)"), CORE.indexOf("[missed-call email]"));
    expect(hook).toMatch(/const sent = await sendEmail\(\{/);
    expect(hook).toMatch(/if \(!sent\.ok\) await releaseMissedCallEmailClaim\(callee\.userId\);/);
  });

  it("is a cooldown with no daily cap, and says why", () => {
    expect(V2DB).toMatch(/MISSED_CALL_EMAIL_COOLDOWN_MS = 10 \* 60 \* 1000/);
    // A missed call is a first-class event: capping the tenth could hide the one
    // that mattered, and repeated dialling is what blocking is for.
    expect(SCHEMA).toMatch(/lastMissedCallEmailAt: timestamp\("lastMissedCallEmailAt"\)/);
    expect(SCHEMA).toMatch(/NO daily cap/);
    expect(V2DB).toMatch(/column: "lastMissedCallEmailAt", ddl: "ADD COLUMN `lastMissedCallEmailAt` timestamp NULL"/);
  });
});

describe("L1 — an all-declined group dial fails instantly, not after 65s", () => {
  it("tracks outstanding invitees for a FRESH group dial only", () => {
    expect(CLIENT).toMatch(/let groupDialOutstanding: Set<string> \| null = null;/);
    // Populated on the dial path…
    expect(CLIENT).toMatch(/groupDialOutstanding = new Set\(clean\);/);
    // …and NOT when adding people to a call that already exists.
    const dial = CLIENT.slice(CLIENT.indexOf("if (alreadyInRoom) {"), CLIENT.indexOf("Starting group call ("));
    const addBranch = dial.slice(0, dial.indexOf("} else {"));
    expect(addBranch).not.toMatch(/groupDialOutstanding/);
  });

  it("only ends the dial once the LAST invitee has resolved", () => {
    const fn = CLIENT.slice(
      CLIENT.indexOf("function groupInviteeResolved"),
      CLIENT.indexOf("function groupInviteeResolved") + 900
    );
    expect(fn).toMatch(/groupDialOutstanding\.delete\(pin\)/);
    expect(fn).toMatch(/if \(groupDialOutstanding\.size > 0\) return;/);
    // …and only while this is still an unanswered dial with nobody on the call,
    // so it can never tear down an established or partially-answered call.
    expect(fn).toMatch(/if \(inCall && outgoingDial && !establishedOnce && aloneInCall\(\)\) failDial\(/);
  });

  it("counts declines, busies and unreachable invitees", () => {
    const rejected = CLIENT.slice(CLIENT.indexOf('case "rejected":'), CLIENT.indexOf('case "busy":'));
    expect(rejected).toMatch(/groupInviteeResolved\(m\.from, "Everyone declined\."\)/);
    const busy = CLIENT.slice(CLIENT.indexOf('case "busy":'), CLIENT.indexOf('case "busy":') + 400);
    expect(busy).toMatch(/groupInviteeResolved\(m\.from, "Nobody was available\."\)/);
    // A reachability error resolves its invitee too — the only thing that
    // notices a later invitee going offline once the room already exists.
    expect(CLIENT).toMatch(/if \(groupDialOutstanding && m\.pin\) groupDialOutstanding\.delete\(m\.pin\);/);
  });

  it("a partial decline still leaves the others ringing (the v2.99.22 property)", () => {
    // inParkedCall() is true for a group call, so the fatal 1:1 branch is skipped
    // — that must stay exactly as it was.
    expect(CLIENT).toMatch(/function inParkedCall\(\): boolean \{\s*\n\s*return callIsGroup \|\|/);
    const rejected = CLIENT.slice(CLIENT.indexOf('case "rejected":'), CLIENT.indexOf('case "busy":'));
    expect(rejected).toMatch(/if \(inCall && aloneInCall\(\) && !inParkedCall\(\)\)/);
  });

  it("the tracking is cleared when the dial ends either way", () => {
    for (const fnName of ["function failDial(", "function hangUp("]) {
      const body = CLIENT.slice(CLIENT.indexOf(fnName), CLIENT.indexOf(fnName) + 600);
      expect(body, `${fnName} clears the set`).toMatch(/groupDialOutstanding = null;/);
    }
  });

  it("the server names WHICH invitee an offline error is about", () => {
    // Without this the caller cannot attribute an error to an invitee, so the
    // last-one-resolved bookkeeping is impossible. Additive field.
    const sites = [...RELAY.matchAll(/code: "offline",\s*\n(?:\s*\/\/[^\n]*\n)*\s*pin: to,/g)];
    expect(sites.length).toBe(3);
  });
});
