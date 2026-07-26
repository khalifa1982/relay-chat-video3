/**
 * v2.99.61 — advertise EVERY TURN relay, one per availability zone.
 *
 * The fleet is now symmetric: each zone runs its own coturn (13.232.119.83 in
 * ap-south-1a, 13.204.23.58 in ap-south-1b). Until this change the server only
 * ever told clients about ONE of them, so a zone loss took the relay path with
 * it — the one layer of the HA story the infrastructure could not fix on its
 * own, because the relay list is minted server-side per registration.
 *
 * `TURN_HOSTS` is the list form; `TURN_HOST` stays the single-relay spelling.
 * All relays share one minted credential: coturn in `use-auth-secret` mode
 * validates the HMAC against its own static-auth-secret, so relays configured
 * with the same secret accept the same username/credential pair.
 *
 * Verified in a real browser before shipping: an 11-entry ICE list (3 STUN + 4
 * URLs × 2 relays) is accepted by RTCPeerConnection and survives
 * getConfiguration() intact — nothing is silently truncated.
 */
import { describe, it, expect, afterEach } from "vitest";
import { iceServers } from "./relay";

// Every TURN var the function reads must be listed here, or a value leaks
// between tests and the assertions stop meaning what they say.
const KEYS = ["TURN_SECRET", "TURN_HOST", "TURN_HOSTS", "TURN_TCP_HOST", "TURN_TLS",
  "TURN_PORT", "TURN_TCP_ALT_PORT", "TURN_TLS_PORT", "TURN_TTL"] as const;
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
const turnUrls = () => iceServers("123456").filter((s) => /^turns?:/.test(s.urls)).map((s) => s.urls);

describe("multi-relay TURN (v2.99.61)", () => {
  it("advertises every host in TURN_HOSTS, each with all transports", () => {
    setEnv({ TURN_SECRET: "s", TURN_HOSTS: "10.0.0.1,10.0.0.2", TURN_TLS: "1" });
    const urls = turnUrls();
    for (const h of ["10.0.0.1", "10.0.0.2"]) {
      expect(urls).toContain(`turn:${h}:3478?transport=udp`);
      expect(urls).toContain(`turn:${h}:443?transport=tcp`);
      expect(urls).toContain(`turn:${h}:3478?transport=tcp`);
      expect(urls).toContain(`turns:${h}:5349?transport=tcp`);
    }
    expect(urls).toHaveLength(8);
  });

  it("a single TURN_HOST is byte-identical to the pre-change output", () => {
    // The opt-in must be the ONLY thing that changes behaviour, so an existing
    // deployment that never sets TURN_HOSTS keeps exactly the old list.
    setEnv({ TURN_SECRET: "s", TURN_HOST: "1.1.1.1", TURN_TLS: "1" });
    expect(turnUrls()).toEqual([
      "turn:1.1.1.1:3478?transport=udp",
      "turn:1.1.1.1:443?transport=tcp",
      "turn:1.1.1.1:3478?transport=tcp",
      "turns:1.1.1.1:5349?transport=tcp",
    ]);
  });

  it("TURN_HOSTS wins over TURN_HOST when both are set", () => {
    setEnv({ TURN_SECRET: "s", TURN_HOST: "old.example", TURN_HOSTS: "a.example,b.example" });
    const urls = turnUrls().join(" ");
    expect(urls).toContain("a.example");
    expect(urls).toContain("b.example");
    expect(urls).not.toContain("old.example");
  });

  it("every relay gets the SAME credential (coturn use-auth-secret shares the HMAC)", () => {
    setEnv({ TURN_SECRET: "s", TURN_HOSTS: "10.0.0.1,10.0.0.2" });
    const pairs = new Set(
      iceServers("123456").filter((s) => s.username).map((s) => `${s.username}|${s.credential}`),
    );
    expect(pairs.size).toBe(1);
  });

  it("TURN_TCP_HOST still applies to a single relay (the v2.92 two-LB case)", () => {
    setEnv({ TURN_SECRET: "s", TURN_HOST: "1.1.1.1", TURN_TCP_HOST: "2.2.2.2" });
    const urls = turnUrls();
    expect(urls).toContain("turn:1.1.1.1:3478?transport=udp"); // UDP keeps the UDP IP
    expect(urls).toContain("turn:2.2.2.2:443?transport=tcp"); // TCP uses the TCP IP
  });

  it("TURN_TCP_HOST is IGNORED with several relays — each uses its own address", () => {
    // A single global TCP override cannot be right for every relay; honouring it
    // would point all of their TCP candidates at ONE zone, quietly recreating
    // the single point of failure this change exists to remove.
    setEnv({ TURN_SECRET: "s", TURN_HOSTS: "1.1.1.1,3.3.3.3", TURN_TCP_HOST: "2.2.2.2" });
    const urls = turnUrls();
    expect(urls.join(" ")).not.toContain("2.2.2.2");
    expect(urls).toContain("turn:1.1.1.1:443?transport=tcp");
    expect(urls).toContain("turn:3.3.3.3:443?transport=tcp");
  });

  it("tolerates whitespace, trailing separators and duplicates", () => {
    setEnv({ TURN_SECRET: "s", TURN_HOSTS: " 10.0.0.1 , 10.0.0.2 ,, 10.0.0.1 " });
    const hosts = turnUrls().map((u) => u.split(":")[1]);
    expect(new Set(hosts)).toEqual(new Set(["10.0.0.1", "10.0.0.2"]));
    // the repeat is dropped: re-gathering the same relay costs time for nothing
    expect(turnUrls()).toHaveLength(6); // 2 hosts × 3 (no TLS configured)
  });

  it("no TURN secret still falls back to the public relay (unchanged)", () => {
    setEnv({ TURN_HOSTS: "10.0.0.1,10.0.0.2" }); // hosts but no secret
    expect(turnUrls().join(" ")).toContain("openrelay.metered.ca");
  });
});

describe("TURN_TCP_ALT_PORT=off — make room for TLS on 443 (v2.99.65)", () => {
  it("suppresses ONLY the plaintext alt-port candidate", () => {
    setEnv({ TURN_SECRET: "s", TURN_HOSTS: "a.example", TURN_TCP_ALT_PORT: "off" });
    const urls = turnUrls();
    expect(urls).toEqual([
      "turn:a.example:3478?transport=udp",
      "turn:a.example:3478?transport=tcp",
    ]);
  });
  it("lets TLS take 443 without a plaintext listener fighting it for the port", () => {
    setEnv({ TURN_SECRET: "s", TURN_HOSTS: "a.example", TURN_TCP_ALT_PORT: "off", TURN_TLS: "1", TURN_TLS_PORT: "443" });
    const urls = turnUrls();
    expect(urls).toContain("turns:a.example:443?transport=tcp");
    // the plaintext form on the same port must NOT also be advertised
    expect(urls).not.toContain("turn:a.example:443?transport=tcp");
  });
  it("accepts the usual spellings of off, and an unset value still means 443", () => {
    for (const v of ["off", "none", "0", "false", "OFF", " off "]) {
      setEnv({ TURN_SECRET: "s", TURN_HOSTS: "a.example", TURN_TCP_ALT_PORT: v });
      expect(turnUrls().join(" "), v).not.toContain(":443");
    }
    setEnv({ TURN_SECRET: "s", TURN_HOSTS: "a.example" });
    expect(turnUrls()).toContain("turn:a.example:443?transport=tcp");
  });
});
