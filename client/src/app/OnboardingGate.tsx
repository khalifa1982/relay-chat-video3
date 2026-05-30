import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIdentity } from "./useIdentity";

interface OnboardingGateProps {
  children: React.ReactNode;
}

/**
 * Show the children only after we have an identity. Otherwise render
 * a friendly "pick a name" screen that creates a guest session.
 */
export function OnboardingGate({ children }: OnboardingGateProps) {
  const { me, loading, startGuest, startGuestPending, startGuestError } = useIdentity();
  const [name, setName] = useState("");

  if (loading) {
    return (
      <div className="min-h-svh flex items-center justify-center bg-background text-foreground">
        <div className="size-10 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }

  if (me) return <>{children}</>;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await startGuest(trimmed).catch(() => {
      /* error surfaces via startGuestError */
    });
  }

  return (
    <div className="min-h-svh flex items-center justify-center bg-background text-foreground p-6">
      <div className="w-full max-w-md">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-3">
            <span className="inline-block size-3 rounded-full bg-primary animate-pulse" />
            <span className="text-2xl font-semibold tracking-wide">RELAY</span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Pick a name. Get a 6-digit number. Call anyone, anywhere.
          </p>
        </div>
        <form
          onSubmit={onSubmit}
          className="rounded-2xl bg-card border border-border p-6 shadow-2xl"
        >
          <label className="text-xs uppercase tracking-widest text-muted-foreground mb-2 block">
            Your display name
          </label>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alex"
            maxLength={64}
            className="h-12 text-base"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Guests stay signed in on this device for 30 days. Upgrade later to keep your number forever.
          </p>
          {startGuestError && (
            <p className="mt-3 text-sm text-destructive">{startGuestError.message}</p>
          )}
          <Button
            type="submit"
            disabled={!name.trim() || startGuestPending}
            className="mt-5 h-12 w-full text-base font-semibold"
          >
            {startGuestPending ? "Setting up…" : "Enter RELAY"}
          </Button>
        </form>
        <div className="mt-6 text-center text-xs text-muted-foreground">
          By continuing you agree the only data we store about you is your name, number,
          contacts, messages, and call history — all tied to this device until you register.
        </div>
      </div>
    </div>
  );
}
