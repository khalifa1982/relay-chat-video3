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

/* ────────────────────────────────────────────────────────────────────────────
 * PER-CONTACT RINGTONES (v2.107.64, QW-11)
 *
 * Variants of the same synthesized approach — no binary assets, same WebAudio
 * scheduling — so a contact can be given a distinct incoming sound. The DEFAULT
 * ("classic") is the signature motif above, referenced here so there is exactly
 * one source of truth for it; every other variant is a self-contained motif with
 * its own notes, timbre, loop length and level.
 *
 * A variant carries no label — the picker maps its `id` to a bilingual string in
 * `client/src/app/dict/calls.ts`, keeping this file pure (no i18n). Playback (the
 * call engine and the settings preview) reads a variant by id via `getRingtone`,
 * which falls back to `classic` for a null / unknown id, so an un-set contact and
 * a stale id both simply ring the default.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface RingtoneVariant {
  /** Stable id stored on the contact and resolved at ring time. */
  id: string;
  /** The motif — same shape the two players already schedule. */
  notes: RingNote[];
  /** Oscillator timbre. */
  wave: OscillatorType;
  /** Loop period, ms. */
  loopMs: number;
  /** Default peak gain for notes that don't override it. */
  peak: number;
}

export const DEFAULT_RINGTONE_ID = "classic";

export const RINGTONES: RingtoneVariant[] = [
  // The signature "din-DING" — the default, single-sourced from the spec above.
  { id: "classic", notes: RINGTONE_NOTES, wave: RINGTONE_WAVE, loopMs: RINGTONE_LOOP_MS, peak: RINGTONE_PEAK_GAIN },
  // Doorbell — a gentle descending major triad, softer and rounder.
  {
    id: "chime",
    notes: [
      { freq: 1318.51, at: 0.0, dur: 0.28 }, // E6
      { freq: 1046.5, at: 0.26, dur: 0.32 }, // C6
      { freq: 783.99, at: 0.54, dur: 0.6, gain: 0.24 }, // G5, longer tail
    ],
    wave: "sine",
    loopMs: 2400,
    peak: 0.26,
  },
  // Pulse — a quick urgent double-beep, brighter edge.
  {
    id: "pulse",
    notes: [
      { freq: 880.0, at: 0.0, dur: 0.12 }, // A5
      { freq: 880.0, at: 0.18, dur: 0.12 }, // A5 again
      { freq: 1174.66, at: 0.42, dur: 0.16 }, // D6 accent
    ],
    wave: "square",
    loopMs: 1800,
    peak: 0.22,
  },
  // Rising — an ascending arpeggio that climbs to a bright top note.
  {
    id: "rising",
    notes: [
      { freq: 523.25, at: 0.0, dur: 0.14 }, // C5
      { freq: 659.25, at: 0.14, dur: 0.14 }, // E5
      { freq: 783.99, at: 0.28, dur: 0.14 }, // G5
      { freq: 1046.5, at: 0.42, dur: 0.36 }, // C6
    ],
    wave: "triangle",
    loopMs: 2200,
    peak: 0.27,
  },
  // Mellow — a calm low two-note, easy on the ear for someone you don't need to jump for.
  {
    id: "mellow",
    notes: [
      { freq: 440.0, at: 0.0, dur: 0.34 }, // A4
      { freq: 329.63, at: 0.32, dur: 0.6, gain: 0.22 }, // E4, warm tail
    ],
    wave: "sine",
    loopMs: 2600,
    peak: 0.26,
  },
];

/** Resolve a variant by id — falls back to `classic` for null / unknown. */
export function getRingtone(id: string | null | undefined): RingtoneVariant {
  if (id) {
    const hit = RINGTONES.find((r) => r.id === id);
    if (hit) return hit;
  }
  return RINGTONES[0]; // classic
}

/** The set of valid ids — used to validate a stored/incoming choice server-side. */
export const RINGTONE_IDS: string[] = RINGTONES.map((r) => r.id);
