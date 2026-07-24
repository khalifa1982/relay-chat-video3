/**
 * DTMF keypad tones (owner spec: "when you click on the numbers on the dial pad
 * you need to give a tone key like you're dialing").
 *
 * Real telephony DTMF: every key is a DUAL tone — one low (row) + one high
 * (column) sine played together. That pair is what makes a dial pad sound like
 * a phone rather than a generic beep, so we synthesize the genuine frequency
 * table rather than a single tone.
 *
 * Repo convention (see shared/ringtone.ts): sounds are synthesized at runtime
 * via WebAudio — no binary audio assets to ship or cache-bust.
 *
 * IMPORTANT (media-privacy): this is OUTPUT ONLY — it synthesizes with
 * oscillators, never opens a capture device and never builds a media-stream
 * source node, so it can NOT hold the microphone open or light the mic
 * indicator. (The capture-API names are deliberately not written here so a test
 * can assert this file contains none of them.) The single shared AudioContext is
 * created lazily on the first key press (a user gesture, so autoplay policies
 * allow it) and reused; `disposeDtmf()` closes it.
 */

/** Standard DTMF row (low) × column (high) frequency pairs, in Hz. */
const DTMF: Record<string, [number, number]> = {
  "1": [697, 1209],
  "2": [697, 1336],
  "3": [697, 1477],
  "4": [770, 1209],
  "5": [770, 1336],
  "6": [770, 1477],
  "7": [852, 1209],
  "8": [852, 1336],
  "9": [852, 1477],
  "*": [941, 1209],
  "0": [941, 1336],
  "#": [941, 1477],
};

/** Tone length — long enough to read as a dial tone, short enough to keep fast
 *  typing crisp (a real phone key click is ~70–100ms). */
const TONE_MS = 90;
/** Peak gain. Kept below the ringtone's 0.28 (shared/ringtone.ts) — this is a
 *  keypad tick, not an alert — but NOT quieter than that: the landing pad
 *  shipped at 0.045 and was measured inaudible over ambient noise even at full
 *  volume, so both pads now use the same 0.18. */
const PEAK = 0.18;
/** Never schedule a note at exactly `currentTime`: a few ms of lookahead keeps
 *  it out of the past if the clock advances between reading and scheduling. */
const LOOKAHEAD_S = 0.005;

type Ctor = typeof AudioContext;

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx && ctx.state !== "closed") return ctx;
  const Ctor: Ctor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Play the DTMF tone for one key. Best-effort and completely silent on failure
 * (no WebAudio, blocked autoplay, unknown key) — a keypad must never throw or
 * block the digit from being entered.
 */
export function playDtmf(key: string): void {
  const pair = DTMF[key];
  if (!pair) return;
  const ac = audioCtx();
  if (!ac) return;
  // A SUSPENDED context must finish resuming BEFORE the note is scheduled.
  // `resume()` is async and a suspended context's `currentTime` does not
  // advance, so scheduling in the same tick (as this did) pinned the note to a
  // timestamp that had already elapsed once the context actually started — the
  // classic iOS Web Audio race, which made the tone silent there. Resume first,
  // schedule in the callback.
  if (ac.state === "suspended") {
    void ac
      .resume()
      .then(() => fire(ac, pair))
      .catch(() => {});
    return;
  }
  fire(ac, pair);
}

function fire(ac: AudioContext, pair: [number, number]): void {
  if (ac.state !== "running") return;
  try {
    const now = ac.currentTime + LOOKAHEAD_S;
    const end = now + TONE_MS / 1000;
    // One shared gain envelope for both oscillators: a 6ms attack and a ramp to
    // silence, so the tone never clicks at either edge.
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(PEAK, now + 0.006);
    gain.gain.linearRampToValueAtTime(0.0001, end);
    gain.connect(ac.destination);
    const oscs = pair.map((freq) => {
      const o = ac.createOscillator();
      o.type = "sine"; // telephony DTMF is a pure sine pair
      o.frequency.setValueAtTime(freq, now);
      o.connect(gain);
      o.start(now);
      o.stop(end + 0.02);
      return o;
    });
    // Release the nodes once the tone has finished (they are one-shot).
    const last = oscs[oscs.length - 1];
    if (last) {
      last.onended = () => {
        oscs.forEach((o) => {
          try {
            o.disconnect();
          } catch {
            /* already gone */
          }
        });
        try {
          gain.disconnect();
        } catch {
          /* already gone */
        }
      };
    }
  } catch {
    /* keypad audio is decorative — never let it break dialing */
  }
}

/** Close the shared context (called when the dial pad unmounts). */
export function disposeDtmf(): void {
  if (!ctx) return;
  const c = ctx;
  ctx = null;
  try {
    if (c.state !== "closed") void c.close().catch(() => {});
  } catch {
    /* ignore */
  }
}
