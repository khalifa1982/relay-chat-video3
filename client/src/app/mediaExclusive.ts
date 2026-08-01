/**
 * ONE THING PLAYS AT A TIME, AND A RUN OF VOICE NOTES PLAYS ITSELF THROUGH.
 *
 * Owner, verbatim: *"you cannot play two multimedia files in the same time. if you play
 * one anywhere in this system in the app cannot play another until that one's finished
 * … when I send several voices … it will run one by one … if they are below each other
 * it will run the first will end will go to the second … if they were separate message,
 * no it will only run one message."*
 *
 * ── WHY A DOCUMENT-LEVEL CAPTURE LISTENER ────────────────────────────────────────────
 * "Anywhere in this system" is a property of the APP, not of any one component, and the
 * app has five independent media surfaces today (the voice-note player, the media
 * lightbox, the story viewer's video and audio, the composer preview, the video-recorder
 * review). Wiring each one by hand is how the sixth comes to be written without it.
 *
 * `play` does NOT bubble, but it DOES capture — so a single listener on `document` in the
 * capture phase sees every `<audio>`/`<video>` in the tree, including elements mounted
 * later, with nothing to remember.
 *
 * ── THE ONE EXCLUSION, AND IT IS THE WHOLE SAFETY ARGUMENT ───────────────────────────
 * A LIVE CALL's remote audio is `<audio>` elements too (v2.106.51 gives every mesh peer
 * its own, appended to its tile so it is really in the document). Pausing one of those
 * would silence a call somebody is on — catastrophically worse than the bug being fixed,
 * and it would present as "the other person went quiet", which is the hardest class of
 * failure to trace. So anything inside the call surface is skipped, and that exclusion is
 * pinned by test rather than left as a comment.
 *
 * Note the direction this fails: an element we cannot classify is TREATED AS ORDINARY
 * media and paused. That is the recoverable direction — a tap replays it — whereas
 * failing the other way silences calls.
 */

/** The call engine's own root. Its media is never touched. */
const CALL_ROOT = ".relay-root";

/**
 * Detached elements — `new Audio(url)` is not in the document, so `document` never sees
 * its `play`. The voice-note player registers its element here so it both participates in
 * exclusivity and can be reached by the auto-advance.
 */
const detached = new Set<HTMLMediaElement>();

/** messageId → how to start that voice note. A callback rather than the element,
 *  because a note nobody has played yet has no element: the player builds it lazily. */
const voiceRuns = new Map<number, () => void>();

let installed = false;

function isCallMedia(el: HTMLMediaElement): boolean {
  try {
    return !!el.closest?.(CALL_ROOT);
  } catch {
    return false;
  }
}

/** Every media element this module is allowed to pause. */
function candidates(): HTMLMediaElement[] {
  const inDom =
    typeof document === "undefined"
      ? []
      : Array.from(document.querySelectorAll<HTMLMediaElement>("audio,video"));
  // `Array.from`, not a spread: spreading a Set needs `downlevelIteration` under this
  // repo's ES5 target — the trap recorded at v2.99.72, v2.99.98, v2.105.21 and v2.106.32.
  return [...inDom, ...Array.from(detached)];
}

/**
 * Pause everything except `keep`.
 *
 * Exported so a surface can claim playback for an element that is about to start, and
 * called by the capture listener for anything that started on its own.
 */
export function pauseOthers(keep: HTMLMediaElement | null): void {
  for (const el of candidates()) {
    if (el === keep) continue;
    if (isCallMedia(el)) continue;
    // A MUTED element is decoration, not playback — the conversation's video THUMBNAIL is
    // a muted `<video preload="metadata">` and pausing it would do nothing a user could
    // perceive while costing a needless DOM write per element per play.
    if (el.muted) continue;
    if (el.paused) continue;
    try {
      el.pause();
    } catch {
      /* an element mid-teardown is not a reason to fail the play that triggered this */
    }
  }
}

/** Install the one capture listener. Idempotent; safe to call from any surface. */
export function installExclusivePlayback(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener(
    "play",
    (e) => {
      const el = e.target as HTMLMediaElement | null;
      if (!el || typeof el.pause !== "function") return;
      if (isCallMedia(el)) return; // a call starting audio must pause nothing
      if (el.muted) return;
      pauseOthers(el);
    },
    true, // CAPTURE — `play` does not bubble
  );
}

/** Let a detached `new Audio()` take part in exclusivity and in the auto-advance. */
export function registerDetachedMedia(el: HTMLMediaElement): () => void {
  detached.add(el);
  return () => detached.delete(el);
}

/**
 * Register how to start the voice note carried by `messageId`, so the note BEFORE it in
 * the same run can hand over when it ends.
 */
export function registerVoiceNote(messageId: number, play: () => void): () => void {
  voiceRuns.set(messageId, play);
  return () => {
    if (voiceRuns.get(messageId) === play) voiceRuns.delete(messageId);
  };
}

/**
 * Play the next note of a run. Returns false when it could not.
 *
 * FAILS QUIETLY BY DESIGN: on iOS a programmatic `play()` on an element the user has not
 * touched can be refused outright, and a refused hand-over should leave the reader where
 * they are rather than surface an error about something they did not ask for. The chain
 * simply stops and the next note is one tap away.
 */
export function advanceVoiceRun(nextMessageId: number | null | undefined): boolean {
  if (nextMessageId == null) return false;
  const play = voiceRuns.get(nextMessageId);
  if (!play) return false;
  try {
    play();
    return true;
  } catch {
    return false;
  }
}
