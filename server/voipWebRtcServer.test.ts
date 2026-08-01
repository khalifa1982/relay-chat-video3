/**
 * THE `WebRtcServer` CONVERSION — pinned on source, and honest that it is.
 *
 * `index.js` (the agent) cannot be imported here: importing it starts mediasoup workers, binds a port and
 * connects to Redis. So these are source assertions, which this repo generally treats as the
 * weaker kind — and they are chosen for the cases where a plausible edit produces a node that
 * looks completely healthy and serves a call nobody can join. Every one of the four API facts
 * below came off mediasoup's own declarations rather than the docs (`voip-node/README.md`
 * records them), because three planning decisions had rested on prose.
 *
 * WHAT THIS DELIBERATELY DOES NOT CLAIM: that a transport is created, that a candidate is
 * gathered, or that media flows. Nobody has joined a room on a real node from this sandbox.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const AGENT = readFileSync(resolve(__dirname, "..", "voip-node", "index.js"), "utf8");

/** Comment-stripped, because the file EXPLAINS in prose what it must not do — and this repo
 *  has matched its own prose fifteen times. Both forms, since the explanations are blocks. */
const code = AGENT.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The body of one function, brace-matched — never a fixed character slice, which goes stale
 *  the moment anything is inserted (the v2.99.78 fragility, hit six times). */
function fnBody(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  expect(at, `${name} must exist`).toBeGreaterThan(-1);
  let i = src.indexOf("{", at);
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error(`unbalanced body for ${name}`);
}

describe("a transport is created on the server, and the two ways are mutually exclusive", () => {
  const TRANSPORT = fnBody(code, "createWebRtcTransport");

  it("passes `webRtcServer`, and NEITHER of the per-transport listen forms", () => {
    /* The option type is `Either<Either<listenInfos, listenIps>, webRtcServer>`, so these are
       exclusive rather than merely redundant: passing a listen form alongside the server is a
       type error, and passing the DEPRECATED `listenIps` instead silently takes a port per
       transport out of the worker's range rather than sharing one pair per core. */
    expect(TRANSPORT).toMatch(/webRtcServer:\s*room\.webRtcServer/);
    expect(TRANSPORT, "listenIps is deprecated AND exclusive with the server").not.toMatch(
      /listenIps/,
    );
    expect(TRANSPORT, "listenInfos likewise").not.toMatch(/listenInfos/);
  });

  it("`enableTcp` is explicit, because that candidate is the UDP-blocked network's only route", () => {
    /* Leaving it to a default is how a node ends up UDP-only with nothing saying so — and the
       people it fails are exactly the ones for whom every other candidate is also unusable. */
    expect(TRANSPORT).toMatch(/enableTcp:\s*true/);
    expect(TRANSPORT).toMatch(/enableUdp:\s*true/);
  });
});

