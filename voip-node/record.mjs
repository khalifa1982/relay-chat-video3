/**
 * THE NODE RECORD, BUILT ON THE AGENT SIDE.
 *
 * This is the one thing in the agent that the APP also has an opinion about: the app's
 * `server/voipRegistry.ts` decodes and validates exactly this shape, in TypeScript, and
 * refuses anything it does not recognise. So there are two implementations of one rule, in
 * two languages, on two different machines — and that is the precise shape this repo has
 * been bitten by before.
 *
 * v2.99.71 is the recorded case: `scripts/turn-check.mjs` is plain `.mjs` run by bare node
 * on an EC2 box, while `iceServers()` is TypeScript inside the app bundle, and the two
 * drifted — the checker probed an endpoint the fleet does not advertise and would have
 * reported two permanently-DOWN relays forever. No string check would have caught the NEXT
 * divergence, so the fix was a PARITY TEST comparing their actual OUTPUT.
 *
 * The same fix applies here, which is why this file exists separately from `agent.mjs`:
 * it is IMPORTABLE AND SIDE-EFFECT-FREE, so `server/voipNodeParity.test.ts` can call
 * `buildNodeRecord` and feed the result through the app's real `decodeNode`. Importing
 * `agent.mjs` would start mediasoup workers and a server — v2.99.71 also records that
 * trap: importing `turn-check.mjs` used to run a health check and `process.exit(0)`,
 * killing the test runner.
 *
 * KEEP THIS FILE FREE OF SIDE EFFECTS AND OF THE `mediasoup` IMPORT.
 */

/**
 * Build the record this node publishes to the registry.
 *
 * @param {object} o
 * @param {string} o.instanceId  EC2 instance id — the registry key, stable across an IP change
 * @param {string} o.publicIp    read from IMDSv2, NOT from config: it changes on stop/start
 * @param {string} o.privateIp   what the transport LISTENS on while announcing publicIp
 * @param {string} o.az          availability zone, so a room's coturn stays in the same zone
 * @param {number} o.cores       one mediasoup worker per core
 * @param {number} o.routers     live router count (one per room on this node)
 * @param {number} o.consumers   live consumer count — the load signal the app ranks on
 * @param {number} o.cpuLoad     0..1 per core; the app EXCLUDES a saturated node
 * @param {number} o.nowMs      the node's own clock; the app judges freshness on this
 * @param {boolean} [o.draining] being retired: no NEW rooms, existing ones keep flowing
 * @returns {{instanceId:string,publicIp:string,privateIp:string,az:string,cores:number,routers:number,consumers:number,cpuLoad:number,updatedAt:number,draining:boolean}}
 */
export function buildNodeRecord(o) {
  return {
    instanceId: String(o.instanceId),
    publicIp: String(o.publicIp),
    privateIp: String(o.privateIp),
    az: String(o.az),
    // Clamped and floored so a bad reading can never publish a record the app refuses —
    // a node absent from the registry costs its whole capacity, so the agent should not
    // be able to take itself out of service by mis-sampling a counter.
    cores: Math.max(1, Math.floor(o.cores || 1)),
    routers: Math.max(0, Math.floor(o.routers || 0)),
    consumers: Math.max(0, Math.floor(o.consumers || 0)),
    // NOT clamped to the app's ceiling: reporting the truth is the agent's job, and
    // deciding what is too hot is the app's. Clamping here would hide saturation.
    cpuLoad: Math.max(0, Number.isFinite(o.cpuLoad) ? o.cpuLoad : 0),
    updatedAt: o.nowMs,
    /* ALWAYS PRESENT and always a real boolean, so the app never has to distinguish "this
       node says it is serving" from "this node is too old to have an opinion". `=== true`
       rather than truthy for the same reason the app decodes it that way: a flag written by
       a shell can arrive as the STRING "false", and a truthy test would retire the node. */
    draining: o.draining === true,
  };
}

/** The registry keys, spelled once. Must match `server/voipRegistry.ts` — pinned by test. */
export const NODE_KEY_PREFIX = "relay:voip:node:";
export const NODE_INDEX_KEY = "relay:voip:nodes";
export const NODE_TTL_MS = 15_000;
export const NODE_HEARTBEAT_MS = 5_000;

/** @param {string} instanceId */
export function nodeKey(instanceId) {
  return NODE_KEY_PREFIX + instanceId;
}
