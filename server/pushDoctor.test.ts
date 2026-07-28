/* ============================================================
   v2.99.91 — why a notification did not arrive.

   Owner: "Can you check the Firebase configuration as still the notification for the
   front mobile apps for Android? It's not showing or it's not active."

   A native push crosses FIVE links, and every one of them fails the same way from
   the phone — nothing happens:
     1. the shell posts a token into the WebView (an external Expo app),
     2. `push.subscribe` stores it under a kind the server can route,
     3. the transport for that kind is configured on the fleet,
     4. the recipient has not turned push off,
     5. something actually SENDS for the event being tested.
   Guessing which link is broken has already cost more than building the check, so
   the admin panel now reports them separately and can fire a real send.

   THE TEST'S JOB IS THE INVARIANTS THAT MAKE IT SAFE AND TRUSTWORTHY: it is
   admin-gated, it never returns a token, and the test send goes through the REAL
   `sendPushToIdentity` — a parallel test sender could pass while production was
   broken, which is worse than having no test.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { classifyNativeToken } from "./expoPush";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const ROUTERS = read("server/v2routers.ts");
const ADMIN_UI = read("client/src/pages/app/Admin.tsx");
const WEBPUSH = read("server/webPush.ts");

function codeOnly(src: string): string {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

/** One procedure's source, bounded by its own end. */
function proc(name: string): string {
  const at = ROUTERS.indexOf(`  ${name}: publicProcedure`);
  expect(at, `${name} exists`).toBeGreaterThan(-1);
  const end = ROUTERS.indexOf("\n    }),", at);
  expect(end, `${name} has an end`).toBeGreaterThan(at);
  const body = ROUTERS.slice(at, end + 8);
  expect(body.length).toBeGreaterThan(200);
  return body;
}

describe("both procedures are admin-only", () => {
  for (const name of ["pushDiagnostics", "sendTestPush"]) {
    it(`${name} re-derives admin from the users row`, () => {
      // Never the cached whoami role: that value has been through the browser and
      // is a rendering hint, never a permission.
      const body = proc(name);
      expect(body).toMatch(/await requireAdmin\(ctx\)/);
      // The gate comes FIRST, before any read or write.
      const gate = body.indexOf("requireAdmin(ctx)");
      for (const later of ["listPushSubscriptions", "sendPushToIdentity"]) {
        const at = body.indexOf(later);
        if (at >= 0) expect(gate, `${name}: gate precedes ${later}`).toBeLessThan(at);
      }
    });
  }

  it("requireAdmin answers identically for signed-out, non-admin and DB-down", () => {
    // Otherwise the endpoint is an oracle for who holds the role.
    const fn = ROUTERS.slice(ROUTERS.indexOf("async function requireAdmin("));
    expect(fn.slice(0, 700)).toMatch(/code: "FORBIDDEN", message: "Administrators only\."/);
  });
});

