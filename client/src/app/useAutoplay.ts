/**
 * SAFE AUTOPLAY (v2.107.22) — the fix for the first two REAL crashes the new
 * telemetry caught (crash_reports #5 and #6, within hours of it going live):
 *
 *   #5  Chrome/Android — "AbortError: The play() request was interrupted
 *       because the media was removed from the document" — a status closed
 *       while its video was still starting.
 *   #6  Safari/iPhone — "AbortError: The operation was aborted." — answering a
 *       waiting call tore down the outgoing call's media mid-start.
 *
 * The root cause is the JSX `autoPlay` ATTRIBUTE: the browser starts that play
 * internally, so its promise belongs to nobody — when the element unmounts (or
 * is paused by teardown) before playback engages, the rejection is UNCATCHABLE
 * from app code and lands as an unhandled AbortError. Every literal `.play()`
 * call in this codebase was already guarded; the attribute was the one starter
 * that couldn't be.
 *
 * This hook replaces the attribute with the same behaviour, owned:
 *   • play() is OURS, so the refusal/interruption is caught (an interrupted
 *     start on a dying element is not an error — the element is gone anyway;
 *     an autoplay REFUSAL just leaves the user one tap from the controls);
 *   • cleanup calls pause() BEFORE unmount, which settles any still-pending
 *     start deterministically instead of letting removal reject it.
 *
 * `key` re-runs the start when the SOURCE changes on a reused element (a
 * status advancing to its next item re-plays without a remount).
 */
import { useEffect, type RefObject } from "react";

export function useAutoplay(
  ref: RefObject<HTMLMediaElement | null>,
  key?: unknown
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    void el.play().catch(() => {
      /* refusal or interruption — both fine, see the header */
    });
    return () => {
      try {
        el.pause();
      } catch {
        /* a detached element's pause() must never throw a second problem */
      }
    };
  }, [ref, key]);
}
