/**
 * RELAY mediasoup MEDIA-NODE AGENT.
 *
 * Runs ON a media node (not on the app fleet). One mediasoup worker per core, ONE
 * `WebRtcServer` bound to each worker, one router per room, and every transport in a room
 * created on that room's server — so all of a core's transports share a single UDP + TCP port
 * pair instead of taking a port each out of the worker's range. Publishes itself to the Redis
 * registry the app reads, and exposes a VPC-internal HTTP API the app's signaling layer drives.
 *
 * Start:  node agent.mjs        (systemd unit: relay-voip.service)
 * Env:    REDIS_URL          required — the same relay-redis the app uses
 *         VOIP_NODE_SECRET   required — HMAC key for the internal API (see below)
 *         VOIP_API_PORT      default 4443
 *         RTC_MIN_PORT       default 40000   } must match the security group
 *         RTC_MAX_PORT       default 49999   }
 *         PUBLIC_IP          optional override, for a box with no IMDS (dev only)
 *
 * ── THE IP IS READ, NEVER CONFIGURED ─────────────────────────────────────────────
 *
 * The nodes' public IPs are AUTO-ASSIGNED, not Elastic — the account hit its EIP quota and
 * an increase is pending — so an IP CHANGES when an instance stops and starts. A configured
 * address is therefore a value that goes silently wrong and points media at a host nobody
 * is listening on. This agent reads its own IP from IMDSv2 at boot and re-reads it on a
 * timer, and publishes what it read. When Elastic IPs land, nothing here changes, because
 * nothing was ever written down.
 *
 * ── WHY THE INTERNAL API IS SIGNED EVEN THOUGH IT IS VPC-ONLY ────────────────────
 *
 * The security group limits TCP 4443 to 10.0.0.0/16, and that is a network control rather
 * than an authorization one. This API can create a router, mint a transport and — the part
 * that matters — CONSUME a producer, i.e. subscribe to somebody's live audio and video. A
 * reachable-from-inside-the-VPC endpoint that does that unauthenticated is one SSRF or one
 * compromised box away from being a wiretap. So every request carries an HMAC over its own
 * body with a timestamp, using the fleet secret family the app already has. This repo
 * carries an accepted residual about the Redis bus lacking message authentication for the
 * same reason; that one is bounded because the bus only moves notifications. This is not.
 *
 * ── WHAT THIS AGENT DOES NOT DECIDE ──────────────────────────────────────────────
 *
 * It does not choose which room lives here, and it does not know about identities, pins or
 * rooms in RELAY's sense. The app assigns rooms (`server/voipRegistry.ts` selects a node)
 * and passes opaque room ids. Keeping authority in the app is deliberate: a client must
 * never be able to name a room or a producer it should not reach, and the app is where the
 * signed room capability already lives (`server/roomCapability.ts`).
 */
import { createServer } from "node:http";
import { cpus, loadavg } from "node:os";
import * as mediasoup from "mediasoup";
import Redis from "ioredis";
import {
  buildNodeRecord,
  NODE_HEARTBEAT_MS,
  NODE_INDEX_KEY,
  NODE_TTL_MS,
  nodeKey,
} from "./record.mjs";
// The signature rule lives in its own importable module so the APP's signer can be tested
// against this exact verifier — see sign.mjs for why that split is load-bearing.
import { SIG_HEADER, verifySignature } from "./sign.mjs";

const API_PORT = Number(process.env.VOIP_API_PORT || 4443);
const RTC_MIN_PORT = Number(process.env.RTC_MIN_PORT || 40000);
const RTC_MAX_PORT = Number(process.env.RTC_MAX_PORT || 49999);
const SECRET = process.env.VOIP_NODE_SECRET || "";
const REDIS_URL = process.env.REDIS_URL || "";

