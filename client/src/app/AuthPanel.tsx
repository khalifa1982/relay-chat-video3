import { useEffect, useRef, useState } from "react";
import { X, Mail, ShieldCheck, ArrowLeft, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

/**
 * Passwordless email-OTP sign-in / registration (v2.68) + 4-digit PIN login
 * (v2.87). NO password, NO third-party identity provider.
 *
 *   email  → probe: unknown → registration; PIN account → PIN pad (email code
 *            one tap away); otherwise → email a code.
 *   register (first/last/email) → sends a code, then → code stage.
 *   code   → 6-digit entry, "Resend" (60s cooldown), inline errors → verified.
 *   pin    → 4-digit entry. Three wrong entries warn; the FOURTH locks the
 *            account (the server emails the owner) — email code unlocks.
 *   setup  → after REGISTRATION: choose how future sign-ins work (email code
 *            every time, or the 4-digit PIN set right here).
 *
 * On success the server has set the session cookie; we invalidate whoami so the
 * app re-renders as the freshly-verified user (which also earns the blue badge).
 */
type Stage = "email" | "register" | "code" | "pin" | "setup";

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
   * code. Shared by the manual email form AND the auto-send path below —
   * v2.88 fix: the auto path used to call requestOtp directly, bypassing the
   * probe, so PIN accounts arriving via the gate never saw their PIN pad.
   */
  async function routeAfterProbe(email: string): Promise<void> {
    const p = await loginProbe.mutateAsync({ email });
    if (p.unregistered) { setStage("register"); return; }
    if (p.hasPin && !p.locked) {
      setPin("");
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
    try {
      await loginWithPin.mutateAsync({ email: cleanEmail, pin });
      await utils.identity.whoami.invalidate();
      if (onVerified) onVerified();
      else onClose();
    } catch (err) {
      setPin("");
      setError(messageOf(err, "That PIN didn't work."));
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
   * auto-fired the instant the 6th digit lands (v2.88 — matches the v2.49
   * keypad convention). The 4-digit PIN is deliberately NOT auto-submitted:
   * with lock-after-4-wrong-tries, auto-firing typos burns attempts and can
   * lock the account.
   */
  async function verifyCode(codeStr: string) {
    if (verifyOtp.isPending) return;
    setError(null);
    try {
      await verifyOtp.mutateAsync({ email: cleanEmail, code: codeStr.trim() });
      // Fresh REGISTRATION: offer the sign-in choice (email code vs 4-digit
      // PIN) right now, per spec — existing users manage it in Profile.
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
    <div className="fixed inset-0 z-[110] grid place-items-center glass-overlay p-4" role="dialog" aria-modal="true">
      <div className="w-[min(94vw,420px)] rounded-3xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {stage !== "email" && (
              <button
                type="button"
                onClick={() => { setStage("email"); setError(null); setNotice(null); }}
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
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || !cleanEmail}>
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
                <Input id="auth-first" required autoFocus value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Alex" maxLength={64} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="auth-last">Last name</Label>
                <Input id="auth-last" required value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Rivera" maxLength={64} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auth-email2">Email</Label>
              <Input id="auth-email2" type="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || !firstName.trim() || !lastName.trim() || !cleanEmail}>
              {register.isPending ? "Sending…" : "Create account & send code"}
            </Button>
          </form>
        )}

        {stage === "pin" && (
          <form onSubmit={submitPin} className="space-y-4">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/15 text-primary">
              <KeyRound className="size-7" />
            </div>
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
              className="text-center text-2xl tracking-[0.6em] font-mono"
            />
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || pin.length !== 4}>
              {loginWithPin.isPending ? "Checking…" : "Sign in"}
            </Button>
            <Button type="button" variant="secondary" className="w-full" onClick={pinToEmailCode} disabled={busy}>
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
                  placeholder="••••" className="text-center font-mono tracking-[0.4em]" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pin-2">Repeat it</Label>
                <Input id="pin-2" type="password" inputMode="numeric" maxLength={4} value={setupPin2}
                  onChange={(e) => setSetupPin2(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="••••" className="text-center font-mono tracking-[0.4em]" />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || setupPin.length !== 4 || setupPin2.length !== 4}>
              {setLoginPin.isPending ? "Saving…" : "Use this PIN to sign in"}
            </Button>
            <Button type="button" variant="secondary" className="w-full" onClick={skipSetup} disabled={busy}>
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
                // Auto-verify on the 6th digit (v2.49 keypad convention) —
                // no extra tap. Wrong codes surface inline as before.
                if (v.length === 6) void verifyCode(v);
              }}
              placeholder="••••••"
              className="text-center text-2xl tracking-[0.5em] font-mono"
            />
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            {notice && !error && <p className="text-sm text-muted-foreground text-center">{notice}</p>}
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
              {verifyOtp.isPending ? "Verifying…" : "Verify & continue"}
            </Button>
            <div className="flex flex-col items-center gap-2">
              <Button type="button" variant="secondary" onClick={resend} disabled={resendIn > 0} className="w-full">
                {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function messageOf(err: unknown, fallback: string): string {
  const m = (err as { message?: string })?.message;
  return typeof m === "string" && m.length > 0 && m.length < 200 ? m : fallback;
}
