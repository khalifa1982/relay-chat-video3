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
  it("v2.92 R3: ZERO Manus-OAuth call sites anywhere in client/src (owner decision)", () => {
    // The owner removed the Manus OAuth sign-in from the UI entirely — the
    // native AuthPanel is the ONLY sign-in. This walks every non-test source
    // file under client/src and asserts the portal-URL builder and its env var
    // are gone (the server's /api/oauth/callback deliberately remains, but no
    // UI path can start the flow). If this fails, someone re-introduced an
    // OAuth sign-in affordance — see todo.md v2.92.0 before doing that.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.(tsx?|css|json)$/.test(e.name)) continue;
        if (/\.test\.(tsx?)$/.test(e.name)) continue; // tests may cite the old names
        const src = fs.readFileSync(p, "utf8");
        if (/getLoginUrl|VITE_OAUTH_PORTAL_URL/.test(src)) offenders.push(p);
      }
    };
    walk(path.join(ROOT, "client/src"));
    expect(offenders).toEqual([]);
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
