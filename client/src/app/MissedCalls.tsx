import { useEffect, useRef, useState } from "react";
import { PhoneMissed, X, Bell, BellOff, MessageSquare, Clock, ChevronRight, ShieldQuestion } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useLocale, type Locale, type TKey } from "@/app/i18n";

/** The translator's shape, so the pure helpers below need no React and stay drivable
 *  from a test with a stub. Same contract as `inviteMessage.ts`'s `Translate`. */
type T = (key: TKey, vars?: Record<string, string | number>) => string;

/**
 * Which locale tag a platform date formatter is given.
 *
 * `-u-nu-latn` IS LOAD-BEARING, not decoration: `toLocaleDateString("ar")` renders
 * Arabic-Indic numerals (٢٠٢٦) in a real browser, and every other number on these
 * surfaces is an interpolated Western digit. Two numeral systems in one card reads as
 * a rendering fault, which is the rule v2.106.84 set. The extension pins the numbering
 * system without pinning the format, so an Arabic reader still gets Arabic month order
 * and separators.
 *
 * (Node's bundled ICU here already answers `latn` for a bare `ar`, so this cannot be
 * proven by measurement in this environment — it is stated as the guarantee it is, and
 * asserted structurally instead.)
 */
function dateLocale(locale: Locale): string {
  return locale === "ar" ? "ar-u-nu-latn" : "en";
}

/**
 * "3m" / "2h" / "5d" / date — compact relative time.
 *
 * Takes the translator rather than returning finished English: this is a pure function
 * outside any component, so it cannot call a hook, and a module-level helper that
 * returns a sentence is exactly how a screen ends up 95% translated with its timestamps
 * still English.
 */
function ago(t: T, locale: Locale, iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return t("alerts.justNow");
  if (s < 3600) return t("alerts.minutesAgo", { n: Math.floor(s / 60) });
  if (s < 86400) return t("alerts.hoursAgo", { n: Math.floor(s / 3600) });
  if (s < 86400 * 7) return t("alerts.daysAgo", { n: Math.floor(s / 86400) });
  return d.toLocaleDateString(dateLocale(locale));
}

function fmtNumber(n: string): string {
  return n.length === 6 ? `${n.slice(0, 3)}-${n.slice(3)}` : n;
}

/**
 * The caller's 6-digit RELAY number, beside a display name that may be Arabic.
 *
 * `dir="ltr"` + `[unicode-bidi:isolate]`, or the bidi algorithm resolves the digits and
 * the hyphen against the surrounding RTL run and renders `777-254` with its parts
 * reordered — a number somebody reads out loud must not differ from the number stored.
 */
