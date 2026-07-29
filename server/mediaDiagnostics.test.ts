/* ──────────────────────────────────────────────────────────────────────────
 * v2.105.22 — the admin panel says which media stack the fleet is on.
 *
 * Owner, mid-diagnosis: *"make sure livekit details is already in your system"*.
 * `/api/health` already answers WHETHER LiveKit is configured (v2.105.20) as a bare
 * boolean, but it cannot say WHICH project — and "the credentials are set" is not the
 * same claim as "they are the right ones". Until now the only way to find out was to
 * open a call and read `livekitUrl` out of the `registered` frame in devtools.
 *
 * THE WHOLE POINT OF THESE TESTS IS THE SECOND HALF: a screen that reports config is
 * one small mistake away from reporting a CREDENTIAL. So the assertions below are
 * mostly about what this procedure may never return, and they are written on stripped
 * code so a comment mentioning a variable cannot satisfy — or falsely fail — them.
 * ────────────────────────────────────────────────────────────────────────── */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "./testing/codeOnly";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const ROUTERS = read("server/v2routers.ts");
const PANEL = read("client/src/pages/app/Admin.tsx");

/** The procedure's own body, bounded by the next procedure so no assertion can run
 *  past it — the unbounded-slice trap this repo has hit repeatedly. */
const PROC = (() => {
  const at = ROUTERS.indexOf("mediaDiagnostics: publicProcedure");
  expect(at, "found the procedure").toBeGreaterThan(-1);
  const end = ROUTERS.indexOf("pushDiagnostics: publicProcedure", at);
  expect(end, "bounded by the next procedure").toBeGreaterThan(at);
  return ROUTERS.slice(at, end);
})();

describe("it is admin-gated, before anything is read", () => {
  it("requires admin as its FIRST act", () => {
    // Every admin procedure re-derives admin from the `users` row rather than trusting
    // the cached whoami role, which has been through a browser (v2.99.76).
    expect(PROC).toMatch(/await requireAdmin\(ctx\);/);
    const gate = PROC.indexOf("requireAdmin");
    const read1 = PROC.indexOf("livekitConfig()");
    expect(gate).toBeGreaterThan(-1);
    expect(read1).toBeGreaterThan(gate);
  });

  it("the panel itself renders nothing for a non-admin", () => {
    // Belt and braces: the server is the gate, but a page that renders fleet config
    // and only then 403s has already put it on screen.
    expect(PANEL).toMatch(/if \(!amIAdmin\.data\?\.admin\)/);
    const gate = PANEL.indexOf("if (!amIAdmin.data?.admin)");
    const mount = PANEL.indexOf("<MediaCheck />");
    expect(mount).toBeGreaterThan(gate);
  });
});

describe("it can NEVER return a credential — the load-bearing half", () => {
  const code = codeOnly(PROC);

  it("never reads the LiveKit API SECRET at all", () => {
    // The secret is the one value that would let a reader mint join tokens for the
    // project. It is not reported, not compared, not touched.
    expect(code).not.toMatch(/LIVEKIT_API_SECRET/);
  });

  it("reports the API key as a BOOLEAN, never its value", () => {
    expect(code).toMatch(/apiKeySet: !!process\.env\.LIVEKIT_API_KEY/);
    // …and nothing else does anything with it. `!!x` is the only permitted use.
    const uses = code.match(/LIVEKIT_API_KEY/g) || [];
    expect(uses.length).toBe(1);
  });

  it("reports the TURN secret as a boolean too", () => {
    expect(code).toMatch(/secretSet: !!process\.env\.TURN_SECRET/);
    expect((code.match(/TURN_SECRET/g) || []).length).toBe(1);
  });

  it("strips the minted username/credential out of the relay list", () => {
    /* `iceServers()` returns LIVE short-lived TURN credentials — echoing them back
       would hand an admin screen a working relay credential for no reason. Only the
       `urls` field is ever read. */
    expect(code).toMatch(/\.urls\b/);
    expect(code).not.toMatch(/\.credential\b/);
    expect(code).not.toMatch(/\.username\b/);
  });

  it("returns the HOST only — no scheme, path or query", () => {
    // `new URL(...).host`, not a slice: a URL with a port or a path would otherwise
    // be mis-reported as a hostname, and a malformed value must yield null rather
    // than a confident wrong answer.
    expect(code).toMatch(/new URL\(lk\.url\)\.host \|\| null/);
    expect(code).toMatch(/livekitHost = null;/); // the catch
    expect(code).not.toMatch(/host: lk\.url/);
  });
});

