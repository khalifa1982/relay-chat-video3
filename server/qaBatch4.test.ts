import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * v2.99.26 — heavy-QA sweep fixes, batch 4 (storage-media).
 *   H5 (HIGH): updateProfile ran the keyInOwnerNamespace ownership gate ONLY for
 *              a RELATIVE `/manus-storage/…` avatarUrl, but isIdentityAvatarKey
 *              matches the key as a SUFFIX — so an ABSOLUTE
 *              `https://host/manus-storage/<victim-key>` avatarUrl slipped past
 *              the gate and laundered another user's private key (served to
 *              anyone via the avatar-rescue path). Now the key after the LAST
 *              `/manus-storage/` is validated, covering both shapes.
 *   M10 (MED): the unauthenticated `/manus-storage/*` proxy had no rate limit and
 *              each request could trigger an identities full-scan (avatar rescue)
 *              — an easy anon DB-CPU DoS. Now per-IP token-bucketed before any DB
 *              work (honors RELAY_RATELIMIT_OFF).
 */
const ROUTERS = readFileSync(join(__dirname, "v2routers.ts"), "utf8");
const PROXY = readFileSync(join(__dirname, "_core", "storageProxy.ts"), "utf8");

describe("v2.99.26 QA H5 — avatar ownership gate covers absolute /manus-storage/ URLs", () => {
  it("validates the key after the LAST /manus-storage/ (relative AND absolute)", () => {
    const seg = ROUTERS.slice(ROUTERS.indexOf("avatar-laundering, F2 + QA H5"), ROUTERS.indexOf("avatar-laundering, F2 + QA H5") + 1700);
    expect(seg).toMatch(/lastIndexOf\(marker\)/);
    expect(seg).toMatch(/keyInOwnerNamespace\(key, me\.id/);
    // the old relative-only `startsWith("/manus-storage/")` gate is gone
    expect(seg).not.toMatch(/startsWith\("\/manus-storage\/"\)/);
  });
});

describe("v2.99.26 QA M10 — the media proxy is rate-limited before DB work", () => {
  it("has a per-IP limiter that runs before the key lookup and honors RELAY_RATELIMIT_OFF", () => {
    expect(PROXY).toMatch(/const storageIpLimiter = createRateLimiter\(/);
    // v2.99.57 hoisted the IP and the env read so the new in-flight ceiling can
    // share them (`const clientIp = clientIpOf(req)` / `const limitsOff = …`).
    // Pin the PROPERTIES — the kill switch is honoured and the bucket is keyed on
    // the resolved client IP — not the exact inlined expressions.
    expect(PROXY).toMatch(/process\.env\.RELAY_RATELIMIT_OFF === "1"/);
    expect(PROXY).toMatch(/const clientIp = clientIpOf\(req\);/);
    expect(PROXY).toMatch(/storageIpLimiter\.allow\(clientIp, Date\.now\(\)\)/);
    expect(PROXY).toMatch(/if \(!limitsOff && !storageIpLimiter\.allow\(/);
    // the 429 guard precedes the sanitize/authorize (DB) work
    const guardAt = PROXY.indexOf("!storageIpLimiter.allow");
    const keyAt = PROXY.indexOf("sanitizeS3Key(rawKey)");
    expect(guardAt).toBeGreaterThan(0);
    expect(guardAt).toBeLessThan(keyAt);
  });
});
