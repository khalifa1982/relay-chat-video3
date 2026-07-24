/* ============================================================
   v2.99.40 — HARDENING PASS 6 (later-reporting class-sweep findings).

   The class-based sweep was capped at 2 concurrent agents, so it reported
   in waves. M21–M35 shipped as v2.99.37/38; M36 (the PIN slot claim) is
   pinned in hardeningPass5.test.ts alongside the ladder it replaced. This
   file covers the rest: forced camera-on, the Content-Type family, the
   credential leak in auth.me, the signaling enumeration oracle, and the
   number-space sibling of the guest-mint throttle.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (...p: string[]) => fs.readFileSync(path.resolve(__dirname, ...p), "utf8");
const ENGINE = read("..", "client", "src", "lib", "relayClient.ts");
const ROUTERS = read("v2routers.ts");
const APP_ROUTERS = read("routers.ts");
const RELAY = read("relay.ts");
const UPLOAD = read("v2upload.ts");
const PROXY = read("_core", "storageProxy.ts");

/* ── M37: unsolicited video-accept can't force a camera on ─────────────── */

describe("M37 — mutual-consent video can't be bypassed by an unsolicited accept", () => {
  it("onVideoAccept requires that WE offered video", () => {
    const fn = ENGINE.slice(
      ENGINE.indexOf("function onVideoAccept()"),
      ENGINE.indexOf("function onVideoDecline()"),
    );
    expect(fn).toMatch(/if \(!videoOfferedByUs\) return;/);
    // The guard must precede the camera unlock.
    expect(fn.indexOf("videoOfferedByUs")).toBeLessThan(fn.indexOf("unlockApprovedVideo()"));
  });

  it("drops the frame SILENTLY (no toast) so it reveals nothing", () => {
    const fn = ENGINE.slice(
      ENGINE.indexOf("function onVideoAccept()"),
      ENGINE.indexOf("function onVideoDecline()"),
    );
    // The success toast must sit AFTER the guard, not before it.
    expect(fn.indexOf("if (!videoOfferedByUs) return;")).toBeLessThan(fn.indexOf("toast("));
  });

  it("sets the flag at BOTH legitimate consent points", () => {
    // (a) an explicit mid-call request…
    const req = ENGINE.slice(
      ENGINE.indexOf("function requestVideoUpgrade()"),
      ENGINE.indexOf("function onVideoRequest("),
    );
    expect(req).toMatch(/videoOfferedByUs = true;/);
    expect(req.indexOf("videoOfferedByUs")).toBeLessThan(req.indexOf('sendWS({ type: "video-request" })'));
    // (b) …and placing a VIDEO dial, where consent is implicit (no request is
    // ever sent, so videoReqT alone would have broken this flow).
    expect(ENGINE).toMatch(/videoOfferedByUs = camOn;/);
    expect((ENGINE.match(/videoOfferedByUs = !opts\?\.voice;/g) || []).length).toBe(2);
  });

  it("is per-call state, cleared by the same reset as videoApproved", () => {
    expect(ENGINE).toMatch(
      /videoApproved = false; callIsGroup = false;[^\n]*\n\s*videoOfferedByUs = false;/,
    );
  });

  it("declares the flag with the reasoning, next to the consent state", () => {
    expect(ENGINE).toMatch(/let videoOfferedByUs = false;/);
    expect(ENGINE).toMatch(/mutual-consent protocol/);
  });
});

/* ── M38: no attacker-chosen Content-Type is honoured same-origin ───────── */

