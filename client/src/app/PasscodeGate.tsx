import { useEffect, useState, type FormEvent } from "react";
import { Delete, Lock, ScanFace } from "lucide-react";
import { useLocked, verifyPasscode, unlockApp } from "./passcode";
import { hasBiometric, biometricUnlock } from "./biometric";
import { RelayBackground } from "./RelayBackground";

/* ============================================================================
   BOARD 2f — PASSCODE LOCK (plus 5e's wrong-passcode / locked-out states)
   ============================================================================

   The frame: brand dot + RELAY (.22em) · a 52px accent lock puck (radius 18) ·
   "Enter passcode" 17/700 · "locked on this device" 11.5px · a row of 13px dots ·
   a 3x4 circular glass keypad (66px keys, gap 12) · Face ID at the bottom in the
   accent. Every value below is the board's own.

   THE FINDING, and it is a vocabulary bug rather than a restyle: this screen was
   painted end to end in `--relay-online` — the PRESENCE GREEN. That token means
   ONLINE and nothing else; it is what every presence LED is drawn with, which is
   why v2.99.86 moved DND off it, v2.106.9 the speaking tile, v2.106.11 the push
   banner, v2.106.12 the guest-restore card and v2.106.18 the voice waveform. The
   lock puck, the biometric chip, the focus ring and the Unlock button were all
   green here, i.e. a fifth meaning for the one colour that has to carry exactly
   one. "Locked" and "unlock" are not presence statements: they take the ACCENT.

   THE STATES (board 5e: "Wrong passcode · locked out"). The device passcode had
   NO attempt limit at all, so a 4-digit code was open to unlimited guessing by
   anyone holding the phone. 5e specifies four tries then a countdown, and that
   shape is the only safe one here: this lock is a PRIVACY SCREEN, not access
   control (the data is already on the device and the same account is unlocked on
   a laptop), and it has no server-side recovery — a permanent lockout would trap
   the owner behind their own phone, with "clear all site data" (which destroys a
   guest number, v2.99.68) as the only way out. A TIME-BOXED cooldown slows
   guessing and heals itself.

   WHAT THE PROMPT'S "emails the owner" REFERS TO IS A DIFFERENT SURFACE, said
   plainly: the 4-wrong-tries lockout that mails the account owner is the SERVER
   login PIN (`attemptPinLogin`, `loginPinLockedAt`, v2.87) on the sign-in screen.
   This gate is device-local — no session, no server call, nothing that could send
   mail — so the copy here never claims an email was sent. Claiming one would be a
   lie rendered on the screen of the person it lies to.

   `dark relay-v2` ON THIS WRAPPER, not on the root: the shipped surface utilities
   are scoped `.relay-v2 X` / `.dark.relay-v2 X`, and `<html>` carries `relay-v2`
   but `dark` only when the user chose the dark theme. This screen has been
   unconditionally dark since it was written (it already hard-coded `dark`), so
   carrying both classes here is what lets it reuse `.rkey` / `.rcta` verbatim in
   BOTH themes without adding a light variant of a dark-only recipe (global rule
   6) and without touching the root classes another file owns.
   ========================================================================== */

/** The cycling accent, with a LITERAL fallback. `var(--rb, var(--rb))` is a
 *  custom-property CYCLE: it resolves to the guaranteed-invalid value and the
 *  browser DROPS the whole declaration, leaving no colour at all (v2.106.7). */
const ACCENT = "var(--rb, #3FE0C5)";
const accentA = (a: number) => `rgba(var(--rb-rgb, 63, 224, 197), ${a})`;
/** Board 5e. GOLD = admin / owner / LOCKED, so a locked device is exactly what it
 *  is for. Deliberately NOT `--relay-dnd`, which already means "alerts silenced" —
 *  one token carrying two meanings is how a colour stops carrying information. */
const GOLD = "#e8c94a";
/** Board 5e's danger text on a dark surface. */
const DANGER = "#fb7185";

const MIN_LEN = 4; // Profile's PasscodeSection enforces 4-8 digits
const MAX_LEN = 8;
const MAX_TRIES = 4; // board 5e: "After 4 wrong tries: locked"
const COOLDOWN_MS = 5 * 60_000; // board 5e shows "4:32" remaining, i.e. a 5-minute hold