/* ── the media codecs, and the reason for the ORDER ────────────────────────────────
 * VP8 and H.264 only, VP8 first. The smoke test negotiated exactly these on both nodes.
 * VP9/AV1 are deliberately absent: they cost markedly more CPU to encode on a phone, and
 * this app's own measurements (v2.99.84) found a multi-party call already thermally
 * limited on mobile — the SFU removes the N-1 ENCODERS problem, not the cost of the one
 * encoder each phone still runs. H.264 stays because iOS hardware-encodes it.
 * Opus is stereo-capable but published mono by the client on purpose (same release): a
 * voice call carries no spatial information and stereo doubles the encoder's sample work.
 */
const MEDIA_CODECS = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
    parameters: {
      // 24–32 kbps with 20 ms packets, DTX and inband FEC — the brief's audio policy.
      // DTX stops silence costing bandwidth; FEC buys loss tolerance without a retransmit.
      maxaveragebitrate: 32000,
      ptime: 20,
      usedtx: 1,
      useinbandfec: 1,
      stereo: 0,
    },
  },
  { kind: "video", mimeType: "video/VP8", clockRate: 90000, parameters: { "x-google-start-bitrate": 400 } },
  {
    kind: "video",
    mimeType: "video/H264",
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "42e01f",
      "level-asymmetry-allowed": 1,
      "x-google-start-bitrate": 400,
    },
  },
];

/** Per-transport ceiling. A weak RECEIVER must drop a layer, not drag the sender down. */
const MAX_INCOMING_BITRATE = 1_500_000;
const INITIAL_OUTGOING_BITRATE = 1_000_000;

// ── state ────────────────────────────────────────────────────────────────────────
/**
 * One entry per CPU core: the worker AND the `WebRtcServer` bound to it.
 *
 * THE PAIR IS RECORDED BECAUSE IT CANNOT BE DERIVED. `createWebRtcServer` is on `Worker`, not
 * `Router`, and `Router` exposes no `worker` getter — verified against mediasoup's own
 * declarations rather than the docs — so nothing can walk from a room's router back to the
 * server its transports must be created on.
 *
 * @type {{worker: import("mediasoup").types.Worker, webRtcServer: import("mediasoup").types.WebRtcServer, port: number}[]}
 */
const workers = [];
let nextWorker = 0;
/** roomId → { router, transports:Map, producers:Map, consumers:Map, audioObserver } */
const rooms = new Map();
let self = { instanceId: "unknown", publicIp: "", privateIp: "", az: "" };
/** @type {import("ioredis").Redis | null} */
let redis = null;

/**
 * Drop this node's registry record, so a PLANNED stop does not make the app wait out the TTL
 * before it stops sending rooms here.
 *
 * ONE implementation, because there are now two callers — a signal-driven shutdown and the
 * address-change exit — and two copies of "how does a node leave the registry" is how one of
 * them comes to leave a record behind. A crash needs no equivalent: the TTL is the backstop,
 * which is why this may fail silently.
 */
async function deregister() {
  try {
    if (redis) {
      await redis.del(nodeKey(self.instanceId));
      await redis.srem(NODE_INDEX_KEY, self.instanceId);
    }
  } catch {
    /* ignore — the TTL is the backstop */
  }
}

/**
 * Strip the ADDRESSES out of one transport stat, keeping everything a readout uses.
 *
 * THIS IS A DISCLOSURE FIX, NOT TIDYING, and it is about code in this file. mediasoup's
 * `WebRtcTransportStat.iceSelectedTuple` is a `TransportTuple`, and `TransportTuple` carries
 * `remoteIp` and `remotePort` — **the participant's own public address** — so a `stats({roomId})`
 * returning the raw report hands out every participant's IP together, per room. The in-call
 * quality readout is exactly what the coming increments wire to this, and a readout that forwards
 * what it is given makes one participant able to locate another.
 *
 * That class is already ruled out here: v2.99.20 restricted `avatarUrl` to our own storage
 * precisely because a remote image URL became "a remote-fetch primitive aimed at other users",
 * harvesting IP and User-Agent from a call nobody answered — squarely against this app's
 * no-tracing goal. An SFU stat handing the address over directly is the same thing with fewer
 * steps.
 *
 * STRIPPED AT THE SOURCE rather than in whatever forwards it, because a filter in the caller is
 * one a later caller can forget, and this way the address never leaves the node at all.
 * `protocol` is KEPT: it is the one field of the tuple a readout genuinely needs, since it says
 * whether a call fell back to TCP, and it identifies nobody. The node's own `localIp`/`localPort`
 * go too — not a participant's secret, but no reason to publish the private address either.
 */
