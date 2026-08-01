import { useEffect, useRef, useState } from "react";
import { Bell, Check, Mic, Pause, PhoneMissed, Send, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { RoleBadge } from "./VerifiedBadge";
import { uploadAttachment } from "@/lib/uploadAttachment";
import { recorderSupported, startVoiceRecording, type VoiceRecording } from "@/lib/voiceNote";
import { translate, useLocale, useT, type TKey } from "./i18n";

/* ============================================================================
   BOARD 2g — VOICEMAIL (with 5h's "VOICEMAIL — RECORDING (MAX 60S)" panel)
   ============================================================================

   WHAT THIS SCREEN ACTUALLY IS, established by reading before building. The
   handoff README's Screens list (line 71) describes an INBOX LIST — "rows:
   avatar, name+badge, waveform + duration, play button accent, transcript
   preview 2 lines, mono time". The BOARD's own frame is different: `2g
   Voicemail`, subtitle "No answer · leave a message", drawn as a 96px peer
   avatar over "Marcus is unavailable", a red recording chip, a 14-bar live
   waveform, and a bottom row of Discard (glass X) · a red pinging MICROPHONE ·
   Send (accent). That is precisely what this component already was: the card the
   CALLER sees after an unanswered dial.

   The two disagree, and the disagreement is already recorded — MISSING-FRAMES.md
   and CLAUDE.md (v2.106.11) both note that the README's Screens list and the
   board's own frame labels swap 2f/2g, and that THE BOARD IS THE SOURCE OF
   TRUTH. So the inbox-row description is the stale half of a known collision,
   and the frame to build is this one. Board 5h supplies the missing state as a
   "VOICEMAIL — RECORDING (MAX 60S)" panel whose mono readout is "0:23 / 1:00" —
   the exact format this card renders.

   THE INBOX LIST IS DECLINED BECAUSE THERE IS NO SURFACE FOR IT, said plainly:
   a received voicemail is an ordinary DM audio message carrying
   `meta:{voicemail:true}`. There is no voicemail screen, route, list query or
   anything that enumerates voicemails across threads — building one is a
   FEATURE (a query, a route, a tab entry, a read model), not a frame. Worth
   noting that the row's parts already exist where voicemails actually live:
   `Messages.tsx` draws the uppercase "Voicemail" label and `VoiceNotePlayer`
   already carries board 2f's ACCENT play button (shipped v2.106.18), a duration
   and a mono clock.

   THE 2-LINE TRANSCRIPT PREVIEW IS REFUSED OUTRIGHT. This app has no speech
   transcription anywhere — a sweep of client/, server/ and shared/ finds exactly
   one mention, in an unrelated test comment. A preview would therefore have to
   be invented at render time, i.e. a lie printed under somebody's name about
   words they said, which is the worst possible thing to fabricate because a
   wrong quotation is read as a quotation. If the owner wants it, it is a
   transcription service plus a column plus a cost decision.

   FOUR MORE BOARD/5h STRINGS DECLINED, each because it states something this app
   does not do:
     - "No answer after 30 seconds" — the no-answer backstop is 65_000ms
       (`relayClient.ts`). `reasonKey` below already answers correctly for all
       three real reasons and is pinned by `v29911OfflineCall.test.ts`.
     - "it's delivered encrypted, like everything else" — message bodies and
       attachments have no end-to-end encryption here (the storage proxy READS
       the bytes and streams them through the app server since v2.99.14, which
       end-to-end would preclude). The existing copy, which says the voice
       message lands in the chat and raises a "Voicemail" alert, is verifiable.
     - "They hear your greeting first" — there is no greeting feature.
     - "sending declines the call" — this card is only ever mounted AFTER a dial
       has ended (`phase === "idle"` in RelayEngine), so there is no live call
       left to decline.

   `relay-v2` ON THIS WRAPPER, and deliberately NOT `dark`. The shipped surface
   utilities are scoped `.relay-v2 X` (`.rcta`) or `.dark.relay-v2 X`
   (`.rsheet`), and `<html>` carries `relay-v2` from AppShell plus `dark` only in
   the dark theme. Carrying `relay-v2` here makes `.rcta` work regardless of how
   this overlay is reached; adding `dark` too would force a DARK sheet in the
   LIGHT theme, which is exactly what v2.106.10 avoided when it made `.rsheet`
   dark-scoped so the light theme stays byte-identical. `PasscodeGate` can carry
   both only because that screen was already unconditionally dark; this card is
   not — it has always been `bg-card`, i.e. light in the light theme.

   `.rscrim` IS DELIBERATELY NOT USED ON THE BACKDROP, and that is a reading of
   the CSS rather than a preference: `.rscrim` is a radial gradient that is fully
   TRANSPARENT for the inner 50% — it exists to sit over the background canvas.
   Putting it on a modal backdrop would let the app show straight through the
   middle of the screen, i.e. remove the dimming this card needs. The existing
   `bg-black/70 backdrop-blur-sm` stays.
   ========================================================================== */

export interface FailedDialInfo {
  pin: string;
  name: string | null;
  reason: string; // "no-answer" | "peer-rejected" | "server-error:offline"
}

/** Voicemail cap — carrier-style 60 seconds. */
export const VOICEMAIL_MAX_MS = 60_000;

/** The cycling accent AS A FILL, with a LITERAL fallback. `var(--rb, var(--rb))`
 *  is a custom-property CYCLE: it resolves to the guaranteed-invalid value and the
 *  browser DROPS the whole declaration, leaving no colour at all (v2.106.7).
 *
 *  FILLS ONLY. For accent TEXT use `text-primary`, which v2.106.4 repointed at
 *  `--rb` inside `.dark.relay-v2` and left a measured value in light — the raw
 *  variable as text is 1.68:1 on the white light card. This file used it for three
 *  text sites and that was a real AA failure, fixed in v2.106.26. */
const ACCENT = "var(--rb, #3FE0C5)";
/** The same hue at low alpha, for the paused waveform — one colour, not two. */
const ACCENT_DIM = "rgba(var(--rb-rgb, 63, 224, 197), 0.28)";

/* Exported as TEST SEAMS. A source pin cannot tell you whether the readout the
   recipient's sender sees actually counts up to the cap, or whether the three
   refusal reasons still read as three different honest sentences. */
export function fmtClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "1:00" — DERIVED from the cap, so the readout and the recorder's own ceiling
 *  cannot disagree. A literal here would go stale the moment the cap moves. */
export const CAP_LABEL = fmtClock(VOICEMAIL_MAX_MS / 1000);

/**
 * Which of the three honest reasons this dial ended on.
 *
 * A KEY RATHER THAN A SENTENCE, because this is a module-level pure function and a
 * module-level function cannot call a hook — the render site translates it. Returning
 * finished English here is exactly the shape that leaves a screen reporting itself as
 * translated while one line on it stays English (v2.106.91's finding, and the `ago()`
 * helper on the alert surfaces).
 *
 * THE THREE ARE DISTINCT ON PURPOSE and the distinction is the whole point of the
 * function: declined, offline and unanswered are three different facts about one call,
 * and this card is the one surface that knows which. Collapsing any two — in either
 * language — would make it guess.
 */
export function reasonKey(reason: string): TKey {
  if (reason === "peer-rejected") return "voicemail.reasonDeclined";
  if (reason === "server-error:offline") return "voicemail.reasonOffline";
  return "voicemail.reasonNoAnswer";
}

/**
 * The ENGLISH reading of `reasonKey`, DERIVED from it rather than a second mapping.
 *
 * Kept because it is the seam the tests were written against, and it is a better one
 * now than before: it proves the whole chain — reason → key → a dictionary entry whose
 * English half is that sentence — where it used to prove only its own `if` ladder.
 * Deriving rather than restating is what stops the two ever disagreeing about what
 * "offline" says, which is the class of drift this repo has paid for repeatedly.
 */
export function reasonLine(reason: string): string {
  return translate("en", reasonKey(reason));
}

function initialsOf(label: string): string {
  const parts = label.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/** The reason a send failed, as text to interpolate into a translated sentence.
 *  DELIBERATELY NOT TRANSLATED: this is the server's or the browser's own message, and
 *  inventing an Arabic rendering of it would be inventing the cause. */
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The callee's face (board 2g's 96px avatar, scaled to this compact card).
 *
 * DELIBERATELY NOT `PeerAvatar`, and the reason is structural rather than
 * stylistic: `PeerOverlays` imports `useRelayEngine`, which is a `const` export
 * of `RelayEngine` — and `RelayEngine` imports THIS file. Reusing PeerAvatar
 * would close the cycle RelayEngine → VoicemailPrompt → PeerOverlays →
 * RelayEngine with a const-initialised binding inside it, which is a TDZ hazard
 * in exactly the entry chunk that must never fail to evaluate. It would also
 * draw PeerAvatar's unseen-STORY ring on a decorative, non-clickable avatar —
 * a ring that means "tap me" everywhere else in the app.
 *
 * A photo that 403s/404s degrades to the initials disc, never the browser's
 * broken-image glyph (the `PeerAvatar` rule, kept).
 */
function CalleeAvatar({
  label,
  avatarUrl,
  size = 64,
}: {
  label: string;
  avatarUrl: string | null;
  size?: number;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = !!avatarUrl && failedUrl !== avatarUrl;
  return (
    <span className="relative inline-grid shrink-0 place-items-center">
      {showPhoto ? (
        <img
          src={avatarUrl!}
          alt=""
          style={{ width: size, height: size }}
          className="rounded-full border border-border/60 bg-muted/40 object-cover"
          onError={() => setFailedUrl(avatarUrl!)}
        />
      ) : (
        <span
          style={{ width: size, height: size, fontSize: Math.max(13, size * 0.34) }}
          className="grid place-items-center rounded-full bg-primary/15 font-bold text-primary"
        >
          {initialsOf(label)}
        </span>
      )}
      {/* The "this call didn't connect" marker, kept from the header tile this
          avatar replaces — destructive, because a missed call is the fact the
          card exists to report.

          `-end-`, not `-right-`: the marker rides the disc's TRAILING corner, so it
          belongs on the other side in Arabic. That is the same logical spelling the
          thread rows' and GroupInfoSheet's own avatar badges already use, so the app
          cannot end up with one badge flipping and another not. */}
      <span
        aria-hidden
        className="absolute -bottom-0.5 -end-0.5 grid size-6 place-items-center rounded-full border-2 border-card bg-destructive text-destructive-foreground"
      >
        <PhoneMissed className="size-3" />
      </span>
    </span>
  );
}

/**
 * Board 2g / 5h — the live recording panel.
 *
 * WHAT WAS MISSING, and it is genuinely new function rather than a restyle:
 * "Stop & send" was the ONLY exit from a live recording (the header X dismissed
 * the whole card), so a misfire, a cough or a change of mind had no way out
 * except sending the note and unsending it afterwards. That is exactly the gap
 * v2.99.72 fixed for the Messages composer and left unfixed on this second
 * surface. Discard now calls the existing `rec.cancel()`, which resolves `done`
 * null — the take is genuinely gone and the mic genuinely released — and
 * pause/resume route through the same shared handle.
 *
 * THE WAVEFORM IS REAL: `rec.level()` is RMS off a WebAudio analyser tapped from
 * the same MediaStream the recorder encodes, which is the whole reason v2.99.72
 * built it. A decorative animation would look identical while telling you
 * nothing, which was the owner's original complaint.
 *
 * The bars, the clock and the elapsed-vs-cap rail are written IMPERATIVELY from
 * ONE rAF loop, transform-only. A state update per frame would re-render this
 * card every frame (the v2.99.67 cost class), and animating width rather than
 * transform is what the standing keyframe guard exists to catch.
 */
function RecordPanel({
  get,
  paused,
  onTogglePause,
  onDiscard,
  onSend,
}: {
  /** Getter, not the handle: the recorder is replaced on each new take. */
  get: () => VoiceRecording | null;
  paused: boolean;
  onTogglePause: () => void;
  onDiscard: () => void;
  onSend: () => void;
}) {
  const { t, rtl } = useLocale();
  const BARS = 24;
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);
  const clockRef = useRef<HTMLSpanElement | null>(null);
  const fillRef = useRef<HTMLSpanElement | null>(null);
  const histRef = useRef<number[]>([]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      // ~20 samples/sec. Faster buys nothing at this bar width and costs battery
      // on a phone, which is a lesson this project has already paid for once.
      if (t - last < 50) return;
      last = t;
      const rec = get();
      const lvl = rec && !paused ? rec.level() : 0;
      const hist = histRef.current;
      hist.push(lvl);
      if (hist.length > BARS) hist.shift();
      for (let i = 0; i < BARS; i++) {
        const el = barsRef.current[i];
        if (!el) continue;
        // Newest sample on the RIGHT, so the wave scrolls the way people read.
        const v = hist[hist.length - BARS + i] ?? 0;
        el.style.transform = `scaleY(${0.12 + Math.min(1, v) * 0.88})`;
      }
      // `elapsedMs()` EXCLUDES paused time, so the clock and the rail both
      // describe the audio the recipient will actually hear. A wall-clock
      // `Date.now() - startedAt` — which is what this card used to do — over-
      // reports a paused take and would push the rail past a cap it never hit.
      const ms = rec ? rec.elapsedMs() : 0;
      if (clockRef.current) clockRef.current.textContent = fmtClock(ms / 1000);
      if (fillRef.current) {
        // BOUNDED to 1: a cap overrun must not render a fill wider than its rail.
        const frac = Math.max(0, Math.min(1, ms / VOICEMAIL_MAX_MS));
        fillRef.current.style.transform = `scaleX(${frac})`;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [get, paused]);

  return (
    <div className="space-y-3.5">
      {/* Board 5h's section label, in the board's mono 10px / .26em voice —
          the same voice the History day headers and the Contacts A–Z letters
          already use. */}
      <div className="text-center font-mono text-[10px] font-semibold uppercase tracking-[0.26em] text-muted-foreground">
        {t("voicemail.recordingLabel", { seconds: Math.round(VOICEMAIL_MAX_MS / 1000) })}
      </div>

      <div className="flex items-center gap-2.5 rounded-2xl border border-destructive/35 bg-destructive/10 px-3 py-2.5">
        {/* The dot stays RED. Red-means-recording is a convention older than this
            app and does not collide with destructive here, because the only
            destructive control in the panel is the Discard button, which is a
            bordered glass chip rather than a filled red one. */}
        <span
          aria-hidden
          className={
            "size-2 shrink-0 rounded-full " +
            (paused ? "bg-muted-foreground" : "bg-destructive motion-safe:animate-pulse")
          }
        />
        {/* `dir="ltr"` + isolation, because this is `elapsed / total` — two clock
            values either side of a slash, i.e. exactly the shape the bidi algorithm
            reorders. Digits are weak and `/` is neutral, so in an RTL paragraph
            "0:23 / 1:00" resolves the other way round and the readout claims the take
            is already over its cap. The app's other mono numerics carry the same pair
            (the thread stamps, the PIN tags). */}
        <span
          dir="ltr"
          className="shrink-0 font-mono text-xs font-semibold tabular-nums [unicode-bidi:isolate]"
        >
          <span ref={clockRef}>0:00</span> / {CAP_LABEL}
        </span>
        {/* The wave. aria-hidden because a screen reader gains nothing from 24
            bars — the state is announced by the buttons and the clock. */}
        <span
          aria-hidden
          className="flex h-6 min-w-0 flex-1 items-center gap-[2px] overflow-hidden"
        >
          {Array.from({ length: BARS }, (_, i) => (
            <span
              key={i}
              ref={(el) => {
                barsRef.current[i] = el;
              }}
              className="h-6 w-full min-w-[2px] origin-center rounded-full"
              style={{
                transform: "scaleY(0.12)",
                /* The ACCENT, matching the composer's 4d recording bar so the
                   app's two recording surfaces cannot come to disagree about
                   which colour "active" is. Never `--relay-online`: green means
                   ONLINE and nothing else (v2.106.18). */
                background: paused ? ACCENT_DIM : ACCENT,
              }}
            />
          ))}
        </span>
        {/* Board 5h's 26px pause circle. Reads the recorder's OWN state back
            rather than assuming, because an engine without MediaRecorder.pause
            leaves the recorder running — which is why `voiceNote.ts` exposes
            `state()` at all. */}
        {/* The BRANCH IS OUTSIDE `t()`, here and everywhere else on this card. A
            `t(paused ? "a" : "b")` type-checks and renders correctly, and is invisible
            to `copyOnScreen` — so a pin on owner-signed-off wording could no longer be
            written for it at all, which is a guard silently lost rather than a bug. */}
        <button
          type="button"
          onClick={onTogglePause}
          aria-label={paused ? t("voicemail.resumeRecording") : t("voicemail.pauseRecording")}
          title={paused ? t("voicemail.resume") : t("voicemail.pause")}
          className="grid size-[26px] shrink-0 place-items-center rounded-full bg-foreground/10 text-foreground transition active:scale-95"
        >
          {paused ? <Mic className="size-3" /> : <Pause className="size-3" />}
        </button>
      </div>

      {/* Elapsed-vs-cap rail (board 5h). Compositor-only: the fill is a scaleX
          transform off the LEADING edge, never an animated width.

          THE ORIGIN IS THE ONE THING HERE THAT CANNOT BE SWEPT TO A LOGICAL UTILITY:
          `transform-origin` takes physical keywords only — there is no `origin-start`
          in CSS, let alone in Tailwind — so a rail that fills left-to-right in Arabic
          would grow from the END of the line while the waveform beside it (an ordinary
          flex row, which `dir` flips for free) grows from the start. Two static class
          names picked by a ternary, never a composed one: a class assembled at render
          time is invisible to the JIT and comes out unstyled. */}
      <span aria-hidden className="block h-[3px] w-full overflow-hidden rounded-full bg-foreground/15">
        <span
          ref={fillRef}
          className={
            "block h-full w-full bg-destructive " + (rtl ? "origin-right" : "origin-left")
          }
          style={{ transform: "scaleX(0)" }}
        />
      </span>

      {/* Board 2g's bottom row: Discard · the recording indicator · Send. */}
      <div className="flex items-end justify-center gap-8 pt-1">
        <button
          type="button"
          onClick={onDiscard}
          aria-label={t("voicemail.discardRecording")}
          title={t("voicemail.discardRecording")}
          className="flex flex-col items-center gap-1.5 transition active:scale-95"
        >
          <span className="grid size-[54px] place-items-center rounded-full border border-border bg-foreground/[0.07] text-foreground">
            <X className="size-5" />
          </span>
          <span className="text-[10.5px] text-muted-foreground">{t("voicemail.discard")}</span>
        </button>

        {/* The centre of board 2g is a red pinging MICROPHONE — an indicator,
            not a control. It is deliberately NOT a second stop button: in this
            app stopping IS sending (`rec.done` uploads the moment the recorder
            stops), so two controls would either do one thing twice or leave one
            silently doing nothing. */}
        <div className="flex flex-col items-center gap-1.5">
          <span aria-hidden className="relative grid size-[66px] place-items-center">
            {!paused && (
              /* `pointer-events-none` IS LOAD-BEARING, not tidiness. `relayPing`
                 scales to 2.8, so this 66px box paints and HIT-TESTS out to
                 ~185px — ±59px past its own edge — while Discard and Send sit
                 32px away in the same `gap-8` row. Without the guard the halo
                 covers the inner ~27px of BOTH 54px buttons, and because it is
                 positioned while they are static it hit-tests ABOVE them
                 whatever the DOM order; hit-testing ignores opacity, and the
                 easing holds the grown state for most of every 1.8s cycle. The
                 result was that the two ONLY exits from a recording were
                 half-untappable. This repo has paid for this class twice
                 (v2.105.21's readout over the hang-up, v2.106.13's footer over
                 the lightbox backdrop) — a mutation removing it bites. */
              <span
                className="pointer-events-none absolute inset-0 rounded-full bg-destructive motion-safe:[animation:relayPing_1.8s_cubic-bezier(0,0,.2,1)_infinite]"
              />
            )}
            <span className="absolute inset-0 grid place-items-center rounded-full bg-destructive text-destructive-foreground">
              <Mic className="size-6" />
            </span>
          </span>
          <span className="text-[10.5px] font-semibold text-destructive">
            {paused ? t("voicemail.paused") : t("voicemail.recording")}
          </span>
        </div>

        <button
          type="button"
          onClick={onSend}
          aria-label={t("voicemail.sendVoicemail")}
          title={t("voicemail.sendThisVoiceMessage")}
          className="flex flex-col items-center gap-1.5 transition active:scale-95"
        >
          <span className="rcta grid size-[54px] place-items-center rounded-full">
            <Send className="size-5" />
          </span>
          <span className="text-[10.5px] font-semibold text-primary">{t("voicemail.send")}</span>
        </button>
      </div>

      {/* RESTORED (v2.106.26). The reskin deleted "Recording stops automatically at
          60 seconds." — the only place the app said that hitting the cap also SENDS
          the take — and it was deleted not by choice but because this frame's own
          test banned every second-duration in the file, honest ones included. It
          matters more now than before: the panel gained a separate Pause and a
          separate Discard, so Send is the ONLY remaining stop and nothing else on
          screen says so. Derived from the constant, never written as a literal, so
          the copy cannot promise a ceiling the recorder does not enforce. */}
      <p className="text-center text-[11px] text-muted-foreground">
        {t("voicemail.autoStop", { seconds: Math.round(VOICEMAIL_MAX_MS / 1000) })}
      </p>
    </div>
  );
}

/**
 * Post-dial voicemail card (v2.88). Raised by the call engine's onDialFailed
 * hook when a 1:1 outgoing dial ends unconnected (no answer / declined /
 * offline): offers to record a ≤60s voice message — delivered as a normal
 * chat AUDIO message tagged meta:{voicemail:true} into the caller↔callee DM
 * thread (zero new server infrastructure) — and to register a "tell me when
 * they're back online" alert (the v2.88 call-back watch).
 */
export function VoicemailPrompt({ info, onClose }: { info: FailedDialInfo; onClose: () => void }) {
  const t = useT();
  const openThread = trpc.messages.openThread.useMutation();
  const sendMessage = trpc.messages.send.useMutation();
  const watchOnline = trpc.directory.watchOnline.useMutation();

  /* The callee's face + tier badge (board 2g / the README row's "avatar,
     name+badge" — the one item common to BOTH readings of the frame).
     `directory.lookup` already returns avatarUrl, displayName and the
     three-tier role for a number, so this is a gap rather than new data.

     PURELY ADDITIVE: no photo, no badge and no name on failure or while in
     flight, and never a blocking state. This endpoint is `directoryGate`-
     limited and can legitimately refuse, and a decoration must never be the
     reason somebody cannot leave a voicemail (the v2.105.26 rule that a masked
     -number hint fails to null rather than breaking a sign-in). */
  const peer = trpc.directory.lookup.useQuery(
    { number: info.pin },
    { enabled: /^\d{6}$/.test(info.pin), staleTime: 60_000, retry: false },
  );

  const [recState, setRecState] = useState<"idle" | "recording" | "sending" | "sent">("idle");
  const [paused, setPaused] = useState(false);
  const [watched, setWatched] = useState(false);
  // Text-message composer (v2.99.11): the offline card lets you drop a quick
  // written message into the DM thread without leaving the call flow.
  const [text, setText] = useState("");
  const [textState, setTextState] = useState<"idle" | "sending" | "sent">("idle");
  const recRef = useRef<VoiceRecording | null>(null);
  // Still mounted? Guards the mic-acquisition await (v2.99.36) and releases a
  // live recording if the prompt closes mid-record — otherwise the microphone
  // stays captured with no handle left to stop it.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      try { recRef.current?.cancel(); } catch { /* */ }
      recRef.current = null;
    };
  }, []);

  // Unmount safety: never leave the mic live.
  useEffect(() => {
    return () => {
      recRef.current?.cancel();
      recRef.current = null;
    };
  }, []);

  const who = info.name || peer.data?.displayName || info.pin;

  async function beginRecording() {
    if (!recorderSupported()) {
      toast.error(t("voicemail.notSupported"));
      return;
    }
    try {
      const rec = await startVoiceRecording({ maxMs: VOICEMAIL_MAX_MS });
      if (!aliveRef.current) { rec.cancel(); return; }
      recRef.current = rec;
      setPaused(false);
      setRecState("recording");
      void rec.done.then(async (result) => {
        recRef.current = null;
        setPaused(false);
        if (!result) {
          // Cancelled (Discard) or empty: back to the idle card, nothing sent.
          setRecState("idle");
          return;
        }
        setRecState("sending");
        try {
          const uploaded = await uploadAttachment(result.blob, {
            filename: `voicemail.${result.ext}`,
            mimeType: result.blob.type,
            durationMs: result.durationMs,
          });
          const thread = await openThread.mutateAsync({ number: info.pin });
          await sendMessage.mutateAsync({
            conversationId: thread.conversationId,
            kind: "audio",
            body: null,
            attachmentId: uploaded.id,
            meta: { voicemail: true },
          });
          setRecState("sent");
          toast.success(t("voicemail.sentTo", { who }));
          window.setTimeout(onClose, 1400);
        } catch (err) {
          setRecState("idle");
          /* The underlying reason is INTERPOLATED INTO the sentence rather than
             concatenated onto it: Arabic does not put the cause where English does, and
             a sentence chopped at the English seam can only be re-assembled into
             nonsense. `err.message` is the server's or the browser's own text and stays
             untranslated — it is not ours to reword. */
          toast.error(t("voicemail.sendFailed", { error: errText(err) }));
        }
      });
    } catch (err) {
      toast.error(t("voicemail.micRequired", { error: errText(err) }));
    }
  }

  /** Send = stop the recorder; `rec.done` uploads and posts it. */
  function stopRecording() {
    recRef.current?.stop();
  }

  /** Discard the take. `cancel()` resolves `done` null, so nothing is sent and
   *  the mic is released by the same path a normal stop uses. */
  function discardRecording() {
    recRef.current?.cancel();
  }

  function togglePause() {
    const rec = recRef.current;
    if (!rec) return;
    if (rec.state() === "recording") rec.pause();
    else rec.resume();
    // Read the recorder's own state BACK rather than assuming the call took.
    setPaused(rec.state() === "paused");
  }

  async function sendText() {
    const body = text.trim();
    if (!body || textState === "sending") return;
    setTextState("sending");
    try {
      const thread = await openThread.mutateAsync({ number: info.pin });
      await sendMessage.mutateAsync({ conversationId: thread.conversationId, kind: "text", body });
      setTextState("sent");
      toast.success(t("voicemail.messageSentTo", { who }));
      window.setTimeout(onClose, 1200);
    } catch (err) {
      setTextState("idle");
      toast.error(t("voicemail.messageFailed", { error: errText(err) }));
    }
  }

  async function requestWatch() {
    try {
      await watchOnline.mutateAsync({ number: info.pin });
      setWatched(true);
      toast.success(t("voicemail.watchSet", { who }));
    } catch (err) {
      // The server's own refusal wins when there is one — it says which rule was hit.
      // Only the fallback, which is ours, is translated.
      toast.error(err instanceof Error ? err.message : t("voicemail.watchFailed"));
    }
  }

  return (
    <div
      className="relay-v2 fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-label={t("voicemail.didntConnect", { who })}
    >
      <div className="rsheet w-[min(94vw,400px)] rounded-3xl border border-border bg-card p-5 shadow-2xl">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("voicemail.dismiss")}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Board 2g's hierarchy: avatar · title · explainer, centred. The
            explainer stays `reasonKey`, because this app knows which of three
            things happened and already says so honestly — in either language,
            since the key is what the render site translates. */}
        <div className="mb-4 flex flex-col items-center px-2 text-center">
          <CalleeAvatar label={who} avatarUrl={peer.data?.avatarUrl ?? null} />
          <div className="mt-3 flex items-center justify-center gap-1.5">
            {/* `dir="auto"`, not `dir="ltr"`: `who` is a display NAME (which may itself
                be Arabic) OR, when the lookup has not resolved, the callee's 6-digit
                RELAY number. Forcing LTR would lay an Arabic name out backwards;
                `auto` resolves per value and a pure-digit string still renders LTR. */}
            <span dir="auto" className="text-[17px] font-bold leading-tight">
              {who}
            </span>
            <RoleBadge role={peer.data?.role ?? null} size={14} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{t(reasonKey(info.reason))}</div>
        </div>

        {recState === "recording" ? (
          <RecordPanel
            get={() => recRef.current}
            paused={paused}
            onTogglePause={togglePause}
            onDiscard={discardRecording}
            onSend={stopRecording}
          />
        ) : recState === "sending" ? (
          <div className="py-3 text-center text-sm text-muted-foreground">
            {t("voicemail.sendingVoicemail")}
          </div>
        ) : recState === "sent" ? (
          /* The ACCENT, not `--relay-online`: green means ONLINE and nothing else in
             this app, and a "sent" tick is not a presence statement (v2.106.18).
             BUT VIA `text-primary`, NOT the raw `var(--rb)`. v2.106.4 repointed
             `--primary` at `--rb` inside `.dark.relay-v2` PRECISELY so accent UI
             follows the cycling hue automatically, and left light theme its own
             measured value — because the accent is built for a near-black card and
             its default teal is 1.68:1 on the white light card, which fails AA for
             anything small (index.css says so in as many words, and it is the
             measurement that forced `--relay-green-text` to exist in v2.99.86).
             Reaching for `var(--rb)` directly routes around that indirection and
             lands at 1.68:1; `text-primary` is 4.84:1 in light and IS the cycling
             accent in dark, where it measures 11.17:1. One token, both themes. */
          <div className="flex items-center justify-center gap-2 py-3 text-sm text-primary">
            <Check className="size-4" /> {t("voicemail.voicemailSent")}
          </div>
        ) : (
          <div className="space-y-2">
            {/* Send a written message (v2.99.11) — a quick text into the DM. */}
            {/* `ps-3`, not `pl-3`: the extra padding belongs on the side the text
                STARTS from, which is the right-hand side in Arabic. */}
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/20 p-1.5 ps-3">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendText(); }}
                disabled={textState !== "idle"}
                placeholder={t("voicemail.messagePlaceholder", { who })}
                aria-label={t("voicemail.messageLabel", { who })}
                maxLength={2000}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={sendText}
                disabled={!text.trim() || textState !== "idle"}
                aria-label={t("voicemail.sendMessage")}
                className="rcta grid size-9 shrink-0 place-items-center rounded-xl transition-transform active:scale-95 disabled:opacity-40"
              >
                {textState === "sent" ? <Check className="size-4" /> : <Send className="size-4" />}
              </button>
            </div>
            <button
              type="button"
              onClick={beginRecording}
              className="rcta flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 font-semibold transition-transform active:scale-[0.98]"
            >
              <Mic className="size-4" /> {t("voicemail.leaveVoiceMessage")}
            </button>
            <button
              type="button"
              onClick={requestWatch}
              disabled={watched || watchOnline.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-muted/30 px-4 py-3 text-sm font-medium text-foreground transition-transform hover:bg-muted/60 active:scale-[0.98] disabled:opacity-60"
            >
              {watched ? (
                <>
                  <Check className="size-4 text-primary" /> {t("voicemail.willAlert")}
                </>
              ) : (
                <>
                  <Bell className="size-4" /> {t("voicemail.tellMeOnline")}
                </>
              )}
            </button>
            {/* ONE STRING WITH `{who}` INSIDE IT, never a sentence split around the
                interpolation: Arabic puts the name in a different place, so a sentence
                chopped at the English seam can only be re-assembled into nonsense. */}
            <p className="pt-1 text-center text-xs text-muted-foreground">
              {t("voicemail.landsInChat", { who })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