/* Attempt state is PERSISTED, because a cooldown held only in component state is
   undone by a reload — which is the first thing anyone trying codes would do. Its
   own keys; `passcode.ts` still owns `relay_pass_hash` / `relay_pass_salt` and is
   not touched from here. Every access is guarded and fails toward NOT locked out:
   this is friction rather than a security boundary (anyone who can clear storage
   clears the hash too, which unlocks), so a storage error must never be the
   reason somebody cannot get into their own app. */
const TRIES_KEY = "relay_pass_tries";
const UNTIL_KEY = "relay_pass_until";

function readNum(k: string): number {
  try {
    const v = Number(localStorage.getItem(k));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}
function writeNum(k: string, v: number): void {
  try {
    localStorage.setItem(k, String(v));
  } catch {
    /* storage unavailable */
  }
}
function clearAttempts(): void {
  try {
    localStorage.removeItem(TRIES_KEY);
    localStorage.removeItem(UNTIL_KEY);
  } catch {
    /* storage unavailable */
  }
}
/** ms left on the cooldown; 0 when it is not in force.
 *
 *  EXPORTED AS A TEST SEAM. A source pin can tell you the clock-skew guard below
 *  exists; it cannot tell you that a clock which has gone backwards reads as
 *  EXPIRED rather than holding the owner out for what could be years — and that
 *  is the only claim worth making about this function (the `publishAccentVars`
 *  precedent, v2.106.0). `now` is injected for the same reason. */
export function cooldownLeft(now = Date.now()): number {
  const until = readNum(UNTIL_KEY);
  if (!until) return 0;
  const left = until - now;
  if (left <= 0) return 0;
  // A remaining time LARGER than the whole cooldown cannot be real — the clock
  // moved backwards, or the value was edited. Treat it as expired rather than
  // holding the owner out for what could be years (the same reading v2.106.12
  // gave a `savedAt` from a clock that has gone backwards).
  return left > COOLDOWN_MS ? 0 : left;
}
/** Exported as a test seam: the countdown the owner reads while held out, so
 *  "4:32" has to be 4:32 and a sub-minute remainder has to keep its leading zero. */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Shows a full-screen lock when a device passcode is set and the app is locked. */
export function PasscodeGate({ children }: { children: React.ReactNode }) {
  const locked = useLocked();
  if (!locked) return <>{children}</>;
  return <LockScreen />;
}

function LockScreen() {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bioEnrolled] = useState(() => hasBiometric());
  const [bioBusy, setBioBusy] = useState(false);
  const [tries, setTries] = useState(() => readNum(TRIES_KEY));
  const [leftMs, setLeftMs] = useState(() => cooldownLeft());

  const lockedOut = leftMs > 0;
  const triesLeft = Math.max(0, MAX_TRIES - tries);

  /** One exit for both unlock paths, so neither can forget to forgive the
   *  attempts: whoever just proved they own the device does not deserve to
   *  inherit a cooldown from whoever was guessing. */
  function succeed() {
    clearAttempts();
    setTries(0);
    setLeftMs(0);
    unlockApp();
  }

  // The countdown. One interval, armed ONLY while the cooldown is in force, and
  // it clears the stored attempt state at expiry so the next try gets a fresh
  // four rather than locking again on the first mistake.
  useEffect(() => {
    if (!lockedOut) return;
    const t = setInterval(() => {
      const left = cooldownLeft();
      setLeftMs(left);
      if (left <= 0) {
        clearAttempts();
        setTries(0);
        // Clean slate when the hold lifts: the digits that failed four tries ago
        // are still on screen in red, and leaving them there would greet the owner
        // with an error about an attempt they no longer remember making — and with
        // Unlock disabled, since `error` is what disables it.
        setError(false);
        setCode("");
      }
    }, 1000);
    return () => clearInterval(t);
  }, [lockedOut]);

  function push(d: string) {
    if (busy || lockedOut) return;
    // A wrong code stays on screen (board 5e draws the failed digits in red), so
    // the next digit starts a FRESH entry rather than appending to it.
    setCode((c) => (error ? d : c.length >= MAX_LEN ? c : c + d));
    setError(false);
  }
  function back() {
    if (busy || lockedOut) return;
    setCode((c) => (error ? "" : c.slice(0, -1)));
    setError(false);
  }

  async function attempt() {
    // `error` is only cleared by changing the input, so this also stops a second
    // tap on Unlock spending another try on the code that just failed.
    if (busy || lockedOut || error || code.length < MIN_LEN) return;
    setBusy(true);
    const ok = await verifyPasscode(code);
    setBusy(false);
    if (ok) {
      succeed();
      return;
    }
    const n = tries + 1;
    setError(true);
    if (n >= MAX_TRIES) {
      writeNum(UNTIL_KEY, Date.now() + COOLDOWN_MS);
      writeNum(TRIES_KEY, 0);
      setTries(0);
      setLeftMs(COOLDOWN_MS);
    } else {
      writeNum(TRIES_KEY, n);
      setTries(n);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void attempt();
  }

  // A PHYSICAL keyboard still drives the pad. The text input the keypad replaces
  // was the only way to type on a desktop, and losing that would be a regression
  // for everyone not on a phone — this listener is on `window` rather than on an
  // input so it works whether or not anything holds focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        push(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        back();
      } else if (e.key === "Enter") {
        // Enter on a focused key/button is the browser clicking THAT control;
        // submitting here as well would append a digit and unlock in one press.
        const el = document.activeElement;
        if (el instanceof HTMLElement && (el.tagName === "BUTTON" || el.tagName === "A")) return;
        e.preventDefault();
        void attempt();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, error, busy, lockedOut, tries]);

  async function tryBiometric() {
    if (bioBusy) return;
    setBioBusy(true);
    const ok = await biometricUnlock();
    setBioBusy(false);
    if (ok) succeed();
    // On cancel/failure we silently fall back to the keypad below. A refused
    // biometric prompt is NOT a wrong passcode and never spends a try: the OS
    // gate cannot be guessed, so counting it would only strand the owner.
  }

  // Offer the biometric prompt as soon as the lock screen mounts (a no-op if
  // not enrolled). Some browsers require a gesture, so the button stays as the
  // reliable fallback; we swallow any auto-prompt rejection.
  //
  // It fires DURING a cooldown too, deliberately: the hold exists to slow
  // guessing of a 4-digit code, and platform user verification is not something
  // a stranger can guess — blocking it would punish only the owner.
  useEffect(() => {
    if (bioEnrolled) void tryBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The dot row. The stored code is 4-8 digits (Profile enforces the range), so a
     FIXED row of placeholders — which is what the board draws — would assert a
     length this app does not have. Four slots is the minimum that can unlock, and
     the row grows with a longer code. */
  const slots = Math.min(MAX_LEN, Math.max(MIN_LEN, code.length));

  return (
    <div
      className="dark relay-v2 relative flex min-h-svh flex-col items-center"
      style={{ background: "#04070a" }}
    >
      {/* Board: the live canvas sits behind every screen, and this component
          brings the frame's own vignette with it. Mounted here because the
          shell's canvas lives BELOW this gate and is therefore not running while
          the app is locked. Reusing it rather than hand-rolling a near-identical
          scrim keeps one material with one implementation. */}
      <RelayBackground />
      <form
        onSubmit={onSubmit}
        aria-label="Passcode"
        className="relative z-[1] flex w-full max-w-[360px] flex-1 flex-col items-center px-5 text-center"
        /* The board measures its 44px top gap from a MOCK status bar this app does
           not draw, so the real gap is smaller — and it is charged against reaching
           the Unlock button: computed against the board's own sizes, the column
           runs to the CTA's bottom edge at ~561px, which fits a 568px phone with
           the tighter padding and would not with 48px. `env(safe-area-inset-*)` on
           top of it because installed-to-home-screen there is no browser chrome
           above this screen and the notch would otherwise sit on the brand row. */
        style={{
          paddingTop: "max(2rem, calc(env(safe-area-inset-top, 0px) + 1rem))",
          paddingBottom: "max(2.25rem, calc(env(safe-area-inset-bottom, 0px) + 1rem))",
        }}
      >
        {/* Brand row — board: 10px dot with a 2.4s ping ring, RELAY 17/700 at
            .22em, gap 9. The ring animates TRANSFORM + OPACITY only and is behind
            `motion-safe:`, so a reduced-motion viewer gets the still dot. */}
        <div className="flex items-center" style={{ gap: 9 }}>
          <span className="relative flex" style={{ width: 10, height: 10 }}>
            <span
              aria-hidden="true"
              className="absolute inset-0 motion-safe:[animation:relayPing_2.4s_cubic-bezier(0,0,.2,1)_infinite]"
              style={{ borderRadius: 999, background: ACCENT }}
            />
            <span
              className="relative"
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: ACCENT,
                boxShadow: `0 0 12px ${accentA(0.8)}`,
              }}
            />
          </span>
          <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: ".22em", color: "#eafff6" }}>
            RELAY
          </span>
        </div>

        {/* Lock puck — board: 52x52, radius 18, accent tint .12 on a .38 hairline,
            22px glyph at stroke 1.8. Gold while the device is held: the state is
            "locked", which is what that colour means. */}
        <span
          className="grid place-items-center"
          style={{
            marginTop: 34,
            width: 52,
            height: 52,
            borderRadius: 18,
            background: lockedOut ? "rgba(232,201,74,.12)" : accentA(0.12),
            border: `1px solid ${lockedOut ? "rgba(232,201,74,.38)" : accentA(0.38)}`,
          }}
        >
          <Lock style={{ width: 22, height: 22, color: lockedOut ? GOLD : ACCENT }} strokeWidth={1.8} />
        </span>

        <h1 style={{ marginTop: 16, fontSize: 17, fontWeight: 700, color: "#eafff6" }}>
          Enter passcode
        </h1>
        <p style={{ marginTop: 5, fontSize: 11.5, color: "#8ea09b" }}>
          RELAY is locked on this device.
        </p>

        {/* Dots — board: 13px, gap 13, filled = accent with a .6 glow, empty = a
            1.5px .3 white ring. Board 5e turns the failed entry red. Decoration:
            the live region below is what a screen reader is told. */}
        <div aria-hidden="true" className="flex justify-center" style={{ gap: 13, marginTop: 22 }}>
          {Array.from({ length: slots }, (_, i) => {
            const filled = i < code.length;
            return (
              <span
                key={i}
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: 999,
                  ...(filled
                    ? error
                      ? { background: DANGER, boxShadow: "0 0 10px rgba(251,113,133,.6)" }
                      : { background: ACCENT, boxShadow: `0 0 10px ${accentA(0.6)}` }
                    : { border: "1.5px solid rgba(255,255,255,.3)" }),
                }}
              />
            );
          })}
        </div>

        {/* Status. `aria-live` because the dots are decoration and this is the
            only thing that says what happened. */}
        <div aria-live="polite" className="w-full">
          {error && !lockedOut && (
            <p style={{ marginTop: 11, fontSize: 11.5, fontWeight: 600, color: DANGER }}>
              Wrong passcode{triesLeft > 0 ? ` — ${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left` : ""}
            </p>
          )}
          {/* The gold advisory (board 5e). Absent until a try has actually been
              spent — a standing warning on an ordinary unlock is noise. It never
              claims anybody was emailed, because nothing here can send mail. */}
          {(lockedOut || tries > 0) && (
            <div
              className="mx-auto flex w-fit items-center justify-center"
              style={{
                gap: 7,
                marginTop: 13,
                padding: "9px 13px",
                borderRadius: 12,
                background: "rgba(232,201,74,.08)",
                border: "1px solid rgba(232,201,74,.35)",
              }}
            >
              <Lock style={{ width: 12, height: 12, color: GOLD, flexShrink: 0 }} strokeWidth={2} />
              <span style={{ fontSize: 10.5, fontWeight: 600, color: GOLD }}>
                {lockedOut ? (
                  <>
                    Too many wrong tries — try again in{" "}
                    <span className="font-mono" dir="ltr">
                      {mmss(leftMs)}
                    </span>
                  </>
                ) : (
                  `After ${MAX_TRIES} wrong tries this device locks for 5 minutes`
                )}
              </span>
            </div>
          )}
        </div>

        {/* The keypad, and the Unlock button under it, are ABSENT during the hold
            rather than disabled: a control that can only refuse should not be
            there (global rule 9). Face ID below stays, because it still works. */}
        {!lockedOut && (
          <>
            {/* Board: `grid-template-columns: repeat(3, 66px)`, gap 12, top 28 —
                222px of pad. Each key is `aspect-square` so the cell is square BY
                CONSTRUCTION at any width; sizing rows independently is what made
                the Dialer's "circles" ovals by 18px (v2.106.3).
                The third `min()` term is the viewport HEIGHT: a full 222px pad is
                ~300px tall and does not fit under the brand block, the dots and
                the CTA on a 667px phone. The 168px FLOOR keeps keys at 48px —
                above the 44px anyone can reliably hit — and below that height the
                page scrolls instead (this screen is outside the shell's
                `relay-app-lock`, so the document CAN scroll). */}
            <div
              className="grid"
              style={{
                marginTop: 28,
                gap: 12,
                gridTemplateColumns: "repeat(3, 1fr)",
                width: "min(100%, 222px, max(168px, calc((100dvh - 470px) * 0.78)))",
              }}
            >
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <PadKey key={d} onPress={() => push(d)}>
                  <span
                    className="font-mono leading-none"
                    style={{ fontSize: 22, fontWeight: 600, color: "#eafff6" }}
                  >
                    {d}
                  </span>
                </PadKey>
              ))}
              {/* BLANK · 0 · ERASE, the app's own bottom row since v2.99.90: a real
                  inert cell rather than a shortened list, which is what keeps `0`
                  in the middle column and erase under the thumb that just typed.
                  Not a button and aria-hidden, so nothing announces an empty
                  control between 9 and 0. */}
              <span aria-hidden="true" />
              <PadKey onPress={() => push("0")}>
                <span
                  className="font-mono leading-none"
                  style={{ fontSize: 22, fontWeight: 600, color: "#eafff6" }}
                >
                  0
                </span>
              </PadKey>
              {/* Uniform glass, not the Dialer's red erase: board 2f draws twelve
                  identical cells, and red on a lock screen would read as the
                  danger state rather than as a correction. Dimmed with nothing to
                  erase — never hidden, because a key that comes and goes makes
                  the grid jump. */}
              <PadKey onPress={back} disabled={code.length === 0} label="Erase last digit">
                <Delete style={{ width: 22, height: 22, color: "#eafff6" }} strokeWidth={2} />
              </PadKey>
            </div>

            {/* The board's frame carries no submit control, because its mock code is
                a fixed length that can auto-submit. This one is 4-8 digits, so the
                app cannot know when the entry is complete — the button stays, in
                the board's accent CTA. `.rcta` is the shipped recipe: solid accent
                with the board's `#04211a` on-accent text, which stays legible
                across all twelve hues where white fails on the yellow and lime. */}
            <button
              type="submit"
              disabled={code.length < MIN_LEN || busy || error}
              className="rcta mt-6 h-12 w-full max-w-[222px] rounded-xl font-semibold transition-transform duration-150 active:scale-[0.99] disabled:opacity-40 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              {busy ? "Checking…" : "Unlock"}
            </button>
          </>
        )}

        {/* Board: bottom of the screen, `margin-top:auto`, 36px clear of the edge —
            a quiet accent row rather than the bordered chip this used to be near
            the top. A 12px label needs a real target, so the row is padded to 44px
            (global rule 8) even though the type is small. */}
        <div className="mt-auto flex w-full flex-col items-center" style={{ paddingTop: 24 }}>
          {bioEnrolled && (
            <button
              type="button"
              onClick={tryBiometric}
              disabled={bioBusy}
              className="inline-flex min-h-11 items-center rounded-xl px-3 transition active:scale-[0.98] disabled:opacity-50 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              style={{ gap: 7 }}
            >
              <ScanFace style={{ width: 15, height: 15, color: ACCENT }} strokeWidth={1.7} />
              <span style={{ fontSize: 12, fontWeight: 600, color: ACCENT }}>
                {bioBusy ? "Waiting…" : "Unlock with Face ID"}
              </span>
            </button>
          )}
          {/* Board 5e's footer line is "Forgot? Sign out and verify your email
              again" — and that is NOT true of this build: sign-out (`useSignOut`)
              rotates the device id and drops the session, and leaves
              `relay_pass_hash` exactly where it is, so the lock would still be
              here afterwards. The honest recovery is the one that exists. */}
          <p style={{ marginTop: 10, fontSize: 10, color: "#68797c", lineHeight: 1.5 }}>
            Forgot it? This code lives only in this browser. Clearing this site's data removes the
            lock — and a guest number kept only here.
          </p>
        </div>
      </form>
    </div>
  );
}

/** One circular glass key. `.rkey` is the shipped board recipe (1a/1i): the glass
 *  fill, the hairline, and a hover tint that follows the cycling accent — so the
 *  pad breathes with the background from a compiled class rather than a
 *  runtime-composed one, which the JIT cannot see and which renders unstyled.
 *  The press is a TRANSFORM, never a box-shadow, which would repaint every frame. */
function PadKey({
  onPress,
  disabled,
  label,
  children,
}: {
  onPress: () => void;
  disabled?: boolean;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label={label}
      className="rkey grid aspect-square place-items-center rounded-full select-none transition-[transform,background-color,opacity] duration-150 active:scale-[0.94] disabled:opacity-30 disabled:active:scale-100 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
      style={{ transitionTimingFunction: "var(--ease-out)" }}
    >
      {children}
    </button>
  );
}