function sanitizeTransportStat(stat) {
  if (!stat || typeof stat !== "object") return stat;
  const { iceSelectedTuple, ...rest } = stat;
  if (!iceSelectedTuple || typeof iceSelectedTuple !== "object") return rest;
  return { ...rest, iceSelectedTuple: { protocol: iceSelectedTuple.protocol } };
}

// ── IMDSv2 ───────────────────────────────────────────────────────────────────────
/**
 * Read this instance's own identity from instance metadata.
 *
 * IMDSv2 (token-first) rather than v1: v1 is a plain unauthenticated GET that any process
 * — or an SSRF in anything running here — can make, which is why AWS gates v2 behind a
 * PUT-obtained token with a short TTL. There is no reason to use the weaker one.
 *
 * Falls back to `PUBLIC_IP` only if metadata is unreachable, so a dev box works, and
 * NEVER invents an address: without one the agent refuses to register rather than
 * publishing a record that would send media nowhere.
 */
async function readSelf() {
  const base = "http://169.254.169.254/latest";
  const get = async (path, token) => {
    const r = await fetch(`${base}/meta-data/${path}`, {
      headers: { "x-aws-ec2-metadata-token": token },
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) throw new Error(`imds ${path} ${r.status}`);
    return (await r.text()).trim();
  };
  try {
    const tr = await fetch(`${base}/api/token`, {
      method: "PUT",
      headers: { "x-aws-ec2-metadata-token-ttl-seconds": "300" },
      signal: AbortSignal.timeout(2000),
    });
    if (!tr.ok) throw new Error(`imds token ${tr.status}`);
    const token = (await tr.text()).trim();
    const [instanceId, publicIp, privateIp, az] = await Promise.all([
      get("instance-id", token),
      get("public-ipv4", token),
      get("local-ipv4", token),
      get("placement/availability-zone", token),
    ]);
    return { instanceId, publicIp, privateIp, az };
  } catch (e) {
    if (process.env.PUBLIC_IP) {
      return {
        instanceId: process.env.INSTANCE_ID || `dev-${process.env.PUBLIC_IP}`,
        publicIp: process.env.PUBLIC_IP,
        privateIp: process.env.PRIVATE_IP || "127.0.0.1",
        az: process.env.AZ || "dev",
      };
    }
    throw new Error(`cannot read instance metadata and no PUBLIC_IP set: ${e}`);
  }
}

// ── workers ──────────────────────────────────────────────────────────────────────
async function startWorkers() {
  const n = Math.max(1, cpus().length);
  /* THE FIRST `n` PORTS ARE RESERVED FOR THE WebRtcServers, and each worker's own range starts
     ABOVE them — so a worker can never allocate a port a server is already bound to. Collision
     avoided by construction rather than by hoping the ranges do not overlap. */
  const serverPortBase = RTC_MIN_PORT;
  const workerMinPort = RTC_MIN_PORT + n;
  for (let i = 0; i < n; i++) {
    const w = await mediasoup.createWorker({
      rtcMinPort: workerMinPort,
      rtcMaxPort: RTC_MAX_PORT,
      logLevel: "warn",
      logTags: ["info", "ice", "dtls", "rtp", "rtcp", "bwe"],
    });
    /* A worker death is FATAL to the rooms it holds and there is nothing this process can
       do to save them — the C++ process owning their RTP is gone. Exit and let systemd
       restart: the app's registry TTL then expires this node, its rooms are reassigned to
       the surviving node, and clients take the already-shipped rejoin-recreate path. That
       is a worse outcome than not crashing and a far better one than a half-alive agent
       reporting healthy while holding dead routers. */
    w.on("died", () => {
      console.error(`[voip] worker ${w.pid} died — exiting so systemd restarts us`);
      process.exit(1);
    });
    /* ONE WebRtcServer PER WORKER, and every transport on that worker shares its single
       UDP + TCP port pair instead of taking a port each out of the worker's range. That is the
       reason to prefer it over per-transport `listenInfos`: one socket pair per core rather than
       one per participant.
       TWO ENTRIES, NOT ONE. `listenInfos` is a LIST, and supplying only the UDP entry ships a
       node that silently has no TCP candidate at all — which is invisible until somebody on a
       UDP-blocking network cannot connect and everything else looks healthy.
       `announcedAddress`, not the deprecated `announcedIp`: LISTEN on the private address, ANNOUNCE
       the public one. That is the whole trick of an SFU behind NAT — the socket binds inside the
       VPC while the candidate a browser receives is the address routable to it. */
    const port = serverPortBase + i;
    const webRtcServer = await w.createWebRtcServer({
      listenInfos: [
        { protocol: "udp", ip: self.privateIp, announcedAddress: self.publicIp, port },
        { protocol: "tcp", ip: self.privateIp, announcedAddress: self.publicIp, port },
      ],
    });
    workers.push({ worker: w, webRtcServer, port });
  }
  console.log(
    `[voip] ${workers.length} worker(s); WebRtcServers on ${serverPortBase}-${serverPortBase + n - 1}, ` +
      `worker range ${workerMinPort}-${RTC_MAX_PORT}, announcing ${self.publicIp}`,
  );
}

/**
 * Round-robin, so rooms spread across cores rather than piling on worker 0.
 *
 * Returns the PAIR, because a room needs both halves and cannot recover one from the other:
 * transports are created on the `WebRtcServer` while `canConsume` and `rtpCapabilities` come
 * from the router, and `Router` has no `worker` getter to walk back through.
 */
function pickWorker() {
  const w = workers[nextWorker % workers.length];
  nextWorker++;
  return w;
}

async function getOrCreateRoom(roomId) {
  const existing = rooms.get(roomId);
  if (existing) return existing;
  const slot = pickWorker();
  const router = await slot.worker.createRouter({ mediaCodecs: MEDIA_CODECS });
  /* Dominant-speaker detection, so the app can forward only the loudest few. Forwarding
     every audio stream in a large room is the thing that makes a 10-way call cost ten
     times a 1:1 for no perceptual gain. */
  const audioObserver = await router.createAudioLevelObserver({
    maxEntries: 8,
    threshold: -60,
    interval: 800,
  });
  const room = {
    router,
    /* The server every transport in THIS room is created on. Recorded per room rather than
       looked up per transport, so a room can never end up with transports split across two
       servers — which would put one participant's media on a different port pair from the
       rest and is invisible until exactly one person cannot connect. */
    webRtcServer: slot.webRtcServer,
    audioObserver,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
    loudest: [],
    createdAt: Date.now(),
  };
  audioObserver.on("volumes", (volumes) => {
    room.loudest = volumes.map((v) => ({ producerId: v.producer.id, volume: v.volume }));
  });
  audioObserver.on("silence", () => {
    room.loudest = [];
  });
  rooms.set(roomId, room);
  return room;
}

function closeRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return false;
  // Closing the router closes every transport, producer and consumer under it — one call
  // rather than a hand-rolled sweep that a later addition could be left out of.
  try {
    room.router.close();
  } catch {
    /* already closed */
  }
  rooms.delete(roomId);
  return true;
}

