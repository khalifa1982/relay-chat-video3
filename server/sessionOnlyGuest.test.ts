import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Session-only guests (v2.95, owner spec: guest data is "session-only, wiped on
 * logout/close"). BOTH halves of the guest-survival pair are now session-scoped:
 *   - the guest cookie is a SESSION cookie (guestCookieOptions adds no maxAge)
 *   - the device id lives in sessionStorage (client/src/lib/deviceId.ts)
 * so a browser close mints a fresh guest, while within a session the number
 * stays stable (either half resolves it, surviving reloads + cookie drops).
 * Registered users are unaffected (they resolve via the persistent relay_session).
 */
describe("session-only guest wiring", () => {
  it("the guest cookie is a SESSION cookie (no maxAge/expires)", () => {
    const src = read("server/v2routers.ts");
    // guestCookieOptions returns the base options WITHOUT adding a maxAge.
    expect(src).toMatch(/function guestCookieOptions[\s\S]*?return getSessionCookieOptions\(req\);\s*\}/);
    expect(src).not.toMatch(/maxAge: GUEST_DAYS_MS/);
  });

  it("the device id is sessionStorage-backed (dies on browser close)", () => {
    const src = read("client/src/lib/deviceId.ts");
    expect(src).toMatch(/window\.sessionStorage\.getItem/);
    expect(src).toMatch(/window\.sessionStorage\.setItem/);
    expect(src).not.toMatch(/window\.localStorage\.getItem\(STORAGE_KEY\)/);
  });

  it("guest UI copy no longer promises 30-day persistence", () => {
    for (const p of [
      "client/src/app/AppShell.tsx",
      "client/src/app/OnboardingGate.tsx",
      "client/src/pages/app/Profile.tsx",
    ]) {
      expect(read(p)).not.toMatch(/for 30 days|on this device for 30 days/);
    }
  });
});
