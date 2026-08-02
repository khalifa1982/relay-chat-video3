/* ============================================================
   v2.99.40 — the four confirmed gaps from the owner's Rounds 1–8
   instruction file. Everything else in that file was already
   shipped (R1, R2B, R3, R4A/B, R5, R6, R7-GAP4, R8-FIX1..4) and
   is pinned by its own release's tests; these are the four that
   were genuinely still open.

   R2A  the production server bundle statically imported dev-only
        packages, so `node dist/index.js` needed five devDependencies
        at boot to serve static files.
   R7-1 a new message never woke an offline recipient's device.
   R7-2 no user-facing switch for push delivery.
   R7-3 the offline-message email needed SES-safe limits + a
        working, no-login unsubscribe.
   ============================================================ */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { extraHeaderLines, buildMimeMessage } from "./smtp";
import { copyOnScreen, whyCopyMissing } from "./testing/copyOnScreen";
import { unsubscribeToken, verifyUnsubscribeToken, unsubscribeHeaders } from "./unsubscribe";

const read = (...p: string[]) => fs.readFileSync(path.resolve(__dirname, ...p), "utf8");
const ROUTERS = read("v2routers.ts");
const V2DB = read("v2db.ts");
const WEBPUSH = read("webPush.ts");
const INBOUND = read("emailInbound.ts");
const VITE_SETUP = read("_core", "vite.ts");
const PROFILE = read("..", "client", "src", "pages", "app", "Profile.tsx");
const SCHEMA = read("..", "drizzle", "schema.ts");

/* ── R2A ────────────────────────────────────────────────────────────────── */

