import { useEffect, useRef, useState } from "react";
import { PhoneMissed, X, Bell, BellOff, MessageSquare, Clock, ChevronRight, ShieldQuestion } from "lucide-react";
import { Switch } from "@/components/ui/switch";

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
      // z-75: below RelayEngine's reconnect modal (z-80) — if you're mid-call
      // recovery, that takes priority over a missed-call banner.
      className="fixed inset-x-0 top-0 z-[75] flex justify-center px-3 pt-3 pointer-events-none"
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
            className="flex-1 min-w-0 text-left outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-lg"
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
            className="shrink-0 grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            <X className="size-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={onView}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border/60 py-2.5 text-sm font-semibold text-destructive hover:bg-destructive/5 rounded-b-2xl outline-none focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 focus-visible:ring-[3px]"
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
 * messages). Tapping opens a small panel with a Do Not Disturb toggle at the
 * top (the ONLY bell-family control in the app header — DND used to be a
 * second, visually-identical bell icon sitting right next to this one, which
 * read as a confusing duplicate) and one row per category below that routes to
 * the detailed list — the History tab for missed calls, Messages for unread.
 */
export function NotificationBell({
  missedCount,
  unreadCount,
  pendingDevices = 0,
  onOpenHistory,
  onOpenMessages,
  onOpenDevices,
  dnd,
  onDndChange,
}: {
  missedCount: number;
  unreadCount: number;
  /** New-device sign-ins waiting for this account's approval (v2.99.7). */
  pendingDevices?: number;
  onOpenHistory: () => void;
  onOpenMessages: () => void;
  onOpenDevices?: () => void;
  dnd: boolean;
  onDndChange: (value: boolean) => void;
}) {
  const total = missedCount + unreadCount + pendingDevices;
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
        title={dnd ? "Notifications (Do Not Disturb is on)" : "Notifications"}
        onClick={() => setOpen((v) => !v)}
        className={
          "relative grid size-9 place-items-center rounded-xl active:scale-95 transition-colors outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] " +
          (dnd
            ? "bg-[color:var(--relay-online)]/15 text-[color:var(--relay-online)]"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50")
        }
      >
        {dnd ? <BellOff className="size-[18px]" /> : <Bell className="size-[18px]" />}
        {total > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex min-w-4 h-4 px-1 rounded-full bg-destructive text-white text-[10px] items-center justify-center font-bold ring-2 ring-card">
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>
      {open && (
        /* Mobile (v2.96.3): the bell sits mid-bar, so a right-anchored
           absolute panel ran past the LEFT screen edge on phones — pin it to
           the viewport instead (fixed, 12px side margins, under the sticky
           header). Desktop keeps the classic right-aligned dropdown. */
        <div className="max-md:fixed max-md:inset-x-3 max-md:top-16 md:absolute md:left-0 md:mt-2 md:w-64 rounded-2xl border border-border bg-card shadow-2xl overflow-hidden z-[80]">
          <div className="px-4 py-2.5 border-b border-border text-xs font-semibold text-muted-foreground">
            Notifications
          </div>
          {/* Do Not Disturb lives here — the toggle stays in the panel rather
              than closing it, so it reads as "the notification center" rather
              than a second header icon. */}
          <label className="flex items-center gap-3 px-4 py-3 border-b border-border/60 cursor-pointer">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
              {dnd ? <BellOff className="size-4" /> : <Bell className="size-4" />}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium">Do Not Disturb</span>
              <span className="block text-xs text-muted-foreground">
                {dnd ? "Incoming calls are silenced" : "Calls ring normally"}
              </span>
            </span>
            <Switch checked={dnd} onCheckedChange={onDndChange} aria-label="Toggle Do Not Disturb" />
          </label>
          {total === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">You're all caught up 🎉</div>
          ) : (
            <ul>
              {pendingDevices > 0 && (
                <li>
                  <button
                    type="button"
                    onClick={() => { setOpen(false); onOpenDevices?.(); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  >
                    <span className="grid size-9 place-items-center rounded-xl bg-amber-400/15 text-amber-500">
                      <ShieldQuestion className="size-4" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium">{pendingDevices} new device{pendingDevices > 1 ? "s" : ""} waiting</span>
                      <span className="block text-xs text-muted-foreground">Approve or decline the sign-in</span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                  </button>
                </li>
              )}
              {missedCount > 0 && (
                <li className={pendingDevices > 0 ? "border-t border-border/60" : ""}>
                  <button
                    type="button"
                    onClick={() => { setOpen(false); onOpenHistory(); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
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
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
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
