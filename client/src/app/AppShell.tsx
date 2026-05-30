import { useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { Phone, MessageSquare, UserRound, LogOut, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useIdentity } from "./useIdentity";
import { OnboardingGate } from "./OnboardingGate";
import { useRealtime } from "./useRealtime";

/**
 * Tab keys used by the bottom-nav / sidebar. We hard-code the routes here
 * so the bottom-nav matches across pages.
 */
const TABS = [
  { key: "dialer", path: "/app/dialer", label: "Calls", icon: Phone },
  { key: "messages", path: "/app/messages", label: "Messages", icon: MessageSquare },
  { key: "contacts", path: "/app/contacts", label: "Contacts", icon: UserRound },
] as const;

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
  // Apply the relay-v2 theme class to <html>.
  useEffect(() => {
    document.documentElement.classList.add("dark", "relay-v2");
    return () => {
      // Don't remove on unmount — the user is in the app, leave them in dark.
    };
  }, []);

  return (
    <OnboardingGate>
      <Inner>{children}</Inner>
    </OnboardingGate>
  );
}

function Inner({ children }: { children: React.ReactNode }) {
  const { me, signOut } = useIdentity();
  const [location] = useLocation();
  const utils = trpc.useUtils();

  // Open the SSE push channel as soon as we know we have an identity.
  // Server pushes message/read/presence/contact hints → hook invalidates the
  // right tRPC queries so the UI feels near-instant without WebSockets.
  useRealtime(Boolean(me));

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
  const unreadTotal = useMemo(
    () =>
      (threads.data ?? []).reduce((acc, t) => acc + (t.unreadCount ?? 0), 0),
    [threads.data]
  );

  if (!me) return null;

  return (
    <div className="min-h-svh bg-background text-foreground flex flex-col md:flex-row">
      {/* ── desktop / tablet sidebar ───────────────────────────── */}
      <aside className="hidden md:flex md:flex-col md:w-64 lg:w-72 border-r border-border bg-sidebar shrink-0">
        <div className="px-5 pt-6 pb-4">
          <Link
            href="/app/profile"
            className="flex items-center gap-3 group rounded-xl -mx-1 px-1 py-1 hover:bg-muted/40 transition-colors"
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
              <div className="font-mono text-sm text-muted-foreground">
                {formatNumber(me.number)}
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
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border">
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
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-card">
          <Link
            href="/app/profile"
            className="flex items-center gap-3 min-w-0 active:opacity-70 transition-opacity"
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
              <div className="font-mono text-xs text-muted-foreground">
                {formatNumber(me.number)}
              </div>
            </div>
          </Link>
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
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto pb-24 md:pb-0">{children}</div>

        {/* mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <div className="grid grid-cols-3">
            {TABS.map((tab) => {
              const active = location.startsWith(tab.path);
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.key}
                  href={tab.path}
                  className={
                    "flex flex-col items-center gap-1 py-3 transition-colors " +
                    (active ? "text-primary" : "text-muted-foreground")
                  }
                >
                  <span className="relative inline-flex">
                    <Icon className="size-6" />
                    {tab.key === "messages" && unreadTotal > 0 && (
                      <span className="absolute -top-1.5 -right-2 inline-flex min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] items-center justify-center font-bold">
                        {unreadTotal > 99 ? "99+" : unreadTotal}
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] font-medium">{tab.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </main>
    </div>
  );
}
