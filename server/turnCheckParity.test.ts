/**
 * The TURN health checker must probe EXACTLY the endpoints the server advertises.
 *
 * These two derivations live in different files and different languages
 * (`scripts/turn-check.mjs` runs as plain node on an app instance; `iceServers()`
 * is TypeScript in the server bundle) and they drifted the first time one of them
 * learned something new: v2.99.65 taught the SERVER that `TURN_TCP_ALT_PORT=off`
 * suppresses the plaintext alt-port candidate — which is what frees port 443 for
 * TLS — and the checker was never told. With `off` set on the fleet it went on
 * probing port `+"off"` = NaN, so it reported a DOWN endpoint that no client is
 * ever offered: a permanent false failure on every relay, and false failures are
 * what hide real ones.
 *
 * A string check of the two files would not catch the next divergence. This
 * compares the ACTUAL OUTPUT of both, over the env matrix that matters.
 */
import { describe, it, expect, afterEach } from "vitest";
// The script exports its derivation and guards its own main body, so importing
// it here does not run a health check.
// @ts-expect-error — plain .mjs with no type declarations, by design: it must run
// under bare `node` on an EC2 instance from the release tar.
import { deriveTurnEndpoints, endpointToUrl } from "../scripts/turn-check.mjs";
import { iceServers } from "./relay";

type Ep = { host: string; port: number; transport: string; scheme: string };

const KEYS = [
  "TURN_SECRET", "TURN_HOST", "TURN_HOSTS", "TURN_TCP_HOST", "TURN_TLS",
  "TURN_PORT", "TURN_TCP_ALT_PORT", "TURN_TLS_PORT", "TURN_TTL",
] as const;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
const setEnv = (e: Partial<Record<(typeof KEYS)[number], string>>) => {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(e)) process.env[k] = v;
};

/** What the SERVER tells clients (TURN/TURNS only — STUN is not ours to check). */
const advertised = () =>
  iceServers("123456")
    .filter((s) => /^turns?:/.test(s.urls))
    .map((s) => s.urls)
    .sort();

/** What the CHECKER would probe, expressed as the same URL strings. */
const probed = () =>
  (deriveTurnEndpoints(process.env).eps as Ep[]).map((e) => endpointToUrl(e)).sort();

describe("turn-check probes exactly what the server advertises", () => {
  const CASES: Array<[string, Partial<Record<(typeof KEYS)[number], string>>]> = [
    ["single relay, defaults", { TURN_SECRET: "s", TURN_HOST: "a.example" }],
    ["single relay + TLS", { TURN_SECRET: "s", TURN_HOST: "a.example", TURN_TLS: "1" }],
    ["two relays + TLS", { TURN_SECRET: "s", TURN_HOSTS: "a.example,b.example", TURN_TLS: "1" }],
    // The live fleet's shape as of v2.99.68: hostnames, TLS on 443, and the
    // plaintext alt-port candidate suppressed so it cannot fight TLS for the port.
    ["LIVE SHAPE — TLS on 443, alt-port off", {
      TURN_SECRET: "s", TURN_HOSTS: "turn.example,turn2.example",
      TURN_TLS: "1", TURN_TLS_PORT: "443", TURN_TCP_ALT_PORT: "off",
    }],
    ["alt-port off without TLS", { TURN_SECRET: "s", TURN_HOSTS: "a.example", TURN_TCP_ALT_PORT: "off" }],
    ["custom ports", {
      TURN_SECRET: "s", TURN_HOSTS: "a.example", TURN_PORT: "3479",
      TURN_TCP_ALT_PORT: "8443", TURN_TLS: "1", TURN_TLS_PORT: "5350",
    }],
    ["duplicate hosts are deduped on both sides", { TURN_SECRET: "s", TURN_HOSTS: "a.example, a.example ,b.example" }],
  ];

  for (const [name, env] of CASES) {
    it(name, () => {
      setEnv(env);
      expect(probed()).toEqual(advertised());
    });
  }

  it("the live shape is TLS-on-443 with NO plaintext candidate on the same port", () => {
    // The whole point of the arrangement: `turns:` on 443 is indistinguishable
    // from HTTPS and survives DPI, and the two cannot share the port — so
    // advertising the plaintext form would point clients at a TLS listener.
    setEnv({
      TURN_SECRET: "s", TURN_HOSTS: "turn.example,turn2.example",
      TURN_TLS: "1", TURN_TLS_PORT: "443", TURN_TCP_ALT_PORT: "off",
    });
    const urls = advertised();
    expect(urls).toContain("turns:turn.example:443?transport=tcp");
    expect(urls).toContain("turns:turn2.example:443?transport=tcp");
    expect(urls).not.toContain("turn:turn.example:443?transport=tcp");
    expect(urls.filter((u) => u.includes(":443")).every((u) => u.startsWith("turns:"))).toBe(true);
    // …and the checker probes 3 per relay, never a NaN port.
    const eps = deriveTurnEndpoints(process.env).eps as Ep[];
    expect(eps).toHaveLength(6);
    expect(eps.every((e) => Number.isInteger(e.port) && e.port > 0)).toBe(true);
  });

  it("no TURN secret ⇒ the checker has nothing to probe (and skips cleanly)", () => {
    setEnv({ TURN_HOSTS: "a.example" });
    const { secret, hosts } = deriveTurnEndpoints(process.env) as { secret: string; hosts: string[] };
    expect(secret).toBe("");
    expect(hosts).toEqual(["a.example"]);
    // The server falls back to the public relay in this case; the checker's own
    // guard is `!secret || !hosts.length`, so it exits 0 rather than probing it.
    expect(advertised().join(" ")).toContain("openrelay.metered.ca");
  });
});
