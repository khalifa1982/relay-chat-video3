/**
 * RELAY's signature incoming-call ringtone — ONE spec, two players:
 * the call engine (client/src/lib/relayClient.ts playRingtone) and the
 * Profile "Test ringtone" preview (client/src/app/notifications.ts).
 *
 * Design brief (user spec): a DISTINCT custom sound — instantly
 * distinguishable from stock system notifications — at a fixed
 * MEDIUM-LOUD level: clearly audible across a room, deliberately below
 * "max loud" so it never startles. Synthesized at runtime via WebAudio
 * (repo convention: no binary sound assets to ship or cache-bust).
 *
 * The motif: a bright two-note "din-DING" (B5 → E6, triangle wave)
 * echoed once with a longer tail, over a soft low-octave warmth layer —
 * reads as a phone, sounds like nobody else's.
 */

export interface RingNote {
  /** Oscillator frequency, Hz. */
  freq: number;
  /** Offset from the start of one loop, seconds. */
  at: number;
  /** Note length, seconds (gain ramps to silence by then). */
  dur: number;
  /** Per-note peak gain override (defaults to RINGTONE_PEAK_GAIN). */
  gain?: number;
}

export const RINGTONE_NOTES: RingNote[] = [
  // Bar 1 — "din-DING"
  { freq: 987.77, at: 0.0, dur: 0.16 }, // B5
  { freq: 1318.51, at: 0.14, dur: 0.3 }, // E6
  { freq: 659.25, at: 0.14, dur: 0.3, gain: 0.1 }, // E5 warmth layer
  // Bar 2 — the echo, longer tail
  { freq: 987.77, at: 0.52, dur: 0.16 },
  { freq: 1318.51, at: 0.66, dur: 0.46 },
  { freq: 659.25, at: 0.66, dur: 0.46, gain: 0.1 },
];

/** One loop every 2.6s — enough silence between bars to stay pleasant. */
export const RINGTONE_LOOP_MS = 2600;

/**
 * MEDIUM-LOUD peak gain. 0.28 sits well above the old barely-audible 0.12
 * and clearly below the ~0.5+ that reads as "max volume" on phone speakers.
 */
export const RINGTONE_PEAK_GAIN = 0.28;

/** Oscillator timbre for the motif (bright but soft-edged). */
export const RINGTONE_WAVE: OscillatorType = "triangle";
