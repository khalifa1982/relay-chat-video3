import { useEffect, useRef, useState } from "react";
import { PhoneMissed, X, Bell, MessageSquare, Clock, ChevronRight } from "lucide-react";

/** "3m" / "2h" / "5d" / date — compact relative time. */
function ago(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString();
}

function fmtNumber(n: string): string {
  return n.length === 6 ? `${n.slice(0, 3)}-${n.slice(3)}` : n;
}

export interface MissedSummary {
  count: number;
  latest: { name: string; number: string; at: string | Date } | null;
}

/**
 * Landing missed-call popup — a prominent but NON-INTRUSIVE banner that drops in
 * at the top of the app on launch when the authenticated user (guest or
 * registered) has missed calls while away. Identifies the most recent caller and
 * how many were missed; "View" routes to the dialer's missed-call alert, the X
 * just dismisses (the badge stays as a prompt to review).
 */
export function MissedCallToast({
  summary,
  onView,
  onDismiss,
}: {
  summary: MissedSummary;
  onView: () => void;
  onDismiss: () => void;
}) {
  const { count, latest } = summary;
  if (count <= 0 || !latest) return null;
  const more = count - 1;
  return (
    <div
      role="alertdialog"
      aria-label="Missed calls"
      className="fixed inset-x-0 top-0 z-[90] flex justify-center px-3 pt-3 pointer-events-none"
    >
      <div
        className="pointer-events-auto w-full max-w-md rounded-2xl border border-destructive/30 bg-card/95 shadow-2xl backdrop-blur-xl
                   supports-[backdrop-filter]:bg-card/80 animate-in slide-in-from-top-3 fade-in duration-300"
      >
        <div className="flex items-start gap-3 p-3.5">
          <div className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-2xl bg-destructive/15 text-destructive">
            <PhoneMissed className="size-5" />
          </div>
          <button
            type="button"
            onClick={onView}
            className="flex-1 min-w-0 text-left"
          >
            <div className="text-sm font-semibold text-foreground">
              {count === 1 ? "Missed call" : `${count} missed calls`}
            </div>
            <div className="text-sm text-muted-foreground truncate">
              <span className="font-medium text-foreground/90">{latest.name}</span>
              {latest.number ? ` · ${fmtNumber(latest.number)}` : ""}
              {more > 0 ? ` and ${more} other${more > 1 ? "s" : ""}` : ""}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">{ago(latest.at)}</div>
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="shrink-0 grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={onView}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border/60 py-2.5 text-sm font-semibold text-destructive hover:bg-destructive/5 rounded-b-2xl"
        >
          View missed {count === 1 ? "call" : "calls"}
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * Global notification bell with a cumulative badge (missed calls + unread
 * messages). Tapping opens a small panel with one row per category that routes
 * to the detailed list — the History tab for missed calls, Messages for unread.
 */
export function NotificationBell({
  missedCount,
  unreadCount,
  onOpenHistory,
  onOpenMessages,
}: {
  missedCount: number;
  unreadCount: number;
  onOpenHistory: () => void;
  onOpenMessages: () => void;
}) {
  const total = missedCount + unreadCount;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={total > 0 ? `${total} notifications` : "Notifications"}
        title="Notifications"
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-9 place-items-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 active:scale-95 transition-colors"
      >
        <Bell className="size-[18px]" />
        {total > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex min-w-4 h-4 px-1 rounded-full bg-destructive text-white text-[10px] items-center justify-center font-bold ring-2 ring-card">
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-border bg-card shadow-2xl overflow-hidden z-[80]">
          <div className="px-4 py-2.5 border-b border-border text-xs font-semibold text-muted-foreground">
            Notifications
          </div>
          {total === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">You're all caught up 🎉</div>
          ) : (
            <ul>
              {missedCount > 0 && (
                <li>
                  <button
                    type="button"
                    onClick={() => { setOpen(false); onOpenHistory(); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
                  >
                    <span className="grid size-9 place-items-center rounded-xl bg-destructive/15 text-destructive">
                      <PhoneMissed className="size-4" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium">{missedCount} missed call{missedCount > 1 ? "s" : ""}</span>
                      <span className="block text-xs text-muted-foreground">Tap to review in History</span>
                    </span>
                    <Clock className="size-4 text-muted-foreground shrink-0" />
                  </button>
                </li>
              )}
              {unreadCount > 0 && (
                <li className={missedCount > 0 ? "border-t border-border/60" : ""}>
                  <button
                    type="button"
                    onClick={() => { setOpen(false); onOpenMessages(); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
                  >
                    <span className="grid size-9 place-items-center rounded-xl bg-primary/15 text-primary">
                      <MessageSquare className="size-4" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium">{unreadCount} unread message{unreadCount > 1 ? "s" : ""}</span>
                      <span className="block text-xs text-muted-foreground">Tap to open Messages</span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
