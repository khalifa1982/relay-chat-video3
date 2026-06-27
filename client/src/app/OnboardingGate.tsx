import { useState, type FormEvent } from "react";
import { Phone, Video, MessageSquare, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getLoginUrl } from "@/const";
import { useIdentity } from "./useIdentity";

interface OnboardingGateProps {
  children: React.ReactNode;
}

/**
 * Entry / login screen. Shows the app once an identity exists; otherwise a
 * fast, glassy dual-path screen: continue as a guest (name → instant 6-digit
 * number) or sign in / register. Forced dark for a consistent striking look;
 * the animated backdrop is pure CSS and gated behind prefers-reduced-motion.
 */
export function OnboardingGate({ children }: OnboardingGateProps) {
  const { me, loading, startGuest, startGuestPending, startGuestError } = useIdentity();
  const [name, setName] = useState("");

  if (loading) {
    return (
      <div className="dark min-h-svh grid place-items-center bg-[#08090C] text-foreground">
        <div className="size-9 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
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

  // "" when OAuth isn't configured (e.g. local dev) — hide the sign-in path
  // rather than crashing the whole entry screen.
  const loginUrl = getLoginUrl();

  return (
    <div className="dark relay-login relative min-h-svh overflow-hidden grid place-items-center bg-[#08090C] text-foreground p-5">
      {/* Lightweight animated backdrop (CSS only, reduced-motion gated) */}
      <div aria-hidden className="login-fx pointer-events-none absolute inset-0" />
      <div aria-hidden className="login-grid pointer-events-none absolute inset-0" />

      <div className="login-card relative w-full max-w-[400px]">
        {/* Brand */}
        <div className="mb-7 text-center">
          <div className="inline-flex items-center gap-2.5">
            <span className="login-dot inline-block size-3 rounded-full" />
            <span className="text-[1.6rem] font-bold tracking-tight">RELAY</span>
          </div>
          <p className="mx-auto mt-2.5 max-w-[19rem] text-sm leading-relaxed text-muted-foreground">
            Pick a name, get a 6-digit number, call anyone — straight in the browser.
          </p>
        </div>

        {/* Card */}
        <div className="rounded-3xl border border-border/60 bg-card/60 p-6 shadow-2xl shadow-black/40 backdrop-blur-2xl backdrop-saturate-150">
          <form onSubmit={onSubmit}>
            <label
              htmlFor="relay-name"
              className="mb-2 block text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground"
            >
              Your display name
            </label>
            <Input
              id="relay-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex"
              maxLength={64}
              className="h-12 rounded-xl text-base"
            />
            {startGuestError && (
              <p className="mt-2.5 text-sm text-destructive">{startGuestError.message}</p>
            )}
            <Button
              type="submit"
              disabled={!name.trim() || startGuestPending}
              className="mt-4 h-12 w-full gap-2 rounded-xl text-base font-semibold text-primary-foreground bg-[color:var(--relay-online,theme(colors.primary.DEFAULT))] shadow-[0_10px_28px_-10px_color-mix(in_oklab,var(--relay-online,#06d6a0)_70%,transparent)] active:scale-[0.99] transition-transform"
            >
              {startGuestPending ? (
                "Setting up…"
              ) : (
                <>
                  Enter RELAY <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </form>

          {loginUrl && (
            <>
              <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground/70">
                <span className="h-px flex-1 bg-border/60" /> or{" "}
                <span className="h-px flex-1 bg-border/60" />
              </div>

              <a href={loginUrl} className="block">
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-full rounded-xl border-border/60 text-base"
                >
                  Sign in / Register
                </Button>
              </a>
            </>
          )}
          <p className="mt-3 text-center text-[0.72rem] leading-relaxed text-muted-foreground/80">
            Guests stay on this device for 30 days. Register to keep your number forever
            and unlock contact sync, recording &amp; more.
          </p>
        </div>

        {/* Feature chips */}
        <div className="mt-6 flex items-center justify-center gap-2">
          {[
            { icon: Phone, label: "Voice" },
            { icon: Video, label: "Video" },
            { icon: MessageSquare, label: "Chat" },
          ].map(({ icon: Icon, label }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-card/50 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-md"
            >
              <Icon className="size-3.5" /> {label}
            </span>
          ))}
        </div>
      </div>

      <style>{`
        .relay-login { --c1: 63,224,197; --c2: 110,231,255; }
        .relay-login .login-dot {
          background: linear-gradient(135deg, #3FE0C5, #6EE7FF);
          box-shadow: 0 0 16px rgba(63,224,197,.7);
        }
        .relay-login .login-grid {
          background-image:
            linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px);
          background-size: 44px 44px;
          -webkit-mask-image: radial-gradient(circle at 50% 42%, black, transparent 72%);
          mask-image: radial-gradient(circle at 50% 42%, black, transparent 72%);
        }
        .relay-login .login-fx::before, .relay-login .login-fx::after {
          content: ""; position: absolute; border-radius: 9999px; filter: blur(60px); opacity: .5;
        }
        .relay-login .login-fx::before {
          width: 46vmax; height: 46vmax; left: -10vmax; top: -14vmax;
          background: radial-gradient(circle, rgba(var(--c1),.20), transparent 60%);
        }
        .relay-login .login-fx::after {
          width: 40vmax; height: 40vmax; right: -12vmax; bottom: -14vmax;
          background: radial-gradient(circle, rgba(var(--c2),.16), transparent 60%);
        }
        @media (prefers-reduced-motion: no-preference) {
          .relay-login .login-fx::before { animation: loginDrift1 14s ease-in-out infinite alternate; }
          .relay-login .login-fx::after  { animation: loginDrift2 18s ease-in-out infinite alternate; }
          .relay-login .login-card { animation: loginIn .5s cubic-bezier(0.23,1,0.32,1) both; }
        }
        @keyframes loginDrift1 { from { transform: translate(-3%,-2%) scale(1); } to { transform: translate(4%,3%) scale(1.08); } }
        @keyframes loginDrift2 { from { transform: translate(3%,2%) scale(1); } to { transform: translate(-4%,-3%) scale(1.1); } }
        @keyframes loginIn { from { opacity: 0; transform: translateY(14px) scale(.985); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
}