describe("what it reports", () => {
  it("whether the SFU is in use at all — false meaning the mesh", () => {
    expect(PROC).toMatch(/enabled: lk\.enabled/);
    expect(PANEL).toMatch(/lk\.enabled \? "LiveKit SFU in use" : "WebRTC mesh in use"/);
    // The mesh case explains its own cost, because that is the number that matters:
    // N−1 encoders per phone is the biggest lever on call CPU and latency.
    expect(PANEL).toMatch(/N−1 encoders/);
  });

  it("the host, which is the entire reason this exists", () => {
    // "Configured" is not the same claim as "pointed at the right project", and only
    // the host distinguishes them.
    expect(PROC).toMatch(/host: livekitHost/);
    expect(PANEL).toMatch(/lk\.host \?\? "host unreadable"/);
  });

  it("the relay list as clients are actually TOLD it, not a re-derivation", () => {
    /* Read straight out of `iceServers()`, so this cannot drift from what calls use —
       the v2.99.71 lesson, where a health checker and the server disagreed about which
       endpoints existed and the checker reported two permanent false failures. */
    expect(PROC).toMatch(/for \(const s of iceServers\(/);
    expect(PROC).not.toMatch(/process\.env\.TURN_HOSTS/);
    expect(PROC).not.toMatch(/process\.env\.TURN_HOST\b/);
  });

  it("counts each transport separately, since they fail independently", () => {
    for (const k of ["stun", "turnUdp", "turnTcp", "turnsTls"]) {
      expect(PROC, k).toContain(k + ":");
    }
  });
});

describe("it degrades rather than misleads", () => {
  it("a failed read is reported as a FAILURE, not as 'not configured'", () => {
    // Those need different next steps; conflating them sends somebody to the wrong
    // file. The same distinction the push doctor draws between dbOk and an empty list.
    expect(PANEL).toMatch(/Couldn&apos;t read the media config\./);
    expect(PANEL).toMatch(/if \(!q\.data\)/);
  });

  it("an unreadable URL yields null, and the panel says so rather than showing blank", () => {
    expect(PANEL).toMatch(/host unreadable/);
  });

  it("no TURN at all is called out, because it is a real gap and not a neutral zero", () => {
    expect(PANEL).toMatch(/No TURN advertised/);
  });

  it("every read is individually guarded, so one bad value cannot 500 the page", () => {
    expect((PROC.match(/catch/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("it writes nothing", () => {
  it("is a query, and reaches no user data", () => {
    expect(PROC).toMatch(/mediaDiagnostics: publicProcedure\.query\(/);
    const code = codeOnly(PROC);
    for (const forbidden of ["getDb", "identities", "users", ".update(", ".insert(", ".delete("]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("takes no input, so there is nothing to probe with", () => {
    // A parameterless query cannot be aimed at anybody — it describes the fleet.
    expect(PROC).not.toMatch(/\.input\(/);
  });
});

describe("it is a FLEET readout, not a per-person one", () => {
  it("renders once, above the per-person search", () => {
    const mount = PANEL.indexOf("<MediaCheck />");
    /* ANCHORED ON THE ATTRIBUTE, not the phrase. My first cut used the bare string
       "Find a person", which also appears in this file's own HEADER DOC COMMENT at
       line 7 — so it resolved to char 201 and the ordering assertion failed on
       perfectly correct code. The prose-anchor trap, for the fourth time in this
       session's releases. */
    const search = PANEL.indexOf('aria-label="Find a person"');
    expect(mount).toBeGreaterThan(-1);
    expect(search).toBeGreaterThan(-1);
    expect(search).toBeGreaterThan(mount);
    expect((PANEL.match(/<MediaCheck \/>/g) || []).length).toBe(1);
  });

  it("points at the in-call readout for the live numbers", () => {
    // The two halves are complementary: this says what the fleet is CONFIGURED with,
    // the v2.105.21 chip says what a call is actually DOING.
    expect(PANEL.replace(/\s+/g, " ")).toMatch(/tap <span[^>]*>Stats<\/span> in the control bar/);
  });
});
