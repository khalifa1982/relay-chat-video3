import { useEffect, useRef, useState } from "react";
import { X, Mail, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Self-hosted email + password registration / sign-in panel (no third-party
 * identity provider). Talks to the raw /api/auth/* routes.
 *
 * Register → a "check your email" stage that POLLS /api/auth/status (so it never
 * hangs); the instant the link is clicked in the other tab, it auto-signs-in and
 * proceeds. A 1-minute "Resend link" cooldown matches the backend.
 */
type Mode = "register" | "login";
type Stage = "form" | "verify";

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: { error?: string; message?: string } }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { message: "Network error — please try again." } };
  }
}

export function AuthPanel({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("register");
  const [stage, setStage] = useState<Stage>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };
  useEffect(() => stopPolling, []);

  // Single 1Hz ticker for the resend countdown.
  useEffect(() => {
    const t = setInterval(() => setResendIn((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  const proceed = () => window.location.assign("/app");

  function beginVerifyWait() {
    setStage("verify");
    setResendIn(60);
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/auth/status?email=${encodeURIComponent(email)}`, { cache: "no-store" });
        const data = (await res.json()) as { verified?: boolean };
        if (data.verified) {
          stopPolling();
          // Auto-sign-in with the password still held in memory, then continue.
          const r = await postJson("/api/auth/login", { email, password });
          if (r.ok) proceed();
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        const r = await postJson("/api/auth/login", { email: email.trim(), password });
        if (r.ok) return proceed();
        if (r.status === 403 && r.data.error === "unverified") return beginVerifyWait();
        setError(r.data.message || "Couldn't sign in.");
      } else {
        const r = await postJson("/api/auth/register", { email: email.trim(), password });
        if (r.ok) return beginVerifyWait();
        setError(r.data.message || "Couldn't create your account.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (resendIn > 0) return;
    setResendIn(60);
    await postJson("/api/auth/resend", { email: email.trim() });
  }

  return (
    <div className="fixed inset-0 z-[110] grid place-items-center bg-black/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-[min(94vw,420px)] rounded-3xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {stage === "verify" ? "Verify your email" : mode === "register" ? "Create your account" : "Sign in"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted-foreground hover:bg-muted">
            <X className="size-5" />
          </button>
        </div>

        {stage === "verify" ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/15 text-primary">
              <Mail className="size-7" />
            </div>
            <p className="text-sm">
              We sent a verification link to <span className="font-semibold break-all">{email}</span>.
              Open it to finish — this screen updates automatically.
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Waiting for verification…
            </div>
            <div className="flex flex-col gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={resend} disabled={resendIn > 0}>
                {resendIn > 0 ? `Resend link in ${resendIn}s` : "Resend link"}
              </Button>
              <button
                type="button"
                onClick={() => { stopPolling(); setStage("form"); setError(null); }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Use a different email
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="auth-email">Email</Label>
              <Input
                id="auth-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auth-pass">Password</Label>
              <Input
                id="auth-pass"
                type="password"
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "register" ? "At least 8 characters, with a number" : "Your password"}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || !email.trim() || !password}>
              {busy ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}
            </Button>
            <div className="flex items-center justify-center gap-1 pt-1 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" /> Self-hosted — your email &amp; password stay on this server.
            </div>
            <button
              type="button"
              onClick={() => { setMode(mode === "register" ? "login" : "register"); setError(null); }}
              className="w-full pt-1 text-center text-xs text-muted-foreground hover:text-foreground"
            >
              {mode === "register" ? "Already have an account? Sign in" : "New here? Create an account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
