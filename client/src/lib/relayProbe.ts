/**
 * The force-relay self-test.
 *
 * WHAT QUESTION IT ANSWERS. An operator report from the coturn logs said most
 * TURN sessions arrive with no credential, and concluded the app must be racing
 * the credential fetch. Reading the source refutes that specific mechanism, and
 * an argument between a log and a source reading is not a thing to settle by
 * argument — so this settles it by MEASUREMENT: build a peer connection with
 * `iceTransportPolicy: "relay"`, which can gather NOTHING except through TURN,
 * and report what each relay actually did.
 *
 * THE THREE OUTCOMES ARE THE POINT, AND THEY NEED DIFFERENT FIXES:
 *   - a relay candidate is gathered      → the credentials this fleet mints WORK;
 *                                          a call that has no audio is failing
 *                                          somewhere else and the log is a symptom
 *                                          of something other than the credential.
 *   - `icecandidateerror` code 401       → coturn REFUSED the credential. That is
 *                                          the report's hypothesis, confirmed:
 *                                          a wrong/expired shared secret.
 *   - neither, within the budget         → nothing was refused, because nothing
 *                                          ANSWERED. A blocked port or an
 *                                          unreachable host — an infrastructure
 *                                          question, not a credential one.
 * Collapsing those into one boolean would send somebody to the wrong file, which
 * is the failure this whole exercise is about.
 *
 * CALL-INDEPENDENT BY CONSTRUCTION. It takes a server list rather than reaching
 * for a live call's config, so it can be run from `/api/relay/ice` with no call
 * up at all. That matters: the credential question should be answerable in one
 * tap at any time, not only while a call is in progress.
 *
 * PURE CORE, INJECTED GATHERING — the same split `callStats.ts` uses and for the
 * same reason: `summarizeRelayProbe` is where every judgement lives and it can be
 * driven with a table of events, while the part that owns a real
 * `RTCPeerConnection` is thin enough to read.
 */

import { urlNeedsCredentials, type IceServerLike } from "./iceGuard";

/** One thing the browser told us while gathering. */
export type RelayProbeEvent =
  | { type: "candidate"; candidateType: string | null; url: string | null }
  | { type: "error"; url: string | null; code: number | null; text: string };

export interface RelayProbeError {
  url: string | null;
  code: number | null;
  text: string;
}

export interface RelayProbeResult {
  /** At least one relay candidate was gathered — media CAN be relayed. */
  ok: boolean;
  /** The TURN URLs the probe was given, in order. */
  turnUrls: string[];
  /** The TURN URLs that actually produced a relay candidate. */
  relayUrls: string[];
  /** How many relay candidates arrived in total. */
  relayCandidates: number;
  /** Every `icecandidateerror`, verbatim — the URL, the STUN error code, the text. */
  errors: RelayProbeError[];
  /** Any error carrying STUN code 401, i.e. the credential was REFUSED. */
  unauthorized: boolean;
  /** Wall-clock the probe took, ms. */
  ms: number;
}

export type RelayProbeVerdict = "ok" | "unauthorized" | "unreachable" | "no-turn";

/**
 * Read the ICE candidate's type.
 *
 * Prefers the parsed `type` field and falls back to the candidate STRING, which
 * always carries `typ <type>` — some engines report the attribute and some do
 * not, and treating an unreported type as "not a relay" would make a working
 * relay read as unreachable, i.e. exactly the wrong answer.
 */
export function parseCandidateType(
  c: { candidate?: string; type?: string } | null | undefined,
): string | null {
  if (!c) return null;
  if (typeof c.type === "string" && c.type) return c.type.toLowerCase();
  const s = typeof c.candidate === "string" ? c.candidate : "";
  const m = /\btyp\s+([a-zA-Z]+)/.exec(s);
  return m ? m[1].toLowerCase() : null;
}

/** Reduce the gathered events to a verdict-ready record. Pure. */
export function summarizeRelayProbe(
  turnUrls: readonly string[],
  events: readonly RelayProbeEvent[],
  ms: number,
): RelayProbeResult {
  const relayUrls: string[] = [];
  const errors: RelayProbeError[] = [];
  let relayCandidates = 0;
  for (const e of events) {
    if (!e) continue;
    if (e.type === "candidate") {
      /* STRICTLY relay. `iceTransportPolicy: "relay"` should already make this
         the only kind that can arrive, but counting whatever turns up would let a
         host candidate from a UA that ignores the policy report the relay as
         working — the one answer that must never be given wrongly. */
      if (e.candidateType !== "relay") continue;
      relayCandidates++;
      if (e.url && relayUrls.indexOf(e.url) === -1) relayUrls.push(e.url);
    } else if (e.type === "error") {
      errors.push({ url: e.url ?? null, code: e.code ?? null, text: e.text || "" });
    }
  }
  return {
    ok: relayCandidates > 0,
    turnUrls: turnUrls.slice(),
    relayUrls,
    relayCandidates,
    errors,
    unauthorized: errors.some((x) => x.code === 401),
    ms,
  };
}