async function createWebRtcTransport(room) {
  const transport = await room.router.createWebRtcTransport({
    /* THE SERVER, NOT `listenIps` — and they are MUTUALLY EXCLUSIVE rather than merely
       redundant: the option type is `Either<Either<listenInfos, listenIps>, webRtcServer>`, so
       passing both is a type error and passing the deprecated one gets a port per transport
       instead of one shared pair per core. The listen/announce addresses were decided once when
       this server was created; a transport cannot restate or override them. */
    webRtcServer: room.webRtcServer,
    enableUdp: true,
    /* EXPLICIT, and it is the candidate that carries a UDP-blocked network. The WebRtcServer
       has a TCP listener precisely so this can be true; leaving it to a default is how a node
       ends up UDP-only with nothing saying so. */
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: INITIAL_OUTGOING_BITRATE,
  });
  try {
    await transport.setMaxIncomingBitrate(MAX_INCOMING_BITRATE);
  } catch {
    /* advisory */
  }
  room.transports.set(transport.id, transport);
  transport.on("dtlsstatechange", (s) => {
    if (s === "closed") room.transports.delete(transport.id);
  });
  return transport;
}

// ── the internal API ─────────────────────────────────────────────────────────────
/**
 * Verify the app's HMAC over the raw body.
 *
 * Signed over `<timestamp>.<body>` with a five-minute window, so a captured request cannot
 * be replayed indefinitely, and compared with `timingSafeEqual` after a length check —
 * `timingSafeEqual` THROWS on a length mismatch, which would turn a malformed signature
 * into a 500 instead of a 401.
 */
