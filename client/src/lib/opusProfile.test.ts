/**
 * v2.107.72 — the voice-mode audio profile, on the transport that carries calls:
 * Opus, 32 kbps ceiling, FEC on, ptime 20 — and DTX OFF, actively stripped.
 *
 * DTX WAS REMOVED BECAUSE THE OWNER COULD HEAR IT. v2.106.57 enabled `usedtx=1`
 * per the activation doc's bandwidth spec; on real devices the cost surfaced as a
 * periodic tick-tick in the speaker, during calls only — DTX stops the stream in
 * silence and the comfort-noise transitions around every speech pause click.
 * Opus VBR already spends almost nothing on silence, so the saving was small and
 * the artifact was not. The profile now SCRUBS `usedtx` from our offer AND answer:
 * DTX is a receiver preference (`usedtx=1` in our SDP asks the PEER to go
 * discontinuous toward us), so cleaning both descriptions turns it off in both
 * directions — the same deploy, because both ends are this web app.
 *
 * STILL MEASURED, STILL SDP-ONLY: `RTCRtpSender.setParameters` with
 * `encodings[0].dtx` is ACCEPTED WITHOUT THROWING and then silently dropped — the
 * key is absent when read straight back — so an API-level version of any of this
 * would read as done and change nothing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const CLIENT = readFileSync(resolve(root, "client/src/lib/relayClient.ts"), "utf8");
/** Comment SPANS stripped — this file's prose names the patterns it bans. */
const CODE = CLIENT.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/* The shipped function, re-declared so its BEHAVIOUR can be driven. A source pin
   cannot answer "does garbage SDP come back byte-identical", and that is the property
   the whole safety argument rests on. Pinned against the original below, because the
   one weakness of a re-declaration is the original changing underneath it. */
const OPUS_MAX_BITRATE = 32_000;
const OPUS_PTIME_MS = 20;
const OPUS_FMTP_RE = /^(a=fmtp:(\d+) ([^\r\n]*\buseinbandfec=1\b[^\r\n]*))$/m;
function tuneOpusSdp(sdp: string | null | undefined): string {
  const src = typeof sdp === "string" ? sdp : "";
  try {
    if (!src) return src;
    const m = src.match(OPUS_FMTP_RE);
    if (!m) return src;
    const params = m[3]
      .split(";")
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && !/^usedtx=/i.test(p));
    if (!params.some((p) => /^maxaveragebitrate=/i.test(p))) {
      params.push("maxaveragebitrate=" + OPUS_MAX_BITRATE);
    }
    const line = "a=fmtp:" + m[2] + " " + params.join(";");
    let next = src.replace(OPUS_FMTP_RE, () => line);
    if (!/^a=ptime:/m.test(next)) {
      next = next.replace(
        new RegExp("^(a=rtpmap:" + m[2] + " opus/48000/2)$", "m"),
        "$1\r\na=ptime:" + OPUS_PTIME_MS,
      );
    }
    return next;
  } catch { return src; }
}

/** What Chromium actually offers — copied from a real createOffer in this repo. */
const REAL_SDP = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8",
  "c=IN IP4 0.0.0.0",
  "a=rtpmap:111 opus/48000/2",
  "a=rtcp-fb:111 transport-cc",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "a=rtpmap:63 red/48000/2",
  "m=video 9 UDP/TLS/RTP/SAVPF 96",
  "a=rtpmap:96 VP8/90000",
].join("\r\n");

