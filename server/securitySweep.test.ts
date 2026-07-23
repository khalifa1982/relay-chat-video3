import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isAllowedWebPushEndpoint } from "./webPush";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Regression tests for the 2026-07-22 full-platform security sweep (S1–S11).
 * The exported pure validator (S8) is tested behaviorally; the signaling gate
 * (S2) is covered behaviorally in relay.test.ts. The rest touch DB/router code
 * that isn't reachable in the unit env (no MySQL), so — following the repo's
 * precedent (status.test.ts / securityAudit.test.ts) — they pin the
 * security-relevant wiring by reading the source.
 */

// ── S8: Web Push endpoint SSRF allowlist (behavioral — the validator is pure) ─
describe("S8 — isAllowedWebPushEndpoint (blind-SSRF guard on push endpoints)", () => {
  it("allows the known push services over https", () => {
    for (const ok of [
      "https://fcm.googleapis.com/fcm/send/abc123",
      "https://updates.push.services.mozilla.com/wpush/v2/xyz",
      "https://web.push.apple.com/QABC",
      "https://wns2-par02p.notify.windows.com/w/?token=AAA",
      "https://android.googleapis.com/fcm/send/z",
    ]) {
      expect(isAllowedWebPushEndpoint(ok)).toBe(true);
    }
  });
  it("rejects non-https, internal, and arbitrary hosts (SSRF targets)", () => {
    for (const bad of [
      "http://fcm.googleapis.com/fcm/send/abc", // not https
      "https://169.254.169.254/latest/meta-data/", // cloud metadata
      "https://localhost:6379/", // internal service
      "https://10.0.0.5/", // VPC
      "https://evil.example.com/collect", // arbitrary
      "https://fcm.googleapis.com.evil.com/x", // suffix-spoof of an allowed host
      "not-a-url",
      "",
    ]) {
      expect(isAllowedWebPushEndpoint(bad)).toBe(false);
    }
  });
});

// ── S1: PIN lockout is incremented atomically (no lost-update brute-force) ────
describe("S1 — attemptPinLogin increments the lockout counter atomically", () => {
  const src = read("server/authPin.ts");
  it("uses a single conditional UPDATE guarded on the row still being unlocked", () => {
    expect(src).toMatch(/COALESCE\(\$\{users\.loginPinAttempts\}, 0\) \+ 1/);
    expect(src).toMatch(/isNull\(users\.loginPinLockedAt\)/);
    // The verdict is derived from the PERSISTED post-increment value, not the
    // stale caller-passed count.
    expect(src).toMatch(/\.select\(\{ attempts: users\.loginPinAttempts, lockedAt: users\.loginPinLockedAt \}\)/);
  });
});

// ── S3–S5: the enumeration endpoints inherit the F5 directoryGate ─────────────
describe("S3–S5 — directory.presence / watchOnline / calls.logStart are gated", () => {
  const src = read("server/v2routers.ts");
  it("directory.presence calls directoryGate and applies the guest-privacy rule", () => {
    const seg = src.slice(src.indexOf("presence: publicProcedure"), src.indexOf("presenceMany: publicProcedure"));
    expect(seg).toMatch(/directoryGate\(ctx\)/);
    expect(seg).toMatch(/isGuestPresenceHidden/);
  });
  it("watchOnline calls directoryGate", () => {
    const seg = src.slice(src.indexOf("watchOnline: publicProcedure"), src.indexOf("heartbeat: publicProcedure"));
    expect(seg).toMatch(/directoryGate\(ctx\)/);
  });
  it("calls.logStart calls directoryGate (its S5 comment + gate are present)", () => {
    expect(src).toMatch(/SECURITY \(S5\): logStart resolves calleeNumber/);
    // The gate sits in the logStart mutation, just before recordCallStart.
    const seg = src.slice(
      src.indexOf("SECURITY (S5): logStart"),
      src.indexOf("recordCallStart({")
    );
    expect(seg).toMatch(/directoryGate\(ctx\)/);
  });
});

// ── S6: markRead is participant-gated (read-receipt IDOR) ─────────────────────
describe("S6 — markThreadRead requires membership before flipping read state", () => {
  const db = read("server/v2db.ts");
  const routers = read("server/v2routers.ts");
  it("checks conversationParticipants membership inside the transaction", () => {
    const fn = db.slice(db.indexOf("export async function markThreadRead"), db.indexOf("/* ── attachments"));
    expect(fn).toMatch(/from\(conversationParticipants\)/);
    expect(fn).toMatch(/if \(membership\.length === 0\) return;/);
    expect(fn).toMatch(/return isMember;/);
  });
  it("the markRead router only fans out the read SSE when the caller was a member", () => {
    expect(routers).toMatch(/const wasMember = await markThreadRead\(/);
    expect(routers).toMatch(/if \(wasMember\) \{/);
  });
});

// ── S7: upload endpoint is rate-limited per-IP and per-identity ───────────────
describe("S7 — POST /api/v2/upload is rate limited", () => {
  const src = read("server/v2upload.ts");
  it("defines per-IP and per-identity limiters and checks both before storing", () => {
    expect(src).toMatch(/uploadIpLimiter = createRateLimiter/);
    expect(src).toMatch(/uploadIdLimiter = createRateLimiter/);
    expect(src).toMatch(/uploadIpLimiter\.allow\(clientIpOf\(req\)/);
    expect(src).toMatch(/uploadIdLimiter\.allow\(String\(identityId\)/);
  });
});

// ── S9: OTP failure counter is atomic ─────────────────────────────────────────
describe("S9 — recordOtpFailure increments atomically", () => {
  const src = read("server/authOtp.ts");
  it("uses a guarded conditional UPDATE and reads back the persisted count", () => {
    expect(src).toMatch(/COALESCE\(\$\{emailOtps\.attempts\}, 0\) \+ 1/);
    expect(src).toMatch(/isNull\(emailOtps\.consumedAt\)/);
  });
});

// ── S10/S11: signing secrets fail CLOSED in production ────────────────────────
describe("S10/S11 — session + inbound signing secrets fail closed in production", () => {
  it("authLocal.sessionSecret throws in production instead of the public dev constant", () => {
    const src = read("server/authLocal.ts");
    const fn = src.slice(src.indexOf("function sessionSecret"), src.indexOf("function baseUrl"));
    expect(fn).toMatch(/NODE_ENV === "production"/);
    expect(fn).toMatch(/throw new Error/);
  });
  it("emailInbound.inboundSecret throws in production and the route is rate-limited", () => {
    const src = read("server/emailInbound.ts");
    const fn = src.slice(src.indexOf("function inboundSecret"), src.indexOf("export function signInbound"));
    expect(fn).toMatch(/NODE_ENV === "production"/);
    expect(fn).toMatch(/throw new Error/);
    expect(src).toMatch(/inboundIpLimiter = createRateLimiter/);
    expect(src).toMatch(/inboundIpLimiter\.allow\(clientIpOf\(req\)/);
  });
});
