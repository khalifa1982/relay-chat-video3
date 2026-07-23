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

export interface UnreadSummary {
  count: number;
  latest: { name: string; at: string | Date } | null;
}

/**
 * "While you were away" landing card (v2.99.12). A single non-intrusive banner
 * that drops in at the top of the app on launch/return and surfaces EVERYTHING
 * the user missed while offline — missed calls AND unread messages — each as a
 * tappable row that routes to the right place. Supersedes the calls-only
 * `MissedCallToast` at the AppShell mount (that component is kept for
 * backward-compat / any direct callers). Renders nothing when there's nothing
 * to show.
 *
 * Owner directive (offline-return batch): "when he logs in again he will see
 * the notification on the main page … if there is a message or a missed call."
 */
export function AwaySummaryToast({
  missed,
  unread,
  onViewMissed,
  onOpenMessages,
  onDismiss,
}: {
  missed: MissedSummary;
  unread: UnreadSummary;
  onViewMissed: () => void;
  onOpenMessages: () => void;
  onDismiss: () => void;
}) {
  const hasMissed = missed.count > 0 && !!missed.latest;
  const hasUnread = unread.count > 0;
  if (!hasMissed && !hasUnread) return null;
  const moreCalls = missed.count - 1;
  return (
    <div
      // A passive, non-modal catch-up banner — role="region" (a labelled
      // landmark), NOT alertdialog: it doesn't trap focus or demand a response,
      // and its buttons stay tab-reachable. aria-live=polite announces it on
      // appearance without stealing focus.
      role="region"
      aria-live="polite"
      aria-label="While you were away"
      // z-75: below RelayEngine's reconnect modal (z-80) — mid-call recovery
      // takes priority over a catch-up banner.
      className="fixed inset-x-0 top-0 z-[75] flex justify-center px-3 pt-3 pointer-events-none"
    >
      <div
        className="pointer-events-auto w-full max-w-md rounded-2xl border border-border bg-card/95 shadow-2xl backdrop-blur-xl
                   supports-[backdrop-filter]:bg-card/80 animate-in slide-in-from-top-3 fade-in duration-300 overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Bell className="size-3.5" />
            While you were away
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="shrink-0 grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            <X className="size-4" />
          </button>
        </div>
        {hasMissed && (
          <button
            type="button"
            onClick={onViewMissed}
            className="flex w-full items-start gap-3 px-3.5 py-2.5 text-left hover:bg-destructive/5 outline-none focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 focus-visible:ring-[3px]"
          >
            <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-2xl bg-destructive/15 text-destructive">
              <PhoneMissed className="size-5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-foreground">
                {missed.count === 1 ? "Missed call" : `${missed.count} missed calls`}
              </span>
              <span className="block text-sm text-muted-foreground truncate">
                <span className="font-medium text-foreground/90">{missed.latest!.name}</span>
                {missed.latest!.number ? ` · ${fmtNumber(missed.latest!.number)}` : ""}
                {moreCalls > 0 ? ` and ${moreCalls} other${moreCalls > 1 ? "s" : ""}` : ""}
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5">{ago(missed.latest!.at)}</span>
            </span>
            <ChevronRight className="mt-3 size-4 shrink-0 text-muted-foreground" />
          </button>
        )}
        {hasUnread && (
          <button
            type="button"
            onClick={onOpenMessages}
            className={
              "flex w-full items-start gap-3 px-3.5 py-2.5 text-left hover:bg-primary/5 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] " +
              (hasMissed ? "border-t border-border/60" : "")
            }
          >
            <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary">
              <MessageSquare className="size-5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-foreground">
                {unread.count === 1 ? "New message" : `${unread.count} new messages`}
              </span>
              <span className="block text-sm text-muted-foreground truncate">
                {unread.latest ? (
                  <span className="font-medium text-foreground/90">{unread.latest.name}</span>
                ) : (
                  "Tap to open Messages"
                )}
              </span>
              {unread.latest && (
                <span className="block text-xs text-muted-foreground mt-0.5">{ago(unread.latest.at)}</span>
              )}
            </span>
            <ChevronRight className="mt-3 size-4 shrink-0 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  );
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
      // Passive non-modal banner: role="region" (labelled landmark), not
      // alertdialog — no focus trap, buttons stay tab-reachable.
      role="region"
      aria-live="polite"
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
  // Blink the icon whenever there's a missed call or an unread message (the
  // owner's exact triggers) — a live prompt to catch up on return. The badge
  // count still includes pending-device approvals, but the blink is reserved
  // for messages/calls so a routine device prompt doesn't strobe the header.
  // `.relay-blink*` are inert under prefers-reduced-motion (see index.css).
  const blink = missedCount + unreadCount > 0;
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
          (blink && !dnd ? "relay-blink-glow " : "") +
          (dnd
            ? "bg-[color:var(--relay-online)]/15 text-[color:var(--relay-online)]"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50")
        }
      >
        {dnd ? <BellOff className="size-[18px]" /> : <Bell className="size-[18px]" />}
        {total > 0 && (
          <span
            className={
              "absolute -top-0.5 -right-0.5 inline-flex min-w-4 h-4 px-1 rounded-full bg-destructive text-white text-[10px] items-center justify-center font-bold ring-2 ring-card " +
              (blink ? "relay-blink" : "")
            }
          >
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