describe("v2.107.72 — the Opus profile: bitrate + ptime negotiated, DTX scrubbed", () => {
  it("adds an explicit bitrate ceiling and ptime 20, and requests NO DTX", () => {
    const out = tuneOpusSdp(REAL_SDP);
    const fmtp = out.split("\r\n").find(l => l.startsWith("a=fmtp:111"))!;
    expect(fmtp).not.toContain("usedtx");
    expect(fmtp).toContain("maxaveragebitrate=32000");
    expect(fmtp).toContain("useinbandfec=1");   // already there — must SURVIVE
    expect(out).toMatch(/^a=ptime:20$/m);
  });

  it("STRIPS a usedtx the browser (or an older build) put there", () => {
    /* This is the actual fix for the owner's speaker tick: DTX is a RECEIVER
       preference, so a `usedtx=1` we publish invites the peer to click at us.
       Merely not adding it would leave the v2.106.x token alive through any
       renegotiation of an old description; scrubbing kills it everywhere. */
    const pre = REAL_SDP.replace(
      "a=fmtp:111 minptime=10;useinbandfec=1",
      "a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1",
    );
    const out = tuneOpusSdp(pre);
    const fmtp = out.split("\r\n").find(l => l.startsWith("a=fmtp:111"))!;
    expect(fmtp).not.toContain("usedtx");
    expect(fmtp).toContain("minptime=10");           // neighbours survive the rebuild
    expect(fmtp).toContain("useinbandfec=1");
    expect(fmtp).toContain("maxaveragebitrate=32000");
  });

  it("keeps FEC and minptime rather than replacing the line", () => {
    /* FEC was already on by default; a rewrite that DROPPED it would trade one of the
       profile's parameters for another and read as progress. */
    const fmtp = tuneOpusSdp(REAL_SDP).split("\r\n").find(l => l.startsWith("a=fmtp:111"))!;
    expect(fmtp).toContain("minptime=10");
    expect(fmtp).toContain("useinbandfec=1");
  });

  it("the ptime line lands on the OPUS payload's rtpmap, not the video one", () => {
    /* The regex captures the payload number from the fmtp it matched, so a video
       rtpmap can never receive an audio ptime. */
    const out = tuneOpusSdp(REAL_SDP);
    const lines = out.split("\r\n");
    const at = lines.indexOf("a=ptime:20");
    expect(at).toBeGreaterThan(0);
    expect(lines[at - 1]).toBe("a=rtpmap:111 opus/48000/2");
  });

  it("FAILS TOWARD THE UNTOUCHED ORIGINAL — the whole safety argument", () => {
    /* This runs on the offer AND answer of EVERY call, so a misfire breaks calling
       outright. Anything unrecognisable must come back byte-identical. */
    const garbage = "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\n";
    expect(tuneOpusSdp(garbage)).toBe(garbage);
    expect(tuneOpusSdp("")).toBe("");
    expect(tuneOpusSdp(null)).toBe("");
    expect(tuneOpusSdp(undefined)).toBe("");
    // An audio m-line with NO recognisable Opus fmtp is left alone too.
    const noFmtp = "v=0\r\nm=audio 9 RTP/AVP 0\r\na=rtpmap:0 PCMU/8000\r\n";
    expect(tuneOpusSdp(noFmtp)).toBe(noFmtp);
  });

  it("is IDEMPOTENT — a renegotiation re-runs it", () => {
    /* ICE restart and the consent upgrade both create a fresh offer through the same
       funnel, so applying twice must not grow the line or add a second ptime. */
    const once = tuneOpusSdp(REAL_SDP);
    expect(tuneOpusSdp(once)).toBe(once);
    expect(once).not.toContain("usedtx");
    expect((once.match(/maxaveragebitrate=/g) || []).length).toBe(1);
    expect((once.match(/^a=ptime:/gm) || []).length).toBe(1);
  });

  it("keeps a peer's own ceiling and ptime — but still scrubs DTX", () => {
    /* A future Chromium's own maxaveragebitrate or ptime must not be overridden;
       usedtx is the ONE token this profile owns the removal of, whoever wrote it. */
    const pre = REAL_SDP
      .replace("a=fmtp:111 minptime=10;useinbandfec=1",
               "a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1;maxaveragebitrate=24000")
      .replace("a=rtpmap:111 opus/48000/2", "a=rtpmap:111 opus/48000/2\r\na=ptime:60");
    const out = tuneOpusSdp(pre);
    expect(out).not.toContain("usedtx");
    expect(out).toContain("maxaveragebitrate=24000");  // theirs, not ours
    expect(out).not.toContain("maxaveragebitrate=32000");
    expect(out).toContain("a=ptime:60");
    expect(out).not.toMatch(/^a=ptime:20$/m);
  });

  it("a multi-m-line SDP gets exactly ONE audio tune", () => {
    const two = REAL_SDP + "\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fmtp:111 minptime=10;useinbandfec=1";
    const out = tuneOpusSdp(two);
    // The regex is non-global by design: one call, one line, so a bundled SDP cannot
    // be half-rewritten into something inconsistent.
    expect((out.match(/maxaveragebitrate=32000/g) || []).length).toBe(1);
  });
});

