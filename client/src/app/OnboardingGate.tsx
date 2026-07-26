import { useState, type FormEvent } from "react";
import { Phone, Video, MessageSquare, ArrowRight, User2, PhoneCall, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { useIdentity } from "./useIdentity";
import { AuthPanel } from "./AuthPanel";
import { GuestRestore } from "./GuestRestore";
import { LiveStats } from "./LiveStats";
import { MatrixReveal } from "./MatrixReveal";

interface OnboardingGateProps {
  children: React.ReactNode;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Format a 6-digit RELAY number as `NNN-NNN`; pass anything else through. */
function fmtNumber(n: string): string {
  return /^\d{6}$/.test(n) ? `${n.slice(0, 3)}-${n.slice(3)}` : n;
}

/**
 * A shared call/invite link (`/i/<pin>` → `/app/dialer?to=<pin>`) carries the
 * number to dial in the URL. Pull it out so a not-yet-identified clicker can be
 * shown a FOCUSED "join this call" screen instead of the generic login. Returns
 * the 6-digit target or null. Pure + exported for tests.
 */
export function inviteTargetFromSearch(search: string): string | null {
  try {
    const to = (new URLSearchParams(search || "").get("to") || "").replace(/\D+/g, "").slice(0, 6);
    return /^\d{6}$/.test(to) ? to : null;
  } catch {
    return null;
  }
}

/**
 * Entry / login screen. Shows the app once an identity exists; otherwise a
 * fast, glassy screen whose PRIMARY path is GUEST entry: type a display name →
 * straight in (a SESSION-only guest — wiped when the browser closes). Registered sign-in
 * (passwordless email code — login and registration are the same flow, so
 * there's no password to forget) is the secondary path behind a "Login /
 * Register" button. No third-party sign-in. Forced dark for a consistent
 * striking look; the animated backdrop is pure CSS, reduced-motion gated.
 *
 * CALL-LINK DIRECT-JOIN (owner: "paramount"): when the URL carries a call
 * target (a shared `/i/<pin>` invite → `/app/dialer?to=<pin>`) and the visitor
 * has NO identity, the gate does NOT show the marketing/login clutter — it
 * shows a single "you're calling <name> · enter your name to connect" card so
 * the clicker types one field and lands straight in the dial (the Dialer's
 * existing `?to=` auto-dial handles the rest). Registered users / active guests
 * skip this entirely (identity present ⇒ children render ⇒ auto-dial).
 */
export function OnboardingGate({ children }: OnboardingGateProps) {
  const { me, loading, startGuest, startGuestPending, startGuestError, refresh } = useIdentity();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailMode, setEmailMode] = useState(false); // guest-first: email is the secondary path
  const [authEmail, setAuthEmail] = useState<string | null>(null);

  // A call/invite link puts the callee's number in the URL. Resolve it (public
  // query, no identity needed) so the join card can name who you're calling.
  const [callTarget] = useState<string | null>(() =>
    inviteTargetFromSearch(typeof window !== "undefined" ? window.location.search : "")
  );
  const invite = trpc.directory.lookup.useQuery(
    { number: callTarget ?? "" },
    { enabled: !!callTarget && !me && !loading, retry: false, staleTime: 60_000 }
  );

  // Guest ID-reveal ("matrix" animation) state — plays after a standard guest
  // picks a name, holding the gate on screen while the session is minted.
  const [revealing, setRevealing] = useState(false);
  const [revealNumber, setRevealNumber] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="dark min-h-svh grid place-items-center bg-[#08090C] text-foreground">
        <div className="size-9 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
      </div>
    );
  }

  // The matrix reveal must outlast the moment `me` flips truthy (startGuest
  // invalidates whoami on success), so it's checked BEFORE the identity gate —
  // it stays until its own onDone, then children render underneath.
  if (revealing) {
    return (
      <MatrixReveal
        number={revealNumber}
        name={name}
        onDone={() => setRevealing(false)}
      />
    );
  }

  if (me) return <>{children}</>;

  async function onGuestSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    // Standard guest entry plays the ID-reveal; a call-link join skips it and
    // goes straight into the dial (owner: "land directly in the call").
    if (!callTarget) setRevealing(true);
    try {
      const res = await startGuest(trimmed);
      if (!callTarget) setRevealNumber(res?.number ?? null);
    } catch {
      // Error surfaces via startGuestError; drop the reveal so the form shows it.
      setRevealing(false);
    }
  }

  function onEmailSubmit(e: FormEvent) {
    e.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) return;
    setAuthEmail(clean); // opens the passwordless panel, prefilled + auto-send
  }

  // ── Call-link direct-join: a focused "enter your name to connect" card. ──
  // Shown when a call target is in the URL and we're not in the email path.
  const showJoin = !!callTarget && !emailMode;
  const invitee = invite.data;
  const isPartyLine = !!invitee?.partyLine;
  const inviteeName = invitee?.displayName?.trim() || "";
  // v2.99.15 — a guest may only call an ONLINE user from a call link. A guest
  // has no persistent thread to leave a message on (unlike a signed-in caller's
  // post-dial voicemail card), so an offline callee — or a number that doesn't
  // exist — BLOCKS the join here instead of ringing into the void. Party lines
  // are always joinable (they never ring anyone). We wait for the lookup to
  // resolve and FAIL OPEN on a lookup error (isError ⇒ not "resolved"), so a
  // transient hiccup never strands a legitimate caller.
  const inviteResolved = invite.isFetched && !invite.isError;
  const numberNotFound = inviteResolved && !isPartyLine && !invitee;
  const calleeOffline = inviteResolved && !isPartyLine && !!invitee && !invitee.isOnline;
  const joinBlocked = numberNotFound || calleeOffline;

  return (
    <div className="dark relay-login relative min-h-svh overflow-hidden grid place-items-center bg-[#08090C] text-foreground p-5">
      {/* Lightweight animated backdrop (CSS only, reduced-motion gated) */}
      <div aria-hidden className="login-fx pointer-events-none absolute inset-0" />
      <div aria-hidden className="login-grid pointer-events-none absolute inset-0" />

      <div className="login-card relative w-full max-w-[400px]">
        {showJoin ? (
          <>
            {/* ── CALL-LINK JOIN ── */}
            <div className="mb-6 text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--relay-online,#06d6a0)]/30 bg-[color:var(--relay-online,#06d6a0)]/10 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--relay-online,#06d6a0)]">
                {isPartyLine ? <Users className="size-3.5" /> : <PhoneCall className="size-3.5" />}
                {isPartyLine ? "Party line" : "Incoming call link"}
              </span>
            </div>

            <div className="rounded-3xl border border-border/60 bg-card/60 p-6 shadow-2xl shadow-black/40 backdrop-blur-2xl backdrop-saturate-150">
              {/* Callee card */}
              <div className="mb-5 flex flex-col items-center text-center">
                <div className="relative mb-3">
                  <div className="grid size-16 place-items-center rounded-full bg-gradient-to-br from-[#3FE0C5] to-[#6EE7FF] text-2xl font-bold text-[#04201b]">
                    {(inviteeName || "?").slice(0, 1).toUpperCase()}
                  </div>
                  {invitee?.isOnline && (
                    <span className="absolute bottom-0.5 right-0.5 size-3.5 rounded-full border-2 border-[#0b0f14] bg-[color:var(--relay-online,#06d6a0)]" />
                  )}
                </div>
                <div className="text-lg font-semibold leading-tight">
                  {isPartyLine
                    ? inviteeName || "Party line"
                    : inviteeName
                      ? `Call ${inviteeName}`
                      : "Call this number"}
                </div>
                <div className="mt-1 font-mono text-sm text-muted-foreground">
                  {fmtNumber(callTarget!)}
                  {isPartyLine
                    ? ` · ${invitee?.memberCount ?? 0} on the line`
                    : invitee
                      ? invitee.isOnline
                        ? " · online now"
                        : " · offline — you can't call them right now"
                      : invite.isFetched
                        ? " · number not found"
                        : ""}
                </div>
              </div>

              {/* One field: your name, then join. */}
              <form onSubmit={onGuestSubmit}>
                <label
                  htmlFor="relay-join-name"
                  className="mb-2 block text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground"
                >
                  Enter your name to connect
                </label>
                <Input
                  id="relay-join-name"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  maxLength={64}
                  className="h-12 rounded-xl text-base"
                />
                {startGuestError && (
                  <p className="mt-2.5 text-sm text-destructive">{startGuestError.message}</p>
                )}
                <Button
                  type="submit"
                  disabled={!name.trim() || startGuestPending || joinBlocked}
                  className="mt-4 h-12 w-full gap-2 rounded-xl text-base font-semibold text-primary-foreground bg-[color:var(--relay-online,theme(colors.primary.DEFAULT))] shadow-[0_10px_28px_-10px_color-mix(in_oklab,var(--relay-online,#06d6a0)_70%,transparent)] active:scale-[0.99] transition-transform"
                >
                  {startGuestPending ? (
                    "Connecting…"
                  ) : numberNotFound ? (
                    "Number not found"
                  ) : calleeOffline ? (
                    <>
                      <PhoneCall className="size-4" />
                      They're offline — can't call
                    </>
                  ) : (
                    <>
                      {isPartyLine ? <Users className="size-4" /> : <PhoneCall className="size-4" />}
                      {isPartyLine ? "Join the line" : "Join call"}
                    </>
                  )}
                </Button>
                {calleeOffline && (
                  <p className="mt-2.5 text-center text-xs text-muted-foreground">
                    You can reach {inviteeName || "them"} once they're back online.
                  </p>
                )}
              </form>

              <button
                type="button"
                onClick={() => setEmailMode(true)}
                className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground"
              >
                Have a RELAY account? Sign in first
              </button>
            </div>
            <p className="mx-auto mt-4 max-w-[19rem] text-center text-[0.72rem] leading-relaxed text-muted-foreground/80">
              No account needed — your name is just for this call. Registering later
              keeps your number and history.
            </p>
          </>
        ) : (
          <>
            {/* ── RESTORE A PREVIOUS NUMBER (v2.99.68) ──
                Renders itself only when this browser holds a recovery record AND
                the server confirms the key still names an unclaimed identity, so a
                first-time visitor never sees it. Above the sign-in card because for
                a returning guest this IS the primary action — typing a name would
                mint a second identity and leave the first one stranded, which is
                the loss this exists to prevent.
                Deliberately NOT on the call-link join screen: that path is a single
                focused field by design, and a second decision there costs the
                caller the call. */}
            {!emailMode && (
              <GuestRestore className="mb-5" onRestored={refresh} />
            )}

            {/* Brand */}
            <div className="mb-7 text-center">
              <div className="inline-flex items-center gap-2.5">
                <span className="login-dot inline-block size-3 rounded-full" />
                <span className="text-[1.6rem] font-bold tracking-tight">RELAY</span>
              </div>
              <p className="mx-auto mt-2.5 max-w-[19rem] text-sm leading-relaxed text-muted-foreground">
                {emailMode
                  ? "Login or register with your email — no password, we send you a one-time code."
                  : "Pick a name and jump straight in — no account needed."}
              </p>
            </div>

            {/* Card */}
            <div className="rounded-3xl border border-border/60 bg-card/60 p-6 shadow-2xl shadow-black/40 backdrop-blur-2xl backdrop-saturate-150">
              {!emailMode ? (
                <>
                  {/* PRIMARY: guest entry */}
                  <form onSubmit={onGuestSubmit}>
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
                      {startGuestPending ? "Setting up…" : (<><User2 className="size-4" /> Enter as guest</>)}
                    </Button>
                  </form>

                  <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground/70">
                    <span className="h-px flex-1 bg-border/60" /> or{" "}
                    <span className="h-px flex-1 bg-border/60" />
                  </div>

                  {/* SECONDARY: registered account (passwordless email code) */}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEmailMode(true)}
                    className="h-12 w-full gap-2 rounded-xl border-border/60 text-base"
                  >
                    Login / Register with email <ArrowRight className="size-4" />
                  </Button>
                  <p className="mt-3 text-center text-[0.72rem] leading-relaxed text-muted-foreground/80">
                    Guest sessions end when you close your browser — but this browser can
                    restore your number and history next time. Registering keeps them
                    permanently and earns a verified badge.
                  </p>
                </>
              ) : (
                <>
                  {/* Registered sign-in / registration — passwordless email code */}
                  <form onSubmit={onEmailSubmit}>
                    <label
                      htmlFor="relay-email"
                      className="mb-2 block text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground"
                    >
                      Your email
                    </label>
                    <Input
                      id="relay-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoFocus
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="h-12 rounded-xl text-base"
                    />
                    <Button
                      type="submit"
                      disabled={!EMAIL_RE.test(email.trim().toLowerCase())}
                      className="mt-4 h-12 w-full gap-2 rounded-xl text-base font-semibold text-primary-foreground bg-[color:var(--relay-online,theme(colors.primary.DEFAULT))] shadow-[0_10px_28px_-10px_color-mix(in_oklab,var(--relay-online,#06d6a0)_70%,transparent)] active:scale-[0.99] transition-transform"
                    >
                      Continue with email <ArrowRight className="size-4" />
                    </Button>
                  </form>
                  <p className="mt-3 text-center text-[0.72rem] leading-relaxed text-muted-foreground/80">
                    Login and registration are the same step — the code we email you does both.
                    No password, so there's nothing to forget.
                  </p>
                  <button
                    type="button"
                    onClick={() => setEmailMode(false)}
                    className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground"
                  >
                    {callTarget ? "← Back to joining the call" : "← Continue as guest instead"}
                  </button>
                </>
              )}
            </div>

            {/* Live counters — below the sign-in card, above the Voice/Video/Chat
                chips, exactly where the owner asked for them. Same public
                aggregate endpoint the landing page reads, polled so the figures
                move while the screen is open. */}
            <LiveStats className="mt-6" />

            {/* Feature chips */}
            <div className="mt-5 flex items-center justify-center gap-2">
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
          </>
        )}
      </div>

      {authEmail !== null && (
        <AuthPanel
          initialEmail={authEmail}
          onClose={() => setAuthEmail(null)}
          onVerified={() => {
            // Session cookie is set; re-resolve whoami so the gate lets us in.
            setAuthEmail(null);
            refresh();
          }}
        />
      )}

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
