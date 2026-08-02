import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AUDIO_MIN_PACKETS,
  audioInboundState,
  callStatsVerdict,
  callQualityTone,
  formatCallDetail,
  formatCallStats,
  summarizeStats,
  type StatEntry,
} from "./callStats";
import { urlNeedsCredentials, usableIceServers } from "./iceGuard";
import {
  parseCandidateType,
  probeRelayReachability,
  relayProbeVerdict,
  summarizeRelayProbe,
  type ProbePc,
  type RelayProbeEvent,
} from "./relayProbe";

/**
 * v2.107.10 — the three deliverables from the audio-failure incident.
 *
 * WHAT THE INCIDENT ACTUALLY WAS. An operator report from the coturn logs said
 * ~90% of TURN sessions arrive with a BLANK username and concluded the app must
 * be constructing an `RTCPeerConnection` before the credentials are fetched. That
 * mechanism is refuted by three facts in this repo's own source — `max-bundle`
 * puts audio and video on ONE ICE transport (so "video fine, audio dead" cannot
 * be an ICE outcome), the pre-ack config is STUN-only (so an early connection
 * produces NO coturn session rather than a blank one), and `iceServers()` has no
 * path that emits a credential-less TURN entry. But an argument between a log and
 * a source reading is not settled by argument, so this ships MEASUREMENT plus the
 * guard that makes the proposed mechanism impossible regardless.
 *
 * The three, and what each is for:
 *   1. AUDIO EVIDENCE — `totalAudioEnergy` beside `packetsReceived`, so the app
 *      can tell "audio never arrived" from "audio arrived and was never played
 *      out". Its absence is the reason this outage had to be argued from coturn
 *      logs at all, and it is the counter that caught v2.106.51.
 *   2. THE FORCE-RELAY SELF-TEST — a relay-only connection against live
 *      credentials, so a 401 says "credential refused" and silence says
 *      "nothing answered", which are different problems in different files.
 *   3. THE BLANK-CREDENTIAL GUARD — drop a TURN entry with no credentials
 *      before a peer connection is built.
 *
 * Behavioural throughout: whether a relay candidate is gathered, and whether a
 * silent call is diagnosed, are exactly the questions a source pin cannot answer.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Strip comment SPANS, so an assertion cannot be satisfied by prose ABOUT the
 *  thing it forbids — the trap this repo has recorded many times over. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/* ── 1. AUDIO EVIDENCE ──────────────────────────────────────────────────────── */

function audioLeg(over: Partial<StatEntry> = {}): StatEntry[] {
  return [
    {
      type: "inbound-rtp",
      kind: "audio",
      packetsReceived: 500,
      packetsLost: 0,
      totalAudioEnergy: 2.68,
      totalSamplesDuration: 12,
      ...over,
    },
  ];
}

