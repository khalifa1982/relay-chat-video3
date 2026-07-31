/* ──────────────────────────────────────────────────────────────────────────
 * v2.105.22 — the admin panel says which media stack the fleet is on.
 *
 * Owner, mid-diagnosis: make sure the media details are visible in the system.
 * `/api/health` reports the transport as a bare boolean; this screen is admin-gated,
 * so it can also enumerate the RELAYS, which is the half an operator has to act on.
 *
 * IT LOST A ROW IN v2.106.53 rather than gaining one: it used to name the hosted
 * SFU's project host, because "the credentials are set" is not the same claim as
 * "pointed at the right project" — and that account is gone, so there is no project
 * to name and no key to report.
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
    const read1 = PROC.indexOf("iceServers(");
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

  it("reads no media-server credential at all — there is no longer one to read", () => {
    /* v2.106.53: the hosted SFU is retired, so this reports the transport as a
       literal and touches nothing secret on that side. The pin stays as a SWEEP
       rather than being deleted, because the dangerous regression is a NEW
       credential being surfaced here — this endpoint's whole risk is that a
       config screen is one careless line from printing a secret. */
    expect(code).not.toMatch(/LIVEKIT/);
    expect(code).not.toMatch(/API_SECRET/);
    expect(code).not.toMatch(/apiKey/i);
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

});

describe("what it reports", () => {
  it("which transport every call is on", () => {
    expect(PROC).toMatch(/transport: "mesh" as const/);
    expect(PANEL).toMatch(/transport === "mesh" \? "WebRTC mesh in use"/);
    // It explains its own cost, because that is the number that matters: N−1
    // encoders per phone is the biggest lever on call CPU and latency, and it is
    // also why the cap is 6.
    expect(PANEL).toMatch(/N−1 encoders/);
  });

  it("the transport row is not drawn as a fault", () => {
    /* It renders on EVERY load, so an `ok={false}` there would make the card read
       as a permanent problem and teach an operator to ignore it. The honest cost
       goes in the detail line instead. */
    const row = PANEL.slice(PANEL.indexOf("<ul className=\"text-xs\">"));
    const first = row.slice(0, row.indexOf("<Row", row.indexOf("<Row") + 4));
    expect(first).toMatch(/\bok\b/);
    expect(first).not.toMatch(/ok=\{false\}/);
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

  it("no TURN at all is called out, because it is a real gap and not a neutral zero", () => {
    expect(PANEL).toMatch(/No TURN advertised/);
  });

  it("the relay read is guarded, so one bad value cannot 500 the page", () => {
    expect((PROC.match(/catch/g) || []).length).toBeGreaterThanOrEqual(1);
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