describe("the report never hands back a token", () => {
  const body = proc("pushDiagnostics");

  it("emits a short prefix and a length, never the endpoint", () => {
    // An FCM registration token plus the project key — or an Expo token on its own
    // — is enough to push to that handset. A prefix tells two devices apart and
    // cannot address either.
    expect(body).toMatch(/prefix: r\.endpoint\.slice\(0, 12\)/);
    expect(body).toMatch(/length: r\.endpoint\.length/);
    // No shape that returns the whole thing.
    expect(codeOnly(body)).not.toMatch(/endpoint: r\.endpoint/);
    expect(codeOnly(body)).not.toMatch(/\.\.\.r,/);
    expect(codeOnly(body)).not.toMatch(/token: r\.endpoint/);
  });

  it("and never the Firebase key — only whether it parses", () => {
    expect(body).toMatch(/fcm: !!fcmConfig\(\)/);
    expect(codeOnly(body)).not.toMatch(/FIREBASE_SERVICE_ACCOUNT_JSON/);
    expect(codeOnly(body)).not.toMatch(/private_key/);
    // Same for the Expo token: presence only.
    expect(body).toMatch(/expoAccessToken: !!process\.env\.EXPO_ACCESS_TOKEN/);
    expect(codeOnly(body)).not.toMatch(/expoAccessToken: process\.env/);
  });

  it("is a read — it cannot change anything", () => {
    expect(body).toMatch(/\.query\(async \(\{ ctx, input \}\)/);
    for (const w of ["upsertPushSubscription", "deletePushSubscription", "sendPushToIdentity", ".update(", ".insert("]) {
      expect(codeOnly(body), `pushDiagnostics does not ${w}`).not.toContain(w);
    }
  });
});

describe("the report names each link separately", () => {
  const body = proc("pushDiagnostics");

  it("reports the STORED kind and the SHAPE-DERIVED kind", () => {
    // The sender routes by the STORED kind, so an Expo token filed as `fcm` goes to
    // FCM and is dropped with no error anywhere. That disagreement is invisible
    // unless both are reported — it is the one failure with no other symptom.
    expect(body).toMatch(/kind: kindOf\(r\.kind\)/);
    expect(body).toMatch(/derived: classifyNativeToken\(r\.endpoint\)/);
    expect(ADMIN_UI).toMatch(/x\.derived !== "unknown" && x\.derived !== x\.kind/);
  });

  it("treats a legacy null kind as webpush, like the sender does", () => {
    // Rows predating the column are Web Push by construction; reporting them as
    // "unknown" would invent a problem.
    expect(body).toMatch(/const kindOf = \(k: string \| null \| undefined\) => \(k && k\.length > 0 \? k : "webpush"\)/);
  });

  it("reports the recipient's own push switch", () => {
    expect(body).toMatch(/pushEnabled: await pushEnabledForIdentity\(input\.identityId\)/);
  });

  it("distinguishes a DB failure from an empty list", () => {
    // "No devices" and "we couldn't look" need different next steps.
    expect(body).toMatch(/dbOk/);
    expect(body).toMatch(/dbOk = false/);
  });

  it("reports whether a CALL rings, and does not hard-code the answer in the UI", () => {
    // The likeliest reading of "it's not showing" is testing by calling a closed
    // app, so this row is the report's most consequential line — which is exactly
    // why it must not be a literal. It said "A CALL does not push at all" while
    // v2.99.11 held; v2.105.12 restored the ring, and a hard-coded `ok={false}`
    // would have gone on telling the owner their phone cannot ring while it rang.
    // The row now READS the server's own flag, so the two cannot diverge again.
    expect(body).toMatch(/ringPushed: true/);
    expect(ADMIN_UI).toMatch(/ok=\{d\.ringPushed\}/);
    expect(ADMIN_UI).not.toMatch(/A CALL does not push at all"\s*$/m);
    // The transport that actually rings a LOCKED iPhone is reported separately:
    // an apns token on a fleet with no .p8 key is undeliverable and invisible
    // otherwise.
    expect(body).toMatch(/apnsVoip: apnsVoipConfigured\(\)/);
    expect(ADMIN_UI).toMatch(/ok=\{d\.transports\.apnsVoip\}/);
  });

  it("reports WHICH credential and when a certificate expires (v2.105.14)", () => {
    // A VoIP Services certificate is the one credential here that dies on a DATE
    // rather than because of a change: ringing would stop one morning with nothing
    // in the diff to blame. The doctor surfaces it so the operator sees it coming.
    expect(body).toMatch(/apnsVoipMode: apnsVoipConfig\(\)\?\.mode \?\? null/);
    expect(body).toMatch(/apnsVoipExpiresAt: apnsCredentialExpiry\(\)\?\.toISOString\(\) \?\? null/);
    // The row must be ABSENT for a .p8 rather than reassuring about a date that
    // does not exist — hence the null guard, not a fallback string.
    expect(ADMIN_UI).toMatch(/d\.transports\.apnsVoipExpiresAt \?/);
    // Warn AHEAD of the lapse, not after it.
    expect(ADMIN_UI).toMatch(/days > 30/);
    expect(ADMIN_UI).toMatch(/EXPIRED/);
  });

  it("the 'not configured' hint names BOTH credential shapes", () => {
    // Naming only the .p8 sent an operator holding a certificate looking for a
    // file they do not have — which is exactly what happened here.
    const ui = ADMIN_UI.slice(ADMIN_UI.indexOf("APNs VoIP) is NOT configured"));
    expect(ui).toMatch(/APNS_P8_KEY/);
    expect(ui).toMatch(/APNS_VOIP_CERT_PEM/);
    expect(ui).toMatch(/APNS_VOIP_KEY_PEM/);
  });

  it("the claimed send list matches what the code ACTUALLY sends", () => {
    // A hard-coded list that drifts from reality is worse than no list: it would
    // send somebody looking in the wrong place. Cross-checked against every real
    // call site's `kind`.
    // `incoming-call` joined this list in v2.105.12 — the ring push removed in
    // v2.99.11 is back at the owner's request. The guard worked exactly as
    // intended: it went red the moment the code sent a kind the operator-facing
    // list did not claim, which is the drift it exists to catch.
    const declared = ["incoming-call", "message", "missed-call", "voicemail", "contact-online"];
    const sources = [ROUTERS, read("server/_core/index.ts")];
    const actual = new Set<string>();
    for (const src of sources) {
      for (const m of src.matchAll(/sendPushToIdentity\([^)]*?\{\s*\n\s*kind: "([a-z-]+)"/g)) {
        actual.add(m[1]);
      }
    }
    expect(actual.size, "found the real call sites").toBeGreaterThan(0);
    expect([...actual].sort()).toEqual([...declared].sort());
    // A ring IS pushed now, so the doctor must not still tell an operator it isn't
    // — that claim is the single most misleading thing this report could carry.
    expect(actual.has("incoming-call")).toBe(true);
    expect(ROUTERS).toMatch(/ringPushed: true/);
  });
});

describe("the test send is the REAL sender", () => {
  const body = proc("sendTestPush");

  it("calls sendPushToIdentity rather than reimplementing it", () => {
    // A parallel test sender could pass while production was broken — the worst
    // possible outcome for a diagnostic. This proves the actual path, including the
    // master switch, the per-kind routing and the dead-token pruning.
    expect(body).toMatch(/await sendPushToIdentity\(input\.identityId, \{/);
    for (const other of ["sendFcmData", "sendExpoPush", "webpush.sendNotification"]) {
      expect(codeOnly(body), `does not bypass via ${other}`).not.toContain(other);
    }
  });

  it("is rate-limited even for an admin", () => {
    // It writes to a third party's device; a stuck retry in the panel must not
    // become a notification flood.
    expect(body).toMatch(/directoryGate\(ctx\)/);
  });

  it("is content-free and says it is a test", () => {
    expect(body).toMatch(/title: "RELAY test notification"/);
    expect(body).toMatch(/notifications are working on this device/);
  });

  it("traces the action with ids only", () => {
    // This line lands in logs, so it carries no name, email or content.
    const trace = body.slice(body.indexOf("console.warn"));
    expect(trace).toMatch(/\[admin\] test push to identity \$\{input\.identityId\} by identity \$\{me\.id\}/);
    expect(trace).not.toMatch(/displayName|email/);
  });

  it("returns the delivered count, so zero is distinguishable from a failure", () => {
    expect(body).toMatch(/return \{ delivered \}/);
    expect(ADMIN_UI).toMatch(/Nothing was reachable/);
  });
});

describe("classifyNativeToken is the one routing rule", () => {
  // The report leans on it, so a behavioural check that it still separates the two
  // native transports — sending an Expo token to FCM is a SILENT delivery failure.
  it("separates Expo tokens from raw device tokens", () => {
    expect(classifyNativeToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe("expo");
    expect(classifyNativeToken("ExpoPushToken[yyyyyyyyyyyyyyyyyyyyyy]")).toBe("expo");
    const fcmish = "cX9" + "a".repeat(140);
    expect(classifyNativeToken(fcmish)).toBe("fcm");
  });

  it("refuses what it cannot classify rather than guessing", () => {
    // `push.subscribe` re-derives the kind and REFUSES an unclassifiable token, so
    // an unroutable row is never stored in the first place.
    for (const bad of ["", "   ", "short", null, undefined, 42, {}]) {
      expect(classifyNativeToken(bad as unknown)).toBeNull();
    }
    expect(WEBPUSH).toMatch(/subs\.filter\(s => s\.kind === "fcm"\)/);
    expect(WEBPUSH).toMatch(/subs\.filter\(s => s\.kind === "expo"\)/);
  });
});

describe("the panel stays a panel", () => {
  it("the notification check renders inside the existing admin gate", () => {
    // Nothing here may be reachable without the server's own admin answer.
    expect(ADMIN_UI).toMatch(/if \(!amIAdmin\.data\?\.admin\)/);
    expect(ADMIN_UI).toMatch(/<PushCheck identityId=\{r\.id\}/);
  });

  it("the panel's capabilities are an EXACT set, so the surface cannot widen quietly", () => {
    // An admin panel is a permanent high-value surface, so every capability on it is
    // enumerated and a new one has to be added HERE on purpose. This list has grown
    // twice, both times because the owner asked in their own words ("I can delete the
    // user or change type of account from guest to registered to admin") — and both
    // times the guard did its job by turning red first: `setAccountType` in v2.99.99
    // and `deleteIdentity` in v2.100.0.
    //
    // Still absent, and each absence is a decision: no message reading, no contact
    // listing, and no password or PIN reset.
    //
    // v2.105.15 (#111) is the third growth, and the narrowest: the two invite
    // procedures write a SUGGESTED address onto a guest identity and nothing else.
    // They deliberately do NOT register anybody, because the claim writer takes its
    // candidates only from the requesting browser — which is why v2.99.99 could
    // refuse the direct version as an account-takeover primitive and this one can
    // ship.
    const calls = [...ADMIN_UI.matchAll(/trpc\.admin\.([A-Za-z]+)\./g)].map((m) => m[1]);
    expect([...new Set(calls)].sort()).toEqual(
      [
        "amIAdmin",
        "clearGuestRegistrationInvite",
        "deleteIdentity",
        "findIdentities",
        "inviteGuestRegistration",
        "pushDiagnostics",
        "sendTestPush",
        "setAccountType",
        "setIdentityNumber",
      ].sort()
    );
  });

  it("account-type control writes ONE enum column and can reach nothing else", () => {
    const fn = ROUTERS.slice(ROUTERS.indexOf("  setAccountType: publicProcedure"));
    const body = fn.slice(0, fn.indexOf("\n    }),"));
    expect(body.length).toBeGreaterThan(200);
    // Admin is re-derived from the users row, before anything else happens.
    expect(body).toMatch(/const me = await requireAdmin\(ctx\);/);
    expect(body.indexOf("requireAdmin")).toBeLessThan(body.indexOf("setIdentityAccountType"));
    // The input is a closed enum — not a free string that could name any column value.
    expect(body).toMatch(/role: z\.enum\(\["admin", "registered", "guest"\]\)/);
    // And it cannot write anything but the role.
    expect(body).not.toMatch(/\.update\(identities\)/);
    expect(body).not.toMatch(/passwordHash|loginPinHash|recoveryHash|guestToken/);
  });

  it("an admin cannot remove their OWN admin rights", () => {
    // users.role is otherwise grantable only by hand (SQL, or the backend
    // admin-tool), so a self-demotion could leave a deployment with no administrator
    // and no way back in through the app. Refusing it also GUARANTEES at least one
    // admin always remains, however many others are demoted.
    const V2DB = read("server/v2db.ts");
    const fn = V2DB.slice(V2DB.indexOf("export async function setIdentityAccountType"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body.length).toBeGreaterThan(200);
    expect(body).toMatch(/row\.userId === actingUserId/);
    expect(body).toMatch(/reason: "self"/);
    // The guard is checked against the ACCOUNT, not the identity: one account can
    // hold more than one identity over its life.
    expect(body).not.toMatch(/identityId === acting/);
  });

  it("a GUEST is refused rather than half-promoted", () => {
    // A guest has no `users` row at all — that is what being a guest IS — so there is
    // no role column to write. Flipping `identities.verified` instead would hand them
    // the Registered badge while they still had no email, no password and no way to
    // sign in anywhere else: a badge that lies about the account behind it.
    const V2DB = read("server/v2db.ts");
    const fn = V2DB.slice(V2DB.indexOf("export async function setIdentityAccountType"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toMatch(/if \(row\.userId == null\) return \{ ok: false, reason: "no-account" \}/);
    expect(body).not.toMatch(/verified: true/);
    // "Become a guest" is refused for the mirror reason, before any DB work.
    expect(body).toMatch(/if \(role === "guest"\) return \{ ok: false, reason: "unsupported" \}/);
  });

  it("every refusal is NAMED, because each needs a different next step", () => {
    const fn = ROUTERS.slice(ROUTERS.indexOf("  setAccountType: publicProcedure"));
    const body = fn.slice(0, fn.indexOf("\n    }),"));
    for (const reason of ["not-found", "no-account", "self", "unsupported", "unavailable"]) {
      expect(body, `${reason} is mapped`).toMatch(new RegExp(`"?${reason}"?:`));
    }
    // And the trace carries ids only — it lands in logs.
    expect(body).toMatch(/console\.warn\(/);
    expect(body).not.toMatch(/\$\{.*email/);
  });
});