describe("v2.107.10 (1) — the audio-playout evidence", () => {
  it("reports packets, energy and playout seconds off a real inbound audio stream", () => {
    const { stats } = summarizeStats([audioLeg()], { nowMs: 0 });
    expect(stats.audioIn).not.toBeNull();
    expect(stats.audioIn!.packets).toBe(500);
    expect(stats.audioIn!.energy).toBeCloseTo(2.68);
    expect(stats.audioIn!.playoutSec).toBe(12);
    expect(stats.audioIn!.state).toBe("ok");
  });

  it("THE v2.106.51 SIGNATURE: packets arriving, zero energy, nothing rendered", () => {
    // 508 packets a side and exactly 0 energy is the reading that release
    // measured. `totalSamplesDuration === 0` is what makes "not playing" a
    // statement rather than a guess: samples were never rendered at all.
    const { stats } = summarizeStats(
      [audioLeg({ packetsReceived: 508, totalAudioEnergy: 0, totalSamplesDuration: 0 })],
      { nowMs: 0 },
    );
    expect(stats.audioIn!.state).toBe("not-playing");
    // And it must reach the person looking at the readout, in words.
    expect(formatCallStats(stats)).toContain("audio not playing out");
    // A perfect network with silent audio is a POOR call — every other threshold
    // here says it is fine, which is exactly why this one has to exist.
    expect(callStatsVerdict(stats)).toBe("poor");
    expect(callQualityTone(stats)).toBe("warn");
  });

  it("a MUTED far side is 'no-sound', NOT a fault", () => {
    // Rendered (playoutSec > 0) and every sample zero. A readout that accuses the
    // app every time somebody mutes is one nobody believes on the day it is right.
    const { stats } = summarizeStats(
      [audioLeg({ totalAudioEnergy: 0, totalSamplesDuration: 9 })],
      { nowMs: 0 },
    );
    expect(stats.audioIn!.state).toBe("no-sound");
    expect(callStatsVerdict(stats)).not.toBe("poor");
    expect(formatCallStats(stats)).not.toContain("audio not playing out");
    expect(formatCallDetail(stats)).toContain("silent (muted?)");
  });

  it("with no sample duration reported it degrades to 'no-sound', never to an accusation", () => {
    const { stats } = summarizeStats(
      [audioLeg({ totalAudioEnergy: 0, totalSamplesDuration: undefined })],
      { nowMs: 0 },
    );
    // The two causes cannot be told apart without a duration, so the weaker,
    // non-accusatory claim is the honest one.
    expect(stats.audioIn!.state).toBe("no-sound");
    expect(callStatsVerdict(stats)).not.toBe("poor");
  });

  it("a young call makes NO claim — the floor is what stops a healthy call accusing itself", () => {
    const { stats } = summarizeStats(
      [audioLeg({ packetsReceived: 20, totalAudioEnergy: 0, totalSamplesDuration: 0 })],
      { nowMs: 0 },
    );
    expect(stats.audioIn!.state).toBe("unknown");
    expect(callStatsVerdict(stats)).not.toBe("poor");
  });

  it("the floor is ~3s of audio, well above the loss floor", () => {
    // 50 packets/s, so this is three seconds. Lower and the first moments of every
    // call would read as broken.
    expect(AUDIO_MIN_PACKETS).toBeGreaterThanOrEqual(100);
    expect(audioInboundState(AUDIO_MIN_PACKETS - 1, 0, 0)).toBe("unknown");
    expect(audioInboundState(AUDIO_MIN_PACKETS, 0, 0)).toBe("not-playing");
  });

  it("an unreported energy figure makes no claim in EITHER direction", () => {
    expect(audioInboundState(1000, null, 30)).toBe("unknown");
    expect(audioInboundState(1000, null, 0)).toBe("unknown");
  });

  it("null when there is no inbound audio at all — never a zero-filled record", () => {
    // "no audio stream" and "an audio stream that delivered nothing" are different
    // findings and one must not be able to read as the other.
    const video: StatEntry[] = [
      { type: "inbound-rtp", kind: "video", packetsReceived: 900, frameWidth: 640, frameHeight: 360 },
    ];
    expect(summarizeStats([video], { nowMs: 0 }).stats.audioIn).toBeNull();
    expect(summarizeStats([], { nowMs: 0 }).stats.audioIn).toBeNull();
  });

  it("an inbound-rtp with no kind at all is NOT guessed at", () => {
    // Attributing an unlabelled stream to audio would put a video leg's counters
    // behind a sentence about somebody's microphone.
    const vague: StatEntry[] = [
      { type: "inbound-rtp", packetsReceived: 900, totalAudioEnergy: 0, totalSamplesDuration: 0 },
    ];
    expect(summarizeStats([vague], { nowMs: 0 }).stats.audioIn).toBeNull();
  });

  it("sums across legs, so the question is about the CALL rather than one peer", () => {
    const { stats } = summarizeStats([audioLeg(), audioLeg({ packetsReceived: 300 })], {
      nowMs: 0,
    });
    expect(stats.audioIn!.packets).toBe(800);
    expect(stats.audioIn!.energy).toBeCloseTo(5.36);
  });

  it("the raw counters are on the detail line ALWAYS, not only when something is wrong", () => {
    // The point of a number is that it can be compared: "what does a WORKING call
    // read" is precisely what an outage makes unanswerable if the figure only
    // appears during one.
    const { stats } = summarizeStats([audioLeg()], { nowMs: 0 });
    expect(callStatsVerdict(stats)).toBe("ok");
    expect(formatCallDetail(stats)).toMatch(/↓aud 500pkt\/2\.68e/);
  });

  it("an unreported energy renders as '?', never as 0.00", () => {
    const { stats } = summarizeStats(
      [audioLeg({ totalAudioEnergy: undefined, totalSamplesDuration: undefined })],
      { nowMs: 0 },
    );
    expect(formatCallDetail(stats)).toContain("?e");
    expect(formatCallDetail(stats)).not.toContain("0.00e");
  });

  it("`mediaType` is honoured as well as `kind` (older UAs spell it that way)", () => {
    const legacy: StatEntry[] = [
      { type: "inbound-rtp", mediaType: "audio", packetsReceived: 400, totalAudioEnergy: 1 },
    ];
    expect(summarizeStats([legacy], { nowMs: 0 }).stats.audioIn!.packets).toBe(400);
  });

  it("the engine logs the audio counters, and only on a CHANGE", () => {
    const src = codeOnly(read("client/src/lib/relayClient.ts"));
    // The state is part of the signature, or a transition into "not playing out"
    // would never be logged.
    expect(src).toMatch(/stats\.audioIn\?\.state \?\? "-"/);
    expect(src).toMatch(/diag\(\s*`audio-in \$\{stats\.audioIn\.state\}/);
  });
});

/* ── 2. THE FORCE-RELAY SELF-TEST ───────────────────────────────────────────── */

const CAND = (url: string | null, type: string): RelayProbeEvent => ({
  type: "candidate",
  candidateType: type,
  url,
});
const ERR = (url: string | null, code: number | null, text = ""): RelayProbeEvent => ({
  type: "error",
  url,
  code,
  text,
});

describe("v2.107.10 (2) — the force-relay self-test", () => {
  it("a relay candidate means the credentials WORK", () => {
    const r = summarizeRelayProbe(["turn:a:3478"], [CAND("turn:a:3478", "relay")], 120);
    expect(r.ok).toBe(true);
    expect(r.relayUrls).toEqual(["turn:a:3478"]);
    expect(relayProbeVerdict(r)).toBe("ok");
  });

  it("a 401 is REFUSED CREDENTIALS — the report's own hypothesis, measured", () => {
    const r = summarizeRelayProbe(["turn:a:3478"], [ERR("turn:a:3478", 401, "Unauthorized")], 90);
    expect(r.unauthorized).toBe(true);
    expect(relayProbeVerdict(r)).toBe("unauthorized");
    expect(r.errors[0]).toEqual({ url: "turn:a:3478", code: 401, text: "Unauthorized" });
  });

  it("nothing at all is UNREACHABLE — a different problem in a different file", () => {
    // No relay candidate AND no refusal: nothing answered. Reporting that as a
    // credential fault sends somebody to rotate a secret that is perfectly fine.
    const r = summarizeRelayProbe(["turn:a:3478"], [], 6000);
    expect(r.ok).toBe(false);
    expect(r.unauthorized).toBe(false);
    expect(relayProbeVerdict(r)).toBe("unreachable");
  });

  it("no TURN configured is its OWN verdict, not a failure", () => {
    expect(relayProbeVerdict(summarizeRelayProbe([], [], 1))).toBe("no-turn");
  });

  it("one relay answering outranks another refusing — media can still be relayed", () => {
    // Reporting the whole fleet broken because one host is misconfigured is the
    // false alarm that teaches an operator to stop reading this. The 401 survives
    // in `errors` so the finding is not lost.
    const r = summarizeRelayProbe(
      ["turn:a:3478", "turn:b:3478"],
      [CAND("turn:a:3478", "relay"), ERR("turn:b:3478", 401)],
      200,
    );
    expect(relayProbeVerdict(r)).toBe("ok");
    expect(r.unauthorized).toBe(true);
    expect(r.errors).toHaveLength(1);
  });

  it("ONLY a relay candidate counts, even under a relay-only policy", () => {
    // A UA that ignores `iceTransportPolicy` must not be able to make the relay
    // read as working — that is the one answer that must never be given wrongly.
    const r = summarizeRelayProbe(
      ["turn:a:3478"],
      [CAND("turn:a:3478", "host"), CAND(null, "srflx")],
      50,
    );
    expect(r.ok).toBe(false);
    expect(relayProbeVerdict(r)).toBe("unreachable");
  });

  it("de-duplicates the URLs but counts every candidate", () => {
    const r = summarizeRelayProbe(
      ["turn:a:3478"],
      [CAND("turn:a:3478", "relay"), CAND("turn:a:3478", "relay")],
      50,
    );
    expect(r.relayUrls).toEqual(["turn:a:3478"]);
    expect(r.relayCandidates).toBe(2);
  });

  it("reads the candidate type off the raw string when the field is absent", () => {
    // Some engines report `type` and some do not; treating an unreported type as
    // "not a relay" would make a working relay read as unreachable.
    expect(parseCandidateType({ candidate: "candidate:1 1 udp 41885 1.2.3.4 5 typ relay raddr" }))
      .toBe("relay");
    expect(parseCandidateType({ type: "RELAY" })).toBe("relay");
    expect(parseCandidateType({ candidate: "garbage" })).toBeNull();
    expect(parseCandidateType(null)).toBeNull();
  });

  /* DRIVEN, because whether a relay candidate is gathered is exactly what a
     source pin cannot answer — and it is the whole feature. */
  function fakePc(script: (p: ProbePc) => void): { pc: ProbePc; closed: () => boolean } {
    let closed = false;
    const pc: ProbePc = {
      createDataChannel: () => ({}),
      createOffer: async () => ({ type: "offer", sdp: "v=0" }),
      setLocalDescription: async () => {
        // The browser starts gathering here, so the script runs on a later turn.
        setTimeout(() => script(pc), 0);
      },
      close: () => {
        closed = true;
      },
      onicecandidate: null,
      onicecandidateerror: null,
      onicegatheringstatechange: null,
      iceGatheringState: "new",
    };
    return { pc, closed: () => closed };
  }

  const TURN = [{ urls: "turn:a:3478", username: "u", credential: "c" }];

  it("DRIVEN: gathers a relay candidate and closes the connection", async () => {
    const f = fakePc((p) => {
      p.onicecandidate?.({
        candidate: { candidate: "candidate:1 1 udp 1 1.2.3.4 5 typ relay", url: "turn:a:3478" },
      });
      p.onicecandidate?.({ candidate: null });
    });
    const r = await probeRelayReachability({ servers: TURN, makePc: () => f.pc });
    expect(r.ok).toBe(true);
    expect(r.relayUrls).toEqual(["turn:a:3478"]);
    // A probe that leaked a peer connection per run would be worse than no probe.
    expect(f.closed()).toBe(true);
  });

  it("DRIVEN: a 401 during gathering is reported verbatim", async () => {
    const f = fakePc((p) => {
      p.onicecandidateerror?.({ url: "turn:a:3478", errorCode: 401, errorText: "Unauthorized" });
      p.iceGatheringState = "complete";
      p.onicegatheringstatechange?.();
    });
    const r = await probeRelayReachability({ servers: TURN, makePc: () => f.pc });
    expect(relayProbeVerdict(r)).toBe("unauthorized");
    expect(r.errors[0].code).toBe(401);
  });

  it("DRIVEN: it asks for a relay-only connection — nothing else can answer", async () => {
    let cfg: { iceTransportPolicy?: string } | null = null;
    const f = fakePc((p) => p.onicecandidate?.({ candidate: null }));
    await probeRelayReachability({
      servers: TURN,
      makePc: (c) => {
        cfg = c;
        return f.pc;
      },
    });
    expect(cfg!.iceTransportPolicy).toBe("relay");
  });

  it("DRIVEN: it opens a DATA CHANNEL, never media — no camera, no microphone", async () => {
    // Without a media section the offer gathers nothing, so a probe with no data
    // channel would report "unreachable" for a healthy relay. A data channel needs
    // no permission, which is what makes this safe behind a button.
    const labels: string[] = [];
    const f = fakePc((p) => p.onicecandidate?.({ candidate: null }));
    f.pc.createDataChannel = (l: string) => {
      labels.push(l);
      return {};
    };
    await probeRelayReachability({ servers: TURN, makePc: () => f.pc });
    expect(labels).toHaveLength(1);
    const src = codeOnly(read("client/src/lib/relayProbe.ts"));
    expect(src).not.toMatch(/getUserMedia|addTrack|addTransceiver/);
  });

  it("DRIVEN: a connection that never finishes is bounded by the timeout", async () => {
    const f = fakePc(() => {
      /* silence — the relay never answers */
    });
    const r = await probeRelayReachability({ servers: TURN, makePc: () => f.pc, timeoutMs: 20 });
    expect(relayProbeVerdict(r)).toBe("unreachable");
    expect(f.closed()).toBe(true);
  });

  it("DRIVEN: it NEVER throws — a diagnostic that explodes tells you less than one that reports", async () => {
    const r = await probeRelayReachability({
      servers: TURN,
      makePc: () => {
        throw new Error("no RTCPeerConnection here");
      },
    });
    expect(relayProbeVerdict(r)).toBe("unreachable");
  });

  it("DRIVEN: with no TURN configured it opens no connection at all", async () => {
    let built = 0;
    const r = await probeRelayReachability({
      servers: [{ urls: "stun:s:19302" }],
      makePc: () => {
        built++;
        return fakePc(() => {}).pc;
      },
    });
    expect(built).toBe(0);
    expect(relayProbeVerdict(r)).toBe("no-turn");
  });

  it("the admin panel mounts it, and loads the probe lazily", () => {
    const src = read("client/src/pages/app/Admin.tsx");
    /* THE MOUNT MUST RENDER, not merely appear. A first draft of this asserted
       `toMatch(/<RelaySelfTest \/>/)`, which `{false && <RelaySelfTest />}`
       satisfies untouched — so the card could have become unreachable with the
       assertion green, which is exactly the pin-the-presence-not-the-behaviour
       class this repo keeps re-learning. The mount is a bare JSX child, so its
       own line begins with the element and cannot be the right-hand side of a
       gate or a ternary. */
    const mount = src.split("\n").filter((l) => l.includes("<RelaySelfTest"));
    expect(mount).toHaveLength(1);
    expect(mount[0].trim().startsWith("<RelaySelfTest")).toBe(true);
    // The heavy half is behind the button; the page costs nothing extra to open.
    expect(codeOnly(src)).toMatch(/import\("@\/lib\/relayProbe"\)/);
    // Live credentials from the endpoint that exists for exactly this, so the
    // question is answerable with no call up.
    expect(src).toMatch(/fetch\("\/api\/relay\/ice"/);
  });
});

/* ── 3. THE BLANK-CREDENTIAL GUARD ──────────────────────────────────────────── */

describe("v2.107.10 (3) — a credential-less TURN entry can never reach a peer connection", () => {
  it("drops a TURN entry with no username or credential", () => {
    const { kept, dropped } = usableIceServers([
      { urls: "turn:a:3478" },
      { urls: "turn:b:3478", username: "u" },
      { urls: "turn:c:3478", username: "u", credential: "" },
      { urls: "turn:d:3478", username: "u", credential: "c" },
    ]);
    expect(kept.map((k) => k.urls)).toEqual(["turn:d:3478"]);
    expect(dropped).toHaveLength(3);
  });

  it("a STUN entry passes through untouched — it carries no credentials by design", () => {
    const { kept, dropped } = usableIceServers([
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stuns:s:5349" },
    ]);
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });

  it("`turns:` is guarded too, and the scheme test is case-insensitive", () => {
    expect(urlNeedsCredentials("turns:a:5349?transport=tcp")).toBe(true);
    expect(urlNeedsCredentials("TURN:a:3478")).toBe(true);
    expect(urlNeedsCredentials("stun:a:19302")).toBe(false);
  });

  it("an entry it cannot parse is KEPT — dropping the unknown is what costs a call", () => {
    expect(urlNeedsCredentials("")).toBe(false);
    expect(urlNeedsCredentials(":3478")).toBe(false);
    expect(urlNeedsCredentials(undefined)).toBe(false);
    const { kept } = usableIceServers([{ urls: "weird" } as { urls: string }]);
    expect(kept).toHaveLength(1);
  });

  it("an empty or absent list is not an error", () => {
    expect(usableIceServers([]).kept).toEqual([]);
    expect(usableIceServers(null).kept).toEqual([]);
    expect(usableIceServers(undefined).dropped).toEqual([]);
  });

  it("`buildIceConfig` applies it — the ONE funnel every ICE swap passes through", () => {
    const src = codeOnly(read("client/src/lib/relayClient.ts"));
    const at = src.indexOf("function buildIceConfig(");
    expect(at).toBeGreaterThan(0);
    const body = src.slice(at, src.indexOf("\n}", at));
    expect(body).toMatch(/usableIceServers\(servers\)/);
    // The FILTERED list is what reaches the config — pinning that the helper is
    // called says nothing about whether its answer is used.
    expect(body).toMatch(/iceServers: kept,/);
    expect(body).not.toMatch(/iceServers: servers,/);
  });

  it("the connect-speed tuning survives the change", () => {
    // A guard that quietly dropped max-bundle would make the audio/video split the
    // incident report describes newly POSSIBLE, which would be the worst outcome.
    const src = codeOnly(read("client/src/lib/relayClient.ts"));
    const at = src.indexOf("function buildIceConfig(");
    const body = src.slice(at, src.indexOf("\n}", at));
    expect(body).toMatch(/bundlePolicy: "max-bundle"/);
    expect(body).toMatch(/rtcpMuxPolicy: "require"/);
    expect(body).toMatch(/iceCandidatePoolSize:/);
  });

  it("the drop is LOUD — it should never happen, and the URL is what identifies it", () => {
    const src = codeOnly(read("client/src/lib/relayClient.ts"));
    const at = src.indexOf("function buildIceConfig(");
    const body = src.slice(at, src.indexOf("\n}", at));
    expect(body).toMatch(/console\.warn\(/);
    expect(body).toMatch(/dropped\.map\(d => d\.urls\)/);
  });

  it("the server still emits no credential-less TURN entry — the other end of the same rule", () => {
    /* The guard is a BACKSTOP, not a licence for the server to get this wrong, and
       the report's whole premise is that a blank-credentialed entry came from
       somewhere. So this reads every `list.push` in `iceServers()` and requires
       each one whose url is a turn/turns scheme to carry BOTH halves on the same
       object. Counting the pushes as well means a new emitter that forgot them
       cannot hide behind its neighbours. */
    const src = codeOnly(read("server/relay.ts"));
    const at = src.indexOf("export function iceServers(");
    expect(at).toBeGreaterThan(0);
    const body = src.slice(at, src.indexOf("\n}", at));
    const pushes = body.match(/list\.push\(\{[\s\S]*?\}\);/g) || [];
    // Vacuity guard: a slice that read nothing would satisfy every `every` below.
    expect(pushes.length).toBeGreaterThanOrEqual(4);
    const turnPushes = pushes.filter((p) => /urls: "turns?:|urls: "turn:/.test(p));
    expect(turnPushes.length).toBeGreaterThanOrEqual(4);
    for (const p of turnPushes) {
      // Either the minted pair by name, or the spread of an object that holds it.
      expect(/username/.test(p) || /\.\.\.\w+/.test(p)).toBe(true);
      expect(/credential/.test(p) || /\.\.\.\w+/.test(p)).toBe(true);
    }
  });
});