/** @type {Record<string, (body: any) => Promise<any>>} */
const HANDLERS = {
  /** Health + capabilities. The app polls nothing here; the registry is the read path. */
  async state() {
    return { ...self, cores: cpus().length, workers: workers.length, rooms: rooms.size };
  },

  /** Router RTP capabilities — step one of every mediasoup handshake. */
  async routerCapabilities({ roomId }) {
    const room = await getOrCreateRoom(roomId);
    return { rtpCapabilities: room.router.rtpCapabilities };
  },

  async createTransport({ roomId }) {
    const room = rooms.get(roomId);
    if (!room) throw new Error("no such room");
    const t = await createWebRtcTransport(room);
    return {
      id: t.id,
      iceParameters: t.iceParameters,
      iceCandidates: t.iceCandidates,
      dtlsParameters: t.dtlsParameters,
    };
  },

  async connectTransport({ roomId, transportId, dtlsParameters }) {
    const t = rooms.get(roomId)?.transports.get(transportId);
    if (!t) throw new Error("no such transport");
    await t.connect({ dtlsParameters });
    return { ok: true };
  },

  async produce({ roomId, transportId, kind, rtpParameters, appData }) {
    const room = rooms.get(roomId);
    const t = room?.transports.get(transportId);
    if (!room || !t) throw new Error("no such transport");
    const producer = await t.produce({ kind, rtpParameters, appData: appData ?? {} });
    room.producers.set(producer.id, producer);
    producer.on("transportclose", () => room.producers.delete(producer.id));
    if (kind === "audio") {
      try {
        await room.audioObserver.addProducer({ producerId: producer.id });
      } catch {
        /* observer is advisory */
      }
    }
    return { id: producer.id };
  },

  async consume({ roomId, transportId, producerId, rtpCapabilities }) {
    const room = rooms.get(roomId);
    const t = room?.transports.get(transportId);
    if (!room || !t) throw new Error("no such transport");
    if (!room.router.canConsume({ producerId, rtpCapabilities })) throw new Error("cannot consume");
    /* Start PAUSED. The client resumes once its receiving element is ready — otherwise the
       first packets arrive before anything can decode them and the join looks like a
       frozen tile. */
    const consumer = await t.consume({ producerId, rtpCapabilities, paused: true });
    room.consumers.set(consumer.id, consumer);
    consumer.on("transportclose", () => room.consumers.delete(consumer.id));
    consumer.on("producerclose", () => room.consumers.delete(consumer.id));
    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  },

  async resumeConsumer({ roomId, consumerId }) {
    const c = rooms.get(roomId)?.consumers.get(consumerId);
    if (!c) throw new Error("no such consumer");
    await c.resume();
    return { ok: true };
  },

  /**
   * Server-side layer switching: pin THIS consumer to a simulcast layer.
   *
   * The point of simulcast, and the answer to "video degrades during the call": a weak
   * RECEIVER drops to a lower spatial layer while the sender keeps publishing all three,
   * so one bad connection no longer drags everybody's quality down with it.
   */
  async setConsumerLayers({ roomId, consumerId, spatialLayer, temporalLayer }) {
    const c = rooms.get(roomId)?.consumers.get(consumerId);
    if (!c) throw new Error("no such consumer");
    await c.setPreferredLayers({ spatialLayer, temporalLayer });
    return { ok: true };
  },

  async closeRoom({ roomId }) {
    return { closed: closeRoom(roomId) };
  },

  /** Who is talking, for the app's speaking-tile and loudest-N forwarding. */
  async loudest({ roomId }) {
    return { loudest: rooms.get(roomId)?.loudest ?? [] };
  },

  /** Per-room transport stats, for the in-call readout on both transports. */
  async stats({ roomId }) {
    const room = rooms.get(roomId);
    if (!room) return { transports: [] };
    const out = [];
    for (const t of room.transports.values()) {
      try {
        const raw = await t.getStats();
        /* `getStats()` returns an ARRAY of stats per transport, so map rather than sanitizing
           one object — handing the array through unmapped is how the strip comes to cover the
           first entry only. */
        out.push({
          id: t.id,
          stats: Array.isArray(raw) ? raw.map(sanitizeTransportStat) : sanitizeTransportStat(raw),
        });
      } catch {
        /* a closing transport is not an error */
      }
    }
    return { transports: out };
  },
};