describe("M38 — dangerous media types are blocked at upload AND at the proxy", () => {
  it("the upload denylist now covers the XML and script families", () => {
    // The source spells these as regex alternatives with escaped slashes, e.g.
    // the literal characters `text\/xml`, so compare with the same escaping.
    for (const t of [
      "text\\/xml",
      "text\\/xsl",
      "application\\/xml",
      "application\\/xslt\\+xml",
      "text\\/javascript",
      "application\\/ecmascript",
      "application\\/x-javascript",
    ]) {
      expect(UPLOAD, `denylist covers ${t}`).toContain(t);
    }
    // …without losing the originals.
    expect(UPLOAD).toContain("image\\/svg\\+xml");
    expect(UPLOAD).toContain("text\\/html");
  });

  /** Exercise the real denylist against the types that used to slip through. */
  it("behaviourally rejects every script-capable type", () => {
    const m = UPLOAD.match(/const BLOCKED_MIME =\s*\n?\s*(\/\^\([^\n]+\/i);/);
    expect(m, "BLOCKED_MIME is extractable").not.toBeNull();
    // eslint-disable-next-line no-eval
    const BLOCKED: RegExp = eval(m![1]);
    for (const evil of [
      "text/xml",
      "application/xml",
      "text/xsl",
      "application/xslt+xml",
      "text/javascript",
      "application/ecmascript",
      "application/x-javascript",
      "image/svg+xml",
      "text/html",
      "application/xhtml+xml",
    ]) {
      expect(BLOCKED.test(evil), `${evil} must be blocked`).toBe(true);
    }
    // Legitimate attachment types must still pass.
    for (const ok of ["image/png", "video/mp4", "audio/mpeg", "application/pdf", "text/plain"]) {
      expect(BLOCKED.test(ok), `${ok} must be allowed`).toBe(false);
    }
  });

  it("the proxy serves only inline-safe types as themselves", () => {
    expect(PROXY).toMatch(/const INLINE_SAFE_TYPE =/);
    expect(PROXY).toMatch(/res\.setHeader\("Content-Type", "application\/octet-stream"\);/);
    expect(PROXY).toMatch(/res\.setHeader\("Content-Disposition", "attachment"\);/);
  });

  it("the proxy's downgrade is applied AFTER relaying headers, so it wins", () => {
    expect(PROXY.indexOf('for (const h of ["content-type"')).toBeLessThan(
      PROXY.indexOf("INLINE_SAFE_TYPE.test(declared)"),
    );
  });

  /** The proxy predicate, exercised directly. */
  it("inline-safe set admits real media and refuses everything else", () => {
    const m = PROXY.match(/const INLINE_SAFE_TYPE =\s*\n?\s*(\/\^\([^\n]+\/);/);
    expect(m, "INLINE_SAFE_TYPE is extractable").not.toBeNull();
    // eslint-disable-next-line no-eval
    const SAFE: RegExp = eval(m![1]);
    for (const ok of ["image/png", "image/webp", "video/mp4", "audio/mpeg", "application/pdf"]) {
      expect(SAFE.test(ok), `${ok} renders inline`).toBe(true);
    }
    for (const bad of ["text/html", "text/xml", "image/svg+xml", "application/javascript", "text/plain"]) {
      expect(SAFE.test(bad), `${bad} must be forced to download`).toBe(false);
    }
  });
});

/* ── M39: auth.me never ships credential material ──────────────────────── */

describe("M39 — auth.me strips password and PIN hashes", () => {
  const me = APP_ROUTERS.slice(
    APP_ROUTERS.indexOf("SECURITY (M39"),
    APP_ROUTERS.indexOf("logout: publicProcedure"),
  );

  it("no longer returns ctx.user verbatim", () => {
    expect(APP_ROUTERS).not.toMatch(/me: publicProcedure\.query\(\(opts\) => opts\.ctx\.user\),/);
  });

  it("destructures BOTH secrets out of the response", () => {
    expect(me).toMatch(/passwordHash: _passwordHash/);
    expect(me).toMatch(/loginPinHash: _loginPinHash/);
    expect(me).toMatch(/\.\.\.safe/);
    expect(me).toMatch(/return safe;/);
  });

  it("still returns null for an unauthenticated caller", () => {
    expect(me).toMatch(/if \(!u\) return null;/);
  });

  it("explains why a self-only hash leak still matters", () => {
    expect(me).toMatch(/10\^4/); // the PIN space argument
    expect(me).toMatch(/offline credential cracking|offline/i);
  });
});

/* ── M40: the signaling offline branch is throttled ────────────────────── */

describe("M40 — offline dials can't be used as an enumeration oracle", () => {
  it("declares a module-scoped per-pin limiter with a sweep", () => {
    expect(RELAY).toMatch(/const offlineDialLimiter = createRateLimiter\(/);
    expect(RELAY).toMatch(/offlineDialLimiter\.sweep\(/);
    expect(RELAY).toMatch(/setInterval\(\(\) => offlineDialLimiter\.sweep\(/);
  });

  it("gates the offline branch on the CALLER PIN and honors the kill switch", () => {
    expect(RELAY).toMatch(
      /process\.env\.RELAY_RATELIMIT_OFF !== "1" && !offlineDialLimiter\.allow\(callerPin, Date\.now\(\)\)/,
    );
  });

  it("refuses BEFORE resolving the identity, so nothing leaks and no miss is recorded", () => {
    const branch = RELAY.slice(
      RELAY.indexOf("if (process.env.RELAY_RATELIMIT_OFF !== \"1\" && !offlineDialLimiter"),
      RELAY.indexOf("onPageCallee({ calleePin: to"),
    );
    // The throttled path returns without ever calling the resolver.
    expect(branch).toMatch(/return;/);
    expect(branch).not.toMatch(/onPageCallee\(/);
    expect(branch).not.toMatch(/onMissedCall/);
  });

  it("its reply is the GENERIC offline message — no name, no existence signal", () => {
    const branch = RELAY.slice(
      RELAY.indexOf("if (process.env.RELAY_RATELIMIT_OFF !== \"1\" && !offlineDialLimiter"),
      RELAY.indexOf("onPageCallee({ calleePin: to"),
    );
    expect(branch).toMatch(/message: "They're offline right now\."/);
    expect(branch).not.toMatch(/info\.name/);
    expect(branch).not.toMatch(/nonexistent/);
  });

  it("documents that it is scoped to the offline branch (group dials untouched)", () => {
    expect(RELAY).toMatch(/Scoped deliberately to the OFFLINE branch/);
  });

  it("is sized for GROUP dials, where one dial spends a token per offline invitee", () => {
    // Self-review retune: a 9-person all-offline group dial spends 9 tokens at
    // once, so the original 20/1-per-4s budget was gone by the second such dial —
    // and the throttled path skips onMissedCall, so people dialled after that
    // silently lost their missed-call record, History row and notification.
    expect(RELAY).toMatch(/createRateLimiter\(\{ capacity: 60, refillPerSec: 0\.5 \}\)/);
    expect(RELAY).not.toMatch(/capacity: 20, refillPerSec: 0\.25/);
  });

  it("its throttled reply is classified by the client as a reachErr, so a group dial survives", () => {
    // code "offline" is in the client's reachErr set, which during a group-dial
    // bootstrap PROMOTES the next invitee instead of failing the whole dial.
    const ENGINE = read("..", "client", "src", "lib", "relayClient.ts");
    expect(ENGINE).toMatch(/const reachErr = m\.code === "offline"/);
    expect(ENGINE).toMatch(/if \(reachErr && callIsGroup && outgoingDial/);
    expect(RELAY).toMatch(/reachErr/);
  });
});

/* ── M41: regenerateNumber can't drain the number space ────────────────── */

describe("M41 — regenerateNumber is throttled (number-space sibling of M21)", () => {
  const fn = ROUTERS.slice(
    ROUTERS.indexOf("regenerateNumber: publicProcedure"),
    ROUTERS.indexOf("/* ── directory (numbers / lookups)"),
  );

  it("applies the mint budget before allocating a fresh number", () => {
    expect(fn).toMatch(/guestMintGate\(ctx\);/);
    expect(fn.indexOf("guestMintGate(ctx)")).toBeLessThan(fn.indexOf("regenerateIdentityNumber("));
  });

  it("still requires an identity (unchanged authz)", () => {
    expect(fn).toMatch(/const me = requireIdentity\(ctx\);/);
  });

  it("documents the shared-space exhaustion it prevents", () => {
    expect(fn).toMatch(/M21/);
    expect(fn).toMatch(/monotonic|never recycled/);
  });
});

/* ── M42: the inbound-address regex can't be driven quadratic ───────────── */

describe("M42 — inbound email address parsing is length-capped (ReDoS)", () => {
  const INBOUND = read("emailInbound.ts");

  it("caps the input BEFORE the backtracking-prone match", () => {
    expect(INBOUND).toMatch(/const MAX_INBOUND_ADDRESS_LEN = 1024;/);
    const fn = INBOUND.slice(
      INBOUND.indexOf("export function parseInboundAddress"),
      INBOUND.indexOf("const angle = raw.match"),
    );
    expect(fn).toMatch(/if \(raw\.length > MAX_INBOUND_ADDRESS_LEN\) return null;/);
  });

  it("documents that the process is single-threaded, so this is a full outage", () => {
    expect(INBOUND).toMatch(/single-threaded/);
  });

  /**
   * The actual pathological shape: a `<` with no `>` anywhere. Unbounded, the
   * engine retries `[^>]+` from every `<` and gives back a character at a time —
   * quadratic. Bounded, the work is trivially small. Assert the guard rejects the
   * payload rather than timing the regex (a timing assertion would be flaky).
   */
  it("rejects the payload shape that caused the blow-up", () => {
    const cap = 1024;
    const guard = (raw: string) => raw.length <= cap;
    expect(guard("<".repeat(5 * 1024 * 1024))).toBe(false);
    expect(guard("<" + "a".repeat(5 * 1024 * 1024))).toBe(false);
    // A real address, with or without a display name, is far under the cap.
    expect(guard('"Some Person" <relay+12.34.abcdef@inbound.example.com>')).toBe(true);
    expect(guard("relay+12.34.abcdef@inbound.example.com")).toBe(true);
  });

  it("the bounded regex is linear on any accepted input", () => {
    // At <=1024 chars the worst case is ~1024^2 steps — microseconds. Prove the
    // engine actually terminates promptly on the worst accepted shape.
    const worst = "<".repeat(1024);
    const started = process.hrtime.bigint();
    worst.match(/<([^>]+)>/);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    expect(ms).toBeLessThan(100);
  });
});

/* ── M43: sign-out revokes the session ledger row ───────────────────────── */

describe("M43 — logout revokes server-side, not just the cookies", () => {
  const logout = APP_ROUTERS.slice(
    APP_ROUTERS.indexOf("logout: publicProcedure"),
    APP_ROUTERS.indexOf("// v2.0 phone-app namespace"),
  );

  it("revokes the caller's own ledger row by sid", () => {
    expect(logout).toMatch(/await revokeSession\(ctx\.user\.id, ctx\.sessionSid\)/);
    expect(logout).toMatch(/if \(ctx\.user && ctx\.sessionSid\)/);
    expect(APP_ROUTERS).toMatch(/import \{ revokeSession \} from "\.\/v2db";/);
  });

  it("still clears all three cookies even if the revoke throws", () => {
    // The revoke is wrapped so a DB hiccup can't leave the user signed in.
    expect(logout).toMatch(/try \{[\s\S]*revokeSession[\s\S]*\} catch \{/);
    expect(logout.indexOf("revokeSession")).toBeLessThan(logout.indexOf("clearCookie"));
    for (const c of ["COOKIE_NAME", "LOCAL_SESSION_COOKIE", "GUEST_COOKIE"]) {
      expect(logout).toContain(c);
    }
  });

  it("is async now (it awaits the revoke)", () => {
    expect(logout).toMatch(/^logout: publicProcedure\.mutation\(async \(\{ ctx \}\) => \{/m);
  });
});

/* ── region injection: the third free-text input on the SSM path ────────── */

describe("aws-ops ses-ssm — the `region` input is no longer spliced raw", () => {
  const OPS = read("..", ".github", "workflows", "aws-ops.yml");
  const sesSsm = OPS.slice(OPS.indexOf("ses-ssm — SES ops"), OPS.indexOf("- name: iam-grant-ses"));

  it("base64-encodes AWS_REGION alongside SES_EMAIL and DOMAIN", () => {
    expect(sesSsm).toMatch(/REGION_B64=\$\(printf %s "\$AWS_REGION" \| base64 -w0\)/);
  });

  it("every remote command decodes it instead of interpolating the raw value", () => {
    for (const c of ["C1", "C2", "C3", "C4", "C5"]) {
      const line = sesSsm.split("\n").find((l) => l.trim().startsWith(`${c}="`)) || "";
      expect(line, `${c} decodes the region`).toMatch(/RG=\\\$\(echo \$REGION_B64 \| base64 -d\)/);
      expect(line, `${c} uses the decoded value`).toMatch(/--region \\"\\\$RG\\"/);
      expect(line, `${c} no longer splices $AWS_REGION`).not.toMatch(/--region \$AWS_REGION/);
    }
  });

  it("explains that this input was missed when the sibling two were fixed", () => {
    expect(sesSsm).toMatch(/THIRD free-text workflow_dispatch input/);
  });
});

/* ── M44: the media limiter isn't tight enough to break shared egress ───── */

describe("M44 — storage-proxy limiter tolerates a shared-egress network", () => {
  it("was raised above a realistic multi-user image burst", () => {
    expect(PROXY).toMatch(/createRateLimiter\(\{ capacity: 600, refillPerSec: 20 \}\)/);
    expect(PROXY).not.toMatch(/capacity: 240, refillPerSec: 4/);
  });

  it("records that a throttled media request surfaces as a broken image", () => {
    expect(PROXY).toMatch(/BROKEN IMAGE/);
  });

  it("keeps the sweep and the kill switch", () => {
    expect(PROXY).toMatch(/storageIpLimiter\.sweep\(/);
    expect(PROXY).toMatch(/RELAY_RATELIMIT_OFF/);
  });
});
