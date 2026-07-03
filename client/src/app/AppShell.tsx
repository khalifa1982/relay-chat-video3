import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Phone, MessageCircle, UsersRound, History, LogOut, Sparkles, Sun, Moon, Smartphone, Monitor, ArrowLeft } from "lucide-react";
import { detectDeviceType } from "@/lib/deviceType";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useIdentity } from "./useIdentity";
import { AuthPanel } from "./AuthPanel";
import { VerifiedBadge } from "./VerifiedBadge";
import { OnboardingGate } from "./OnboardingGate";
import { PasscodeGate } from "./PasscodeGate";
import { useRealtime } from "./useRealtime";
import { useDnd } from "./dnd";
import { useTheme } from "@/contexts/ThemeContext";
import { MissedCallToast, NotificationBell } from "./MissedCalls";

/**
 * Tab keys used by the bottom-nav / sidebar. We hard-code the routes here
 * so the bottom-nav matches across pages.
 *
 * Each tab carries its OWN accent (`color`, plus a darker `shade` for the
 * active gradient + light-theme text) so tapping a section lights it up in a
 * distinct hue — Calls green, History sky, Messages orange, Contacts purple.
 * These are applied via inline styles, NOT template-composed Tailwind classes:
 * the JIT compiler can't see class names assembled at runtime.
 */
const TABS = [
  { key: "dialer", path: "/app/dialer", label: "Calls", icon: Phone, color: "#22c55e", shade: "#15803d" },
  { key: "history", path: "/app/history", label: "History", icon: History, color: "#38bdf8", shade: "#0369a1" },
  { key: "messages", path: "/app/messages", label: "Messages", icon: MessageCircle, color: "#fb923c", shade: "#c2410c" },
  { key: "contacts", path: "/app/contacts", label: "Contacts", icon: UsersRound, color: "#a78bfa", shade: "#7c3aed" },
] as const;

/** Small "Mobile"/"Desktop" chip shown next to the country flag, detected
 *  dynamically from this device. */
function DeviceChip({ className = "" }: { className?: string }) {
  const type = detectDeviceType();
  const Icon = type === "Mobile" ? Smartphone : Monitor;
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground " +
        className
      }
      title={`Calling from ${type}`}
    >
      <Icon className="size-3" />
      {type}
    </span>
  );
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || "??";
}

function formatNumber(n: string): string {
  // e.g. "812345" -> "812-345"
  if (n.length !== 6) return n;
  return `${n.slice(0, 3)}-${n.slice(3)}`;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  // Apply the relay-v2 accent palette to <html>. We deliberately do
  // NOT toggle `.dark` here — ThemeProvider owns light/dark and the
  // user can flip from Profile.
  useEffect(() => {
    document.documentElement.classList.add("relay-v2");
  }, []);

  // PasscodeGate sits outermost: if a device passcode is set the lock
  // screen covers everything (even onboarding) until the user unlocks.
  return (
    <PasscodeGate>
      <OnboardingGate>
        <Inner>{children}</Inner>
      </OnboardingGate>
    </PasscodeGate>
  );
}

