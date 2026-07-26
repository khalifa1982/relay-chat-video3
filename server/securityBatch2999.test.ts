/* ============================================================
   v2.99.81 — the eight-item security batch from the verified backlog audit.

   Every finding here was INDEPENDENTLY RE-CONFIRMED against current source by a
   skeptic defaulting to REFUTED before anything was changed, and two of the
   original claims were corrected in the process:

   - F2 was claimed as "mintOtp never invalidates prior codes". That part is
     harmless — superseding only SHADOWS, so a burned newest row falls back to the
     older un-consumed one, and every mint mails the valid code to the victim's own
     inbox. Making mintOtp invalidate priors would DELETE that fallback and make the
     burn permanent, i.e. strictly worse. The real defect is that `verifyOtp` has no
     per-address budget at all.
   - F3 was claimed to rewrite `displayName`. It rewrites `firstName`/`lastName` —
     `ensureUserIdentity` leaves an existing row's displayName alone.

   The limiter cost and the recipient canonicalisation are tested BEHAVIOURALLY:
   a source pin cannot tell you whether 100 numbers now cost more than one, and
   that arithmetic is the entire fix.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRateLimiter } from "./rateLimit";
import { canonicalRecipient } from "./v2routers";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const ROUTERS = read("server/v2routers.ts");
const V2DB = read("server/v2db.ts");
const INBOUND = read("server/emailInbound.ts");
const SW = read("client/public/sw.js");
const SIGNOUT = read("client/src/app/useSignOut.tsx");

/** Strip comment lines before an "absent" assertion — four releases running, a
 *  not.toMatch matched the comment explaining why the pattern was gone. */