describe("the WebRtcServer is created once per worker, with BOTH protocols", () => {
  const START = fnBody(code, "startWorkers");

  it("is created on the WORKER — `createWebRtcServer` does not exist on a Router", () => {
    expect(START).toMatch(/w\.createWebRtcServer\(/);
  });

  it("declares TWO listenInfos entries, udp AND tcp — one of them ships UDP-only in silence", () => {
    /* `listenInfos` is a LIST. Supplying only the UDP entry produces a node with no TCP
       candidate at all, which is invisible until somebody cannot connect and every other
       reading looks healthy. Counted, so deleting one is caught. */
    const infos = START.match(/protocol:\s*"(udp|tcp)"/g) ?? [];
    expect(infos.sort()).toEqual(['protocol: "tcp"', 'protocol: "udp"']);
  });

  it("uses `announcedAddress`, not the deprecated `announcedIp`", () => {
    const announced = START.match(/announcedAddress:/g) ?? [];
    expect(announced.length, "one per listenInfo").toBe(2);
    expect(START).not.toMatch(/announcedIp/);
  });

  it("LISTENS on the private address and ANNOUNCES the public one, never the reverse", () => {
    /* Reversed, the socket tries to bind an address this box does not hold (the transport fails
       to create) or — worse — announces the private address, so a browser gathers a candidate
       for 10.0.x.x and the call simply never connects with nothing logged. */
    expect(START).toMatch(/ip:\s*self\.privateIp/);
    expect(START).toMatch(/announcedAddress:\s*self\.publicIp/);
    expect(START).not.toMatch(/ip:\s*self\.publicIp/);
  });

  it("the workers' own port range starts ABOVE the ports the servers reserve", () => {
    /* Collision avoided by construction rather than by hoping the ranges do not overlap: a
       worker allocating a port a server is already bound to fails at transport-creation time,
       under load, on one core. */
    expect(START).toMatch(/const workerMinPort = RTC_MIN_PORT \+ n;/);
    expect(START).toMatch(/rtcMinPort:\s*workerMinPort/);
    expect(START, "the servers take the bottom of the range").toMatch(
      /const serverPortBase = RTC_MIN_PORT;/,
    );
    expect(START).toMatch(/serverPortBase \+ i/);
  });
});

describe("the {worker, webRtcServer} pair is carried, because it cannot be derived", () => {
  it("`pickWorker` returns the pair and the room records the server", () => {
    /* `Router` has no `worker` getter — verified against the declarations — so nothing can walk
       from a room's router back to the server its transports must be created on. */
    expect(fnBody(code, "pickWorker")).toMatch(/return w;/);
    expect(code).toMatch(/const slot = pickWorker\(\);/);
    expect(code).toMatch(/slot\.worker\.createRouter\(/);
    expect(code).toMatch(/webRtcServer:\s*slot\.webRtcServer/);
  });

  it("every entry is pushed as a pair, so no consumer can receive a bare Worker", () => {
    expect(code).toMatch(/workers\.push\(\{ worker: w, webRtcServer, port \}\)/);
    expect(code, "a bare push would hand a Worker to code expecting the pair").not.toMatch(
      /workers\.push\(w\)/,
    );
  });

  it("the shutdown closes `slot.worker` — a bare `slot.close()` is not a function", () => {
    /* A REAL BUG THIS CONVERSION INTRODUCED AND THIS CAUGHT: the shutdown loop still read
       `w.close()` after `workers` became a list of pairs, so the close was `undefined` and a
       planned stop would have thrown on its way out. */
    expect(code).toMatch(/for \(const slot of workers\)/);
    expect(code).toMatch(/slot\.worker\.close\(\)/);
  });
});

describe("an address change EXITS rather than carrying on with a stale announcement", () => {
  it("the change path exits, and does not merely update `self`", () => {
    /* THE CONVERSION CHANGED WHAT THIS CASE MEANS. `announcedAddress` is decided when the SERVER
       is created and is immutable — it appears only as a creation option, with no setter anywhere
       in mediasoup's type surface — so a process that keeps running after its address changes
       announces the OLD one for the rest of its life, not for one interval.
       Updating `self` alone would be the worst combination: the heartbeat would report a healthy
       node at the NEW address while every transport it minted pointed at one that no longer
       reaches it, and nothing could detect the difference because this agent is the only source
       of that value. */
    const at = code.indexOf("now.publicIp !== self.publicIp");
    expect(at, "the change must still be detected").toBeGreaterThan(-1);
    const branch = code.slice(at, at + 700);
    expect(branch, "it must not just carry on").toMatch(/process\.exit\(0\)/);
    expect(branch, "and it must leave the registry cleanly first").toMatch(/deregister\(\)/);
    // The exit must come AFTER the deregister, or the app keeps sending rooms to a dead node
    // for a whole TTL for no reason.
    expect(branch.indexOf("deregister()")).toBeLessThan(branch.indexOf("process.exit(0)"));
  });

  it("there is exactly ONE deregister implementation for its two callers", () => {
    /* Two callers now — the signal shutdown and this exit — and two copies of "how does a node
       leave the registry" is how one of them comes to leave a record behind. */
    const defs = code.match(/async function deregister\(/g) ?? [];
    expect(defs.length).toBe(1);
    const calls = code.match(/\bderegister\(\)/g) ?? [];
    expect(calls.length, "defined once, called twice").toBe(3); // 1 declaration + 2 call sites
  });

  it("the re-read interval is the registry TTL, not an arbitrary minute", () => {
    /* The window during which a new room can be created against a stale address. Bounding it to
       the TTL means it can never exceed the one interval the app already reasons in — and
       reading IMDS per transport was rejected because that is a round trip on the call path. */
    expect(code).toMatch(/\}, NODE_TTL_MS\)\.unref\(\)/);
    expect(code, "a hardcoded minute is what this replaced").not.toMatch(/\}, 60_000\)\.unref/);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────
 * THE STATS ENDPOINT MUST NOT HAND OUT PARTICIPANTS' IP ADDRESSES.
 *
 * mediasoup's `WebRtcTransportStat.iceSelectedTuple` is a `TransportTuple`, and `TransportTuple`
 * carries `remoteIp` and `remotePort` — read off the declarations, not the docs. So `stats({roomId})`
 * returning the raw report is a per-room IP-disclosure primitive: every participant's real address,
 * together, to whatever asks. The in-call quality readout is exactly what the coming increments wire
 * to this, and a readout that forwards what it is handed lets one participant locate another.
 *
 * The class is already ruled out in this app: v2.99.20 restricted `avatarUrl` to our own storage
 * because a remote image URL became "a remote-fetch primitive aimed at other users", harvesting IP
 * and User-Agent from a call nobody answered. An SFU stat handing the address over is the same thing
 * with fewer steps.
 *
 * DRIVEN rather than pinned, because the strip is a pure function and whether an address survives it
 * is exactly what a source assertion cannot answer. The function is re-declared here from the source
 * — the agent cannot be imported, since importing it starts mediasoup workers and binds a port — and
 * a companion assertion pins that the real file still contains this exact body, so the copy cannot
 * drift away from the thing it claims to test.
 * ────────────────────────────────────────────────────────────────────────────────────── */
describe("a transport stat never carries an address off the node", () => {
  /** Lifted verbatim from the agent (`voip-node/index.js`); the assertion below proves it is still verbatim. */
  function sanitizeTransportStat(stat: unknown): unknown {
    if (!stat || typeof stat !== "object") return stat;
    const { iceSelectedTuple, ...rest } = stat as Record<string, unknown>;
    if (!iceSelectedTuple || typeof iceSelectedTuple !== "object") return rest;
    return { ...rest, iceSelectedTuple: { protocol: (iceSelectedTuple as Record<string, unknown>).protocol } };
  }

  /** A real mediasoup transport stat, with every field the tuple type declares. */
  const realStat = () => ({
    type: "webrtc-transport",
    transportId: "t-1",
    iceRole: "controlled",
    iceState: "completed",
    dtlsState: "connected",
    bytesReceived: 123456,
    bytesSent: 98765,
    rtpBytesReceived: 120000,
    rtpPacketsReceived: 900,
    iceSelectedTuple: {
      localIp: "10.0.1.192",
      localAddress: "10.0.1.192",
      localPort: 40000,
      remoteIp: "203.0.113.77",
      remotePort: 54321,
      protocol: "udp",
    },
  });

  it("the participant's REMOTE address is gone", () => {
    const out = JSON.stringify(sanitizeTransportStat(realStat()));
    expect(out, "the participant's IP must not survive").not.toContain("203.0.113.77");
    expect(out, "nor their port, which narrows a NAT mapping").not.toContain("54321");
  });

  it("the NODE's own private address is gone too", () => {
    /* Not a participant's secret, but there is no reason to publish the private address or the
       server's port to anything downstream either. */
    const out = JSON.stringify(sanitizeTransportStat(realStat()));
    expect(out).not.toContain("10.0.1.192");
    expect(out).not.toContain("40000");
  });

  it("`protocol` SURVIVES, because that is what a readout actually needs", () => {
    /* It says whether a call fell back to TCP — the one genuinely useful field of the tuple, and
       it identifies nobody. Stripping the whole tuple would take the answer with the address. */
    const out = sanitizeTransportStat(realStat()) as { iceSelectedTuple?: { protocol?: string } };
    expect(out.iceSelectedTuple?.protocol).toBe("udp");
  });

  it("everything the readout reads is untouched", () => {
    const out = sanitizeTransportStat(realStat()) as Record<string, unknown>;
    for (const k of [
      "type",
      "transportId",
      "iceState",
      "dtlsState",
      "bytesReceived",
      "bytesSent",
      "rtpPacketsReceived",
    ]) {
      expect(out[k], `${k} must survive`).toEqual((realStat() as Record<string, unknown>)[k]);
    }
  });

  it("a stat with NO selected tuple is handled, not crashed on", () => {
    /* `iceSelectedTuple` is optional — absent before ICE completes, which is exactly when a
       readout is most likely to poll. */
    const { iceSelectedTuple: _drop, ...noTuple } = realStat();
    expect(() => sanitizeTransportStat(noTuple)).not.toThrow();
    expect(sanitizeTransportStat(noTuple)).toEqual(noTuple);
    for (const junk of [null, undefined, 0, "", "stat", []]) {
      expect(() => sanitizeTransportStat(junk)).not.toThrow();
    }
  });

  it("the handler MAPS the array — getStats() returns one per transport, not one object", () => {
    /* Sanitizing the array itself would strip nothing and leave every address in place, which is
       the shape of a fix that reads as done. */
    const handler = code.slice(code.indexOf("async stats({ roomId })"));
    const body = handler.slice(0, handler.indexOf("\n  },"));
    expect(body).toMatch(/Array\.isArray\(raw\) \? raw\.map\(sanitizeTransportStat\)/);
    expect(body, "and the raw report must never be pushed straight through").not.toMatch(
      /stats: raw[,}]/,
    );
    expect(body).not.toMatch(/stats: await t\.getStats\(\)/);
  });

  it("the copy above is still verbatim from the agent — or it tests nothing", () => {
    /* The one weakness of re-declaring a function in a test is that the original can change
       underneath it. Pinning the real body closes that. */
    expect(code).toMatch(/const \{ iceSelectedTuple, \.\.\.rest \} = stat;/);
    expect(code).toMatch(
      /return \{ \.\.\.rest, iceSelectedTuple: \{ protocol: iceSelectedTuple\.protocol \} \};/,
    );
  });
});

/**
 * v2.106.46 — PRIVATE FOR CONTROL, PUBLIC FOR MEDIA.
 *
 * The owner opened the network path and stated the rule from the infrastructure side: signaling
 * reaches the nodes over their PRIVATE addresses on 4443 (the app fleet's security group to the
 * SFU group), while transports ANNOUNCE the PUBLIC addresses to clients for media. Crossing
 * those is how a node becomes unreachable in one direction while looking perfectly healthy in
 * the other — so both halves are pinned here, in the file that already reads the agent.
 */
describe("the signaling API is private by construction, not by firewall", () => {
  it("binds the node's PRIVATE address, never 0.0.0.0", () => {
    /* Binding every interface WORKS — the security group only permits 4443 from the app
       fleet's group — but it leaves that group as the ONLY thing keeping an HMAC-gated
       internal API off the public internet. Binding the private IP makes the rule structural:
       a group widened to 0.0.0.0/4443 by mistake still cannot reach a listener the kernel is
       not accepting on. */
    const body = fnBody(code, "startApi");
    expect(body).toMatch(/server\.listen\(API_PORT, apiBind\b/);
    expect(body, "0.0.0.0 would put the API on the public interface").not.toMatch(
      /server\.listen\([^)]*"0\.0\.0\.0"/,
    );
    expect(body).toMatch(/const apiBind = self\.privateIp \|\| "127\.0\.0\.1"/);
  });

  it("self is resolved BEFORE the API listens — the ordering is now load-bearing", () => {
    /* It was not before: binding 0.0.0.0 needed nothing from `self`. Reordering these would
       silently bind loopback and the fleet's first signaling call would hang, which is exactly
       the wasted debugging cycle the owner's own network fix was meant to avoid. */
    // The CALL, not the declaration: `indexOf("startApi()")` also matches
    // `function startApi()`, which sits 100 lines earlier — so the first draft of this
    // compared the wrong thing and failed on correct source, which is how it was caught.
    const resolved = code.indexOf("self = await readSelf()");
    const listens = code.indexOf("= startApi()");
    expect(resolved, "readSelf must be assigned to self").toBeGreaterThan(-1);
    expect(listens, "startApi must be CALLED").toBeGreaterThan(-1);
    expect(resolved, "self must be resolved first").toBeLessThan(listens);
  });

  it("failing shut on an unknown address is consistent with the app refusing the node", () => {
    /* With IMDS unreachable the bind falls back to loopback, so the API is unreachable from
       the fleet. That is not a new hazard: such a node also reports an EMPTY publicIp, and
       decodeNode's isIpv4 refuses the record, so the app never selects it. A node that cannot
       learn its own address is already useless. */
    expect(code, "the IMDS fallback must still yield a loopback private address").toMatch(
      /privateIp: process\.env\.PRIVATE_IP \|\| "127\.0\.0\.1"/,
    );
    const reg = readFileSync(resolve(__dirname, "voipRegistry.ts"), "utf8");
    expect(reg, "and the app must refuse a record with no valid public address").toMatch(
      /if \(!isIpv4\(o\.publicIp\) \|\| !isIpv4\(o\.privateIp\)\) return null/,
    );
  });

  it("MEDIA is the other way round: listen private, announce public", () => {
    // The complement of the rule above, and the half that decides whether a client's ICE
    // candidates point anywhere reachable.
    const src = fnBody(code, "startWorkers");
    expect(src).toMatch(/protocol: "udp", ip: self\.privateIp, announcedAddress: self\.publicIp/);
    expect(src).toMatch(/protocol: "tcp", ip: self\.privateIp, announcedAddress: self\.publicIp/);
    // Swapping them would announce an address clients cannot route to while the node looks up.
    expect(src).not.toMatch(/ip: self\.publicIp, announcedAddress: self\.privateIp/);
  });

  it("the app addresses the node over its PRIVATE ip, and only ever there", () => {
    const sig = readFileSync(resolve(__dirname, "mediasoupSignaling.ts"), "utf8");
    expect(sig).toMatch(/return `http:\/\/\$\{node\.privateIp\}:\$\{port\}\//);
    // Reaching for publicIp here is the crossing the owner's rule forbids: it would leave the
    // internal API dependent on a public route that the security group deliberately does not
    // open, and the failure would be a timeout with nothing saying why.
    const fn = sig.slice(sig.indexOf("export function nodeApiUrl"));
    expect(fn.slice(0, fn.indexOf("\n}")), "nodeApiUrl must not use publicIp").not.toMatch(
      /publicIp/,
    );
  });

  it("the 4443 port is ONE value, cross-checked across the two implementations", () => {
    /* Two implementations of one constant in two languages is the class this repo has been
       bitten by repeatedly (v2.99.71's turn checker, v2.105.11's token classifier). Diverge
       here and signaling posts to a port nothing is listening on — a timeout with nothing in
       any log pointing at the cause. The agent is plain .mjs on another machine, so no import
       can unify them; this comparison is the only thing that can. */
    const sig = readFileSync(resolve(__dirname, "mediasoupSignaling.ts"), "utf8");
    const appPort = /export const VOIP_API_PORT = (\d+)/.exec(sig)?.[1];
    const agentPort = /const API_PORT = Number\(process\.env\.VOIP_API_PORT \|\| (\d+)\)/.exec(
      code,
    )?.[1];
    expect(appPort, "the app must declare the port").toBeTruthy();
    expect(agentPort, "the agent must default the port").toBeTruthy();
    expect(agentPort, "the two must agree").toBe(appPort);
    // Both read the same env var name, so an operator override moves both together.
    expect(code).toMatch(/process\.env\.VOIP_API_PORT/);
  });
});
