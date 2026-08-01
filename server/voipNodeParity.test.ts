/**
 * THE NODE AGENT AND THE APP MUST AGREE ABOUT THE RECORD — checked by DRIVING both.
 *
 * The agent is plain `.mjs` run by bare node on a media node; the registry is TypeScript
 * inside the app bundle on a different machine. That is two implementations of one rule, in
 * two languages, and this repo has a recorded production case of exactly that drifting:
 * v2.99.71's `turn-check.mjs` vs `iceServers()`, where the checker probed an endpoint the
 * fleet does not advertise and would have reported two relays permanently DOWN.
 *
 * The fix there was not a string check — no string check catches the NEXT divergence — it
 * was comparing their actual OUTPUT. So this file feeds the agent's real `buildNodeRecord`
 * through the app's real `decodeNode`, plus the constants both sides spell.
 *
 * If this test ever goes red, the agent is publishing something the app will silently
 * refuse, which presents as "the SFU has no nodes" with nothing in any log saying why.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { codeOnly } from "./testing/codeOnly";
import {
  buildNodeRecord,
  NODE_HEARTBEAT_MS as AGENT_HEARTBEAT,
  NODE_INDEX_KEY as AGENT_INDEX,
  NODE_KEY_PREFIX as AGENT_PREFIX,
  NODE_TTL_MS as AGENT_TTL,
  nodeKey as agentNodeKey,
} from "../voip-node/record.mjs";
import {
  decodeNode,
  NODE_HEARTBEAT_MS,
  NODE_INDEX_KEY,
  NODE_KEY_PREFIX,
  NODE_TTL_MS,
  nodeKey,
} from "./voipRegistry";

const NOW = 1_785_000_000_000;
const REAL = {
  instanceId: "i-062022390e558ce74",
  publicIp: "192.0.2.10",
  privateIp: "10.0.1.192",
  az: "ap-south-1a",
  cores: 2,
  routers: 3,
  consumers: 11,
  cpuLoad: 0.34,
  nowMs: NOW,
};

describe("the record the agent publishes is one the app accepts", () => {
  it("a real record round-trips through the app's own validator", () => {
    const rec = buildNodeRecord(REAL);
    const decoded = decodeNode(JSON.stringify(rec));
    expect(decoded, "the app REFUSED the agent's record").not.toBeNull();
    expect(decoded).toEqual({
      instanceId: REAL.instanceId,
      publicIp: REAL.publicIp,
      privateIp: REAL.privateIp,
      az: REAL.az,
      cores: 2,
      routers: 3,
      consumers: 11,
      cpuLoad: 0.34,
      updatedAt: NOW,
      /* THE PARITY THAT MATTERS FOR A NEW FIELD: the agent always publishes `draining` as a
         real boolean and the app always decodes it as one, so the two never disagree about
         what an absent value meant. A field the agent emits and the app drops would silently
         make drain-then-retire a no-op. */
      draining: false,
    });
  });

  it("a DRAINING record round-trips as draining — parity in both states", () => {
    /* FOUND BY MUTATION: asserting only the default (`false`) is satisfied by an agent that
       publishes a hardcoded `false`, which makes retiring a node a silent no-op from the
       agent's end while the app's decoder looks perfectly correct. The parity claim is that
       the two agree in BOTH states, so both states have to be driven.

       This is the exact divergence class this file exists for (v2.99.71): two
       implementations of one rule, in two languages, on two machines, where nothing fails
       when they stop meaning the same thing. */
    const on = decodeNode(JSON.stringify(buildNodeRecord({ ...REAL, draining: true })));
    expect(on?.draining, "the agent said draining and the app must hear it").toBe(true);

    const off = decodeNode(JSON.stringify(buildNodeRecord({ ...REAL, draining: false })));
    expect(off?.draining).toBe(false);

    // And the agent must not invent draining from a value that is not the boolean true.
    for (const junk of ["false", "", 0, null, undefined]) {
      const rec = buildNodeRecord({ ...REAL, draining: junk as never });
      expect(decodeNode(JSON.stringify(rec))?.draining, String(junk)).toBe(false);
    }
  });

  it("both real nodes' records are accepted, as measured by the infrastructure brief", () => {
    for (const n of [
      { ...REAL },
      {
        ...REAL,
        instanceId: "i-0dce71f5056f73ce6",
        publicIp: "198.51.100.20",
        privateIp: "10.0.2.246",
        az: "ap-south-1b",
      },
    ]) {
      expect(decodeNode(JSON.stringify(buildNodeRecord(n))), n.instanceId).not.toBeNull();
    }
  });

  it("a mis-sampled counter cannot take a node OUT of service", () => {
    /* A node absent from the registry costs its entire capacity, so the agent must not be
       able to remove itself by reading a counter badly. Floats, negatives and NaN are
       clamped into a shape the app accepts rather than published as-is and refused. */
    for (const broken of [
      { consumers: -5 },
      { consumers: 2.7 },
      { routers: Number.NaN },
      { cores: 0 },
      { cpuLoad: Number.NaN },
    ]) {
      const rec = buildNodeRecord({ ...REAL, ...broken });
      expect(decodeNode(JSON.stringify(rec)), JSON.stringify(broken)).not.toBeNull();
    }
  });

  it("but a SATURATED load is reported honestly rather than clamped away", () => {
    /* Clamping cpuLoad to the app's ceiling here would hide saturation — reporting the
       truth is the agent's job and deciding what is too hot is the app's. */
    const rec = buildNodeRecord({ ...REAL, cpuLoad: 3.5 });
    expect(rec.cpuLoad).toBe(3.5);
    expect(decodeNode(JSON.stringify(rec))?.cpuLoad).toBe(3.5);
  });

  it("the two sides spell the same keys and the same timings", () => {
    expect(AGENT_PREFIX).toBe(NODE_KEY_PREFIX);
    expect(AGENT_INDEX).toBe(NODE_INDEX_KEY);
    expect(AGENT_TTL).toBe(NODE_TTL_MS);
    expect(AGENT_HEARTBEAT).toBe(NODE_HEARTBEAT_MS);
    expect(agentNodeKey("i-abc")).toBe(nodeKey("i-abc"));
  });
});

