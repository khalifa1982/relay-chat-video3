import { describe, it, expect, afterEach } from "vitest";
import {
  clusterEnabled,
  sigInChannel,
  sigOutChannel,
  encodeFrame,
  decodeInbound,
  decodeOutbound,
  isSelfLeader,
  makeRemoteSocket,
  LEADER_TTL_MS,
  LEADER_RENEW_MS,
} from "./relayCluster";

describe("relayCluster (phase-1 pure core)", () => {
  const saved = { RELAY_CLUSTER: process.env.RELAY_CLUSTER, REDIS_URL: process.env.REDIS_URL };
  afterEach(() => {
    for (const k of ["RELAY_CLUSTER", "REDIS_URL"] as const) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("clusterEnabled requires BOTH RELAY_CLUSTER and REDIS_URL (dormant otherwise)", () => {
    delete process.env.RELAY_CLUSTER;
    delete process.env.REDIS_URL;
    expect(clusterEnabled()).toBe(false);
    process.env.RELAY_CLUSTER = "1";
    expect(clusterEnabled()).toBe(false); // no REDIS_URL
    process.env.REDIS_URL = "redis://x:6379";
    expect(clusterEnabled()).toBe(true);
    process.env.RELAY_CLUSTER = "true";
    expect(clusterEnabled()).toBe(true);
    process.env.RELAY_CLUSTER = "0";
    expect(clusterEnabled()).toBe(false);
    process.env.RELAY_CLUSTER = "yes"; // only 1/true count
    expect(clusterEnabled()).toBe(false);
  });

  it("channel names are per-instance and distinct for in/out", () => {
    expect(sigInChannel("L1")).toBe("relay:sig:in:L1");
    expect(sigOutChannel("H2")).toBe("relay:sig:out:H2");
    expect(sigInChannel("A")).not.toBe(sigOutChannel("A"));
  });

  it("inbound frame round-trips (cid/home/raw) and rejects malformed", () => {
    // v2.99.59: the decoder NORMALISES `proxy` to a boolean, so a frame from an
    // older instance (which omits the field) is explicitly non-proxied rather
    // than undefined — the leader's routing branches on it.
    const f = { cid: "c1", home: "H", raw: { type: "invite", to: "314159" } };
    expect(decodeInbound(encodeFrame(f))).toEqual({ ...f, proxy: false });
    // raw may be any JSON value, including a synthetic control message
    const ctl = { cid: "c2", home: "H", raw: { type: "__disconnect" } };
    expect(decodeInbound(encodeFrame(ctl))).toEqual({ ...ctl, proxy: false });
    // …and a genuine proxy frame survives the round trip.
    const px = { cid: "c3", home: "H", raw: { type: "accept" }, proxy: true };
    expect(decodeInbound(encodeFrame(px))).toEqual(px);
    // Anything non-true is normalised to false — never a truthy string.
    expect(decodeInbound('{"cid":"c","home":"H","raw":1,"proxy":"yes"}')).toEqual({
      cid: "c", home: "H", raw: 1, proxy: false,
    });
    for (const bad of ["{", "null", "{}", '{"cid":"c"}', '{"cid":1,"home":"H","raw":1}']) {
      expect(decodeInbound(bad)).toBeNull();
    }
  });

  it("outbound frame round-trips (cid/obj) and rejects malformed", () => {
    const f = { cid: "c1", obj: { type: "ring", from: "271828" } };
    expect(decodeOutbound(encodeFrame(f))).toEqual(f);
    // obj may be any JSON value
    expect(decodeOutbound(encodeFrame({ cid: "c", obj: null }))).toEqual({ cid: "c", obj: null });
    for (const bad of ["", "[]", '{"obj":1}', '{"cid":2,"obj":1}']) {
      expect(decodeOutbound(bad)).toBeNull();
    }
  });

  it("isSelfLeader is a strict holder==self check; lease timings are sane", () => {
    expect(isSelfLeader("me", "me")).toBe(true);
    expect(isSelfLeader("other", "me")).toBe(false);
    expect(isSelfLeader(null, "me")).toBe(false);
    // TTL must comfortably exceed the renew interval so a slow renew never
    // self-demotes, and the loop can't out-race its own lease.
    expect(LEADER_TTL_MS).toBeGreaterThan(LEADER_RENEW_MS * 2);
  });

  it("makeRemoteSocket routes send→deliver(cid,obj) and close→onClose(cid)", () => {
    const delivered: Array<{ cid: string; obj: unknown }> = [];
    const closed: string[] = [];
    const sock = makeRemoteSocket(
      "cid-9",
      (cid, obj) => delivered.push({ cid, obj }),
      (cid) => closed.push(cid)
    );
    sock.send({ type: "peer-joined", pin: "141421" });
    expect(delivered).toEqual([{ cid: "cid-9", obj: { type: "peer-joined", pin: "141421" } }]);
    sock.close();
    expect(closed).toEqual(["cid-9"]);
    // Satisfies the RelaySocket contract shape the registry expects.
    expect(typeof sock.send).toBe("function");
    expect(typeof sock.close).toBe("function");
  });
});
