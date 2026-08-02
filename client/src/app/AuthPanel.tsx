import { useEffect, useRef, useState } from "react";
import { X, Mail, ArrowLeft, Lock, LockKeyhole, Check, Camera, Loader2, KeyRound, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { uploadAvatarImage } from "@/lib/uploadAttachment";
import { AvatarPicker } from "./AvatarPicker";
/**
 * THE OFFER RULE IS IMPORTED, NOT RE-DERIVED — that is the whole reason this is a
 * cross-module import rather than five copied lines. "Which ways in do we offer"
 * is ONE rule with two readers now (the standalone `LoginScreen` and this sheet),
 * and a second implementation is precisely how two surfaces come to disagree —
 * one offering a method that always refuses, the other hiding one that works. This
 * repo has paid for that twice already (v2.99.71's TURN checker, v2.105.11's token
 * classifier), so the agreement is made STRUCTURAL here instead of tested.
 *
 * IT COSTS NO BUNDLE, which is what makes it free rather than a trade: `App.tsx`
 * imports `AppShell` statically, `AppShell` imports `OnboardingGate`, and that
 * imports `LoginScreen` — so the module is already in the eager graph of every
 * surface that can open this sheet (the shell, the gate, and Profile, which is a
 * lazy route rendered INSIDE the shell). Verified by reading the graph, not assumed.
 */
import { signInMethodOptions, type SignInMethod } from "./LoginScreen";
import { useLocale, useT } from "./i18n";

/** Format a 6-digit RELAY number as NNN-NNN (LTR island). */
function fmtNumber(n: string): string {
  return n && n.length === 6 ? `${n.slice(0, 3)}-${n.slice(3)}` : n;
}

/**
 * Passwordless email-OTP sign-in / registration (v2.68) + 4-digit PIN login
 * (v2.87), reskinned in the login overhaul: a dark glass panel, a "secure lock
 * engaging" animation on PIN entry, and a "keep me signed in" (30/60/90-day)
 * control wired to the server's session-cookie lifetime (remember param).
 *
 * ── BOARD 2e "REGISTER SHEET" (design_handoff_relay_app) ────────────────────
 * The board draws this surface as a BOTTOM SHEET — 28px top corners, the
 * `.rsheet` near-opaque gradient, a grab handle, a 19px headline, a "YOUR
 * NUMBER · RESERVED" accent row, mono section eyebrows, a Private/Business
 * account-type row and a solid-accent CTA over a "no password" footer. That is
 * what this panel now is, at every stage, because one material for one surface
 * is the point: a sheet that becomes a centred dialog three steps in reads as
 * two different screens.
 *
 * IT IS THE SAME COMPONENT FOR TWO JOBS, AND THE COPY HAS TO SAY WHICH.
 * The board's frame is labelled "in-app upsell / guest → verified upgrade", and
 * this panel is opened both that way (Profile → "Register with email", where the
 * caller is a guest holding a number they want to keep) and as the plain SIGN-IN
 * from the onboarding gate and the app shell, where there is no number to keep
 * and "Register — keep this number" would be a false promise. So the board's
 * headline, its explainer, its YOUR NUMBER row and its ACCOUNT TYPE row render
 * for the UPSELL reading only — one derived boolean, no second component.
 *
 *   email  → probe: unknown → registration; PIN account → PIN pad (email code
 *            one tap away); otherwise → email a code. An address that ALREADY
 *            has an account now says so on the step it lands on (see
 *            `existingAccount`) instead of silently becoming a log-in.
 *   register (first/last/email) → sends a code, then → code stage.
 *   code   → 6-digit entry, "Resend" (60s cooldown), inline errors → verified.
 *   pin    → 4-digit entry. Three wrong entries warn; the FOURTH locks the
 *            account (the server emails the owner) — email code unlocks.
 *   setup  → after REGISTRATION: choose how future sign-ins work.
 *
 * On success the server has set the session cookie; we invalidate whoami so the
 * app re-renders as the freshly-verified user (which also earns the blue badge).
 */
type Stage = "email" | "register" | "code" | "pin" | "setup" | "waiting";
type Remember = 0 | 30 | 60 | 90;
type LockState = "idle" | "engaging" | "ok" | "err";

/** "Keep me signed in" — a toggle + 30/60/90-day segmented picker. `value` 0
 *  means session-only (this browser session).
 *
 *  A VOCABULARY FIX RATHER THAN A RESTYLE, and it is the finding this pass turned
 *  up: the switch and the selected day chip were painted with `--relay-online`,
 *  the PRESENCE LED colour. Green in this app means ONLINE and nothing else — it
 *  is what every presence dot is drawn with, which is why v2.99.86 moved DND off
 *  it, v2.106.9 the speaking tile, v2.106.11 the push banner and v2.106.18 the
 *  voice waveform. A green "this toggle is enabled" is one more meaning for the
 *  one colour that has to carry exactly one, so ON takes the cycling ACCENT,
 *  which is what "active" already means everywhere else after v2.106.6. */
function RememberControl({
  value,
  onChange,
}: {
  value: Remember;
  onChange: (v: Remember) => void;
}) {
  const t = useT();
  const on = value !== 0;
  const days: Remember[] = [30, 60, 90];
  return (
    <div className="rauth-tile rounded-[13px] p-3">
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="text-sm font-medium">{t("auth.rememberMe")}</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => onChange(on ? 0 : 30)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            on ? "rauth-switch-on" : "bg-muted"
          }`}
        >
          <span
            className="absolute top-0.5 size-5 rounded-full bg-white shadow transition-all"
            style={{ left: on ? "1.5rem" : "0.125rem" }}
          />
        </button>
      </label>
      <div
        className="mt-2.5 grid grid-cols-3 gap-1.5 transition-opacity"
        style={{ opacity: on ? 1 : 0.4, pointerEvents: on ? "auto" : "none" }}
      >
        {days.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onChange(d)}
            className={`min-h-11 rounded-[9px] border text-xs font-semibold transition-colors ${
              value === d
                ? "rauth-daysel text-foreground"
                : "border-border/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("auth.rememberDays", { days: d })}
          </button>
        ))}
      </div>
      {!on && (
        <p className="mt-2 text-[0.72rem] leading-relaxed text-muted-foreground">
          {t("auth.rememberOff")}
        </p>
      )}
    </div>
  );
}

/**
 * The animated "secure lock" badge shown on the PIN stage.
 *
 * IDLE / ENGAGING TAKE THE CYCLING ACCENT, not the presence green they used to:
 * "the lock is working" is an ACTIVE state, and green here was a second meaning
 * for the presence LED colour (see RememberControl above).
 *
 * OK STAYS GREEN, and that is deliberate rather than an exception squeezed
 * through: it is a momentary SUCCESS confirmation — not a claim that anybody is
 * online — and the repo already tokenizes that separately as `--relay-success`.
 * Naming the token is the whole point; the hue is the same, the meaning is not.
 * The fallbacks are LITERALS: `var(--rb, var(--rb))` is a custom-property CYCLE,
 * which resolves to the guaranteed-invalid value and makes the browser DROP the
 * declaration — a lock badge with no colour at all (the v2.106.7 trap).
 */