/**
 * The one-word answer.
 *
 * `ok` OUTRANKS `unauthorized` deliberately: with two relays configured, one
 * answering and one refusing, media can still be relayed — so the call is fine
 * and the 401 is a real but non-blocking finding the caller surfaces from
 * `errors`. Reporting the whole fleet as broken because one host is
 * misconfigured would be the false alarm that teaches an operator to stop
 * reading this.
 */
export function relayProbeVerdict(r: RelayProbeResult): RelayProbeVerdict {
  if (!r.turnUrls.length) return "no-turn";
  if (r.ok) return "ok";
  if (r.unauthorized) return "unauthorized";
  return "unreachable";
}

/** The minimum of `RTCPeerConnection` this probe uses, so it can be driven with a
 *  stand-in — whether a relay candidate is gathered is exactly what a source pin
 *  cannot answer, and it is the entire feature. */
export interface ProbePc {
  createDataChannel(label: string): unknown;
  createOffer(): Promise<unknown>;
  setLocalDescription(d: unknown): Promise<void>;
  close(): void;
  onicecandidate:
    | ((e: { candidate: { candidate?: string; type?: string; url?: string } | null }) => void)
    | null;
  onicecandidateerror: ((e: { url?: string; errorCode?: number; errorText?: string }) => void) | null;
  onicegatheringstatechange: (() => void) | null;
  iceGatheringState: string;
}

export const RELAY_PROBE_TIMEOUT_MS = 6000;

/**
 * Gather relay-only candidates from the given servers and report what happened.
 *
 * NEVER THROWS. This is a diagnostic reached from a screen somebody is already on
 * because something is wrong; a probe that explodes tells them less than one that
 * reports "unreachable". Every failure resolves to a result.
 */
export async function probeRelayReachability(opts: {
  servers: readonly IceServerLike[];
  makePc: (cfg: {
    iceServers: readonly IceServerLike[];
    iceTransportPolicy: "relay";
  }) => ProbePc;
  timeoutMs?: number;
  nowMs?: () => number;
}): Promise<RelayProbeResult> {
  const now = opts.nowMs || (() => Date.now());
  const t0 = now();
  const turnUrls: string[] = [];
  for (const s of opts.servers || []) {
    if (s && urlNeedsCredentials(s.urls)) turnUrls.push(s.urls);
  }
  // Nothing to probe: answer immediately rather than opening a connection that
  // cannot, by policy, gather anything at all.
  if (!turnUrls.length) return summarizeRelayProbe(turnUrls, [], now() - t0);

  const events: RelayProbeEvent[] = [];
  let pc: ProbePc | null = null;
  try {
    pc = opts.makePc({ iceServers: opts.servers, iceTransportPolicy: "relay" });
  } catch {
    return summarizeRelayProbe(turnUrls, events, now() - t0);
  }

  const budget = opts.timeoutMs ?? RELAY_PROBE_TIMEOUT_MS;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, budget);
    const p = pc as ProbePc;
    p.onicecandidate = (e) => {
      // A null candidate is the end-of-gathering sentinel, which is the signal to
      // stop waiting rather than something to record.
      if (!e || !e.candidate) {
        finish();
        return;
      }
      events.push({
        type: "candidate",
        candidateType: parseCandidateType(e.candidate),
        url: typeof e.candidate.url === "string" ? e.candidate.url : null,
      });
    };
    p.onicecandidateerror = (e) => {
      events.push({
        type: "error",
        url: e && typeof e.url === "string" ? e.url : null,
        code: e && typeof e.errorCode === "number" ? e.errorCode : null,
        text: e && typeof e.errorText === "string" ? e.errorText : "",
      });
    };
    p.onicegatheringstatechange = () => {
      if (p.iceGatheringState === "complete") finish();
    };
    /* A DATA CHANNEL, not a transceiver: an offer with no media section gathers
       no candidates at all, so without this the probe would report "unreachable"
       for a perfectly healthy relay. A data channel needs no permission, opens no
       camera and no microphone — which is what makes this safe to run from a
       settings screen. */
    (async () => {
      try {
        p.createDataChannel("relay-probe");
        const offer = await p.createOffer();
        await p.setLocalDescription(offer);
      } catch {
        finish();
      }
    })();
  });

  try {
    pc.close();
  } catch {
    /* a stand-in or a half-built connection must not turn a result into a throw */
  }
  return summarizeRelayProbe(turnUrls, events, now() - t0);
}
