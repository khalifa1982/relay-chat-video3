import { useState, useEffect, type FormEvent } from "react";
import { Lock, ScanFace } from "lucide-react";
import { useLocked, verifyPasscode, unlockApp } from "./passcode";
import { hasBiometric, biometricUnlock } from "./biometric";

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

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || code.length < 4) return;
    setBusy(true);
    const ok = await verifyPasscode(code);
    setBusy(false);
    if (ok) {
      unlockApp();
    } else {
      setError(true);
      setCode("");
    }
  }

  async function tryBiometric() {
    if (bioBusy) return;
    setBioBusy(true);
    const ok = await biometricUnlock();
    setBioBusy(false);
    if (ok) unlockApp();
    // On cancel/failure we silently fall back to the passcode field below.
  }

  // Offer the biometric prompt as soon as the lock screen mounts (a no-op if
  // not enrolled). Some browsers require a gesture, so the button stays as the
  // reliable fallback; we swallow any auto-prompt rejection.
  useEffect(() => {
    if (bioEnrolled) void tryBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dark min-h-svh grid place-items-center bg-[#08090C] text-foreground p-5">
      <form onSubmit={submit} className="w-full max-w-[340px] text-center">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-[color:var(--relay-online)]/12 text-[color:var(--relay-online)]">
          <Lock className="size-6" />
        </div>
        <h1 className="text-lg font-semibold">Enter passcode</h1>
        <p className="mt-1 text-sm text-muted-foreground">RELAY is locked on this device.</p>
        {bioEnrolled && (
          <button
            type="button"
            onClick={tryBiometric}
            disabled={bioBusy}
            className="mt-5 inline-flex items-center gap-2 rounded-xl border border-[color:var(--relay-online)]/40 bg-[color:var(--relay-online)]/10 px-4 py-2.5 text-sm font-medium text-[color:var(--relay-online)] transition active:scale-[0.98] disabled:opacity-50 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            <ScanFace className="size-4" />
            {bioBusy ? "Waiting…" : "Unlock with Face ID / fingerprint"}
          </button>
        )}
        <input
          autoFocus
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={8}
          value={code}
          onChange={(e) => {
            setError(false);
            setCode(e.target.value.replace(/\D+/g, ""));
          }}
          className={
            "mt-6 h-14 w-full rounded-2xl border bg-card/60 text-center text-3xl tracking-[0.4em] font-mono outline-none transition " +
            "focus-visible:ring-ring/50 focus-visible:ring-[3px] " +
            (error
              ? "border-destructive"
              : "border-border/60 focus:border-[color:var(--relay-online)]")
          }
          aria-label="Passcode"
        />
        {error && <p className="mt-2 text-sm text-destructive">Incorrect passcode</p>}
        <button
          type="submit"
          disabled={code.length < 4 || busy}
          className="mt-5 h-12 w-full rounded-xl bg-[color:var(--relay-online,theme(colors.primary.DEFAULT))] text-primary-foreground font-semibold disabled:opacity-40 active:scale-[0.99] transition outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        >
          {busy ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
