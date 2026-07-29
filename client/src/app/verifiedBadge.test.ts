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

/**
 * v2.99.6 (owner spec) — the single verified-only badge is superseded by the
 * THREE-TIER RoleBadge: blue ✓ Guest, green ✓ Registered, yellow ✓ Admin,
 * each with the tier name in very small type right under the mark (first
 * letter capital). Every primary identity surface renders it for EVERY user.
 */
describe("RoleBadge — three account tiers with captions", () => {
  const src = read("client/src/app/VerifiedBadge.tsx");
  it("defines the three tiers with the owner's colors + capitalized captions", () => {
    expect(src).toMatch(/guest: \{ color: "#4c9bff", label: "Guest"/);
    expect(src).toMatch(/registered: \{ color: "#22c55e", label: "Registered"/);
    expect(src).toMatch(/admin: \{ color: "#eab308", label: "Admin"/);
  });
  it("renders the caption under the mark in very small type (scaled to badge size)", () => {
    expect(src).toMatch(/flex-col items-center/);
    expect(src).toMatch(/Math\.max\(7, Math\.round\(size \* 0\.52\)\)/);
  });
  it("roleFromFlags: role wins; null = no badge (party lines); old payloads fall back to verified", () => {
    expect(src).toMatch(/if \(role === "guest" \|\| role === "registered" \|\| role === "admin"\) return role;/);
    expect(src).toMatch(/if \(role === null\) return null;/);
    expect(src).toMatch(/return verified \? "registered" : "guest";/);
  });
});

describe("role badge is wired into every primary identity surface", () => {
  const sites: Array<[string, RegExp]> = [
    // AppShell's badge is the DESKTOP SIDEBAR account link. v2.105.19 removed the
    // second copy that sat in the top bar's avatar-menu header, so this now names one
    // site rather than two — and the count is asserted below, or removing the sidebar's
    // too would leave this passing on nothing.
    ["client/src/app/AppShell.tsx", /<RoleBadge role=\{roleFromFlags\(me\.role, me\.verified\)\}/],
    // RESTORED v2.105.19: v2.103.1 dropped this entry when it stripped the Profile
    // hero, which was the wrong surface for the owner's ask (see profileHub.test.ts).
    ["client/src/pages/app/Profile.tsx", /<RoleBadge role=\{roleFromFlags\(me\.role, me\.verified\)\}/],
    ["client/src/pages/app/Contacts.tsx", /<RoleBadge role=\{roleFromFlags\(c\.role, c\.verified\)\}/],
    // v2.99.37: the redesigned thread row computes the tier first, then renders a
    // caption-less mark beside the name (a stacked caption clipped a row before).
    // The fixed 6500-char window went stale when v2.102.0 added the group-avatar
    // branch between the two anchors — the recurring fixed-slice fragility. Both
    // halves are asserted independently instead, which is what the test is about:
    // the tier comes from the payload with a verified fallback, and it is RENDERED.
    ["client/src/pages/app/Messages.tsx", /const tier = isDm \? roleFromFlags\(t\.peerRole, t\.peerVerified\) : null;/],
    ["client/src/pages/app/Messages.tsx", /<RoleBadge role=\{tier\} size=\{16\} caption=\{false\}/],
    // v2.99.36: the Dialer preview computes the tier first (`tier`) and renders a
    // CAPTION-LESS mark with the tier word inline, because the stacked caption
    // overflowed the one-line row and collided with the keypad.
    ["client/src/pages/app/Dialer.tsx", /const tier = roleFromFlags\(previewIdentity\.role, previewIdentity\.verified\);[\s\S]{0,1600}<RoleBadge role=\{tier\} size=\{13\} caption=\{false\} \/>/],
    ["client/src/app/PeerOverlays.tsx", /<RoleBadge role=\{roleFromFlags\(p\.role, p\.verified\)\}/],
  ];
  for (const [file, re] of sites) {
    it(`${file.split("/").pop()} renders the RoleBadge from the payload role (verified fallback)`, () => {
      const src = read(file);
      expect(src).toMatch(/RoleBadge/);
      expect(src).toMatch(re);
    });
  }
  it("the incoming-call ring card tints its badge by tier + shows the tiny tier caption", () => {
    const client = read("client/src/lib/relayClient.ts");
    expect(client).toMatch(/guest: \["#4c9bff", "Guest"\], registered: \["#22c55e", "Registered"\], admin: \["#eab308", "Admin"\]/);
    const assets = read("client/src/lib/relayAssets.ts");
    expect(assets).toMatch(/id="ringRoleTxt"/);
    expect(assets).toMatch(/\.ring-role-txt\{font-style:normal;font-size:7\.5px/);
  });
  it("the server emits role on whoami / directory.lookup / contacts.list / messages.threads", () => {
    const routers = read("server/v2routers.ts");
    expect(routers).toMatch(/getRolesByIdentityIds\(\[ctx\.identity\.id\]\)/); // whoami
    expect(routers).toMatch(/role: \(\(await getRolesByIdentityIds\(\[id\.id\]\)\)\.get\(id\.id\)/); // lookup
    // v2.99.28 (M14): an unresolved (non-RELAY) saved number now emits role null
    // (no badge) instead of a false "guest"; a real identity still defaults guest.
    expect(routers).toMatch(/role: \(ident != null \? \(rolesById\.get\(ident\) \?\? "guest"\) : null\) as IdentityRole \| null/); // contacts
    expect(routers).toMatch(/peerRole: \(rolesById\.get\(b\.otherIdentityId\) \?\? "guest"\)/); // threads
    const db = read("server/v2db.ts");
    // admin = owning user's users.role; registered = verified; guest otherwise.
    expect(db).toMatch(/r\.userRole === "admin" \? "admin" : r\.verified === true \? "registered" : "guest"/);
  });
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