function startApi() {
  const server = createServer((req, res) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on("data", (c) => {
      size += c.length;
      // Bounded before buffering: an unbounded body on an internal port is still a way to
      // exhaust a node that is holding live calls.
      if (size > 512 * 1024) {
        aborted = true;
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", async () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      const reply = (code, obj) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      // Verified against the RAW bytes, never against a re-serialization of the parsed
      // JSON — re-serializing can reorder keys, and then a perfectly good request fails.
      // Also verified BEFORE the JSON parse, so an unauthenticated caller cannot even
      // reach the parser.
      if (!verifySignature(SECRET, raw, req.headers[SIG_HEADER], Date.now()))
        return reply(401, { error: "unauthorized" });
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        return reply(400, { error: "bad json" });
      }
      const handler = HANDLERS[body?.op];
      if (!handler) return reply(400, { error: "unknown op" });
      try {
        reply(200, await handler(body));
      } catch (e) {
        // The op name is safe to echo (the app chose it); the message is not necessarily,
        // so it is logged here and returned as a short string rather than a stack.
        console.error(`[voip] ${body.op} failed:`, e);
        reply(500, { error: String(e?.message ?? e).slice(0, 200) });
      }
    });
  });
  server.listen(API_PORT, "0.0.0.0", () =>
    console.log(`[voip] internal API on :${API_PORT} (HMAC required)`),
  );
  return server;
}

// ── registry heartbeat ───────────────────────────────────────────────────────────
function countConsumers() {
  let n = 0;
  for (const r of rooms.values()) n += r.consumers.size;
  return n;
}

async function heartbeat() {
  if (!redis) return;
  const rec = buildNodeRecord({
    ...self,
    cores: cpus().length,
    routers: rooms.size,
    consumers: countConsumers(),
    // loadavg[0] is a 1-minute average across all cores; per-core is what the app compares
    // against its ceiling, so divide rather than publishing a figure that means something
    // different on a 2-core box than on an 8-core one.
    cpuLoad: loadavg()[0] / Math.max(1, cpus().length),
    nowMs: Date.now(),
  });
  try {
    await redis.set(nodeKey(self.instanceId), JSON.stringify(rec), "PX", NODE_TTL_MS);
    await redis.sadd(NODE_INDEX_KEY, self.instanceId);
  } catch (e) {
    // Never fatal: a registry blip must not take a node holding live calls off the air.
    // The app's TTL will drop us and reassign NEW rooms; existing ones keep flowing.
    console.error("[voip] heartbeat failed:", e?.message ?? e);
  }
}