function LockBadge({ state }: { state: LockState }) {
  const color =
    state === "ok"
      ? "var(--relay-success, #06d6a0)"
      : state === "err"
        ? "var(--destructive, #f0526a)"
        : "var(--rb, #3FE0C5)";
  return (
    <div
      className={`lockbadge relative mx-auto grid size-16 place-items-center rounded-2xl ${
        state === "err" ? "lockbadge-shake" : ""
      }`}
      style={{
        background: `color-mix(in oklab, ${color} 16%, transparent)`,
        boxShadow: state === "engaging" ? `0 0 26px -6px ${color}` : "none",
        transition: "box-shadow .3s ease",
      }}
      aria-hidden
    >
      {/* sweeping ring while engaging */}
      {state === "engaging" && (
        <span
          className="lockbadge-ring absolute inset-0 rounded-2xl"
          style={{ border: `2px solid ${color}`, borderTopColor: "transparent" }}
        />
      )}
      <span style={{ color }}>
        {state === "ok" ? (
          <Check className="size-7" />
        ) : state === "idle" ? (
          <LockKeyhole className="size-7" />
        ) : (
          <Lock className="size-7 lockbadge-clank" />
        )}
      </span>
    </div>
  );
}

/**
 * BOARD 2e's "YOUR NUMBER · RESERVED" row — the number you are registering to
 * KEEP, so it is the caller's OWN live number from whoami, never the masked hint
 * `loginProbe` returns for whatever account the typed address belongs to. Those
 * are two different numbers and showing the wrong one here would be a claim
 * about somebody else's account.
 *
 * `dir="ltr"` + bidi isolation because a grouped six-digit number can have its
 * parts reordered inside an RTL paragraph (the standing rule since v2.99.77).
 */
function NumberRow({ number }: { number: string }) {
  const t = useT();
  return (
    <div className="rauth-numrow flex items-center gap-2.5 px-3.5 py-2.5">
      <span aria-hidden className="rauth-numtile grid size-[34px] shrink-0 place-items-center rounded-[11px]">
        <Lock className="size-[15px]" />
      </span>
      <div className="min-w-0">
        <div className="rauth-cap font-mono">{t("auth.yourNumber")}</div>
        <div dir="ltr" className="rauth-num font-mono" style={{ unicodeBidi: "isolate" }}>
          {fmtNumber(number)}
        </div>
      </div>
      {/* `.rchip-accent` is the shared accent-chip recipe (tint + hairline + the
          cycling hue), so this chip cannot drift from every other one. */}
      <span className="rchip-accent rauth-chip ms-auto shrink-0 rounded-[14px] px-2.5 py-1 font-mono">
        {t("auth.reserved")}
      </span>
    </div>
  );
}

/**
 * BOARD 2e's ACCOUNT TYPE row. Business is "coming soon" behind a gold SOON chip
 * — the owner's standing decision, so it stays.
 *
 * NEITHER HALF IS A BUTTON, and that is rule 9 rather than laziness: a control
 * that can only ever refuse is worse than no control, so this is an
 * INFORMATIONAL row stating which type the account will be, not a picker with
 * one dead option. The board draws both as spans for the same reason.
 *
 * THE SOON CHIP USES THE BOARD'S OWN AMBER (#f0b45a), NOT the `#e8c94a` role
 * gold: that literal is reserved for admin / owner / locked, and spending it on
 * "coming soon" is how a colour stops carrying information.
 */