function Inner({ children }: { children: React.ReactNode }) {
  const { me, signOut } = useIdentity();
  const [location, navigate] = useLocation();
  const utils = trpc.useUtils();
  // Passwordless upgrade panel (guest → verified user). No third-party sign-in.
  const [authOpen, setAuthOpen] = useState(false);
  // Do Not Disturb now lives inside the NotificationBell panel (it used to be a
  // SECOND, visually-identical bell icon next to the notification bell).
  const [dnd, setDnd] = useDnd();

  // Open the SSE push channel as soon as we know we have an identity.
  // Server pushes message/read/presence/contact hints → hook invalidates the
  // right tRPC queries so the UI feels near-instant without WebSockets.
  useRealtime(Boolean(me), me?.id ?? null);

  // Lock the DOCUMENT while the shell is mounted: every scrollable area lives
  // INSIDE the shell, so the page itself must never scroll or rubber-band.
  // Without this, iOS Safari's keyboard scroll-into-view (e.g. focusing the
  // Contacts search) shoved the whole shell upward and left the app scrolled
  // past its own end — a dead black band below the tab bar. Scoped to Inner so
  // the onboarding/lock screens (outside the shell) keep normal page scroll.
  useEffect(() => {
    document.documentElement.classList.add("relay-app-lock");
    document.body.classList.add("relay-app-lock");
    return () => {
      document.documentElement.classList.remove("relay-app-lock");
      document.body.classList.remove("relay-app-lock");
    };
  }, []);

  // Pre-fetch the threads & calls list once we have an identity so the
  // tab badges are warm by the time the user taps them.
  useEffect(() => {
    if (me) {
      utils.messages.threads.prefetch();
      utils.calls.history.prefetch();
    }
  }, [me, utils]);

  const threads = trpc.messages.threads.useQuery(undefined, {
    enabled: !!me,
    refetchInterval: 15_000,
  });
  // Lightweight geo lookup for the country-flag chip next to the user's PIN.
  // Polled once per session — IPs don't change often inside a tab lifetime.
  const geo = trpc.directory.geoSelf.useQuery(undefined, {
    enabled: !!me,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  const { theme, setTheme } = useTheme();
  // Universal Back: Profile is the one drill-in route off the tab bar (message
  // threads handle their own in-page back). Go back in history, or fall back to
  // the dialer if there's nowhere to go.
  const isSubPage = location.startsWith("/app/profile");
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) window.history.back();
    else navigate("/app/dialer");
  };
  const unreadTotal = useMemo(
    () =>
      (threads.data ?? []).reduce((acc, t) => acc + (t.unreadCount ?? 0), 0),
    [threads.data]
  );

  // Missed calls that arrived while away (guest or registered). Drives the
  // landing popup + the History / bell badges.
  const missed = trpc.calls.missedSummary.useQuery(undefined, {
    enabled: !!me,
    refetchInterval: 20_000,
  });
  const missedCount = missed.data?.count ?? 0;
  const markSeen = trpc.calls.markMissedSeen.useMutation({
    onSuccess: () => utils.calls.missedSummary.invalidate(),
  });
  // Reviewing the History tab acknowledges all missed calls (clears the badges).
  const onHistory = location.startsWith("/app/history");
  useEffect(() => {
    if (onHistory && missedCount > 0 && !markSeen.isPending) {
      markSeen.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onHistory, missedCount]);
  // The landing popup is dismissible WITHOUT clearing the History/bell badges
  // (those stay until the user actually reviews History — dismissing the toast
  // just says "stop showing me this banner", not "I've seen these calls").
  // Persisted to localStorage (not just sessionStorage, which only survives a
  // refresh — not a full close + reopen) and keyed to the dismissed COUNT, so a
  // brand-new missed call after dismissal still re-surfaces the popup instead
  // of staying silently suppressed forever.
  const DISMISS_KEY = "relay_missed_popup_dismissed_count";
  const [dismissedAtCount, setDismissedAtCount] = useState(() => {
    try { return Number(localStorage.getItem(DISMISS_KEY) ?? 0); } catch { return 0; }
  });
  const popupDismissed = missedCount > 0 && missedCount <= dismissedAtCount;
  const dismissPopup = () => {
    setDismissedAtCount(missedCount);
    try { localStorage.setItem(DISMISS_KEY, String(missedCount)); } catch { /* */ }
  };
  const viewMissed = () => {
    dismissPopup();
    navigate("/app/dialer?missed=1");
  };

  if (!me) return null;

  return (
    <div className="min-h-svh bg-background text-foreground flex flex-col md:flex-row">
      {/* Landing missed-call popup: prominent but non-intrusive, on app launch. */}
      {!popupDismissed && missed.data && (
        <MissedCallToast
          summary={{ count: missed.data.count, latest: missed.data.latest }}
          onView={viewMissed}
          onDismiss={dismissPopup}
        />
      )}
      {/* ── desktop / tablet sidebar ───────────────────────────── */}
      <aside
        className={
          "relay-appshell-chrome hidden md:flex md:flex-col md:w-64 lg:w-72 shrink-0 " +
          "border-r border-border/70 bg-sidebar/65 " +
          "supports-[backdrop-filter]:bg-sidebar/45 supports-[backdrop-filter]:backdrop-blur-xl supports-[backdrop-filter]:backdrop-saturate-150"
        }
      >
        <div className="px-5 pt-6 pb-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">RELAY</span>
            <NotificationBell
              missedCount={missedCount}
              unreadCount={unreadTotal}
              onOpenHistory={() => navigate("/app/history")}
              onOpenMessages={() => navigate("/app/messages")}
              dnd={dnd}
              onDndChange={setDnd}
            />
          </div>
          <Link
            href="/app/profile"
            className="flex items-center gap-3 group rounded-xl -mx-1 px-1 py-1 hover:bg-muted/40 transition-colors outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            {me.avatarUrl ? (
              <img
                src={me.avatarUrl}
                alt={me.displayName}
                className="size-10 rounded-2xl object-cover border border-border"
              />
            ) : (
              <div className="size-10 rounded-2xl bg-primary/15 grid place-items-center text-primary font-bold">
                {initialsFrom(me.displayName)}
              </div>
            )}
            <div className="min-w-0">
              <div className="font-semibold truncate group-hover:text-primary transition-colors flex items-center gap-1">
                <span className="truncate">{me.displayName}</span>
                {me.verified && <VerifiedBadge size={15} />}
              </div>
              <div className="font-mono text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
                {formatNumber(me.number)}
                {geo.data?.flagEmoji && (
                  <span
                    className="text-base leading-none"
                    title={geo.data.countryName ?? geo.data.country ?? ""}
                  >
                    {geo.data.flagEmoji}
                  </span>
                )}
                <DeviceChip />
              </div>
            </div>
          </Link>
          {me.isGuest && (
            <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs leading-relaxed">
              <div className="flex items-center gap-2 text-primary font-semibold mb-1">
                <Sparkles className="size-3.5" /> Guest mode
              </div>
              <p className="text-muted-foreground">
                Cookied to this browser for 30 days. Register to keep this number forever.
              </p>
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                className="mt-2 inline-block text-primary underline-offset-4 hover:underline font-medium"
              >
                Register with email →
              </button>
            </div>
          )}
        </div>
        <nav className="px-3 flex-1">
          {TABS.map((tab) => {
            const active = location.startsWith(tab.path);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.key}
                href={tab.path}
                className={
                  "group flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition-colors " +
                  "outline-none focus-visible:ring-sidebar-ring focus-visible:ring-[3px] " +
                  (active ? "font-semibold" : "hover:bg-sidebar-accent/15 text-sidebar-foreground")
                }
                style={
                  active
                    ? {
                        background: `color-mix(in oklab, ${tab.color} 16%, transparent)`,
                        color: theme === "light" ? tab.shade : tab.color,
                      }
                    : undefined
                }
              >
                <Icon className="size-5 shrink-0" strokeWidth={active ? 2.3 : 2} />
                <span className="flex-1">{tab.label}</span>
                {tab.key === "messages" && unreadTotal > 0 && (
                  <span className="inline-flex min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs items-center justify-center font-bold">
                    {unreadTotal > 99 ? "99+" : unreadTotal}
                  </span>
                )}
                {tab.key === "history" && missedCount > 0 && (
                  <span className="inline-flex min-w-5 h-5 px-1.5 rounded-full bg-destructive text-white text-xs items-center justify-center font-bold">
                    {missedCount > 99 ? "99+" : missedCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border space-y-2">
          {/* Compact theme toggle — mirrors the segmented control on Profile */}
          <div
            role="group"
            aria-label="Theme"
            className="grid grid-cols-2 gap-1 rounded-xl bg-muted/50 p-1"
          >
            <button
              type="button"
              aria-pressed={theme === "dark"}
              onClick={() => setTheme("dark")}
              className={
                "flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 " +
                "outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] " +
                (theme === "dark"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
              style={{ transitionTimingFunction: "cubic-bezier(0.23,1,0.32,1)" }}
            >
              <Moon className="size-3.5" /> Dark
            </button>
            <button
              type="button"
              aria-pressed={theme === "light"}
              onClick={() => setTheme("light")}
              className={
                "flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 " +
                "outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] " +
                (theme === "light"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
              style={{ transitionTimingFunction: "cubic-bezier(0.23,1,0.32,1)" }}
            >
              <Sun className="size-3.5" /> Light
            </button>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-muted-foreground"
            onClick={() => signOut().then(() => (window.location.href = "/"))}
          >
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </aside>

      {/* ── main column ────────────────────────────────────────── */}
      {/* max-md:h-svh makes the mobile shell's height DEFINITE (not just a
          min-height floor) so the flex chain below it resolves — and SMALL
          (svh = the viewport with the browser's toolbars VISIBLE), so the tab
          bar always fits on screen. dvh was tried (v2.76) and CUT THE TAB BAR
          OFF on a real iPhone: with the document scroll-locked, iOS Safari
          reported the large (toolbar-collapsed) height, making the shell
          taller than the visible area with no way to scroll to the bar. The
          scroll lock also means the toolbar never collapses on our page, so
          svh matches the visible viewport in practice. Do not switch back to
          dvh without re-testing on a physical iPhone. */}
      <main className="flex-1 flex flex-col min-w-0 min-h-svh max-md:h-svh">
        {/* mobile header */}
        <header
          className={
            "relay-appshell-chrome relay-appshell-topbar md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-2.5 " +
            "border-b border-border/70 bg-card/70 " +
            "supports-[backdrop-filter]:bg-card/45 supports-[backdrop-filter]:backdrop-blur-xl supports-[backdrop-filter]:backdrop-saturate-150"
          }
        >
          {isSubPage && (
            <button
              type="button"
              onClick={goBack}
              aria-label="Back"
              className="mr-1 grid size-9 shrink-0 place-items-center rounded-xl text-foreground hover:bg-muted/50 active:scale-95 transition outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              <ArrowLeft className="size-5" />
            </button>
          )}
          <Link
            href="/app/profile"
            className="flex items-center gap-3 min-w-0 active:opacity-70 transition-opacity rounded-xl outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            {me.avatarUrl ? (
              <img
                src={me.avatarUrl}
                alt={me.displayName}
                className="size-9 rounded-xl object-cover border border-border"
              />
            ) : (
              <div className="size-9 rounded-xl bg-primary/15 grid place-items-center text-primary font-bold text-sm">
                {initialsFrom(me.displayName)}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate flex items-center gap-1">
                <span className="truncate">{me.displayName}</span>
                {me.verified && <VerifiedBadge size={14} />}
              </div>
              <div className="font-mono text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                {formatNumber(me.number)}
                {geo.data?.flagEmoji && (
                  <span
                    className="text-sm leading-none"
                    title={geo.data.countryName ?? geo.data.country ?? ""}
                  >
                    {geo.data.flagEmoji}
                  </span>
                )}
                <DeviceChip />
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-1">
            <NotificationBell
              missedCount={missedCount}
              unreadCount={unreadTotal}
              onOpenHistory={() => navigate("/app/history")}
              onOpenMessages={() => navigate("/app/messages")}
              dnd={dnd}
              onDndChange={setDnd}
            />
            {me.isGuest ? (
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                className="text-xs font-semibold text-primary"
              >
                Register
              </button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => signOut().then(() => (window.location.href = "/"))}
              >
                <LogOut className="size-4" />
              </Button>
            )}
          </div>
        </header>

        {/* The scroll container ends EXACTLY at the tab bar's top edge — the
            bar below is an in-flow flex sibling, not a floating overlay, so no
            clearance padding is needed and content can never hide behind it.
            It is itself a flex COLUMN so full-height pages (Messages, Dialer)
            can fill it with flex-1 — flex-grow needs no percentage resolution,
            whereas height:100% against a flex-derived (non-explicit) height
            silently falls back to content height in Chrome and collapses
            short pages upward. */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col">{children}</div>

        {/* Docked glass tab bar. IN-FLOW (not position:fixed): as the last
            flex child of the viewport-bounded column it is permanently pinned
            to the very bottom — the scrolling happens in the sibling above, so
            the bar can never scroll away and nothing can slide under it.
            (During a call, body.relay-call-active hides all .relay-appshell-chrome,
            which also returns this bar's row to the call UI.) Each tab lights up
            in its own accent — green / sky / orange / purple — as a gradient
            squircle with a soft matching glow. */}
        <nav
          className={
            "relay-appshell-chrome md:hidden shrink-0 z-30 " +
            "border-t border-white/10 " +
            "bg-card/80 " +
            "shadow-[0_-8px_24px_rgba(0,0,0,0.18)] " +
            "supports-[backdrop-filter]:bg-card/60 supports-[backdrop-filter]:backdrop-blur-2xl supports-[backdrop-filter]:backdrop-saturate-150"
          }
          style={{
            // A touch more breathing room than the bare safe-area minimum so
            // the tab row sits comfortably clear of the browser's own bottom
            // toolbar on mobile.
            paddingBottom: "max(0.55rem, env(safe-area-inset-bottom))",
          }}
        >
          <div className="grid grid-cols-4">
            {TABS.map((tab) => {
              const active = location.startsWith(tab.path);
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.key}
                  href={tab.path}
                  aria-current={active ? "page" : undefined}
                  className="flex flex-col items-center gap-1 pt-2 pb-1 transition-transform duration-150 active:scale-[0.94] outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-xl"
                  style={{ transitionTimingFunction: "cubic-bezier(0.23,1,0.32,1)" }}
                >
                  <span
                    className={
                      "relative inline-flex items-center justify-center rounded-[14px] size-10 transition-all duration-200 " +
                      (active ? "" : "text-muted-foreground")
                    }
                    style={
                      active
                        ? {
                            color: "#fff",
                            background: `linear-gradient(135deg, ${tab.color} 0%, ${tab.shade} 100%)`,
                            boxShadow: `0 4px 14px ${tab.color}59, inset 0 1px 0 rgba(255,255,255,0.28)`,
                          }
                        : undefined
                    }
                  >
                    <Icon className="size-[19px]" strokeWidth={active ? 2.4 : 2} />
                    {tab.key === "messages" && unreadTotal > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 inline-flex min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] items-center justify-center font-bold ring-2 ring-card">
                        {unreadTotal > 99 ? "99+" : unreadTotal}
                      </span>
                    )}
                    {tab.key === "history" && missedCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 inline-flex min-w-4 h-4 px-1 rounded-full bg-destructive text-white text-[10px] items-center justify-center font-bold ring-2 ring-card">
                        {missedCount > 99 ? "99+" : missedCount}
                      </span>
                    )}
                  </span>
                  <span
                    className={
                      "text-[10px] font-semibold tracking-wide transition-colors " +
                      (active ? "" : "text-muted-foreground")
                    }
                    style={active ? { color: theme === "light" ? tab.shade : tab.color } : undefined}
                  >
                    {tab.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      </main>
      {authOpen && (
        <AuthPanel
          onClose={() => setAuthOpen(false)}
          onVerified={() => {
            setAuthOpen(false);
            utils.identity.whoami.invalidate();
          }}
        />
      )}
    </div>
  );
}
