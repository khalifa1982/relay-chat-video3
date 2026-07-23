import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Phone, MessageCircle, UsersRound, History, LogOut, Sparkles, Sun, Moon, Smartphone, Monitor, ArrowLeft, UserRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { detectDeviceType } from "@/lib/deviceType";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useIdentity } from "./useIdentity";
import { useSignOut } from "./useSignOut";
import { AuthPanel } from "./AuthPanel";
import { RoleBadge, roleFromFlags } from "./VerifiedBadge";
import { CountryFlag } from "./CountryFlag";
import { OnboardingGate } from "./OnboardingGate";
import { PasscodeGate } from "./PasscodeGate";
import { useRealtime } from "./useRealtime";
import { useDnd } from "./dnd";
import { useTheme } from "@/contexts/ThemeContext";
import { MissedCallToast, NotificationBell } from "./MissedCalls";
import { PushBanner } from "./PushBanner";
import { CallHealthBanner } from "./CallHealthBanner";
import { PeerOverlaysHost } from "./PeerOverlays";
import { unlockAudio } from "./notifications";

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

  // One-time gesture unlock for the notification-sound AudioContext: iOS won't
  // start ANY WebAudio outside a user gesture, so the call ring / message chime
  // fired later from an SSE event would be silent. Entering the app is itself a
  // tap, so this is armed long before the first alert. Self-removes on fire.
  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      document.removeEventListener("pointerdown", unlock);
    };
    document.addEventListener("pointerdown", unlock);
    return () => document.removeEventListener("pointerdown", unlock);
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
  const { me } = useIdentity();
  // Shared sign-out flow (v2.88): AlertDialog confirm + full session/device
  // teardown, branching guest/member correctly (the old inline handler called
  // the GUEST mutation even for registered members).
  const { requestSignOut, signOutDialog } = useSignOut(me);
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

  // GROUND-TRUTH viewport height for the mobile shell. CSS viewport units
  // proved unreliable on real iPhones: dvh (v2.76) reported the toolbar-
  // collapsed height while the scroll lock keeps Safari's toolbar visible,
  // so the tab bar + Messages composer sat BELOW the fold with no way to
  // scroll to them — the last messages / history rows were unreachable.
  // window.innerHeight IS the actual layout viewport right now; measure it,
  // keep it fresh (rotation, toolbar show/hide, split view), and size the
  // shell with it. 100svh remains the CSS fallback until the first
  // measurement lands. An explicit px height also makes the whole flex
  // chain below unambiguously definite for Safari's layout engine.
  useEffect(() => {
    const root = document.documentElement;
    const set = () => {
      try { root.style.setProperty("--relay-vh", window.innerHeight + "px"); } catch { /* */ }
    };
    set();
    window.addEventListener("resize", set);
    window.addEventListener("orientationchange", set);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", set);
    return () => {
      window.removeEventListener("resize", set);
      window.removeEventListener("orientationchange", set);
      vv?.removeEventListener("resize", set);
      root.style.removeProperty("--relay-vh");
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

  // Unseen-status dot (v2.96): a contact posted a story I haven't seen —
  // light a quiet teal dot on the Messages tab (the status strip lives at
  // its top). SSE "status" events invalidate this feed, so it's realtime.
  const statusFeed = trpc.status.feed.useQuery(undefined, {
    enabled: !!me,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });
  const hasUnseenStatus = useMemo(
    () => (statusFeed.data?.groups ?? []).some((g) => !g.owner.isMe && g.hasUnseen),
    [statusFeed.data]
  );

  // Missed calls that arrived while away (guest or registered). Drives the
  // landing popup + the History / bell badges.
  const missed = trpc.calls.missedSummary.useQuery(undefined, {
    enabled: !!me,
    refetchInterval: 20_000,
  });
  const missedCount = missed.data?.count ?? 0;
  // New-device sign-ins waiting for this account's approval (v2.99.7) — the
  // bell surfaces the count; SSE "device_pending" invalidates this instantly.
  const pendingDevicesQ = trpc.otpAuth.pendingSessions.useQuery(undefined, {
    enabled: !!me,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const pendingDevices = pendingDevicesQ.data?.pending?.length ?? 0;
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
    // Straight to the full Missed log (History → Missed filter pre-selected);
    // reviewing it also acknowledges the missed calls (clears the badges).
    navigate("/app/history?filter=missed");
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
              pendingDevices={pendingDevices}
              onOpenHistory={() => navigate("/app/history?filter=missed")}
              onOpenMessages={() => navigate("/app/messages")}
              onOpenDevices={() => navigate("/app/profile#devices")}
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
                {/* v2.99.6: three-tier badge — Guest (blue) / Registered (green) / Admin (yellow). */}
                <RoleBadge role={roleFromFlags(me.role, me.verified)} size={15} />
              </div>
              <div className="font-mono text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
                {formatNumber(me.number)}
                <CountryFlag
                  code={geo.data?.country}
                  title={geo.data?.countryName ?? geo.data?.country ?? ""}
                />
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
                This guest number lasts for this browser session. Register to keep it forever.
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
                {tab.key === "messages" && hasUnseenStatus && (
                  <span
                    className="size-2 rounded-full bg-gradient-to-tr from-[#06d6a0] to-[#0ea5e9]"
                    title="New status updates"
                  />
                )}
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
            onClick={requestSignOut}
          >
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </aside>

      {/* ── main column ────────────────────────────────────────── */}
      {/* The mobile shell is sized by the MEASURED viewport (--relay-vh =
          window.innerHeight, kept fresh above), NOT by CSS viewport units:
          dvh (v2.76) reported the toolbar-collapsed height on a real iPhone
          while the scroll lock keeps the toolbar visible, so the tab bar and
          composer sat below the fold and long chats/history lists could
          never be scrolled to their end. 100svh is only the first-paint
          fallback before the measurement lands. The explicit px height also
          makes the whole flex chain below unambiguously definite, so every
          inner list scrolls within the visible area. Do not swap this back
          to a bare viewport unit without a physical-iPhone retest.

          max-md:flex-none is LOAD-BEARING: with flex-1 (basis 0%), a flex
          item's MAIN-axis size ignores its height property, and its CONTENT
          contribution inflates the auto-height root column — so any page
          taller than the viewport (a long chat, a full call log) blew the
          shell up to content height, pushed the tab bar/composer below the
          fold, and killed every inner scroll area. flex-none makes the
          explicit height authoritative on mobile; md+ keeps flex-1, where
          the root is a ROW and it governs width, not height. */}
      {/* Desktop height must be DEFINITE (md:h-svh), not just min-h-svh: a tall
          page (a long conversation with images/video) grew `main` past the
          viewport, so the inner overflow-y-auto never bounded and the Messages
          composer fell below the fold (you had to scroll the whole column to
          reach it). h-svh caps main at the viewport so every inner list scrolls
          within it and the composer stays pinned. Mobile keeps the measured
          --relay-vh height (flex-none) as before. */}
      <main className="flex-1 max-md:flex-none flex flex-col min-w-0 min-h-svh md:h-svh md:overflow-hidden max-md:h-[var(--relay-vh,100svh)]">
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
              className="mr-0.5 grid size-9 shrink-0 place-items-center rounded-xl text-foreground hover:bg-muted/50 active:scale-95 transition outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              <ArrowLeft className="size-5" />
            </button>
          )}
          {/* Brand — the prototype leads the header with a cyan logo dot + the
              RELAY wordmark on the left; identity (flag · number · avatar) sits
              on the right. */}
          <Link
            href="/app/dialer"
            aria-label="RELAY"
            className="flex items-center gap-2 shrink-0 active:opacity-70 transition-opacity rounded-lg outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            <span
              className="size-2.5 rounded-full shrink-0"
              style={{ background: "linear-gradient(135deg,#3FE0C5,#6EE7FF)", boxShadow: "0 0 10px rgba(63,224,197,.8)" }}
            />
            <span className="text-sm font-extrabold tracking-[0.22em] text-foreground">RELAY</span>
          </Link>
          <span className="flex-1" />
          <div className="flex items-center gap-2 min-w-0">
            <NotificationBell
              missedCount={missedCount}
              unreadCount={unreadTotal}
              pendingDevices={pendingDevices}
              onOpenHistory={() => navigate("/app/history?filter=missed")}
              onOpenMessages={() => navigate("/app/messages")}
              onOpenDevices={() => navigate("/app/profile#devices")}
              dnd={dnd}
              onDndChange={setDnd}
            />
            <CountryFlag
              code={geo.data?.country}
              title={geo.data?.countryName ?? geo.data?.country ?? ""}
              className="shrink-0"
            />
            {/* Hidden only on ultra-narrow phones (<360px) so the bar can
                never overflow; the number is always in the avatar menu too. */}
            <span className="font-mono text-xs text-muted-foreground shrink-0 max-[359px]:hidden">
              {formatNumber(me.number)}
            </span>
            {/* Avatar → ACCOUNT MENU (v2.95.10). The old layout crammed a
                separate "Register" pill next to the avatar, which overflowed
                the bar on phones (the pill clipped off-screen). Everything
                account-related now lives in one dropdown: Profile, Register
                (guests), Sign out. LED: amber on DND, online-green otherwise. */}
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Account menu"
                title={me.displayName}
                className="relative shrink-0 active:scale-95 transition-transform rounded-full outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              >
                {me.avatarUrl ? (
                  <img
                    src={me.avatarUrl}
                    alt={me.displayName}
                    className="size-9 rounded-full object-cover border border-border"
                  />
                ) : (
                  <span
                    className="size-9 rounded-full grid place-items-center font-bold text-sm"
                    style={{ background: "linear-gradient(135deg,#3FE0C5,#6EE7FF)", color: "#08211d" }}
                  >
                    {initialsFrom(me.displayName)}
                  </span>
                )}
                <span
                  className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-card"
                  style={{ background: dnd ? "#fbbf24" : "#06d6a0" }}
                />
                {/* v2.99.10 (owner): the tier badge no longer crowds the header
                    avatar corner (it overlapped the flag/photo). It now lives
                    in the dropdown that opens on tap — beside the name, with the
                    PIN right under it. */}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-semibold">{me.displayName}</span>
                    <RoleBadge role={roleFromFlags(me.role, me.verified)} size={15} />
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">{formatNumber(me.number)}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/app/profile")}>
                  <UserRound className="size-4" /> Profile
                </DropdownMenuItem>
                {me.isGuest && (
                  <DropdownMenuItem onClick={() => setAuthOpen(true)} className="text-primary focus:text-primary">
                    <Sparkles className="size-4" /> Register — keep this number
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={requestSignOut}>
                  <LogOut className="size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col">
          {/* One-time "get call alerts" opt-in (Web Push) + iOS install tip.
              Renders nothing once granted / denied / dismissed. */}
          <PushBanner />
          {/* Warns when the deploy is multi-instance with call signaling not
              pinned — the silent-missed-call misconfiguration. Self-hides on
              single-instance deploys. */}
          <CallHealthBanner />
          {children}
        </div>

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
                    {tab.key === "messages" && hasUnseenStatus && (
                      <span
                        className="absolute -top-0.5 -left-0.5 size-2.5 rounded-full bg-gradient-to-tr from-[#06d6a0] to-[#0ea5e9] ring-2 ring-card"
                        title="New status updates"
                      />
                    )}
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
      {signOutDialog}
      {/* Global peer overlays (v2.96): the status viewer + profile popup any
          avatar or name click opens, from ANY screen. Mounted once here. */}
      <PeerOverlaysHost />
    </div>
  );
}