function AccountTypeRow() {
  const t = useT();
  return (
    <div className="space-y-2">
      <div id="rauth-acct-label" className="rauth-eyebrow font-mono">
        {t("auth.accountType")}
      </div>
      <div
        role="group"
        aria-labelledby="rauth-acct-label"
        className="rauth-seg flex items-stretch gap-1.5 p-1.5"
      >
        <span className="rauth-seg-on flex flex-1 items-center justify-center rounded-[9px] px-2 py-2.5 text-[13px] font-bold">
          {t("auth.private")}
        </span>
        <span className="rauth-seg-off flex flex-1 items-center justify-center gap-1.5 rounded-[9px] px-2 py-2.5 text-[13px] font-semibold">
          {t("auth.business")} <span className="rauth-soon font-mono">{t("auth.soon")}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * The "this email already has an account" state (board 2e + the ask). NOTHING IS
 * REBUILT HERE: `loginProbe` has decided this since v2.105.26 and
 * `routeAfterProbe` already routes such an address to the PIN pad or an email
 * code. What was missing is that the sheet never SAID so — and this panel is
 * opened from Profile as a REGISTER upsell, so somebody who came to register
 * landed on "Enter your PIN" with no explanation for the change of subject.
 *
 * IT ALSO NAMES THE CONSEQUENCE, which is the part that actually matters and is
 * not obvious: signing in to an existing account does NOT carry the guest number
 * over — `ensureUserIdentity` returns that account's own identity (v2.99.49) —
 * so the sheet's own promise ("keep this number") does not hold on this branch,
 * and saying nothing would leave the promise standing.
 *
 * Nothing new is disclosed: the probe already told THIS caller this address is
 * taken, so the words reveal only what the request they just made returned.
 */
function ExistingAccountNote() {
  const t = useT();
  return (
    <div className="rauth-note space-y-1 px-3.5 py-3 text-start">
      <p className="text-[12.5px] font-semibold" style={{ color: "var(--rb, #3FE0C5)" }}>
        {t("auth.existingTitle")}
      </p>
      <p className="rauth-sub">{t("auth.existingBody")}</p>
    </div>
  );
}

/**
 * BOARD 5d — THE SIGN-IN METHOD SWITCHER.
 *
 * The board draws the three ways in as a LIST of rows — accent icon tile, name,
 * one line of explanation, an optional live indicator on the right — with the
 * current one lit. This sheet had all three ways in already (v2.99.7 shipped the
 * passcode bypass, the email code and approve-on-another-device) and no way to
 * move BETWEEN them: the passcode step offered exactly one exit, the waiting step
 * one, and the CODE step none at all. So somebody whose approver device was shut,
 * or who reached the code screen and then remembered their passcode, had to guess.
 *
 * #122 built exactly this for the standalone `LoginScreen`; the sheet never got
 * it. This is that picker, to frame, on the surface that was left behind.
 *
 * ── A METHOD THAT CANNOT WORK IS OMITTED, NEVER DISABLED ────────────────────
 * `signInMethodOptions` is the shared rule and it is IMPORTED (see the header):
 * the email code is always offered because any registered address can be mailed
 * one, the passcode only when the account HAS one, and second-device approval only
 * once the server has actually parked a session — it is not something a client can
 * choose into existence. A control that can only ever refuse is worse than no
 * control (the v2.103.3 rule), which is also why a LOCKED passcode does not count
 * as having one: see `probeHasPin`.
 *
 * One way in is not a choice, so a single option renders NOTHING rather than a
 * list of one.
 *
 * ── THREE DELIBERATE DEVIATIONS FROM THE FRAME, EACH FOR A REASON ───────────
 * 1. THE CURRENT ROW CARRIES NO SUBTITLE. On the board the picker IS the whole
 *    card, so its selected row has to say where you are. Here every stage already
 *    has its own body saying it — so rendering the subtitle on the lit row would
 *    print the same sentence twice on one small sheet (the waiting step would read
 *    "approve this from a device already signed in" immediately above "This is a
 *    new device. Approve it from a device you're already signed in on"). The
 *    subtitle exists to explain the ways in you are NOT on.
 * 2. THE DEVICE ROW SHOWS A LIVE DOT, NOT THE FRAME'S "1:52". That numeral is a
 *    countdown to a retry, and re-asking the other device means re-sending the
 *    code — which is the CODE row, right above it. A timer counting down to
 *    nothing would be a claim this sheet cannot keep.
 * 3. THE ICONS ARE `LoginScreen`'S THREE, not the frame's keypad/padlock/monitor
 *    paths. Two pickers for one concept must not draw one method two ways; the
 *    shared vocabulary is worth more than the exact path data, and the copy keys
 *    (`login.method*`) are shared for the same reason.
 */
function MethodSwitcher({
  current,
  hasPin,
  hasPending,
  codeSent,
  resendIn,
  onPick,
}: {
  current: SignInMethod;
  hasPin: boolean;
  hasPending: boolean;
  /** A code is already outstanding, so the code row describes a REACHABLE inbox
   *  rather than an action. Tracked rather than inferred from the stage: a person
   *  who goes code → passcode still has a live code waiting. */
  codeSent: boolean;
  resendIn: number;
  onPick: (m: SignInMethod) => void;
}) {
  const t = useT();
  const opts = signInMethodOptions(hasPin, hasPending);
  // One way in is not a choice; a list of one is noise.
  if (opts.length < 2) return null;
  const META: Record<SignInMethod, { icon: React.ReactNode; title: string; sub: string }> = {
    code: {
      icon: <Mail className="size-[15px]" />,
      title: t("login.methodCode"),
      sub: codeSent ? t("login.codeSent") : t("auth.emailCodeInstead"),
    },
    pin: {
      icon: <KeyRound className="size-[15px]" />,
      title: t("login.methodPin"),
      /* Says what picking the row DOES, not what the row IS: "Enter your 4-digit
         passcode" under a title reading "4-digit passcode" is the same words
         twice. It is also the sentence the button this picker replaced carried,
         so the copy the owner signed off is still on screen — and still read,
         which is what keeps it out of the dead-key sweep. */
      sub: t("auth.usePinInstead"),
    },
    device: {
      icon: <Smartphone className="size-[15px]" />,
      title: t("login.methodDevice"),
      sub: t("login.waitingBody"),
    },
  };
  return (
    <div className="rauth-methods">
      <div className="rauth-eyebrow font-mono">{t("login.orSignInWith")}</div>
      {opts.map((k) => {
        const on = k === current;
        const m = META[k];
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            disabled={on}
            onClick={() => onPick(k)}
            className={`rauth-method ${on ? "rauth-method-on" : "rauth-method-off"}`}
          >
            <span aria-hidden className="rauth-method-ico">{m.icon}</span>
            <span className="rauth-method-text">
              <span className="rauth-method-title">{m.title}</span>
              {!on && <span className="rauth-method-sub">{m.sub}</span>}
            </span>
            {/* The resend countdown, on the row it belongs to. Withheld while the
                code row is CURRENT because the dedicated Resend button below then
                carries the very same sentence, and one small sheet must not state
                the same countdown twice. */}
            {k === "code" && !on && resendIn > 0 && (
              <span className="rauth-method-meta font-mono">
                {t("auth.resendIn", { seconds: resendIn })}
              </span>
            )}
            {/* A pending approval is genuinely live, so the dot shows wherever the
                row does — including from the passcode step, where it is the only
                sign that the other device is still being asked. */}
            {k === "device" && <span aria-hidden className="rauth-method-dot" />}
          </button>
        );
      })}
    </div>
  );
}

export function AuthPanel({
  onClose,
  onVerified,
  initialEmail = "",
  suggestedEmail = "",
}: {
  onClose: () => void;
  onVerified?: () => void;
  /** Prefill + auto-send the code (when the gate already collected the email). */
  initialEmail?: string;
  /**
   * Prefill WITHOUT sending anything (v2.105.15) — an address somebody ELSE
   * proposed, currently an admin suggesting how a guest should register.
   *
   * Deliberately NOT `initialEmail`: that one auto-routes and mails a code,
   * which is right when the user typed it themselves at the gate and wrong here,
   * because it would send a code to an address the person has not yet looked at.
   * The whole value of a suggestion is that they get to read and correct it, so
   * this fills the field and waits.
   */
  suggestedEmail?: string;
}) {
  const utils = trpc.useUtils();
  /* `tn` as well as `t` because three of this sheet's sentences wrap the email
     address in bold IN THE MIDDLE — and Arabic does not put it between the same
     two fragments, so splitting the sentence at the English seam would be
     untranslatable. See `translateNodes`. */
  const { t, tn } = useLocale();
  const [stage, setStage] = useState<Stage>("email");
  // `initialEmail` wins when both are set: an address the user typed outranks one
  // proposed for them.
  const [email, setEmail] = useState(initialEmail || suggestedEmail);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [remember, setRemember] = useState<Remember>(30); // "keep me signed in" default
  const [lock, setLock] = useState<LockState>("idle");
  /**
   * The typed address already has an account (board 2e's "→ Log in" state). Set
   * from the probe's own answer in `routeAfterProbe` — a projection of a decision
   * that already existed, not a second one. Shown on whichever step the probe
   * routes to, so the change of subject is explained rather than silent.
   */
  const [existingAccount, setExistingAccount] = useState(false);
  /**
   * BOARD 5d — what the picker is allowed to offer.
   *
   * `probeHasPin` subtracts `locked`, and that is the load-bearing half rather
   * than caution: `loginProbe` reports a spent-attempt account as locked (v2.99.47),
   * and `loginWithPin` refuses it — so a locked passcode is a method that CANNOT
   * work, and offering it would be the dead control the frame's own rule forbids.
   * The locked notice already tells the person the email code is the way back in.
   *
   * `approvalPending` is only ever set by the server parking a session
   * (`verifyOtp` → pending): second-device approval is not something a client can
   * choose into existence, so the row appears only once it is real.
   */
  const [probeHasPin, setProbeHasPin] = useState(false);
  const [approvalPending, setApprovalPending] = useState(false);
  /** A code is outstanding. Not derivable from the stage — code → passcode leaves
   *  a live code behind — so it is tracked at the one place a code is sent. */
  const [codeSent, setCodeSent] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  // 1Hz resend countdown.
  useEffect(() => {
    const t = setInterval(() => setResendIn((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (stage === "code") setTimeout(() => codeRef.current?.focus(), 50);
  }, [stage]);

  const requestOtp = trpc.otpAuth.requestOtp.useMutation();
  const register = trpc.otpAuth.register.useMutation();
  const resendOtp = trpc.otpAuth.resendOtp.useMutation();
  const verifyOtp = trpc.otpAuth.verifyOtp.useMutation();
  const loginProbe = trpc.otpAuth.loginProbe.useMutation();
  const loginWithPin = trpc.otpAuth.loginWithPin.useMutation();
  const setLoginPin = trpc.otpAuth.setLoginPin.useMutation();
  const updateProfile = trpc.identity.updateProfile.useMutation();

  // The setup step shows the just-minted account: its 6-digit RELAY number and
  // its avatar. Board 2e needs the SAME row up front (the number you register to
  // keep), so this is no longer gated on the setup stage.
  //
  // That costs no extra request in the app: `useIdentity` already holds this
  // query, and react-query keys on the procedure + input — so enabling it here
  // subscribes to the SAME cache entry rather than issuing a second fetch. From
  // the onboarding gate, where nobody has an identity yet, `whoami` answers null
  // and every consumer below degrades to hiding its row.
  const whoami = trpc.identity.whoami.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  // New-device approval (v2.99.7): while parked on the waiting screen, poll the
  // server for our own session's approval status. Approved → proceed into the
  // app; denied → back to the email screen with a note.
  const approvalStatus = trpc.otpAuth.sessionApprovalStatus.useQuery(undefined, {
    enabled: stage === "waiting",
    refetchInterval: stage === "waiting" ? 2500 : false,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (stage !== "waiting") return;
    const s = approvalStatus.data?.status;
    if (s === "approved") {
      void utils.identity.whoami.invalidate().then(() => {
        if (onVerified) onVerified();
        else onClose();
      });
    } else if (s === "denied") {
      // That session was refused, so approving on another device is no longer a
      // way in — the row goes with it rather than lingering as a dead option.
      setApprovalPending(false);
      setStage("email");
      setError(t("auth.err.declined"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvalStatus.data?.status, stage]);
  // De-strand the waiting screen (v2.99.19): approval requires ANOTHER device
  // active in the last ~12 min, but that device may be closed now and can never
  // tap Approve — leaving the user stuck watching a spinner. After a short wait
  // with no response, surface a prominent, honest escape (sign in with the PIN,
  // which bypasses approval). Fails toward the user getting in, never locked out.
  const [waitStalled, setWaitStalled] = useState(false);
  useEffect(() => {
    if (stage !== "waiting") { setWaitStalled(false); return; }
    const t = setTimeout(() => setWaitStalled(true), 35_000);
    return () => clearTimeout(t);
  }, [stage]);

  // v2.87 PIN state
  const [pin, setPin] = useState("");
  const [setupPin, setSetupPin] = useState("");
  const [setupPin2, setSetupPin2] = useState("");
  const [wasRegistration, setWasRegistration] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (stage === "pin") setTimeout(() => pinRef.current?.focus(), 50);
  }, [stage]);

  // Mandatory profile photo during registration setup (owner directive): the
  // account isn't "done" until it has a real avatar. Local preview mirrors the
  // uploaded url so the gate + circle update instantly without a whoami round-trip.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const shownAvatar = avatarUrl ?? whoami.data?.avatarUrl ?? null;

  async function onSetupAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError(t("auth.err.photoNotImage")); return; }
    if (file.size > 4 * 1024 * 1024) { setError(t("auth.err.photoTooBig")); return; }
    setAvatarUploading(true);
    setError(null);
    try {
      const json = await uploadAvatarImage(file, { mimeType: file.type });
      // AWAIT the save (v2.98.0 lesson): the upload and the profile save are two
      // round-trips; only report success once the avatarUrl is actually persisted.
      await updateProfile.mutateAsync({ avatarUrl: json.url });
      setAvatarUrl(json.url);
      await utils.identity.whoami.invalidate();
    } catch (err) {
      setError(messageOf(err, t("auth.err.photoUpload")));
    } finally {
      setAvatarUploading(false);
      if (avatarFileRef.current) avatarFileRef.current.value = "";
    }
  }

  const busy =
    requestOtp.isPending || register.isPending || verifyOtp.isPending ||
    loginProbe.isPending || loginWithPin.isPending || setLoginPin.isPending;
  const cleanEmail = email.trim().toLowerCase();

  function toCodeStage() {
    setStage("code");
    setResendIn(60);
    setCode("");
    setCodeSent(true);
    setError(null);
  }

  async function sendEmailCode(email: string): Promise<void> {
    const r = await requestOtp.mutateAsync({ email });
    if (r.unregistered) { setStage("register"); return; }
    if (!r.ok) {
      setError(t("auth.err.mailNotConfigured"));
      return;
    }
    toCodeStage();
  }

  /**
   * Probe FIRST (sends nothing), then route: unknown email → registration; a
   * PIN account → the PIN pad (no email fired unless asked); otherwise email a
   * code.
   */
  async function routeAfterProbe(email: string): Promise<void> {
    // QA H4: clear any stale registration flag before routing. wasRegistration
    // is set true by submitRegister and drives verifyCode → the "Finish setting
    // up" screen. It was never reset, so a user who started a registration, went
    // Back, then signed IN to an existing (PIN-less) account was routed into that
    // setup screen — where whoami has no minted number and setLoginPin/updateProfile
    // 401, stranding them. submitRegister runs AFTER this (a separate submit), so
    // resetting here is safe and re-set true only on a real registration.
    setWasRegistration(false);
    const p = await loginProbe.mutateAsync({ email });
    if (p.unregistered) { setExistingAccount(false); setProbeHasPin(false); setStage("register"); return; }
    // BOARD 5d: a LOCKED passcode cannot sign anybody in, so the picker must not
    // offer it — omitted, never shown disabled.
    setProbeHasPin(Boolean(p.hasPin) && !p.locked);
    // BOARD 2e's "already has an account → log in" state. The probe decided this;
    // all that happens here is that the answer is REMEMBERED so the step it routes
    // to can say why registering turned into signing in. Set before the branches
    // below, because both of them are that state.
    setExistingAccount(true);
    if (p.hasPin && !p.locked) {
      setPin("");
      setLock("idle");
      setStage("pin");
      return;
    }
    if (p.hasPin && p.locked) {
      setNotice(t("auth.notice.locked"));
    }
    await sendEmailCode(email);
  }

  // When the gate already collected a valid email, route immediately so the
  // user lands straight on the right stage (PIN pad / code entry / register).
  const didAutoRef = useRef(false);
  useEffect(() => {
    if (didAutoRef.current) return;
    const e = initialEmail.trim().toLowerCase();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return;
    didAutoRef.current = true;
    (async () => {
      setError(null);
      try {
        await routeAfterProbe(e);
      } catch (err) {
        setError(messageOf(err, t("auth.err.sendCode")));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await routeAfterProbe(cleanEmail);
    } catch (err) {
      setError(messageOf(err, t("auth.err.sendCode")));
    }
  }

  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLock("engaging"); // secure-lock animation while we verify
    try {
      await loginWithPin.mutateAsync({ email: cleanEmail, pin, remember });
      setLock("ok"); // lock closes green, then in
      await utils.identity.whoami.invalidate();
      setTimeout(() => { if (onVerified) onVerified(); else onClose(); }, 560);
    } catch (err) {
      setLock("err"); // shake + red
      setPin("");
      setError(messageOf(err, t("auth.err.badPin")));
      setTimeout(() => setLock("idle"), 480);
    }
  }

  async function pinToEmailCode() {
    setError(null);
    setNotice(null);
    try {
      await sendEmailCode(cleanEmail);
    } catch (err) {
      setError(messageOf(err, t("auth.err.sendCode")));
    }
  }

  /**
   * BOARD 5d — move to another way in.
   *
   * The passcode and the device rows only ever CHANGE SCREEN: both credentials
   * already exist (a passcode the person knows, a session the server has parked),
   * so nothing is sent and nothing is spent.
   *
   * The code row is the one that acts, and it goes through the SAME
   * `pinToEmailCode` the passcode step has always used rather than a second
   * sender — so switching to the code from the waiting step is exactly
   * "ask that device again", because re-sending the code is what re-prompts it.
   * There is no separate nudge to build.
   */
  async function pickMethod(m: SignInMethod) {
    setError(null);
    setNotice(null);
    if (m === "pin") { setPin(""); setLock("idle"); setStage("pin"); return; }
    if (m === "device") { setStage("waiting"); return; }
    await pinToEmailCode();
  }

  async function submitSetup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Both are MANDATORY now (owner directive): a photo AND a 4-digit passcode.
    if (!shownAvatar) { setError(t("auth.err.needAvatar")); return; }
    if (setupPin.length !== 4) { setError(t("auth.err.passcodeLength")); return; }
    if (setupPin !== setupPin2) { setError(t("auth.err.passcodeMismatch")); return; }
    try {
      await setLoginPin.mutateAsync({ pin: setupPin, preferPin: true });
      await utils.identity.whoami.invalidate();
      if (onVerified) onVerified();
      else onClose();
    } catch (err) {
      setError(messageOf(err, t("auth.err.savePasscode")));
    }
  }

  async function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await register.mutateAsync({ firstName: firstName.trim(), lastName: lastName.trim(), email: cleanEmail });
      // Real email verification (SES live): a code was emailed — go enter it.
      // (The v2.97.2 no-code bypass response is gone.)
      if (!r.ok) {
        setError(t("auth.err.mailNotConfigured"));
        return;
      }
      setWasRegistration(true);
      toCodeStage();
    } catch (err) {
      setError(messageOf(err, t("auth.err.startRegistration")));
    }
  }

  /**
   * Verify a 6-digit emailed code. Called by the form's submit button AND
   * auto-fired the instant the 6th digit lands. The 4-digit PIN is deliberately
   * NOT auto-submitted (lock-after-4-wrong-tries would burn attempts on typos).
   */
  async function verifyCode(codeStr: string) {
    if (verifyOtp.isPending) return;
    setError(null);
    try {
      const res = await verifyOtp.mutateAsync({ email: cleanEmail, code: codeStr.trim(), remember });
      // Fresh REGISTRATION: offer the sign-in choice (email code vs 4-digit PIN).
      if (wasRegistration) {
        setSetupPin("");
        setSetupPin2("");
        setError(null);
        setStage("setup");
        return;
      }
      // New-device approval (v2.99.7): the account has another online device
      // and no PIN was used — park on the waiting screen until that device
      // approves (or use the 4-digit PIN, which never lands here). We do NOT
      // invalidate whoami yet: the pending cookie doesn't authenticate, so the
      // app would just bounce back to the gate.
      if ((res as { pending?: boolean })?.pending) {
        // L2: this is a NEW pending session (fresh sid/cookie). The approval
        // poll's cache can still hold a "denied" from a PRIOR attempt on this
        // mount; react-query serves that cached value immediately on re-enter,
        // and the waiting-stage effect would instantly bounce us back to email
        // with a false "declined" before the server ever evaluates this new
        // session. Reset the cache so the effect only acts on a FRESH result.
        utils.otpAuth.sessionApprovalStatus.reset();
        // BOARD 5d: the ONLY thing that makes second-device approval real, so it
        // is the only thing that puts that row in the picker.
        setApprovalPending(true);
        setStage("waiting");
        return;
      }
      await utils.identity.whoami.invalidate();
      if (onVerified) onVerified();
      else onClose();
    } catch (err) {
      setError(messageOf(err, t("auth.err.badCode")));
      // L3: the code input auto-fires verifyCode the instant it reaches 6
      // digits. If we leave the wrong code in place, deleting one digit and
      // retyping re-fires and burns another of the 5 server attempts per
      // single-character correction. Clear it (like the PIN path) so a
      // correction is a fresh 6-digit entry = exactly one attempt.
      setCode("");
    }
  }

  async function resend() {
    if (resendIn > 0) return;
    setError(null);
    setResendIn(60);
    try {
      await resendOtp.mutateAsync({ email: cleanEmail });
      setNotice(t("auth.newCodeSent"));
    } catch {
      /* uniform — don't surface */
    }
  }

  /**
   * THE UPSELL READING (board 2e): a guest holding a number is the one caller for
   * whom "Register — keep this number" is true, and the one the board's frame is
   * drawn for. Everybody else opened this to SIGN IN — from the onboarding gate
   * there is not even an identity yet — so they get honest sign-in copy and none
   * of the register-specific rows. One boolean, so the two readings cannot drift.
   */
  const me = whoami.data ?? null;
  const upsell = me?.isGuest === true && Boolean(me.number);

  const title =
    stage === "code" ? t("auth.title.code")
    : stage === "register" ? t("auth.title.register")
    : stage === "pin" ? t("auth.title.pin")
    : stage === "setup" ? t("auth.title.setup")
    : stage === "waiting" ? t("auth.title.waiting")
    : upsell ? t("auth.title.upsell")
    : t("auth.title.signIn");

  return (
    /* `relay-v2` is carried HERE as well as the local `dark`, and both are needed:
       the design utilities this sheet is built from are scoped `.dark.relay-v2 …`,
       and while <html> holds `relay-v2` it only holds `dark` in the dark theme — so
       without this the sheet would lose its material for every light-theme user. */
    <div className="dark relay-v2 relay-auth fixed inset-0 z-[110] flex items-end justify-center text-foreground" role="dialog" aria-modal="true">
      {/* The scrim is deliberately left as `glass-overlay` rather than repainted to
          the board's rgba(2,4,6,.6)+blur(3px): that utility already carries a
          measured no-backdrop-filter fallback AND a phone rule that DROPS the blur
          (the v2.99.84 cost rule). Forcing a blur back on would undo a measurement
          to match a colour nobody can tell apart behind a near-opaque sheet. */}
      <div aria-hidden className="glass-overlay absolute inset-0" onClick={onClose} />
      <div
        className="rsheet rauth-sheet relative flex max-h-[92dvh] w-full max-w-[460px] flex-col rounded-t-[28px] px-5 pt-2.5"
        /* Two INLINE overrides on top of `.rsheet`, which ships the board's sheet
           gradient and hairline but a DOWNWARD shadow (it was written for centred
           dialogs). A sheet docked to the bottom edge casts upward — the board's
           own `0 -30px 80px`. Inline rather than a rule, because `.dark.relay-v2
           .rsheet` is three classes and an override would otherwise be a
           specificity argument that a later edit could quietly lose. */
        style={{
          boxShadow: "0 -30px 80px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.14)",
          borderBottom: "none",
        }}
      >
        {/* The board's grab handle. Decorative: the scrim is the dismiss target and
            the Close button below is the real control, so this is aria-hidden
            rather than a second, undiscoverable way out. */}
        <div aria-hidden className="rauth-grip" />
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {stage !== "email" && (
              <button
                type="button"
                /* Back is how the address is CHANGED, so everything the probe and
                   the verify learned about the previous one is dropped with it —
                   a picker row describing another account's passcode or another
                   account's pending session would be worse than no row. */
                onClick={() => { setStage("email"); setError(null); setNotice(null); setLock("idle"); setExistingAccount(false); setProbeHasPin(false); setApprovalPending(false); setCodeSent(false); }}
                aria-label={t("auth.back")}
                className="-ms-1.5 grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
              >
                <ArrowLeft className="size-4" />
              </button>
            )}
            {/* The board gives the sheet ONE headline, so the stage title IS it —
                a dialog title plus a separate 19px heading would be the same
                sentence twice. */}
            <h2 className="rauth-title min-w-0">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t("auth.close")} className="-me-1.5 grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted">
            <X className="size-5" />
          </button>
        </div>
        {/* The body scrolls, the handle and header do not: the setup step (number +
            avatar + two passcode fields + CTA) is taller than a short phone with a
            keyboard up, and a sheet that pushes its CTA off-screen is worse than
            one that scrolls.
            `min-h-0` IS LOAD-BEARING, not tidiness: a flex item defaults to
            `min-height:auto`, so without it this child cannot shrink below its
            content, `overflow-y:auto` never engages and the SHEET overflows the
            viewport instead — the same flex-sizing trap v2.78 recorded when the app
            shell grew past its own end. */}
        <div className="rauth-body -mx-5 min-h-0 overscroll-contain px-5">

        {stage === "email" && (
          <form onSubmit={submitEmail} className="space-y-4">
            <p className="rauth-sub">
              {upsell
                ? /* NOT the board's literal "Your guest number ends with this browser
                     session": that claim is FALSE here and it is false for a recorded
                     reason — v2.99.68 gave every guest a recovery key precisely so a
                     browser close no longer strands the number, and v2.99.69 corrected
                     this copy once already. Signing out still forgets it, which is what
                     "only held for this browser" says accurately. */
                  t("auth.emailSubUpsell")
                : t("auth.emailSub")}
            </p>
            {/* Board 2e's YOUR NUMBER row. Withheld when there is no number to keep
                rather than rendered empty — a row reserving space for a value that is
                never coming reads as something failing to load. */}
            {upsell && me?.number && <NumberRow number={me.number} />}
            <div className="space-y-2">
              <Label htmlFor="auth-email" className="rauth-eyebrow font-mono">
                {t("auth.emailLabel")}
              </Label>
              <Input
                id="auth-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="rauth-field h-12 rounded-[13px]"
              />
            </div>
            {upsell && <AccountTypeRow />}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="rcta h-12 w-full rounded-[13px] text-[15px] font-bold" disabled={busy || !cleanEmail}>
              {/* The probe runs BEFORE anything is emailed, so "Sending…" would be a
                  claim about a mail nobody has asked for yet. */}
              {loginProbe.isPending ? t("auth.checking") : requestOtp.isPending ? t("auth.sending") : upsell ? t("auth.sendVerificationCode") : t("auth.sendCode")}
            </Button>
            <p className="rauth-foot flex items-center justify-center gap-1.5">
              <Lock aria-hidden className="size-[11px] shrink-0" /> {t("auth.noPasswordFoot")}
            </p>
          </form>
        )}

        {stage === "register" && (
          <form onSubmit={submitRegister} className="space-y-3.5">
            <p className="rauth-sub">{t("auth.registerSub")}</p>
            {/* The number carries over on THIS branch (the address is unclaimed, so
                `ensureUserIdentity` claims this browser's guest identity — v2.99.49),
                which is exactly what the row is promising. */}
            {upsell && me?.number && <NumberRow number={me.number} />}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="auth-first" className="rauth-eyebrow font-mono">{t("auth.firstName")}</Label>
                <Input id="auth-first" required autoFocus value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Alex" maxLength={64} className="rauth-field h-12 rounded-[13px]" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="auth-last" className="rauth-eyebrow font-mono">{t("auth.lastName")}</Label>
                <Input id="auth-last" required value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Rivera" maxLength={64} className="rauth-field h-12 rounded-[13px]" />
              </div>
            </div>
            {/* Email is already known from the previous step — shown read-only so
                the user never retypes it (owner directive). "Back" changes it. */}
            <div className="space-y-2">
              <Label className="rauth-eyebrow font-mono">{t("auth.emailLabel")}</Label>
              <div className="rauth-field flex h-12 items-center gap-2 rounded-[13px] border px-3 text-sm">
                <Mail className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{cleanEmail}</span>
              </div>
            </div>
            {upsell && <AccountTypeRow />}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="rcta h-12 w-full rounded-[13px] text-[15px] font-bold" disabled={busy || !firstName.trim() || !lastName.trim() || !cleanEmail}>
              {register.isPending ? t("auth.creating") : t("auth.sendVerificationCode")}
            </Button>
            <p className="rauth-foot flex items-center justify-center gap-1.5">
              <Lock aria-hidden className="size-[11px] shrink-0" /> {t("auth.noPasswordFoot")}
            </p>
          </form>
        )}

        {stage === "pin" && (
          <form onSubmit={submitPin} className="space-y-4">
            {/* Board 2e's "→ Log in" state, on the step the probe actually routed to.
                Shown for the UPSELL only: somebody who opened this to sign in asked
                for exactly this, so telling them their address has an account is
                noise — it is only news to somebody who came to register. */}
            {upsell && existingAccount && <ExistingAccountNote />}
            <LockBadge state={lock} />
            <p className="text-center text-sm">
              {tn("auth.pinPrompt", {
                email: <span className="font-semibold break-all">{cleanEmail}</span>,
              })}
            </p>
            <Input
              ref={pinRef}
              type="password"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="••••"
              disabled={lock === "engaging" || lock === "ok"}
              className="rauth-field text-center text-2xl tracking-[0.6em] font-mono h-14 rounded-[13px]"
            />
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            <RememberControl value={remember} onChange={setRemember} />
            <Button type="submit" className="rcta h-12 w-full rounded-[13px] text-[15px] font-bold" disabled={busy || pin.length !== 4}>
              {lock === "ok" ? t("auth.unlocked") : loginWithPin.isPending ? t("auth.unlocking") : t("auth.title.signIn")}
            </Button>
            {/* BOARD 5d. The old one-way "Email me a code instead" button is now one
                ROW of the shared picker rather than a second control beside it: two
                ways to do one thing is dead weight, and the harder one to find wins
                nothing. The email-code escape this step has always owed a person who
                has forgotten their passcode is unchanged — it is the code row. */}
            <MethodSwitcher
              current="pin"
              /* `true`, not `probeHasPin`: standing on the passcode step IS the
                 evidence there is one. It also makes the escape structural — the
                 picker hides itself below two options, so a false here would let a
                 future route into this step arrive with no way out at all. */
              hasPin
              hasPending={approvalPending}
              codeSent={codeSent}
              resendIn={resendIn}
              onPick={(m) => void pickMethod(m)}
            />
            <p className="rauth-foot text-center">{t("auth.pinFoot")}</p>
          </form>
        )}

        {stage === "waiting" && (
          <div className="space-y-5 text-center">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10">
              <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm">
                {tn("auth.waitingBody", {
                  email: <span className="font-semibold break-all">{cleanEmail}</span>,
                })}
              </p>
              <p className="text-xs text-muted-foreground">
                {tn("auth.waitingHow", {
                  approve: <span className="font-semibold">{t("auth.approve")}</span>,
                })}
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {/* THE STALL NOTE NOW MATCHES THE ACCOUNT, and that is a real fix rather
                than a restyle: `auth.waitStalled` ends "you can sign in with your
                4-digit PIN instead", which is FALSE for an account that has none —
                and the button below it used to be rendered unconditionally, so such
                a person was pointed at a pad `loginWithPin` refuses. With no
                passcode the honest thing to say is what one WOULD buy them, which
                is what the login screen already says in this exact situation. */}
            {waitStalled && (
              <div className="rauth-tile rounded-[13px] p-3 text-xs text-muted-foreground">
                {probeHasPin ? t("auth.waitStalled") : t("login.passcodeNoApproval")}
              </div>
            )}
            {/* BOARD 5d. Replaces the unconditional "Sign in with your PIN instead"
                button: the passcode row appears only for an account that HAS one,
                and the code row doubles as "ask that device again" — re-sending the
                code is what re-prompts the other device, so there is no separate
                nudge to invent. */}
            <MethodSwitcher
              current="device"
              hasPin={probeHasPin}
              hasPending
              codeSent={codeSent}
              resendIn={resendIn}
              onPick={(m) => void pickMethod(m)}
            />
            <button
              type="button"
              className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-60"
              onClick={() => { setStage("email"); setError(null); setNotice(null); }}
              disabled={busy}
            >
              {t("common.cancel")}
            </button>
          </div>
        )}

        {stage === "setup" && (
          <form onSubmit={submitSetup} className="space-y-4">
            <p className="rauth-sub">{t("auth.setupSub")}</p>

            {/* The freshly-minted 6-digit RELAY number (LTR island). Deliberately
                NOT the compact `NumberRow`: this is the confirmation the whole flow
                was for, so it keeps its own full-width plate — and the number is now
                the caller's for good, so "RESERVED" would be the wrong word. */}
            <div className="rauth-numrow p-4 text-center">
              <div className="rauth-eyebrow font-mono">{t("auth.yourRelayNumber")}</div>
              <div
                dir="ltr"
                className="mt-1.5 font-mono text-2xl font-bold tracking-[0.15em]"
                style={{ color: "var(--rb, #3FE0C5)", unicodeBidi: "isolate" }}
              >
                {whoami.data?.number ? fmtNumber(whoami.data.number) : "······"}
              </div>
            </div>

            {/* Mandatory avatar (owner directive) — photo OR an emoji character. */}
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => setAvatarPickerOpen(true)}
                disabled={avatarUploading}
                aria-label={shownAvatar ? t("auth.changeAvatar") : t("auth.addAvatar")}
                className="relative grid size-24 place-items-center rounded-full outline-none transition active:scale-95 focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-70"
                style={{ background: "linear-gradient(135deg,#3FE0C5,#6EE7FF)" }}
              >
                <span className="grid size-[86px] place-items-center overflow-hidden rounded-full bg-background">
                  {shownAvatar ? (
                    <img src={shownAvatar} alt={t("auth.yourPhoto")} className="size-full rounded-full object-cover" />
                  ) : (
                    <Camera className="size-7 text-muted-foreground" />
                  )}
                </span>
                <span className="absolute -bottom-0.5 -right-0.5 grid size-8 place-items-center rounded-full border-[3px] border-card bg-secondary text-primary">
                  {avatarUploading ? (
                    <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <Camera className="size-4" />
                  )}
                </span>
              </button>
              <span className="text-xs text-muted-foreground">
                {shownAvatar ? t("auth.avatarSet") : t("auth.avatarNeeded")}
              </span>
              <input
                ref={avatarFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onSetupAvatar}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="pin-1" className="rauth-eyebrow font-mono">{t("auth.passcodeLabel")}</Label>
                <Input id="pin-1" type="password" inputMode="numeric" maxLength={4} value={setupPin}
                  onChange={(e) => setSetupPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="••••" className="rauth-field text-center font-mono tracking-[0.4em] h-12 rounded-[13px]" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pin-2" className="rauth-eyebrow font-mono">{t("auth.passcodeRepeat")}</Label>
                <Input id="pin-2" type="password" inputMode="numeric" maxLength={4} value={setupPin2}
                  onChange={(e) => setSetupPin2(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="••••" className="rauth-field text-center font-mono tracking-[0.4em] h-12 rounded-[13px]" />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              className="rcta h-12 w-full rounded-[13px] text-[15px] font-bold"
              disabled={busy || avatarUploading || !shownAvatar || setupPin.length !== 4 || setupPin2.length !== 4}
            >
              {setLoginPin.isPending ? t("auth.finishing") : t("auth.finish")}
            </Button>
          </form>
        )}

        {stage === "code" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verifyCode(code);
            }}
            className="space-y-4"
          >
            {/* Board 2e's "→ Log in" state — the other step the probe can route to. */}
            {upsell && existingAccount && <ExistingAccountNote />}
            <div className="rauth-numtile mx-auto grid size-14 place-items-center rounded-2xl">
              <Mail className="size-7" />
            </div>
            <p className="text-center text-sm">
              {tn("auth.codeSentTo", {
                email: <span className="font-semibold break-all">{cleanEmail}</span>,
              })}
            </p>
            <Input
              ref={codeRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(v);
                // Auto-verify on the 6th digit — no extra tap.
                if (v.length === 6) void verifyCode(v);
              }}
              placeholder="••••••"
              className="rauth-field text-center text-2xl tracking-[0.5em] font-mono h-14 rounded-[13px]"
            />
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            {notice && !error && <p className="rauth-sub text-center">{notice}</p>}
            <RememberControl value={remember} onChange={setRemember} />
            <Button type="submit" className="rcta h-12 w-full rounded-[13px] text-[15px] font-bold" disabled={busy || code.length !== 6}>
              {verifyOtp.isPending ? t("auth.verifying") : t("auth.verifyContinue")}
            </Button>
            {/* ABSENT rather than disabled during the cooldown would lose the one thing
                a waiting person wants (how long) — so this control keeps its label and
                counts down in place, which is what the v2.103.3 rule is actually
                about: never a control whose refusal is unexplained. */}
            <Button type="button" variant="secondary" onClick={resend} disabled={resendIn > 0} className="h-12 w-full rounded-[13px]">
              {resendIn > 0 ? t("auth.resendIn", { seconds: resendIn }) : t("auth.resend")}
            </Button>
            {/* BOARD 5d. This step had NO way to change method at all — the one
                genuine dead end of the three, since somebody who reached it and then
                remembered their passcode had to go Back and be re-probed. */}
            <MethodSwitcher
              current="code"
              hasPin={probeHasPin}
              hasPending={approvalPending}
              codeSent={codeSent}
              resendIn={resendIn}
              onPick={(m) => void pickMethod(m)}
            />
          </form>
        )}
        </div>
      </div>

      <AvatarPicker
        open={avatarPickerOpen}
        onClose={() => setAvatarPickerOpen(false)}
        displayName={whoami.data?.displayName}
        onSaved={(url) => setAvatarUrl(url)}
      />

      {/* Scoped to `.relay-auth`, and every accent value here carries a LITERAL
          fallback: `var(--rb, var(--rb))` is a custom-property CYCLE, which resolves
          to the guaranteed-invalid value and makes the browser DROP the whole
          declaration — a sheet with no accent at all rather than a plain one (the
          v2.106.7 trap). No backticks anywhere inside this literal: one in a comment
          terminates it and the syntax error is reported hundreds of lines away (the
          trap recorded four times, most recently v2.106.6). */}
      <style>{`
        /* ── BOARD 2e sheet material ─────────────────────────────────────── */
        .relay-auth .rauth-grip {
          width: 38px; height: 4px; border-radius: 3px;
          background: rgba(255,255,255,.2); margin: 4px auto 14px;
        }
        .relay-auth .rauth-title { font-size: 19px; font-weight: 700; color: #eafff6; }
        .relay-auth .rauth-sub { font-size: 12.5px; line-height: 1.55; color: #8ea09b; }
        .relay-auth .rauth-foot { font-size: 10.5px; line-height: 1.5; color: #68797c; }
        /* The board's mono section eyebrows. Natural case in the SOURCE with the
           uppercasing done in CSS, so the accessible name a screen reader reads is
           "Account type" rather than shouted letters — and so a later test pins the
           property instead of a literal that CSS produced (the v2.105.26 lesson). */
        .relay-auth .rauth-eyebrow {
          display: block; font-size: 10px; letter-spacing: .2em;
          text-transform: uppercase; color: #8fa39d; font-weight: 400;
        }
        .relay-auth .rauth-cap {
          font-size: 9px; letter-spacing: .2em; text-transform: uppercase; color: #7d8f8a;
        }
        /* The board's field: a white 5% fill on a 13% hairline. Reached through the
           primitive's own data-slot so this outranks the Input's own dark:bg-input/30
           (two classes) without an !important.
           NOTE: no backticks anywhere in this literal — one inside a CSS comment
           terminates the template and the syntax error surfaces a hundred lines
           away. It bit again while writing this block, for the fifth recorded time. */
        .relay-auth [data-slot="input"].rauth-field,
        .relay-auth .rauth-field {
          background: rgba(255,255,255,.05);
          border-color: rgba(255,255,255,.13);
        }
        .relay-auth .rauth-tile {
          background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.13);
        }
        /* YOUR NUMBER row + the accent tile inside it. */
        .relay-auth .rauth-numrow {
          border-radius: 14px;
          background: rgba(var(--rb-rgb, 63, 224, 197), .09);
          border: 1px solid rgba(var(--rb-rgb, 63, 224, 197), .32);
        }
        .relay-auth .rauth-numtile {
          background: rgba(var(--rb-rgb, 63, 224, 197), .15);
          color: var(--rb, #3FE0C5);
        }
        .relay-auth .rauth-num {
          font-size: 18px; font-weight: 600; letter-spacing: .04em;
          color: var(--rb, #3FE0C5);
        }
        .relay-auth .rauth-chip { font-size: 9px; letter-spacing: .14em; text-transform: uppercase; }
        .relay-auth .rauth-note {
          background: rgba(var(--rb-rgb, 63, 224, 197), .09);
          border: 1px solid rgba(var(--rb-rgb, 63, 224, 197), .3);
          border-radius: 13px;
        }
        /* ACCOUNT TYPE. The SOON chip is the board's own amber (#f0b45a) — NOT the
           #e8c94a role gold, which means admin / owner / locked and must not be spent
           on "coming soon". */
        .relay-auth .rauth-seg {
          background: rgba(0,0,0,.32); border: 1px solid rgba(255,255,255,.08); border-radius: 13px;
        }
        .relay-auth .rauth-seg-on {
          background: rgba(var(--rb-rgb, 63, 224, 197), .2);
          border: 1px solid rgba(var(--rb-rgb, 63, 224, 197), .5);
          color: #f2fffa;
        }
        .relay-auth .rauth-seg-off { color: #93a5a0; }
        .relay-auth .rauth-soon {
          font-size: 8px; letter-spacing: .1em; text-transform: uppercase;
          padding: 2px 6px; border-radius: 16px; background: rgba(240,180,90,.16);
          border: 1px solid rgba(240,180,90,.45); color: #f0b45a; white-space: nowrap;
        }
        /* ON = the cycling accent, never the presence green (see RememberControl). */
        .relay-auth .rauth-switch-on { background: var(--rb, #3FE0C5); }
        .relay-auth .rauth-daysel {
          border-color: rgba(var(--rb-rgb, 63, 224, 197), .55);
          background: rgba(var(--rb-rgb, 63, 224, 197), .18);
        }
        /* The scrolling half of the sheet. The board's 34px bottom padding, plus the
           real home-indicator inset rather than a guessed floor. */
        .relay-auth .rauth-body {
          overflow-y: auto; -webkit-overflow-scrolling: touch;
          padding-bottom: calc(34px + env(safe-area-inset-bottom, 0px));
        }
        /* ── BOARD 5d method switcher ────────────────────────────────────── */
        .relay-auth .rauth-methods { margin-top: 14px; }
        .relay-auth .rauth-methods .rauth-eyebrow { margin-bottom: 8px; }
        /* The frame's row: 12/13 padding around a 36px tile, so the target is ~60px
           tall — comfortably past the 44px floor without stating a second number. */
        .relay-auth .rauth-method {
          display: flex; align-items: center; gap: 11px; width: 100%;
          padding: 12px 13px; border-radius: 15px; margin-bottom: 8px;
          text-align: start; cursor: pointer;
        }
        .relay-auth .rauth-method:last-child { margin-bottom: 0; }
        /* The lit row is where you ARE, so it is not a target. Not the "disabled
           control" the omission rule is about — an unavailable METHOD is absent
           from this list entirely. */
        .relay-auth .rauth-method:disabled { cursor: default; }
        .relay-auth .rauth-method-on {
          background: rgba(var(--rb-rgb, 63, 224, 197), .1);
          border: 1px solid rgba(var(--rb-rgb, 63, 224, 197), .45);
          box-shadow: 0 0 0 3px rgba(var(--rb-rgb, 63, 224, 197), .1);
        }
        .relay-auth .rauth-method-off {
          background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.012));
          border: 1px solid rgba(255,255,255,.09);
        }
        .relay-auth .rauth-method-off:hover { background: rgba(255,255,255,.07); }
        /* The accent tile. A color rather than a fill, so the lucide glyph inherits
           it as currentColor — and it is the LITERAL-fallback form, because
           var(--rb, var(--rb)) is a cycle the browser drops outright.
           NOTE: no backticks in this literal. One in a comment terminates the
           template and the syntax error surfaces a hundred lines away — it bit
           again writing this block, for the sixth recorded time. */
        .relay-auth .rauth-method-ico {
          width: 36px; height: 36px; border-radius: 12px; flex-shrink: 0;
          display: grid; place-items: center;
          background: rgba(var(--rb-rgb, 63, 224, 197), .13);
          border: 1px solid rgba(var(--rb-rgb, 63, 224, 197), .32);
          color: var(--rb, #3FE0C5);
        }
        /* min-width:0 is load-bearing: without it a flex child refuses to shrink
           below its content and a long subtitle pushes the countdown off the row. */
        .relay-auth .rauth-method-text { flex: 1; min-width: 0; display: block; }
        .relay-auth .rauth-method-title {
          display: block; font-size: 13px; font-weight: 700; color: #eafff6;
        }
        .relay-auth .rauth-method-sub {
          display: block; font-size: 10.5px; line-height: 1.45; color: #8ea09b; margin-top: 2px;
        }
        .relay-auth .rauth-method-meta {
          font-size: 10px; white-space: nowrap; flex-shrink: 0;
          color: var(--rb, #3FE0C5);
        }
        .relay-auth .rauth-method-dot {
          width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0;
          background: var(--rb, #3FE0C5);
        }
        @media (prefers-reduced-motion: no-preference) {
          .relay-auth .rauth-method-dot { animation: rauthPulse 1.1s ease infinite; }
        }
        @keyframes rauthPulse { 50% { opacity: .25; } }
        .relay-auth .lockbadge-ring { animation: authSpin .8s linear infinite; }
        @keyframes authSpin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: no-preference) {
          .relay-auth .lockbadge-shake { animation: authShake .42s cubic-bezier(.36,.07,.19,.97) both; }
          .relay-auth .lockbadge-clank { animation: authClank .28s ease-out both; }
          /* The board's sheet presentation: slide up ~300ms. TRANSFORM AND OPACITY
             ONLY, and it is safe to transform this element because nothing
             position:fixed lives inside it — the avatar picker is mounted as a
             SIBLING, not a child, so this cannot become the v2.99.54 containing-block
             bug where an animated ancestor mis-centred a fixed descendant. */
          .relay-auth .rauth-sheet { animation: rauthUp .3s cubic-bezier(.23,1,.32,1) both; }
        }
        @keyframes rauthUp { from { transform: translateY(16px); opacity: 0; } }
        @keyframes authShake {
          10%,90% { transform: translateX(-1px); } 20%,80% { transform: translateX(2px); }
          30%,50%,70% { transform: translateX(-4px); } 40%,60% { transform: translateX(4px); }
        }
        @keyframes authClank { 0% { transform: translateY(-3px) scale(1.06); } 60% { transform: translateY(1px) scale(.98); } 100% { transform: none; } }
      `}</style>
    </div>
  );
}

function messageOf(err: unknown, fallback: string): string {
  const m = (err as { message?: string })?.message;
  return typeof m === "string" && m.length > 0 && m.length < 200 ? m : fallback;
}