function PeerNumber({ number }: { number: string }) {
  return (
    <>
      {" · "}
      <span dir="ltr" className="[unicode-bidi:isolate]">
        {fmtNumber(number)}
      </span>
    </>
  );
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
  const { t, locale } = useLocale();
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
      aria-label={t("alerts.awayTitle")}
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
            {t("alerts.awayTitle")}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t("alerts.dismiss")}
            className="shrink-0 grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            <X className="size-4" />
          </button>
        </div>
        {hasMissed && (
          <button
            type="button"
            onClick={onViewMissed}
            className="flex w-full items-start gap-3 px-3.5 py-2.5 text-start hover:bg-destructive/5 outline-none focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 focus-visible:ring-[3px]"
          >
            <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-2xl bg-destructive/15 text-destructive">
              <PhoneMissed className="size-5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-foreground">
                {missed.count === 1
                  ? t("alerts.missedOne")
                  : t("alerts.missedMany", { n: missed.count })}
              </span>
              <span className="block text-sm text-muted-foreground truncate">
                <span className="font-medium text-foreground/90">{missed.latest!.name}</span>
                {missed.latest!.number ? <PeerNumber number={missed.latest!.number} /> : null}
                {moreCalls <= 0
                  ? ""
                  : moreCalls === 1
                    ? " " + t("alerts.andOthersOne", { n: moreCalls })
                    : " " + t("alerts.andOthersMany", { n: moreCalls })}
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                {ago(t, locale, missed.latest!.at)}
              </span>
            </span>
            <ChevronRight className="mt-3 size-4 shrink-0 text-muted-foreground" />
          </button>
        )}
        {hasUnread && (
          <button
            type="button"
            onClick={onOpenMessages}
            className={
              "flex w-full items-start gap-3 px-3.5 py-2.5 text-start hover:bg-primary/5 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] " +
              (hasMissed ? "border-t border-border/60" : "")
            }
          >
            <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary">
              <MessageSquare className="size-5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-foreground">
                {unread.count === 1
                  ? t("alerts.newMessageOne")
                  : t("alerts.newMessageMany", { n: unread.count })}
              </span>
              <span className="block text-sm text-muted-foreground truncate">
                {unread.latest ? (
                  <span className="font-medium text-foreground/90">{unread.latest.name}</span>
                ) : (
                  t("alerts.tapMessages")
                )}
              </span>
              {unread.latest && (
                <span className="block text-xs text-muted-foreground mt-0.5">
                  {ago(t, locale, unread.latest.at)}
                </span>
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
  const { t, locale } = useLocale();
  const { count, latest } = summary;
  if (count <= 0 || !latest) return null;
  const more = count - 1;
  return (
    <div
      // Passive non-modal banner: role="region" (labelled landmark), not
      // alertdialog — no focus trap, buttons stay tab-reachable.
      role="region"
      aria-live="polite"
      aria-label={t("alerts.missedRegion")}
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
            className="flex-1 min-w-0 text-start outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-lg"
          >
            <div className="text-sm font-semibold text-foreground">
              {count === 1 ? t("alerts.missedOne") : t("alerts.missedMany", { n: count })}
            </div>
            <div className="text-sm text-muted-foreground truncate">
              <span className="font-medium text-foreground/90">{latest.name}</span>
              {latest.number ? <PeerNumber number={latest.number} /> : null}
              {more <= 0
                ? ""
                : more === 1
                  ? " " + t("alerts.andOthersOne", { n: more })
                  : " " + t("alerts.andOthersMany", { n: more })}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">{ago(t, locale, latest.at)}</div>
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t("alerts.dismiss")}
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
          {/* Two WHOLE sentences, never "View missed " + a noun: Arabic does not put the
              adjective where English does, so a sentence chopped at the English seam can
              only be re-assembled into nonsense (the `translateNodes` rule). */}
          {count === 1 ? t("alerts.viewMissedOne") : t("alerts.viewMissedMany")}
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
  pendingDetail,
  onOpenHistory,
  onOpenMessages,
  onOpenDevices,
  onApproveDevice,
  onDeclineDevice,
  dnd,
  onDndChange,
}: {
  missedCount: number;
  unreadCount: number;
  /** New-device sign-ins waiting for this account's approval (v2.99.7). */
  pendingDevices?: number;
  /**
   * The waiting sign-in's own details, when there is exactly ONE (v2.100.1). The
   * owner asked the notification to carry the time, the place and the device name
   * rather than only a count. Optional, so a caller that has not fetched them —
   * or a pre-release client — degrades to the count line it showed before.
   */
  pendingDetail?: { sid: string; label: string; detail: string | null; createdAt: number } | null;
  onOpenHistory: () => void;
  onOpenMessages: () => void;
  onOpenDevices?: () => void;
  /**
   * Board 2d/5h draw Approve and Decline INSIDE the panel, and that is a real
   * change rather than a restyle: v2.99.7 shipped the approval flow with Profile →
   * Devices as the only place to act on it, so the notification told you something
   * was waiting and then made you go and find it. The mutations live in the caller,
   * which already owns the query and its invalidation — passing them down keeps this
   * component presentational and stops a second copy of the refresh rule appearing.
   *
   * Offered ONLY when exactly one sign-in is waiting: with two, a pair of buttons
   * would act on one of them while describing both.
   */
  onApproveDevice?: (sid: string) => void;
  onDeclineDevice?: (sid: string) => void;
  dnd: boolean;
  onDndChange: (value: boolean) => void;
}) {
  const { t, locale } = useLocale();
  const total = missedCount + unreadCount + pendingDevices;
  // Blink the icon whenever there's a missed call or an unread message (the
  // owner's exact triggers) — a live prompt to catch up on return. The badge
  // count still includes pending-device approvals, but the blink is reserved
  // for messages/calls so a routine device prompt doesn't strobe the header.
  // `.relay-blink*` are inert under prefers-reduced-motion (see index.css).
  const blink = missedCount + unreadCount > 0;
  /* Acting on the sign-in HERE is only offered when there is exactly one waiting AND
     the caller supplied both handlers. Derived once, so the two branches below can
     never disagree about which one renders — without this the fallback row would
     disappear for a caller that passes no handlers, losing the notification rather
     than degrading it. */
  const inlineApprove =
    pendingDevices === 1 && pendingDetail && onApproveDevice && onDeclineDevice
      ? { detail: pendingDetail, approve: onApproveDevice, decline: onDeclineDevice }
      : null;
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
        /* The count is SPLIT one/many rather than always plural. English tolerated
           "1 notifications"; Arabic does not, and the split is what the language
           forces rather than a tidy-up taken on the way past. */
        aria-label={
          total === 0
            ? t("alerts.notifications")
            : total === 1
              ? t("alerts.notificationsOne", { n: total })
              : t("alerts.notificationsMany", { n: total })
        }
        title={dnd ? t("alerts.notificationsDnd") : t("alerts.notifications")}
        onClick={() => setOpen((v) => !v)}
        // v2.99.86 (owner): "Green, if there is nothing... no notification. Red and
        // blinking, if there is a notification." So the bell itself now carries the
        // state instead of being a neutral grey glyph with a badge — you can read it
        // without focusing on it. DND keeps its own amber-ish treatment, because
        // "muted" is a third state and colouring it green would claim all-clear while
        // alerts are in fact being suppressed.
        className={
          "relative grid size-9 place-items-center rounded-xl active:scale-95 transition-colors outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] " +
          "relative " +
          // The CLEAR state is a green STROKE, not a filled chip. The owner asked for
          // "green if there is nothing", and this honours it — but a tinted plate lit
          // 100% of the time spends attention on the null state, which is the one
          // state that needs none. Something waiting gets the filled plate, so "lit"
          // still means "look at me".
          (dnd
            ? "bg-[color:var(--relay-dnd)]/15 text-[color:var(--relay-dnd)]"
            : total > 0
              ? "bg-destructive/15 text-destructive hover:bg-destructive/25"
              : "text-[color:var(--relay-green-text)] hover:bg-[color:var(--relay-green-text)]/10")
        }
      >
        {/* The halo, as a stacked overlay with a STATIC shadow whose opacity animates
            — see .relay-blink-halo. Rendered only while something is actually
            waiting, so a quiet bell has no running animation at all. */}
        {blink && !dnd && (
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-xl pointer-events-none relay-blink-halo"
            style={{ boxShadow: "0 0 0 4px color-mix(in oklab, var(--destructive) 32%, transparent)" }}
          />
        )}
        {dnd ? (
          <BellOff className="size-[18px]" />
        ) : (
          // The glyph blinks with the icon colour when something is waiting. The
          // wrapper carries the halo; this carries the fade, so nothing animates a
          // colour (which would repaint) — only opacity moves.
          <Bell className={"size-[18px] " + (blink ? "relay-blink" : "")} />
        )}
        {total > 0 && (
          <span
            className={
              /* `-end-`, not `-right-`: the badge rides the bell's TRAILING corner, so
                 it mirrors with the reading direction like every other corner
                 affordance in the app (GroupInfoSheet's camera badge and presence LED
                 use the same `-end-`). */
              "absolute -top-0.5 -end-0.5 inline-flex min-w-4 h-4 px-1 rounded-full bg-destructive text-white text-[10px] items-center justify-center font-bold ring-2 ring-card " +
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
           header). On desktop it hangs from the bell's LEADING edge and opens away from
           it — `md:start-0`, not `md:left-0`, so that stays true in RTL instead of
           silently opening back across the button. */
        <div className="rsheet max-md:fixed max-md:inset-x-3 max-md:top-16 md:absolute md:start-0 md:mt-2 md:w-72 rounded-2xl border border-border bg-card shadow-2xl overflow-hidden z-[80]">
          <div
            className="px-4 py-2.5 border-b border-border font-mono text-[10px] font-bold uppercase text-muted-foreground"
            style={{ letterSpacing: ".26em" }}
          >
            {t("alerts.notifications")}
          </div>
          {/* Do Not Disturb lives here — the toggle stays in the panel rather
              than closing it, so it reads as "the notification center" rather
              than a second header icon. */}
          <label className="flex items-center gap-3 px-4 py-3 border-b border-border/60 cursor-pointer">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
              {dnd ? <BellOff className="size-4" /> : <Bell className="size-4" />}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium">{t("alerts.dnd")}</span>
              <span className="block text-xs text-muted-foreground">
                {dnd ? t("alerts.dndOn") : t("alerts.dndOff")}
              </span>
            </span>
            <Switch checked={dnd} onCheckedChange={onDndChange} aria-label={t("alerts.dndToggle")} />
          </label>
          {total === 0 ? (
            /* Board 5h's empty state. It names what LANDS here rather than only
               saying there is nothing — an empty panel that does not say what it is
               for reads as broken the first time somebody opens it. */
            <div className="px-4 py-7 text-center">
              <div className="text-sm font-semibold">{t("alerts.allCaughtUp")}</div>
              <div className="mt-1 text-xs text-muted-foreground">{t("alerts.emptyHint")}</div>
            </div>
          ) : (
            <ul>
              {/* Board 2d/5h: a single waiting sign-in is acted on HERE. With more
                  than one the row still routes to Devices, because two rows' worth
                  of detail does not fit a dropdown and a single Approve pair would
                  act on one while describing both. */}
              {inlineApprove && (
                <li>
                  {/* A div, not a button: the two actions are buttons, and nesting a
                      button inside a button is invalid HTML (the rule this repo
                      already follows on thread rows and call tiles). */}
                  <div className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-400/15 text-amber-500">
                        <ShieldQuestion className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {t("alerts.newDeviceSignIn")}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {inlineApprove.detail.label}
                        </span>
                        {inlineApprove.detail.detail && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {inlineApprove.detail.detail}
                          </span>
                        )}
                        <span className="block text-[11px] text-muted-foreground">
                          {new Date(inlineApprove.detail.createdAt).toLocaleString(
                            dateLocale(locale),
                          )}
                        </span>
                      </span>
                    </div>
                    <div className="mt-2.5 flex items-center gap-2 ps-12">
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          inlineApprove.approve(inlineApprove.detail.sid);
                        }}
                        className="rcta rounded-full px-3.5 py-1.5 text-xs font-semibold"
                      >
                        {t("alerts.approve")}
                      </button>
                      {/* Declining REVOKES the pending session, which cannot be taken
                          back — the other device has to start again — so it carries
                          the destructive colour for the same reason the confirm
                          dialogs do. */}
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          inlineApprove.decline(inlineApprove.detail.sid);
                        }}
                        className="rounded-full border border-destructive/40 px-3.5 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10"
                      >
                        {t("alerts.decline")}
                      </button>
                    </div>
                    {/* Said out loud, because the details above are exactly what makes
                        this answerable: if it was not you, Decline is the action. */}
                    <p className="mt-2 ps-12 text-[11px] leading-snug text-muted-foreground">
                      {t("alerts.notYouDecline")}
                    </p>
                  </div>
                </li>
              )}
              {pendingDevices > 0 && !inlineApprove && (
                <li>
                  <button
                    type="button"
                    onClick={() => { setOpen(false); onOpenDevices?.(); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-muted/40 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  >
                    <span className="grid size-9 place-items-center rounded-xl bg-amber-400/15 text-amber-500">
                      <ShieldQuestion className="size-4" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium">
                        {pendingDevices === 1
                          ? t("alerts.devicesWaitingOne", { n: pendingDevices })
                          : t("alerts.devicesWaitingMany", { n: pendingDevices })}
                      </span>
                      {/* v2.100.1 — the owner asked the notification itself to carry
                          the details, not just a count: *"put the time from where,
                          and it should be the device name also."* With more than one
                          waiting, naming only the newest would be misleading, so the
                          count stands on its own and the details are in Devices. */}
                      {pendingDevices === 1 && pendingDetail ? (
                        <>
                          <span className="block truncate text-xs text-muted-foreground">
                            {pendingDetail.label}
                          </span>
                          {pendingDetail.detail && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {pendingDetail.detail}
                            </span>
                          )}
                          <span className="block text-[11px] text-muted-foreground">
                            {new Date(pendingDetail.createdAt).toLocaleString(dateLocale(locale))}
                          </span>
                        </>
                      ) : (
                        <span className="block text-xs text-muted-foreground">
                          {t("alerts.approveOrDecline")}
                        </span>
                      )}
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
                    className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-muted/40 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  >
                    <span className="grid size-9 place-items-center rounded-xl bg-destructive/15 text-destructive">
                      <PhoneMissed className="size-4" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium">
                        {missedCount === 1
                          ? t("alerts.missedRowOne", { n: missedCount })
                          : t("alerts.missedMany", { n: missedCount })}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t("alerts.tapHistory")}
                      </span>
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
                    className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-muted/40 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  >
                    <span className="grid size-9 place-items-center rounded-xl bg-primary/15 text-primary">
                      <MessageSquare className="size-4" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium">
                        {unreadCount === 1
                          ? t("alerts.unreadRowOne", { n: unreadCount })
                          : t("alerts.unreadRowMany", { n: unreadCount })}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t("alerts.tapMessages")}
                      </span>
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
