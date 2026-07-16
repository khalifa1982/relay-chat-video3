import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.68 — the verified "blue badge" must render everywhere a user's identity is
 * shown. jsdom isn't configured, so (per the repo convention) these are static
 * source guards that each render site still imports + gates on the verified flag,
 * so the badge can't be silently dropped from a screen in a refactor.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("VerifiedBadge component", () => {
  it("exists and renders a lucide BadgeCheck with a Verified label", () => {
    const src = read("client/src/app/VerifiedBadge.tsx");
    expect(src).toMatch(/BadgeCheck/);
    expect(src).toMatch(/aria-label="Verified"/);
  });
});

describe("badge is wired into every primary identity surface", () => {
  const sites: Array<[string, RegExp]> = [
    ["client/src/app/AppShell.tsx", /me\.verified && <VerifiedBadge/],
    ["client/src/pages/app/Profile.tsx", /me\.verified &&[\s\S]*?VerifiedBadge/],
    ["client/src/pages/app/Contacts.tsx", /c\.verified && <VerifiedBadge/],
    ["client/src/pages/app/Messages.tsx", /peerVerified && <VerifiedBadge/],
    ["client/src/pages/app/Dialer.tsx", /previewIdentity\.verified && <VerifiedBadge/],
  ];
  for (const [file, re] of sites) {
    it(`${file.split("/").pop()} gates a VerifiedBadge on the verified flag`, () => {
      const src = read(file);
      expect(src).toMatch(/VerifiedBadge/);
      expect(src).toMatch(re);
    });
  }
});

describe("passwordless auth — no third-party sign-in buttons remain", () => {
  it("OnboardingGate no longer imports or links getLoginUrl (OAuth UI removed)", () => {
    const src = read("client/src/app/OnboardingGate.tsx");
    expect(src).not.toMatch(/getLoginUrl/);
    expect(src).toMatch(/Continue with email/);
    expect(src).toMatch(/AuthPanel/);
  });
  it("AuthPanel is the passwordless email→code flow (no password field)", () => {
    const src = read("client/src/app/AuthPanel.tsx");
    expect(src).toMatch(/otpAuth\.requestOtp/);
    expect(src).toMatch(/otpAuth\.verifyOtp/);
    // v2.87: masked 4-digit PIN inputs exist (type="password" hides digits),
    // but there is still NO password AUTHENTICATION — no password autofill
    // hooks, no password procedure. The PIN is a login shortcut with a
    // 3-wrong-tries-then-lock rule, unlocked by the email code.
    expect(src).not.toMatch(/autoComplete="current-password"/);
    expect(src).not.toMatch(/otpAuth\.(login|register)Password/);
    expect(src).toMatch(/otpAuth\.loginWithPin/);
    expect(src).toMatch(/otpAuth\.loginProbe/);
  });
});