describe("R2A — the production server bundle carries no dev-only imports", () => {
  it("setupVite imports vite lazily and never imports the config module", () => {
    expect(VITE_SETUP).toMatch(/await import\("vite"\)/);
    // A static `from "vite"` / `from "../../vite.config"` is what put vite and
    // every plugin the config imports into dist/index.js.
    expect(VITE_SETUP).not.toMatch(/^import .* from "vite";/m);
    expect(VITE_SETUP).not.toMatch(/vite\.config"/);
  });

  it("hands vite the config PATH instead, so vite loads it (single-sourced)", () => {
    expect(VITE_SETUP).toMatch(/configFile: path\.resolve\(import\.meta\.dirname, "\.\.\/\.\.", "vite\.config\.ts"\)/);
    // The old shape spread an imported config AND disabled vite's own
    // resolution, which silently bypassed the real config pipeline.
    expect(VITE_SETUP).not.toMatch(/configFile: false/);
    expect(VITE_SETUP).not.toMatch(/\.\.\.viteConfig/);
  });

  it("the BUILT bundle has no top-level vite/plugin import (the actual property)", () => {
    // This is the assertion that matters: it reads the real artifact. Skipped
    // rather than failed when dist/ hasn't been built in this checkout.
    const dist = path.resolve(__dirname, "..", "dist", "index.js");
    if (!fs.existsSync(dist)) return;
    const built = fs.readFileSync(dist, "utf8");
    const statics = [...built.matchAll(/^import\s[^;]*?from\s*"([^"]+)";/gm)].map((m) => m[1]);
    const devOnly = statics.filter((p) =>
      /^(vite|@vitejs|@tailwindcss|@builder\.io\/vite|vite-plugin)/.test(p)
    );
    expect(devOnly).toEqual([]);
  });
});

/* ── R7 GAP1 — push for a new message ───────────────────────────────────── */

describe("R7 GAP1 — a new message wakes an offline recipient's device", () => {
  const send = ROUTERS.slice(ROUTERS.indexOf("send: publicProcedure"), ROUTERS.indexOf("markRead: publicProcedure"));

  it("pushes to every OFFLINE peer, tagged per conversation", () => {
    // v2.99.92: widened from a bare `!isOnline` to the SHARED rule, because a
    // BACKGROUNDED app is now `isOnline` (that is what stopped minimising reading
    // as offline) yet still cannot draw an in-page toast. Pinning the old
    // expression would have pinned a silent regression: messages would stop
    // notifying anybody whose app was merely minimised.
    expect(send).toMatch(/offlinePeerIds = peerIds\.filter\(\(pid\) => presenceNeedsNotification\(presenceById\.get\(pid\)\)\)/);
    expect(send).toMatch(/kind: "message"/);
    expect(send).toMatch(/tag: `relay-msg-\$\{input\.conversationId\}`/);
    expect(send).toMatch(/url: `\/app\/messages\?c=\$\{input\.conversationId\}`/);
  });

  it("carries the sender's name but NOT a word of the message (owner's rule)", () => {
    const push = send.slice(send.indexOf("NEW-MESSAGE WEB PUSH"), send.indexOf("Offline-message EMAIL"));
    expect(push).toMatch(/title: from/);
    expect(push).toMatch(/body: "Sent you a message — tap to read it\."/);
    // The message body must never reach the notification.
    expect(push).not.toMatch(/trimmedBody/);
    expect(push).not.toMatch(/input\.body/);
  });

  it("doesn't double-notify a voicemail (which pushes its own)", () => {
    expect(send).toMatch(/if \(!input\.meta\?\.voicemail\) \{/);
  });

  it("never lets a notification failure affect the delivered message", () => {
    const push = send.slice(send.indexOf("NEW-MESSAGE WEB PUSH"), send.indexOf("Offline-message EMAIL"));
    expect(push).toMatch(/\.catch\(\(\) => \{\}\)/);
    expect(push).toMatch(/\} catch \{/);
  });

  it('"message" is a declared push kind', () => {
    expect(WEBPUSH).toMatch(/\| "message";/);
  });
});

/* ── R7 GAP2 — the push master switch ───────────────────────────────────── */

describe("R7 GAP2 — push delivery honours a user preference", () => {
  it("is enforced inside sendPushToIdentity, so every kind and call site obeys", () => {
    const fn = WEBPUSH.slice(
      WEBPUSH.indexOf("export async function sendPushToIdentity"),
      WEBPUSH.indexOf("export async function sendPushToIdentity") + 900
    );
    expect(fn).toMatch(/if \(!\(await pushEnabledForIdentity\(identityId\)\)\) return 0;/);
    // Before the subscription lookup, so an opted-out user costs us nothing.
    expect(fn.indexOf("pushEnabledForIdentity")).toBeLessThan(fn.indexOf("listPushSubscriptions"));
  });

  it("reads NULL as ON and fails OPEN, so it can never silence a ringing call", () => {
    const fn = V2DB.slice(
      V2DB.indexOf("export async function pushEnabledForIdentity"),
      V2DB.indexOf("export async function pushEnabledForIdentity") + 1200
    );
    expect(fn).toMatch(/return row\.pushEnabled !== false;/);
    expect(fn).toMatch(/if \(!row\) return true;/); // guest / no linked account
    expect(fn).toMatch(/catch \{\s*\n\s*return true;/); // DB trouble
  });

  it("the column is additive + nullable, with a boot migration", () => {
    expect(SCHEMA).toMatch(/pushEnabled: boolean\("pushEnabled"\)/);
    expect(V2DB).toMatch(/column: "pushEnabled", ddl: "ADD COLUMN `pushEnabled` boolean"/);
  });

  it("is exposed and writable over tRPC, and shown in Profile", () => {
    expect(ROUTERS).toMatch(/push: user\.pushEnabled !== false/);
    expect(ROUTERS).toMatch(/pushEnabled: input\.push/);
    /* The ROW EXISTS AND IS LABELLED. The old pin froze the attribute's literal form;
       the property is that Profile offers the master push switch by name. */
    expect(PROFILE).toMatch(/title=\{t\("profile\.pushTitle"\)\}/);
    expect(
      copyOnScreen(PROFILE, "Push notifications"),
      whyCopyMissing(PROFILE, "Push notifications")
    ).toBe(true);
    expect(PROFILE).toMatch(/onChange=\{\(v\) => setPrefs\.mutate\(\{ push: v \}\)\}/);
  });

  it("the push row shows for an account with no email (it isn't an email pref)", () => {
    const sec = PROFILE.slice(PROFILE.indexOf("function EmailNotificationsSection"), PROFILE.indexOf("function DndSection"));
    expect(sec).toMatch(/if \(!prefs\.data\?\.signedIn\) return null;/);
    expect(sec).not.toMatch(/if \(!prefs\.data\?\.signedIn \|\| !prefs\.data\.hasEmail\) return null;/);
    // The two EMAIL rows are the ones gated on an address.
    expect(sec).toMatch(/\{hasEmail && \(/);
  });
});

/* ── R7 GAP3 — the offline-message email is a last resort ───────────────── */

describe("R7 GAP3 — the message email is SES-safe: last resort, capped, unsubscribable", () => {
  const email = ROUTERS.slice(ROUTERS.indexOf("Offline-message EMAIL"), ROUTERS.indexOf("Offline auto-reply"));

  it("skips anyone we can reach by push instead", () => {
    // "Reachable" = a live subscription AND the push switch on; see the
    // neither-notification finding below for why the subscription alone is wrong.
    expect(email).toMatch(/if \(await pushReachable\(pid\)\) continue;/);
  });

  it("requires the recipient to have actually been away a while", () => {
    expect(email).toMatch(/if \(away !== null && away < OFFLINE_MESSAGE_EMAIL_MIN_AWAY_MS\) continue;/);
    expect(V2DB).toMatch(/OFFLINE_MESSAGE_EMAIL_MIN_AWAY_MS = 5 \* 60 \* 1000/);
  });

  it("cools down for an hour, not 15 minutes", () => {
    expect(V2DB).toMatch(/OFFLINE_MESSAGE_EMAIL_COOLDOWN_MS = 60 \* 60 \* 1000/);
  });

  it("coalesces by wording — plural, never a per-message count", () => {
    expect(email).toMatch(/subject: "You have messages waiting on RELAY"/);
    expect(ROUTERS).toMatch(/You have messages waiting on RELAY\./);
    expect(ROUTERS).not.toMatch(/1 new message/);
  });

  it("caps at 3 per UTC day inside the SAME atomic claim (so it's race-safe)", () => {
    expect(V2DB).toMatch(/OFFLINE_MESSAGE_EMAIL_MAX_PER_DAY = 3/);
    const claim = V2DB.slice(
      V2DB.indexOf("export async function claimOfflineMessageEmail"),
      V2DB.indexOf("export async function claimMissedCallEmail")
    );
    expect(claim).toMatch(/COALESCE\(\$\{users\.messageEmailsToday\}, 0\) < \$\{OFFLINE_MESSAGE_EMAIL_MAX_PER_DAY\}/);
    expect(claim).toMatch(/affectedRows/);
  });

  it("does NOT depend on SET assignment order — drizzle picks that, not us", () => {
    // The first version of this used one statement:
    //   SET count = IF(day <=> today, count + 1, 1), day = today
    // relying on MySQL's left-to-right SET evaluation so the IF read the OLD
    // day. That was WRONG, and the earlier version of this test asserted the
    // object-literal order, which proved nothing: drizzle's `buildUpdateSet`
    // emits assignments in SCHEMA DECLARATION order (it walks the table's
    // columns object), and `messageEmailDay` is declared before
    // `messageEmailsToday` — so the day was written FIRST, the IF always saw
    // `today`, the counter never reset, and the cap decayed to one email per day
    // while the counter grew without bound.
    //
    // The fix is structural: an idempotent day-rollover statement, then a claim
    // whose SET is a pure increment. Correct under ANY emitted order.
    const claim = V2DB.slice(
      V2DB.indexOf("export async function claimOfflineMessageEmail"),
      V2DB.indexOf("export async function claimMissedCallEmail")
    );
    // No day logic may remain in either SET clause.
    expect(claim).not.toMatch(/IF\(\$\{users\.messageEmailDay\}/);
    expect(claim).toMatch(/\.set\(\{ messageEmailsToday: 0, messageEmailDay: today \}\)/);
    expect(claim).toMatch(/messageEmailsToday: sql`COALESCE\(\$\{users\.messageEmailsToday\}, 0\) \+ 1`/);
    // The rollover only touches a row whose day is missing or stale.
    expect(claim).toMatch(/or\(isNull\(users\.messageEmailDay\), sql`NOT \(\$\{users\.messageEmailDay\} <=> \$\{today\}\)`\)/);
    // ...and it documents WHY, so nobody "simplifies" it back into one statement.
    expect(claim).toMatch(/buildUpdateSet/);
    expect(claim).toMatch(/DECLARED IN THE SCHEMA/);
  });

  it("the cap is enforced by the WHERE against the pre-update row", () => {
    const claim = V2DB.slice(
      V2DB.indexOf("export async function claimOfflineMessageEmail"),
      V2DB.indexOf("export async function claimMissedCallEmail")
    );
    const where = claim.slice(claim.lastIndexOf(".where("));
    expect(where).toMatch(/COALESCE\(\$\{users\.messageEmailsToday\}, 0\) < \$\{OFFLINE_MESSAGE_EMAIL_MAX_PER_DAY\}/);
    // The old "a fresh day always passes" OR-branch is gone: the rollover has
    // already zeroed the counter by the time the claim runs, so a day-mismatch
    // escape hatch would only re-open the hole it used to paper over.
    expect(where).not.toMatch(/NOT \(\$\{users\.messageEmailDay\}/);
  });

  it("a drizzle upgrade cannot silently reintroduce the order dependency", () => {
    // Behavioural guard on the ACTUAL library: buildUpdateSet must still derive
    // its order from the table's columns, which is why we refuse to rely on it.
    const dialect = require.resolve("drizzle-orm/mysql-core/dialect", { paths: [process.cwd()] });
    const src = fs.readFileSync(dialect, "utf8");
    const fn = src.slice(src.indexOf("buildUpdateSet(table, set)"), src.indexOf("buildUpdateQuery("));
    expect(fn).toMatch(/Object\.keys\(tableColumns\)/);
    expect(fn).not.toMatch(/Object\.keys\(set\)/);
  });

  it("a failed send returns BOTH the cooldown and the day's budget slot", () => {
    const rel = V2DB.slice(
      V2DB.indexOf("export async function releaseOfflineMessageEmailClaim"),
      V2DB.indexOf("export async function releaseOfflineMessageEmailClaim") + 900
    );
    expect(rel).toMatch(/lastMessageEmailAt: null/);
    expect(rel).toMatch(/GREATEST\(COALESCE\(\$\{users\.messageEmailsToday\}, 0\) - 1, 0\)/);
  });

  it("sends List-Unsubscribe headers and a visible footer link", () => {
    expect(email).toMatch(/headers: unsubscribeHeaders\(peer\.userId\)/);
    expect(email).toMatch(/const unsubscribeUrl = unsubscribeLink\(peer\.userId\);/);
    expect(email).toMatch(/messageWaitingHtml\(\{ appUrl, unsubscribeUrl \}\)/);
    expect(ROUTERS).toMatch(/Unsubscribe from these emails\./);
  });
});

describe("R7 GAP3 — the unsubscribe token is a narrow, non-expiring capability", () => {
  const withSecret = <T,>(fn: () => T): T => {
    const prev = process.env.INBOUND_EMAIL_SECRET;
    process.env.INBOUND_EMAIL_SECRET = "test-unsub-secret";
    try {
      return fn();
    } finally {
      if (prev === undefined) delete process.env.INBOUND_EMAIL_SECRET;
      else process.env.INBOUND_EMAIL_SECRET = prev;
    }
  };

  it("round-trips the userId it was minted for", () => {
    withSecret(() => {
      const t = unsubscribeToken(42);
      expect(t).toBeTruthy();
      expect(verifyUnsubscribeToken(t!)).toBe(42);
    });
  });

  it("rejects a tampered id, a tampered signature, and junk", () => {
    withSecret(() => {
      const t = unsubscribeToken(42)!;
      const sig = t.slice(t.indexOf(".") + 1);
      expect(verifyUnsubscribeToken(`43.${sig}`)).toBeNull(); // someone else's account
      expect(verifyUnsubscribeToken(`42.${"a".repeat(sig.length)}`)).toBeNull();
      expect(verifyUnsubscribeToken("42")).toBeNull();
      expect(verifyUnsubscribeToken("")).toBeNull();
      expect(verifyUnsubscribeToken("0." + sig)).toBeNull();
      expect(verifyUnsubscribeToken("-1." + sig)).toBeNull();
    });
  });

  it("fails CLOSED with no secret configured — verifies nothing, mints nothing", () => {
    const prevInbound = process.env.INBOUND_EMAIL_SECRET;
    const prevJwt = process.env.JWT_SECRET;
    delete process.env.INBOUND_EMAIL_SECRET;
    delete process.env.JWT_SECRET;
    try {
      expect(unsubscribeToken(42)).toBeNull();
      expect(unsubscribeHeaders(42)).toBeUndefined();
      expect(verifyUnsubscribeToken("42.anything")).toBeNull();
    } finally {
      if (prevInbound !== undefined) process.env.INBOUND_EMAIL_SECRET = prevInbound;
      if (prevJwt !== undefined) process.env.JWT_SECRET = prevJwt;
    }
  });

  it("the route can only turn the email OFF — never on, never anything else", () => {
    const route = INBOUND.slice(
      INBOUND.indexOf("export function registerEmailUnsubscribe"),
      INBOUND.indexOf("Mount POST /api/email/inbound")
    );
    expect(route).toMatch(/setUserNotificationPrefs\(userId, \{ emailNotifyMessage: false \}\)/);
    expect(route).not.toMatch(/emailNotifyMessage: true/);
    expect(route).not.toMatch(/pushEnabled/);
    expect(route).not.toMatch(/missedCall/);
  });

  it("works with no session — the token IS the authorization", () => {
    const route = INBOUND.slice(
      INBOUND.indexOf("export function registerEmailUnsubscribe"),
      INBOUND.indexOf("Mount POST /api/email/inbound")
    );
    expect(route).not.toMatch(/ctx\.user|requireAuth|UNAUTHORIZED/);
    expect(INBOUND).toMatch(/registerEmailUnsubscribe\(app\);/); // actually mounted
  });

  it("GET (and HEAD) NEVER writes — only POST does", async () => {
    // Found in pre-merge review. The token is in the recipient's inbox twice, and
    // mail security gateways fetch links found in mail to detonate them (Safe
    // Links, Proofpoint, AV scanners) — and express answers HEAD from app.get.
    // A handler that wrote on GET would silently unsubscribe someone before they
    // ever opened the message. This is behavioural, not a source pin: it drives
    // the real express app and counts writes.
    process.env.INBOUND_EMAIL_SECRET = "test-unsub-secret";
    const token = unsubscribeToken(4242)!;
    const writes: number[] = [];
    vi.resetModules();
    vi.doMock("./v2db", async () => {
      const real = await vi.importActual<typeof import("./v2db")>("./v2db");
      return {
        ...real,
        setUserNotificationPrefs: async (userId: number) => {
          writes.push(userId);
        },
      };
    });
    const express = (await import("express")).default;
    const { registerEmailUnsubscribe } = await import("./emailInbound");
    const app = express();
    registerEmailUnsubscribe(app);
    const server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    const port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}/api/email/unsubscribe?t=${encodeURIComponent(token)}`;
    try {
      const get = await fetch(url);
      expect(get.status).toBe(200);
      const html = await get.text();
      expect(writes, "GET must not mutate").toEqual([]);
      // …and it must offer the POST instead.
      expect(html).toMatch(/<form method="post"/);
      expect(html).toMatch(/Unsubscribe me/);

      const head = await fetch(url, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(writes, "HEAD must not mutate either").toEqual([]);

      const post = await fetch(url, { method: "POST" });
      expect(post.status).toBe(200);
      expect(await post.text()).toMatch(/You're unsubscribed/);
      expect(writes, "POST is the writing path").toEqual([4242]);

      // A tampered token writes nothing on either verb.
      const bad = `http://127.0.0.1:${port}/api/email/unsubscribe?t=9999.deadbeef`;
      expect((await fetch(bad)).status).toBe(400);
      expect((await fetch(bad, { method: "POST" })).status).toBe(400);
      expect(writes).toEqual([4242]);
    } finally {
      server.close();
      vi.doUnmock("./v2db");
      vi.resetModules();
      delete process.env.INBOUND_EMAIL_SECRET;
    }
  });

  it("the reflected token can't become an XSS sink", () => {
    const route = INBOUND.slice(
      INBOUND.indexOf("export function registerEmailUnsubscribe"),
      INBOUND.indexOf("Mount POST /api/email/inbound")
    );
    // The form action is the ONLY place a query value reaches the markup, it is
    // only reached AFTER the token verified (so it is digits + base64url by
    // construction), and it is escaped regardless.
    expect(route).toMatch(/escapeHtmlAttr\(formAction\)/);
    expect(INBOUND).toMatch(/function escapeHtmlAttr/);
  });

  it("the POST path is rate limited, with a sweep like every other limiter", () => {
    expect(INBOUND).toMatch(/const unsubscribeIpLimiter = createRateLimiter\(/);
    expect(INBOUND).toMatch(/unsubscribeIpLimiter\.sweep\(/);
    expect(INBOUND).toMatch(/RELAY_RATELIMIT_OFF/);
  });

  it("reports a failed write honestly instead of claiming success", () => {
    const route = INBOUND.slice(
      INBOUND.indexOf("export function registerEmailUnsubscribe"),
      INBOUND.indexOf("Mount POST /api/email/inbound")
    );
    expect(route).toMatch(/"We couldn't save that"/);
    expect(route).toMatch(/500/);
  });

  it("emits both RFC 8058 headers when a link can be minted", () => {
    const prev = process.env.APP_URL;
    process.env.APP_URL = "https://example.test";
    process.env.INBOUND_EMAIL_SECRET = "test-unsub-secret";
    try {
      const h = unsubscribeHeaders(7)!;
      expect(h["List-Unsubscribe"]).toMatch(/^<https:\/\/example\.test\/api\/email\/unsubscribe\?t=7\./);
      expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    } finally {
      if (prev === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = prev;
      delete process.env.INBOUND_EMAIL_SECRET;
    }
  });
});

describe("R7 GAP3 — custom mail headers can't inject a header or a body", () => {
  it("renders a clean header and drops CR/LF and bad names", () => {
    expect(extraHeaderLines({ "List-Unsubscribe": "<https://x/y>" })).toEqual([
      "List-Unsubscribe: <https://x/y>",
    ]);
    expect(extraHeaderLines({ "X-A": "ok\r\nBcc: victim@example.com" })).toEqual([]);
    expect(extraHeaderLines({ "X-A": "ok\nsomething" })).toEqual([]);
    expect(extraHeaderLines({ "Bad Name": "v" })).toEqual([]);
    expect(extraHeaderLines({ "X:Y": "v" })).toEqual([]);
    expect(extraHeaderLines(undefined)).toEqual([]);
  });

  it("buildMimeMessage places them in the header block, above MIME-Version", () => {
    const mime = buildMimeMessage({
      from: "RELAY <no-reply@example.test>",
      to: ["a@example.test"],
      subject: "s",
      html: "<p>h</p>",
      text: "h",
      headers: { "List-Unsubscribe": "<https://example.test/u>" },
      date: new Date(0),
      messageId: "<fixed@example.test>",
    });
    expect(mime).toContain("List-Unsubscribe: <https://example.test/u>\r\n");
    expect(mime.indexOf("List-Unsubscribe:")).toBeLessThan(mime.indexOf("MIME-Version:"));
    // Still exactly one header block — no stray blank line before it.
    expect(mime.indexOf("List-Unsubscribe:")).toBeLessThan(mime.indexOf("\r\n\r\n"));
  });
});

/* ── pre-merge review findings, all fixed in this release ───────────────── */

describe("v2.99.42 review findings — each fixed before merge", () => {
  it("push OFF must not also suppress the email (neither-notification hole)", () => {
    // Nothing deletes the push_subscriptions row when the switch is turned off,
    // so "has a subscription" was the wrong stand-in for "reachable": push off +
    // message email on produced NO push and NO email, silently, forever.
    const email = ROUTERS.slice(ROUTERS.indexOf("Offline-message EMAIL"), ROUTERS.indexOf("Offline auto-reply"));
    expect(email).toMatch(/if \(await pushReachable\(pid\)\) continue;/);
    expect(email).not.toMatch(/if \(await hasPushSubscription\(pid\)\) continue;/);
    const fn = V2DB.slice(V2DB.indexOf("export async function pushReachable"), V2DB.indexOf("export async function pushReachable") + 700);
    expect(fn).toMatch(/hasPushSubscription\(identityId\)/);
    expect(fn).toMatch(/pushEnabledForIdentity\(identityId\)/);
    expect(fn).toMatch(/return hasSub && enabled;/);
  });

  it("the failed-send rollback inspects the RESULT (sendEmail never rejects)", () => {
    // sendEmail is documented never to throw and resolves {ok:false} on every
    // failure path, so the .catch() this replaces was dead code: a refused SES
    // send kept the claim, burning the cooldown AND one of three daily slots.
    const email = ROUTERS.slice(ROUTERS.indexOf("Offline-message EMAIL"), ROUTERS.indexOf("Offline auto-reply"));
    expect(email).toMatch(/\.then\(\(r\) => \{\s*\n\s*if \(!r\.ok\) void releaseOfflineMessageEmailClaim\(claimUserId\);/);
    // …and the defensive catch stays, in case it ever does throw.
    expect(email).toMatch(/\.catch\(\(\) => \{[\s\S]{0,200}releaseOfflineMessageEmailClaim\(claimUserId\);/);
    const mail = read("email.ts");
    expect(mail).toMatch(/NEVER throws/); // the contract this fix relies on
  });

  it("the unsubscribe URL survives into text/plain (stripHtml eats hrefs)", () => {
    const email = ROUTERS.slice(ROUTERS.indexOf("Offline-message EMAIL"), ROUTERS.indexOf("Offline auto-reply"));
    expect(email).toMatch(/text: messageWaitingText\(\{ appUrl, unsubscribeUrl \}\)/);
    const text = ROUTERS.slice(ROUTERS.indexOf("function messageWaitingText"), ROUTERS.indexOf("function awayForMs"));
    expect(text).toMatch(/Or unsubscribe here: \$\{opts\.unsubscribeUrl\}/);
    expect(text).toMatch(/Open RELAY: \$\{opts\.appUrl\}\/app/);
  });

  it("mute and DND are honoured for message pushes (they bypass the page)", () => {
    const sw = read("..", "client", "public", "sw.js");
    expect(sw).toMatch(/async function suppressed\(d\)/);
    expect(sw).toMatch(/relay-msg-\(\\d\+\)/); // parses the conversation id off the tag
    expect(sw).toMatch(/if \(prefs\.dnd\) return true;/);
    /* REWRITTEN v2.105.20 to the PROPERTY. These two froze literal text — the exact
       `Number(m[1])` expression and the exact catch-return object — so both broke
       when v2.105.20 factored the tag parse into `convOf(d)` and added a third
       pref, while neither said anything about the rule. The rules are: mute is
       decided by the conversation the TAG names, and an unreadable pref store
       yields a fully permissive default (nothing muted, DND off), i.e. it fails
       OPEN and shows the notification. */
    expect(sw).toMatch(/prefs\.muted\.indexOf\(c\) !== -1/);
    expect(sw).toMatch(/function convOf\(d\)/);
    const fallbacks = sw.match(/return \{\s*dnd: false,\s*muted: \[\],[^}]*\};/g) || [];
    expect(fallbacks.length).toBeGreaterThanOrEqual(2); // the no-entry path and the catch
    for (const f of fallbacks) expect(f).not.toMatch(/dnd: true/);
    // REWRITTEN in v2.99.81. This pinned the exact line
    //   if (!isMessage && d.kind !== "missed-call" && d.kind !== "voicemail") return false;
    // whose stated intent was only "a call is never suppressed by a mute" — but the
    // line did much more than that: it returned BEFORE the prefs were read, so
    // every kind outside its list was silently DND-EXEMPT. `contact-online` buzzed
    // the phone with Do Not Disturb on, while the same alert delivered in-page
    // honoured it, so the two paths disagreed about the user's own setting. A
    // list-of-covered-kinds also exempts any FUTURE kind by default.
    //
    // The two properties, asserted directly instead:
    //   (a) a ring is exempt from DND — explicitly, not as a side effect of a list;
    //   (b) DND is reached for everything else, i.e. nothing short-circuits past it;
    //   (c) MUTE stays message-only.
    expect(sw).toMatch(/if \(d\.kind === "incoming-call"\) return false;/);
    const body = sw.slice(sw.indexOf("async function suppressed(d)"));
    const dndAt = body.indexOf("if (prefs.dnd) return true;");
    const muteAt = body.indexOf('if (d.kind !== "message") return false;');
    expect(dndAt, "the DND check exists").toBeGreaterThan(0);
    expect(muteAt, "the message-only mute narrowing exists").toBeGreaterThan(0);
    // DND is evaluated BEFORE the kind is narrowed, so it applies to every kind.
    expect(dndAt).toBeLessThan(muteAt);
    // …and the only early return ahead of the prefs read is the ring exemption.
    const beforePrefs = body.slice(0, body.indexOf("const prefs = await alertPrefs();"));
    expect((beforePrefs.match(/return false;/g) ?? []).length).toBe(1);
    // The page mirrors both settings wherever either can change.
    const prefs = read("..", "client", "src", "app", "swPrefs.ts");
    expect(prefs).toMatch(/caches\.open\(CACHE\)/);
    for (const f of ["mutedThreads.ts", "dnd.ts", "pushClient.ts"]) {
      expect(read("..", "client", "src", "app", f), `${f} syncs`).toMatch(/syncAlertPrefsToSw\(\)/);
    }
  });

  it("the dev-server deny list is complete (it REPLACES vite's defaults)", () => {
    // Handing vite the config path made the file's fs.deny actually apply — and
    // mergeWithDefaults ASSIGNS arrays, so `**/.*` alone replaced vite's four
    // defaults. picomatch only matches a dotted LAST segment, so `.git/config`
    // and `key.pem` fell through: this repo's .git/config holds credentials.
    const cfg = read("..", "vite.config.ts");
    expect(cfg).toMatch(/deny: \["\*\*\/\.\*", "\*\*\/\.git\/\*\*", "\*\.\{crt,pem\}"\]/);
  });

  it("vite.config.ts is still typechecked (the static import used to pull it in)", () => {
    const tsconfig = read("..", "tsconfig.json");
    expect(tsconfig).toMatch(/"vite\.config\.ts"/);
  });
});
