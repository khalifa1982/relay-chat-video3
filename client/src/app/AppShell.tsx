import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Phone, MessageSquare, UserRound, Clock, LogOut, Sparkles, Sun, Moon, Smartphone, Monitor, ArrowLeft } from "lucide-react";
import { detectDeviceType } from "@/lib/deviceType";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useIdentity } from "./useIdentity";
import { OnboardingGate } from "./OnboardingGate";
import { PasscodeGate } from "./PasscodeGate";
import { useRealtime } from "./useRealtime";
import { useDnd } from "./dnd";
import { useTheme } from "@/contexts/ThemeContext";
import { MissedCallToast, NotificationBell } from "./MissedCalls";

/**
 * Tab keys used by the bottom-nav / sidebar. We hard-code the routes here
 * so the bottom-nav matches across pages.
 */
const TABS = [
  { key: "dialer", path: "/app/dialer", label: "Calls", icon: Phone },
  { key: "history", path: "/app/history", label: "History", icon: Clock },
  { key: "messages", path: "/app/messages", label: "Messages", icon: MessageSquare },
  { key: "contacts", path: "/app/contacts", label: "Contacts", icon: UserRound },
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
  // Do Not Disturb now lives inside the NotificationBell panel (it used to be a
  // SECOND, visually-identical bell icon next to the notification bell).
  const [dnd, setDnd] = useDnd();

  // Open the SSE push channel as soon as we know we have an identity.
  // Server pushes message/read/presence/contact hints → hook invalidates the
  // right tRPC queries so the UI feels near-instant without WebSockets.
  useRealtime(Boolean(me), me?.id ?? null);

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
  // The landing popup shows once per browser session until dismissed or acted on
  // (it re-appears on a fresh launch while calls remain unreviewed).
  const [popupDismissed, setPopupDismissed] = useState(() => {
    try { return sessionStorage.getItem("relay_missed_popup") === "1"; } catch { return false; }
  });
  const dismissPopup = () => {
    setPopupDismissed(true);
    try { sessionStorage.setItem("relay_missed_popup", "1"); } catch { /* */ }
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
              <div className="font-semibold truncate group-hover:text-primary transition-colors">{me.displayName}</div>
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
              <a
                href={getLoginUrl()}
                className="mt-2 inline-block text-primary underline-offset-4 hover:underline font-medium"
              >
                Upgrade to keep number →
              </a>
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
                  (active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                    : "hover:bg-sidebar-accent/15 text-sidebar-foreground")
                }
              >
                <Icon className="size-5 shrink-0" />
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
      <main className="flex-1 flex flex-col min-w-0 min-h-svh">
        {/* mobile header */}
        <header
          className={
            "relay-appshell-chrome md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-2.5 " +
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
              <div className="text-sm font-semibold truncate">{me.displayName}</div>
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
              <a
                href={getLoginUrl()}
                className="text-xs font-semibold text-primary"
              >
                Upgrade
              </a>
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

        <div className="flex-1 min-h-0 overflow-y-auto pb-28 md:pb-0">{children}</div>

        {/* Apple-style glass tab bar: floating, compact icons, per-tab
            accent color, and a safe-area inset so it never collides
            with the home indicator. */}
        <nav
          className={
            "relay-appshell-chrome md:hidden fixed bottom-2 inset-x-3 z-30 rounded-2xl " +
            "border border-white/10 " +
            "bg-card/65 " +
            "shadow-[0_8px_32px_rgba(0,0,0,0.25)] " +
            "supports-[backdrop-filter]:bg-card/40 supports-[backdrop-filter]:backdrop-blur-2xl supports-[backdrop-filter]:backdrop-saturate-150"
          }
          style={{
            paddingBottom: "max(0.4rem, env(safe-area-inset-bottom))",
          }}
        >
          <div className="grid grid-cols-4">
            {TABS.map((tab) => {
              const active = location.startsWith(tab.path);
              const Icon = tab.icon;
              const accentClass =
                tab.key === "dialer"
                  ? "bg-[color:var(--relay-online)]/15 text-[color:var(--relay-online)]"
                  : tab.key === "messages"
                    ? "bg-primary/15 text-primary"
                    : tab.key === "history"
                      ? "bg-primary/10 text-primary"
                      : "bg-accent/20 text-accent";
              return (
                <Link
                  key={tab.key}
                  href={tab.path}
                  className="flex flex-col items-center gap-0.5 py-2.5 transition-all duration-150 active:scale-[0.96] outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-xl"
                  style={{ transitionTimingFunction: "cubic-bezier(0.23,1,0.32,1)" }}
                >
                  <span
                    className={
                      "relative inline-flex items-center justify-center rounded-xl size-9 transition-colors " +
                      (active ? accentClass : "text-muted-foreground")
                    }
                  >
                    <Icon className="size-[18px]" />
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
                      "text-[10px] font-medium tracking-wide transition-colors " +
                      (active ? "text-foreground" : "text-muted-foreground")
                    }
                  >
                    {tab.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      </main>
    </div>
  );
}