describe("v2.107.72 — ONE funnel, so no signalling site can forget the profile", () => {
  it("setLocalDescription is called in exactly one place: the funnel", () => {
    /* Three call sites existed (the offer, the answer, the ICE-restart offer) and
       three is three chances to forget — including whichever is added next. */
    const calls = CODE.match(/\.setLocalDescription\(/g) || [];
    expect(calls.length).toBe(1);
    const fn = CODE.slice(CODE.indexOf("async function setLocalTuned"));
    expect(fn.slice(0, 400)).toMatch(/\.setLocalDescription\(/);
  });

  it("every description published to a peer went through the funnel", () => {
    for (const site of [
      "const offer = await peer.pc.createOffer();",
      "const answer = await peer.pc.createAnswer();",
      "const offer = await peer.pc.createOffer({ iceRestart: true });",
    ]) {
      const at = CODE.indexOf(site);
      expect(at, `missing site: ${site}`).toBeGreaterThan(0);
      // the very next setLocal in that region is the tuned one
      const after = CODE.slice(at, at + 300);
      expect(after, site).toMatch(/await setLocalTuned\(peer\.pc,/);
    }
  });

  it("the funnel tunes rather than passing the description straight through", () => {
    const fn = CODE.slice(CODE.indexOf("async function setLocalTuned"));
    expect(fn.slice(0, 400)).toMatch(/sdp: tuneOpusSdp\(desc\.sdp\)/);
  });

  it("the shipped source NEVER writes a usedtx token", () => {
    /* Belt to the behaviour tests' braces: the string "usedtx=1" appearing anywhere
       in shipped code (outside comments) would mean someone re-added the request.
       The only permitted mention is inside the STRIP filter's regex. */
    expect(CODE).not.toMatch(/usedtx=1/);
    const strips = CODE.match(/\^usedtx=/g) || [];
    expect(strips.length).toBeGreaterThanOrEqual(1);
  });

  it("the re-declared copy is BODY-IDENTICAL to the shipped function", () => {
    /* THE LOAD-BEARING PIN, AND IT TOOK THREE ATTEMPTS — recorded because each failure
       taught something. Eight tests above drive the COPY, so a source-only change
       reaches none of them; the copy is trustworthy only while this pin is COMPLETE.
       (a) Enumerating a few lines let "ptime is no longer added" and "FEC is dropped"
       both SURVIVE a mutation. (b) Comparing the statement SET failed on correct source,
       because the shipped ptime replacement spans three lines. (c) Comparing
       `String(tuneOpusSdp)` to the source ALSO failed on correct source — that is the
       TRANSPILED runtime form, with types erased and formatting normalised by esbuild,
       so it can never be byte-compared against TypeScript. So both texts are read FROM
       DISK and compared whitespace-free: exact, and immune to how either is wrapped or
       transpiled. */
    const TEST = readFileSync(resolve(root, "client/src/lib/opusProfile.test.ts"), "utf8");
    const strip = (t: string) =>
      t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/\s+/g, "");
    const cut = (text: string, from: string, to: string, what: string) => {
      const a = text.indexOf(from);
      expect(a, `${what}: start anchor missing`).toBeGreaterThan(0);
      const b = text.indexOf(to, a);
      expect(b, `${what}: end anchor missing`).toBeGreaterThan(a);
      return strip(text.slice(a, b));
    };
    const shipped = cut(CLIENT, "function tuneOpusSdp(", "\n  /** THE ONE FUNNEL.", "shipped");
    const copy = cut(TEST, "function tuneOpusSdp(", "\n/** What Chromium", "copy");
    expect(shipped.length, "the shipped body must be real").toBeGreaterThan(300);
    expect(copy).toBe(shipped);
    // The regex is shared shape too, and the constants come from the source, so a
    // retune of either cannot pass unnoticed.
    expect(CLIENT).toContain("const OPUS_MAX_BITRATE = 32_000;");
    expect(CLIENT).toContain("const OPUS_PTIME_MS = 20;");
    expect(strip(String(OPUS_FMTP_RE))).toBe(
      strip(CLIENT.slice(CLIENT.indexOf("const OPUS_FMTP_RE = ") + 21,
                         CLIENT.indexOf(";\n  function tuneOpusSdp"))));
  });

  it("the profile is NOT gated on voice mode — it is identical in both", () => {
    /* Audio is the same in voice and video mode, and a real VIDEO call was measured
       carrying the same fmtp. A `wantVideo`/voice condition reaching this would split
       one profile into two. */
    const fn = CODE.slice(CODE.indexOf("function tuneOpusSdp"),
                          CODE.indexOf("async function setLocalTuned"));
    expect(fn.length).toBeGreaterThan(200);
    expect(fn).not.toMatch(/wantVideo|voiceMode|isVoice|callIsGroup/);
  });

  it("DTX is not attempted through setParameters, which silently drops it", () => {
    /* MEASURED: Chromium accepts `encodings[0].dtx` without throwing and the key is
       ABSENT on read-back. Anyone reaching for that API here would ship a no-op. */
    expect(CODE).not.toMatch(/\.dtx\s*=/);
  });
});
