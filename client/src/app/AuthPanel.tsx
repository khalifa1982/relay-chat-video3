import { useEffect, useRef, useState } from "react";
import { X, Mail, ShieldCheck, ArrowLeft, Lock, LockKeyhole, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

/**
 * Passwordless email-OTP sign-in / registration (v2.68) + 4-digit PIN login
 * (v2.87), reskinned in the login overhaul: a dark glass panel, a "secure lock
 * engaging" animation on PIN entry, and a "keep me signed in" (30/60/90-day)
 * control wired to the server's session-cookie lifetime (remember param).
 *
 *   email  → probe: unknown → registration; PIN account → PIN pad (email code
 *            one tap away); otherwise → email a code.
 *   register (first/last/email) → sends a code, then → code stage.
 *   code   → 6-digit entry, "Resend" (60s cooldown), inline errors → verified.
 *   pin    → 4-digit entry. Three wrong entries warn; the FOURTH locks the
 *            account (the server emails the owner) — email code unlocks.
 *   setup  → after REGISTRATION: choose how future sign-ins work.
 *
 * On success the server has set the session cookie; we invalidate whoami so the
 * app re-renders as the freshly-verified user (which also earns the blue badge).
 */
type Stage = "email" | "register" | "code" | "pin" | "setup";
type Remember = 0 | 30 | 60 | 90;
type LockState = "idle" | "engaging" | "ok" | "err";

/** "Keep me signed in" — a toggle + 30/60/90-day segmented picker. `value` 0
 *  means session-only (this browser session). */
function RememberControl({
  value,
  onChange,
}: {
  value: Remember;
  onChange: (v: Remember) => void;
}) {
  const on = value !== 0;
  const days: Remember[] = [30, 60, 90];
  return (
    <div className="rounded-2xl border border-border/60 bg-background/40 p-3">
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="text-sm font-medium">Keep me signed in</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => onChange(on ? 0 : 30)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            on ? "bg-[color:var(--relay-online,#06d6a0)]" : "bg-muted"
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
            className={`rounded-xl border py-1.5 text-xs font-semibold transition-colors ${
              value === d
                ? "border-[color:var(--relay-online,#06d6a0)] bg-[color:var(--relay-online,#06d6a0)]/15 text-foreground"
                : "border-border/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            {d} days
          </button>
        ))}
      </div>
      {!on && (
        <p className="mt-2 text-[0.72rem] leading-relaxed text-muted-foreground">
          Off: you'll be signed out when this browser closes.
        </p>
      )}
    </div>
  );
}

/** The animated "secure lock" badge shown on the PIN stage. */
function LockBadge({ state }: { state: LockState }) {
  const color =
    state === "ok" ? "#06d6a0" : state === "err" ? "#f0526a" : "var(--relay-online,#3FE0C5)";
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

export function AuthPanel({
  onClose,
  onVerified,
  initialEmail = "",
}: {
  onClose: () => void;
  onVerified?: () => void;
  /** Prefill + auto-send the code (when the gate already collected the email). */
  initialEmail?: string;
}) {
  const utils = trpc.useUtils();
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState(initialEmail);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [remember, setRemember] = useState<Remember>(30); // "keep me signed in" default
  const [lock, setLock] = useState<LockState>("idle");
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

  // v2.87 PIN state
  const [pin, setPin] = useState("");
  const [setupPin, setSetupPin] = useState("");
  const [setupPin2, setSetupPin2] = useState("");
  const [wasRegistration, setWasRegistration] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (stage === "pin") setTimeout(() => pinRef.current?.focus(), 50);
  }, [stage]);

  const busy =
    requestOtp.isPending || register.isPending || verifyOtp.isPending ||
    loginProbe.isPending || loginWithPin.isPending || setLoginPin.isPending;
  const cleanEmail = email.trim().toLowerCase();

  function toCodeStage() {
    setStage("code");
    setResendIn(60);
    setCode("");
    setError(null);
  }

  async function sendEmailCode(email: string): Promise<void> {
    const r = await requestOtp.mutateAsync({ email });
    if (r.unregistered) { setStage("register"); return; }
    if (!r.ok) {
      setError("We couldn't send your code — email delivery isn't set up yet. Contact the operator.");
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
    const p = await loginProbe.mutateAsync({ email });
    if (p.unregistered) { setStage("register"); return; }
    if (p.hasPin && !p.locked) {
      setPin("");
      setLock("idle");
      setStage("pin");
      return;
    }
    if (p.hasPin && p.locked) {
      setNotice("This account is locked after too many wrong PINs — the email code below unlocks it.");
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
        setError(messageOf(err, "Couldn't send a code. Try again."));
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
      setError(messageOf(err, "Couldn't send a code. Try again."));
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
      setError(messageOf(err, "That PIN didn't work."));
      setTimeout(() => setLock("idle"), 480);
    }
  }

  async function pinToEmailCode() {
    setError(null);
    setNotice(null);
    try {
      await sendEmailCode(cleanEmail);
    } catch (err) {
      setError(messageOf(err, "Couldn't send a code. Try again."));
    }
  }

  async function submitSetup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (setupPin.length !== 4) { setError("The PIN is exactly 4 digits."); return; }
    if (setupPin !== setupPin2) { setError("The PINs don't match."); return; }
    try {
      await setLoginPin.mutateAsync({ pin: setupPin, preferPin: true });
      await utils.identity.whoami.invalidate();
      if (onVerified) onVerified();
      else onClose();
    } catch (err) {
      setError(messageOf(err, "Couldn't save the PIN. You can set it later in Profile."));
    }
  }

  function skipSetup() {
    if (onVerified) onVerified();
    else onClose();
  }

  async function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await register.mutateAsync({ firstName: firstName.trim(), lastName: lastName.trim(), email: cleanEmail });
      if (!r.ok) {
        setError("We couldn't send your code — email delivery isn't set up yet. Contact the operator.");
        return;
      }
      setWasRegistration(true);
      toCodeStage();
    } catch (err) {
      setError(messageOf(err, "Couldn't start registration. Try again."));
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
      await verifyOtp.mutateAsync({ email: cleanEmail, code: codeStr.trim(), remember });
      // Fresh REGISTRATION: offer the sign-in choice (email code vs 4-digit PIN).
      if (wasRegistration) {
        setSetupPin("");
        setSetupPin2("");
        setError(null);
        setStage("setup");
        return;
      }
      await utils.identity.whoami.invalidate();
      if (onVerified) onVerified();
      else onClose();
    } catch (err) {
      setError(messageOf(err, "That code didn't work."));
    }
  }

  async function resend() {
    if (resendIn > 0) return;
    setError(null);
    setResendIn(60);
    try {
      await resendOtp.mutateAsync({ email: cleanEmail });
      setNotice("A new code is on its way.");
    } catch {
      /* uniform — don't surface */
    }
  }

  const title =
    stage === "code" ? "Enter your code"
    : stage === "register" ? "Create your account"
    : stage === "pin" ? "Enter your PIN"
    : stage === "setup" ? "How do you want to sign in?"
    : "Sign in";

  return (
    <div className="dark relay-auth fixed inset-0 z-[110] grid place-items-center p-4 text-foreground" role="dialog" aria-modal="true">
      <div aria-hidden className="glass-overlay absolute inset-0" onClick={onClose} />
      <div className="relative w-[min(94vw,420px)] rounded-3xl border border-border/60 bg-card/70 p-6 shadow-2xl shadow-black/50 backdrop-blur-2xl backdrop-saturate-150">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {stage !== "email" && (
              <button
                type="button"
                onClick={() => { setStage("email"); setError(null); setNotice(null); setLock("idle"); }}
                aria-label="Back"
                className="rounded-full p-1.5 text-muted-foreground hover:bg-muted"
              >
                <ArrowLeft className="size-4" />
              </button>
            )}
            <h2 className="text-lg font-bold">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted-foreground hover:bg-muted">
            <X className="size-5" />
          </button>
        </div>

        {stage === "email" && (
          <form onSubmit={submitEmail} className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Enter your email and we'll send you a one-time code. No password needed.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="auth-email">Email</Label>
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
                className="h-12 rounded-xl"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="h-12 w-full rounded-xl" disabled={busy || !cleanEmail}>
              {requestOtp.isPending ? "Sending…" : "Send code"}
            </Button>
            <div className="flex items-center justify-center gap-1 pt-1 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" /> Passwordless — a fresh code every time, only to your inbox.
            </div>
          </form>
        )}

        {stage === "register" && (
          <form onSubmit={submitRegister} className="space-y-3">
            <p className="text-sm text-muted-foreground">
              We didn't find an account for <span className="font-medium text-foreground break-all">{cleanEmail}</span>. Create one — it takes a moment.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="auth-first">First name</Label>
                <Input id="auth-first" required autoFocus value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Alex" maxLength={64} className="h-12 rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="auth-last">Last name</Label>
                <Input id="auth-last" required value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Rivera" maxLength={64} className="h-12 rounded-xl" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auth-email2">Email</Label>
              <Input id="auth-email2" type="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="h-12 rounded-xl" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="h-12 w-full rounded-xl" disabled={busy || !firstName.trim() || !lastName.trim() || !cleanEmail}>
              {register.isPending ? "Sending…" : "Create account & send code"}
            </Button>
          </form>
        )}

        {stage === "pin" && (
          <form onSubmit={submitPin} className="space-y-4">
            <LockBadge state={lock} />
            <p className="text-center text-sm">
              Enter the 4-digit PIN for <span className="font-semibold break-all">{cleanEmail}</span>.
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
              className="text-center text-2xl tracking-[0.6em] font-mono h-14 rounded-xl"
            />
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            <RememberControl value={remember} onChange={setRemember} />
            <Button type="submit" className="h-12 w-full rounded-xl" disabled={busy || pin.length !== 4}>
              {lock === "ok" ? "Unlocked ✓" : loginWithPin.isPending ? "Unlocking…" : "Sign in"}
            </Button>
            <Button type="button" variant="secondary" className="h-11 w-full rounded-xl" onClick={pinToEmailCode} disabled={busy}>
              Email me a code instead
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Three wrong tries are forgiven — a fourth locks the account until you sign in by email code.
            </p>
          </form>
        )}

        {stage === "setup" && (
          <form onSubmit={submitSetup} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              You're verified ✅ — one last choice. Set a 4-digit PIN to sign in
              instantly next time, or skip to get a fresh email code on every
              sign-in. You can change this anytime in Profile.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="pin-1">4-digit PIN</Label>
                <Input id="pin-1" type="password" inputMode="numeric" maxLength={4} value={setupPin}
                  onChange={(e) => setSetupPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="••••" className="text-center font-mono tracking-[0.4em] h-12 rounded-xl" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pin-2">Repeat it</Label>
                <Input id="pin-2" type="password" inputMode="numeric" maxLength={4} value={setupPin2}
                  onChange={(e) => setSetupPin2(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="••••" className="text-center font-mono tracking-[0.4em] h-12 rounded-xl" />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="h-12 w-full rounded-xl" disabled={busy || setupPin.length !== 4 || setupPin2.length !== 4}>
              {setLoginPin.isPending ? "Saving…" : "Use this PIN to sign in"}
            </Button>
            <Button type="button" variant="secondary" className="h-11 w-full rounded-xl" onClick={skipSetup} disabled={busy}>
              Skip — email me a code each time
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
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/15 text-primary">
              <Mail className="size-7" />
            </div>
            <p className="text-center text-sm">
              We sent a 6-digit code to <span className="font-semibold break-all">{cleanEmail}</span>.
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
              className="text-center text-2xl tracking-[0.5em] font-mono h-14 rounded-xl"
            />
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            {notice && !error && <p className="text-sm text-muted-foreground text-center">{notice}</p>}
            <RememberControl value={remember} onChange={setRemember} />
            <Button type="submit" className="h-12 w-full rounded-xl" disabled={busy || code.length !== 6}>
              {verifyOtp.isPending ? "Verifying…" : "Verify & continue"}
            </Button>
            <div className="flex flex-col items-center gap-2">
              <Button type="button" variant="secondary" onClick={resend} disabled={resendIn > 0} className="h-11 w-full rounded-xl">
                {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </Button>
            </div>
          </form>
        )}
      </div>

      <style>{`
        .relay-auth .lockbadge-ring { animation: authSpin .8s linear infinite; }
        @keyframes authSpin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: no-preference) {
          .relay-auth .lockbadge-shake { animation: authShake .42s cubic-bezier(.36,.07,.19,.97) both; }
          .relay-auth .lockbadge-clank { animation: authClank .28s ease-out both; }
        }
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