describe("the agent's packaging keeps mediasoup out of the app", () => {
  const ROOT = JSON.parse(readFileSync("package.json", "utf8"));
  const AGENT = JSON.parse(readFileSync("voip-node/package.json", "utf8"));

  it("`mediasoup` is NOT a dependency of the app", () => {
    /* THIS IS THE LOAD-BEARING PACKAGING FACT. The app is bundled with
       `esbuild --packages=external` and each app instance runs
       `pnpm install --frozen-lockfile` on EVERY deploy — so a root mediasoup dependency
       would make every app box compile (or fetch) a C++ worker binary it never runs, on
       every release. It belongs only to the agent, which runs on the media nodes. */
    const all = { ...(ROOT.dependencies ?? {}), ...(ROOT.devDependencies ?? {}) };
    expect(Object.keys(all)).not.toContain("mediasoup");
    expect(AGENT.dependencies).toHaveProperty("mediasoup");
  });

  it("the deploy tar does not ship the agent to the app fleet", () => {
    // Different machines, different lifecycle. Shipping it would install nothing (the app
    // never runs `pnpm install` inside it) but would imply it belongs there.
    const wf = readFileSync(".github/workflows/deploy.yml", "utf8");
    const tar = wf.split("\n").find((l) => l.includes("tar -czf relay.tar.gz")) ?? "";
    expect(tar, "the tar line must exist").toContain("relay.tar.gz");
    expect(tar).not.toContain("voip-node");
  });

  it("the record module is importable WITHOUT starting mediasoup", () => {
    /* v2.99.71 recorded this trap too: importing `turn-check.mjs` ran a health check and
       called `process.exit(0)`, killing the test runner. The record shape therefore lives
       apart from `index.js`, which does start workers and listen on a port — and the
       parity test above is only possible because of that split.

       Asserted on CODE, not on the file's text: `record.mjs`'s own header explains why it
       must not `process.exit`, and this assertion matched that sentence on its first run.
       That is the prose-anchor trap, in the very test written to guard against a trap. */
    const rec = codeOnly(readFileSync("voip-node/record.mjs", "utf8"));
    expect(rec).not.toMatch(/from "mediasoup"|require\(["']mediasoup/);
    expect(rec).not.toMatch(/process\.exit/);
    expect(rec).not.toMatch(/createServer|listen\(/);
    // The strip must be doing work rather than hiding a defect: the real file DOES carry
    // that phrase, in prose. If this ever stops being true the guard above went weak.
    expect(readFileSync("voip-node/record.mjs", "utf8")).toMatch(/process\.exit/);
    // …and the agent, which does all of that, is a separate file.
    const agent = codeOnly(readFileSync("voip-node/index.js", "utf8"));
    expect(agent).toMatch(/from "mediasoup"/);
    expect(agent).toMatch(/from "\.\/record\.mjs"/);
  });
});

describe("the media node's dependencies are pinned to what the nodes actually run", () => {
  const PKG = JSON.parse(readFileSync("voip-node/package.json", "utf8")) as {
    dependencies: Record<string, string>;
  };
  const LOCK = readFileSync("voip-node/pnpm-lock.yaml", "utf8");

  it("every dependency is an EXACT version, never a range", () => {
    /* A caret here was already lying. The two live nodes were installed at mediasoup 3.19.3 and
       a fresh install against `^3.19.3` resolves to 3.23.2 — four minor versions apart, with a
       C++ worker compiled per install, so nothing would surface the difference until a call
       behaved differently on ONE box. mediasoup's own API moved inside that range
       (`listenIps`/`announcedIp` became @deprecated), which is exactly the drift a range hides. */
    for (const [name, range] of Object.entries(PKG.dependencies)) {
      expect(range, `${name} must be pinned exactly, got ${range}`).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("the LOCKFILE agrees with the pins — or a rebuild fails on --frozen-lockfile", () => {
    /* THIS CAUGHT A REAL MISTAKE OF MINE. I generated the lockfile before pinning the versions,
       so it locked 3.23.2 while package.json said 3.19.3 — a disagreement that makes
       `pnpm install --frozen-lockfile` refuse outright, i.e. a media node that cannot be rebuilt.
       Both halves have to be asserted, because either alone looks fine. */
    for (const [name, version] of Object.entries(PKG.dependencies)) {
      expect(LOCK, `${name}@${version} is not in the lockfile`).toContain(`${name}@${version}:`);
    }
  });

  it("the lockfile does not ALSO carry a different version of a pinned dependency", () => {
    // A stale entry left behind by an earlier resolution is how the two come to disagree again.
    for (const name of Object.keys(PKG.dependencies)) {
      const found = [...LOCK.matchAll(new RegExp(`^  ${name}@(\\d+\\.\\d+\\.\\d+):`, "gm"))].map(
        (m) => m[1],
      );
      expect(new Set(found).size, `${name} appears at ${found.join(", ")}`).toBe(1);
      expect(found[0]).toBe(PKG.dependencies[name]);
    }
  });
});
