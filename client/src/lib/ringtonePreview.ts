/**
 * RINGTONE PREVIEW (v2.107.64, QW-11).
 *
 * Plays a ringtone variant ONCE, for the contact-settings picker. Deliberately
 * self-contained and NOT coupled to the call engine: it runs on its own short-lived
 * AudioContext created inside the tap handler, so the browser's autoplay policy is
 * satisfied by the user gesture (unlike an incoming ring, which the engine has to
 * pre-arm). It schedules the same note shape the engine does, so what you hear in
 * the picker is what a caller will ring — but it never loops, and it tears its
 * context down after the motif, so a preview can't linger or stack.
 */
import { getRingtone } from "@shared/ringtone";

let activeCtx: AudioContext | null = null;

/** Play one pass of the variant identified by `id` (falls back to "classic"). */
export function previewRingtone(id: string | null | undefined): void {
  const variant = getRingtone(id);
  try {
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as
      | typeof AudioContext
      | undefined;
    if (!Ctx) return;
    // Stop any preview still ringing so taps don't overlap into noise.
    stopPreview();
    const ctx = new Ctx();
    activeCtx = ctx;
    void ctx.resume();
    const now = ctx.currentTime;
    let tail = 0;
    for (const n of variant.notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = variant.wave;
      osc.frequency.value = n.freq;
      const t0 = now + n.at;
      const peak = n.gain ?? variant.peak;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + n.dur + 0.05);
      tail = Math.max(tail, n.at + n.dur);
    }
    // Close the context shortly after the last note so previews don't leak contexts.
    const closeAt = ctx;
    window.setTimeout(() => {
      try { void closeAt.close(); } catch { /* already closed */ }
      if (activeCtx === closeAt) activeCtx = null;
    }, (tail + 0.3) * 1000);
  } catch {
    /* best-effort — a silent preview is fine */
  }
}

/** Tear down any preview currently sounding. */
export function stopPreview(): void {
  if (activeCtx) {
    try { void activeCtx.close(); } catch { /* already closed */ }
    activeCtx = null;
  }
}