function codeOnly(src: string): string {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

/* ── F1: inbound email replies obeyed no block ─────────────── */

describe("F1 — a blocked person cannot post by replying to a notification email", () => {
  const BRANCH = (() => {
    const start = INBOUND.indexOf("const members = await getConversationParticipantIds(parsed.conversationId);");
    const end = INBOUND.indexOf("res.status(503).json({ ok: false, reason: \"store-failed\" });", start);
    expect(start, "the reply branch exists").toBeGreaterThan(0);
    expect(end, "the slice has an end").toBeGreaterThan(start);
    return INBOUND.slice(start, end);
  })();

  it("checks the block before sending", () => {
    // The reply address carries NO expiry, so an old notification email stays a
    // usable credential forever — and a blocked person can even mint a fresh one by
    // not answering a call, because the missed-call gate checks the other direction.
    const check = BRANCH.indexOf("isNumberBlockedBy(peers[0], ident.number)");
    const send = BRANCH.indexOf("await sendMessage({");
    expect(check, "the block check exists").toBeGreaterThan(0);
    expect(send).toBeGreaterThan(0);
    expect(check, "the block check precedes the send").toBeLessThan(send);
  });

  it("is 1:1 ONLY, matching messages.send exactly", () => {
    // Group semantics deliberately do NOT refuse a send because one member blocked
    // the sender; a fix that diverged here would be a different product decision.
    expect(BRANCH).toMatch(/const peers = members\.filter\(\(p\) => p !== parsed\.identityId\);/);
    expect(BRANCH).toMatch(/if \(peers\.length === 1 && ident\?\.number\)/);
  });

  it("fails OPEN on a lookup error, and answers 200 rather than 503", () => {
    // A bare await would throw into the outer catch, which answers 200 — and the
    // provider does not retry, so a genuine reply would be silently destroyed.
    expect(BRANCH).toMatch(/isNumberBlockedBy\(peers\[0\], ident\.number\)\.catch\(\(\) => false\)/);
    // 503 would make the provider redeliver the same mail forever.
    expect(BRANCH).toMatch(/res\.status\(200\)\.json\(\{ ok: false, reason: "blocked" \}\);/);
  });

  it("does not push the check down into sendMessage", () => {
    // sendMessage's other callers include the offline AUTO-REPLY, which legitimately
    // posts on behalf of somebody the sender may have blocked, plus the support
    // branch and status.reply. Enforcing there would regress all of them.
    const sm = V2DB.slice(V2DB.indexOf("export async function sendMessage("));
    const body = sm.slice(0, sm.indexOf("\nexport async function ", 10));
    expect(body.length).toBeGreaterThan(200);
    expect(codeOnly(body)).not.toMatch(/isNumberBlockedBy/);
  });
});

/* ── F2: verifyOtp had no per-address budget ───────────────── */

describe("F2 — draining somebody's sign-in codes is bounded", () => {
  it("verifyOtp claims a per-address budget BEFORE reading the row", () => {
    const fn = ROUTERS.slice(
      ROUTERS.indexOf("verifyOtp: publicProcedure"),
      ROUTERS.indexOf("resendOtp: publicProcedure")
    );
    expect(fn.length).toBeGreaterThan(500);
    const gate = fn.indexOf("otpVerifyGate(email)");
    const readRow = fn.indexOf("await latestOtp(email)");
    expect(gate).toBeGreaterThan(0);
    expect(readRow).toBeGreaterThan(0);
    expect(gate, "the budget is claimed before the row is read").toBeLessThan(readRow);
  });

  it("does NOT make mintOtp invalidate prior codes — that would be worse", () => {
    // Superseding only SHADOWS: once the newest row is burned, latestOtp falls back
    // to the older un-consumed row, which is live again inside its TTL. Deleting
    // that fallback would make an attacker's burn PERMANENT.
    const authOtp = read("server/authOtp.ts");
    const mint = authOtp.slice(authOtp.indexOf("export async function mintOtp"));
    const body = mint.slice(0, mint.indexOf("\nexport ", 10));
    expect(body.length).toBeGreaterThan(100);
    expect(codeOnly(body)).not.toMatch(/consumedAt/);
    // …and the fallback itself: latestOtp still filters on un-consumed, ordered
    // newest-first, so an older live row is still reachable.
    expect(authOtp).toMatch(/isNull\(emailOtps\.consumedAt\)/);
  });

  it("is sized so a real user correcting a typo is never locked out", () => {
    expect(ROUTERS).toMatch(/const otpVerifyLimiter = createRateLimiter\(\{ capacity: 20, refillPerSec: 20 \/ 600 \}\);/);
  });

  it("honours the global rate-limit kill switch", () => {
    const fn = ROUTERS.slice(ROUTERS.indexOf("function otpVerifyGate("));
    expect(fn.slice(0, 400)).toMatch(/RELAY_RATELIMIT_OFF === "1"/);
  });
});

/* ── F3: register-on-an-existing-address ──────────────────── */

describe("F3 — a register code cannot skip approval or rename you", () => {
  const fn = ROUTERS.slice(
    ROUTERS.indexOf("verifyOtp: publicProcedure"),
    ROUTERS.indexOf("resendOtp: publicProcedure")
  );

  it("approval comes from the server's own view, not a client field", () => {
    expect(fn).toMatch(/const pending = await shouldRequireApproval\(userId\);/);
    expect(codeOnly(fn)).not.toMatch(/wasRegistration/);
  });

  it("captures whether the account existed BEFORE createOtpUser", () => {
    // After createOtpUser a pre-existing account is indistinguishable from a
    // genuine first registration, so the flag has to be taken first.
    const flag = fn.indexOf("const accountExisted = userId != null;");
    const create = fn.indexOf("await createOtpUser(");
    expect(flag).toBeGreaterThan(0);
    expect(create).toBeGreaterThan(0);
    expect(flag).toBeLessThan(create);
  });

  it("only a NEW account takes its name from the OTP row", () => {
    expect(fn).toMatch(/if \(!accountExisted\) \{/);
    expect(fn).toMatch(/await markIdentityVerified\(identity\.id\);/); // the existing-account branch
  });
});

/* ── F4: sign-out left the push subscription bound ─────────── */

describe("F4 — signing out stops the pushes", () => {
  it("unsubscribes BEFORE the session is torn down", () => {
    // push.unsubscribe is identity-scoped, so it needs the caller still to BE that
    // identity — after logout it would be refused.
    const un = SIGNOUT.indexOf("pushUnsubscribeMut.mutateAsync");
    const out = SIGNOUT.indexOf("signOutGuestMut.mutateAsync()");
    expect(un).toBeGreaterThan(0);
    expect(out).toBeGreaterThan(0);
    expect(un, "unsubscribe precedes the server sign-out").toBeLessThan(out);
  });

  it("drops the browser-side subscription too", () => {
    // Otherwise a re-registration revives the same endpoint instead of minting a
    // fresh one.
    expect(SIGNOUT).toMatch(/await sub\.unsubscribe\(\)\.catch\(\(\) => \{\}\)/);
  });

  it("is best-effort — a push failure cannot block signing out", () => {
    expect(SIGNOUT).toMatch(/pushUnsubscribeMut\.mutateAsync\(\{ endpoint: sub\.endpoint \}\)\.catch\(\(\) => \{\}\)/);
  });

  it("still does NOT clear the per-browser push claim", () => {
    // That value identifies the BROWSER PROFILE, not the signed-out identity;
    // clearing it would make the next account's re-bind unprovable (v2.99.49 R1).
    expect(codeOnly(SIGNOUT)).not.toMatch(/relay_push_claim/);
  });
});

/* ── F5: DND was opt-in per kind in the worker ─────────────── */

describe("F5 — Do Not Disturb applies to every kind but a ring", () => {
  const body = SW.slice(SW.indexOf("async function suppressed(d)"));

  it("exempts a ring EXPLICITLY, not as a side effect of a list", () => {
    expect(body).toMatch(/if \(d\.kind === "incoming-call"\) return false;/);
  });

  it("reaches the DND check for every other kind", () => {
    // THE BUG: the old early return listed the covered kinds and ran BEFORE the
    // prefs were read, so contact-online buzzed with DND on — and any future kind
    // was silently exempt too.
    const beforePrefs = body.slice(0, body.indexOf("const prefs = await alertPrefs();"));
    expect((beforePrefs.match(/return false;/g) ?? []).length).toBe(1);
    expect(codeOnly(body)).not.toMatch(/d\.kind !== "missed-call" && d\.kind !== "voicemail"/);
  });

  it("keeps MUTE message-only", () => {
    // A per-conversation mute must not silence a missed call or voicemail from that
    // same person.
    const dnd = body.indexOf("if (prefs.dnd) return true;");
    const narrow = body.indexOf('if (d.kind !== "message") return false;');
    expect(dnd).toBeGreaterThan(0);
    expect(narrow).toBeGreaterThan(dnd);
  });

  it("still fails OPEN", () => {
    expect(SW).toMatch(/return \{ dnd: false, muted: \[\] \};/);
  });
});

/* ── F8: the limiter charges by cost now ───────────────────── */

describe("F8 — a batch endpoint costs more than one token", () => {
  it("cost defaults to 1, so every existing call site is unchanged", () => {
    // This limiter backs the directory gate, the OTP gates, the status gate, the
    // mint gate, the upload buckets, the storage proxy and the signaling flood
    // guard. A mandatory cost would change all of them at once.
    const rl = createRateLimiter({ capacity: 3, refillPerSec: 0 });
    expect(rl.allow("k", 0)).toBe(true);
    expect(rl.allow("k", 0)).toBe(true);
    expect(rl.allow("k", 0)).toBe(true);
    expect(rl.allow("k", 0)).toBe(false);
  });

  it("a costly call really does spend more", () => {
    const rl = createRateLimiter({ capacity: 10, refillPerSec: 0 });
    expect(rl.allow("k", 0, 10)).toBe(true); // spends the whole bucket
    expect(rl.allow("k", 0)).toBe(false);
  });

  it("clamps a nonsense cost instead of misbehaving", () => {
    // Below 1 would let unlimited calls through; above capacity could never succeed
    // even on a full bucket, which reads as a permanently broken endpoint.
    const zero = createRateLimiter({ capacity: 2, refillPerSec: 0 });
    expect(zero.allow("k", 0, 0)).toBe(true);
    expect(zero.allow("k", 0, 0)).toBe(true);
    expect(zero.allow("k", 0, 0)).toBe(false); // 0 was clamped up to 1
    const huge = createRateLimiter({ capacity: 2, refillPerSec: 0 });
    expect(huge.allow("k", 0, 9999)).toBe(true); // clamped down to capacity
    expect(huge.allow("k", 0)).toBe(false);
  });

  it("presenceMany is charged by SIZE, before the dedupe", () => {
    // Charging after the Set dedupe would let an attacker pad with repeats for the
    // same price as distinct probes.
    const seg = ROUTERS.slice(
      ROUTERS.indexOf("presenceMany: publicProcedure"),
      ROUTERS.indexOf("watchOnline: publicProcedure")
    );
    expect(seg.length).toBeGreaterThan(200);
    const gate = seg.indexOf("directoryGate(ctx, Math.ceil(input.numbers.length / 10))");
    const dedupe = seg.indexOf("new Set(input.numbers)");
    expect(gate).toBeGreaterThan(0);
    expect(dedupe).toBeGreaterThan(gate);
  });

  it("History's real 100-number poll stays inside the budget", () => {
    // The naive fix — cost = n — would refuse History's legitimate 100-number
    // presence poll outright (100 > the 120 bucket after any prior call), throttling
    // real users' presence LEDs. Sub-linear pricing is what makes this safe.
    const rl = createRateLimiter({ capacity: 120, refillPerSec: 1 });
    // Two polls per minute at 10 tokens each, for ten minutes.
    let ok = true;
    for (let min = 0; min < 10; min++) {
      for (const at of [0, 30_000]) {
        if (!rl.allow("ip", min * 60_000 + at, Math.ceil(100 / 10))) ok = false;
      }
    }
    expect(ok, "20 consecutive 100-number polls all pass").toBe(true);
  });

  it("the cap stays at 100 — the client relies on it", () => {
    expect(ROUTERS).toMatch(/numbers: z\.array\(NumberSchema\)\.max\(100\)/);
  });
});

/* ── F10: +alias bypassed the per-inbox cooldown ───────────── */

describe("F10 — an alias is the same INBOX for throttling", () => {
  it("strips a +tag from the local part", () => {
    expect(canonicalRecipient("victim+1@example.com")).toBe("victim@example.com");
    expect(canonicalRecipient("victim+a+b@example.com")).toBe("victim@example.com");
    expect(canonicalRecipient("  VICTIM+X@Example.COM  ")).toBe("victim@example.com");
    expect(canonicalRecipient("victim@example.com")).toBe("victim@example.com");
  });

  it("does NOT strip dots — that is Gmail-specific", () => {
    // Applying dot-insensitivity globally would merge genuinely distinct addresses
    // at other providers and refuse a legitimate signup.
    expect(canonicalRecipient("first.last@example.com")).toBe("first.last@example.com");
    // THE CASE THAT ACTUALLY EXERCISES THE STRIPPER. A local part with no "+"
    // returns early, so the plain-dot case above cannot detect a dot-stripping
    // regression at all — caught by a mutation run that stayed green.
    expect(canonicalRecipient("first.last+tag@example.com")).toBe("first.last@example.com");
    expect(canonicalRecipient("a.b.c+x@example.com")).toBe("a.b.c@example.com");
  });

  it("leaves malformed input alone rather than inventing a shared bucket", () => {
    // "+tag@x.com" is not a valid address; collapsing it to "@x.com" would put every
    // such address in one bucket.
    expect(canonicalRecipient("+tag@example.com")).toBe("+tag@example.com");
    expect(canonicalRecipient("nodomain")).toBe("nodomain");
    expect(canonicalRecipient("")).toBe("");
  });

  it("keeps the exact-string cooldown as well as the per-inbox one", () => {
    // One shared bucket would let an attacker deny the legitimate owner of an alias
    // their own code.
    const fn = ROUTERS.slice(ROUTERS.indexOf("async function cooldownOk("));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body.length).toBeGreaterThan(100);
    // The read AND the comparison that uses it. Pinning only the read is what a
    // mutation run caught: deleting the comparison left `const last = …` in place
    // and the assertion still passed, so it proved nothing about the cooldown.
    expect(body).toMatch(/const last = await lastOtpAt\(email\);/);
    expect(body).toMatch(/if \(last && Date\.now\(\) - last < OTP_RESEND_COOLDOWN_MS\) return false;/);
    expect(body).toMatch(/otpRecipientLimiter\.allow\(canonicalRecipient\(email\), Date\.now\(\)\)/);
  });

  it("does NOT touch normalizeEmail, which is the identity key", () => {
    // Merging aliases there would make victim+work@ and victim@ resolve to ONE
    // account, breaking the exact-match resolution findUserByEmailAny depends on
    // and the one-email-one-row invariant M35 exists to hold.
    const ac = read("server/authCrypto.ts");
    expect(ac).toMatch(/export function normalizeEmail\(email: string\): string \{\s*\n\s*return String\(email \|\| ""\)\.trim\(\)\.toLowerCase\(\);/);
  });
});

/* ── F11: the renumber read its key outside the transaction ── */

describe("F11 — a concurrent renumber cannot strand everyone's contact rows", () => {
  const FN = (() => {
    const start = V2DB.indexOf("export async function regenerateIdentityNumber");
    const end = V2DB.indexOf("\nexport ", start + 10);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const s = V2DB.slice(start, end);
    expect(s.length).toBeGreaterThan(1000);
    return s;
  })();

  it("re-reads the old number under a ROW LOCK inside the transaction", () => {
    // Two concurrent renumbers both captured the same pre-flight oldNumber; the
    // loser's read view forms after the winner commits, so it propagated against a
    // number that no longer existed and stranded every saver's contact row on a
    // number nobody holds — permanently, since the ledger is monotonic, and it also
    // SHEDS a block, because isNumberBlockedBy keys on contacts.number.
    expect(FN).toMatch(/\.from\(identities\)\s*\n\s*\.where\(eq\(identities\.id, identityId\)\)\s*\n\s*\.for\("update"\);/);
    expect(FN).toMatch(/oldNumber = cur\.number;/);
  });

  it("the lock is taken BEFORE the identity is written", () => {
    const lock = FN.indexOf('.for("update")');
    const write = FN.indexOf(".update(identities)\n      .set({ number: newNumber })") >= 0
      ? FN.indexOf(".update(identities)")
      : FN.indexOf("tx.update(identities)");
    expect(lock).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(lock);
  });

  it("a racer that already landed us on the number is a NO-OP", () => {
    // Propagating with oldNumber === newNumber would delete rows it should keep.
    expect(FN).toMatch(/if \(oldNumber === newNumber\) return;/);
  });

  it("the re-read is a SELECT, keeping exactly ONE writer of identities.number", () => {
    // That single-writer property is what stops a parallel implementation from
    // skipping propagation, and it is pinned elsewhere too.
    const writes = V2DB.match(/\.update\(identities\)\s*\n?\s*\.set\(\{ number:/g) ?? [];
    expect(writes.length).toBe(1);
  });

  it("a vanished identity is reported as not-found, not as a fault", () => {
    expect(FN).toMatch(/throw new Error\("identity-gone"\);/);
    expect(V2DB).toMatch(/if \(msg === "identity-gone"\) return \{ ok: false, reason: "not-found" \};/);
  });
});