async function main() {
  if (!SECRET) throw new Error("VOIP_NODE_SECRET is required — the internal API is signed");
  self = await readSelf();
  console.log(`[voip] ${self.instanceId} ${self.az} public=${self.publicIp} private=${self.privateIp}`);
  await startWorkers();
  const server = startApi();
  if (REDIS_URL) {
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
    redis.on("error", (e) => console.error("[voip] redis:", e?.message ?? e));
    await heartbeat();
    setInterval(heartbeat, NODE_HEARTBEAT_MS).unref();
  } else {
    console.warn("[voip] REDIS_URL unset — this node will NOT be assigned any rooms");
  }
  /* RE-READ THE IP ON A TIMER, because it is auto-assigned and changes on stop/start. A
     changed IP is published on the next heartbeat, so NEW rooms get the new address; rooms
     already running were already broken by the restart and take the rejoin path.
     ── WHY THIS INTERVAL IS THE TTL AND NOT A MINUTE ────────────────────────────────
     `announcedAddress` is IMMUTABLE per transport — confirmed against mediasoup's own
     declarations, where it appears only as a creation option with no setter anywhere — so a
     transport created while this cache is stale announces the WRONG address for its whole life
     and that room's media never arrives.
     THE APP CANNOT CATCH IT, and that is the reason to care: this agent is the SOLE source of
     the address, so a stale cache is published in the heartbeat too. The app's
     `assignmentStillValid` compares the address it was given against the address the node
     reports — and both are the same stale value, so they AGREE and nothing looks wrong. There
     is no second opinion to disagree with.
     A stop/start needs none of this (the process restarts and `readSelf()` runs fresh at boot).
     The case this window exists for is an ELASTIC IP being attached to a RUNNING node, which is
     exactly what happens when the pending EIP quota lands. Reading at transport-creation time
     was considered and rejected: that puts an IMDS round trip on the call-setup path, where
     latency is a per-operation cost. The TTL is the natural bound instead — the window can then
     never exceed the one interval the app already reasons about. */
  setInterval(async () => {
    try {
      const now = await readSelf();
      if (now.publicIp !== self.publicIp) {
        /* THE CONVERSION TO `WebRtcServer` CHANGED WHAT THIS CASE MEANS, and simply updating
           `self` would now be silently wrong.
           `announcedAddress` is decided when the SERVER is created and is immutable, so a
           process that keeps running after its address changes announces the OLD one for the
           rest of its life — not for one interval. Updating `self` would fix the heartbeat and
           fix nothing about the media, which is the worst combination: the registry would report
           a healthy node at the new address while every transport it minted pointed at an
           address that no longer reaches it.
           So exit, and let systemd restart — the same reasoning and the same machinery as a
           worker death directly above. Every room here is already broken by the address change,
           the deregister below stops the app sending more, the registry TTL expires this node,
           its rooms are reassigned to the surviving one, and clients take the already-shipped
           rejoin path. Rebuilding the servers in place was the alternative and it is strictly
           more code for the same outcome, because the rooms bound to the old servers have to be
           torn down either way. */
        console.warn(
          `[voip] public IP changed ${self.publicIp} -> ${now.publicIp} — exiting so the ` +
            `WebRtcServers are recreated announcing the new address`,
        );
        self = now;
        try {
          await deregister();
        } catch {
          /* the TTL is the backstop */
        }
        process.exit(0);
      }
    } catch {
      /* keep the last known good */
    }
  }, NODE_TTL_MS).unref();

  const shutdown = async () => {
    console.log("[voip] shutting down");
    await deregister();
    for (const id of [...rooms.keys()]) closeRoom(id);
    for (const slot of workers) {
      try {
        /* `.worker`, because `workers` holds the {worker, webRtcServer} PAIR. Closing the worker
           closes the server bound to it, so there is nothing separate to close. */
        slot.worker.close();
      } catch {
        /* ignore */
      }
    }
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((e) => {
  console.error("[voip] fatal:", e);
  process.exit(1);
});
