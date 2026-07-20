import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  ChevronDown,
  ChevronRight,
  Clock,
  MessageSquare,
  Phone,
  PhoneMissed,
  PhoneOutgoing,
  Trash2,
  Users,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { formatDuration, formatFullWhen } from "@/lib/formatCall";
import { useIdentity } from "@/app/useIdentity";
import { useRelayEngine } from "@/app/RelayEngine";

type ConfRow = {
  id: number;
  roomId: string;
  dialedNumber: string | null;
  partyCount: number;
  startedAt: string | Date;
  endedAt: string | Date;
  durationSec: number;
  /** Party line (v2.89): this room was a dialable line (`pl-<number>`). */
  partyLine?: boolean;
  /** The line's title (null when the line has since been deleted). */
  partyLineTitle?: string | null;
  participants: Array<{ number: string; name: string; isSelf: boolean }>;
};

type CallRow = {
  id: number;
  direction: "in" | "out";
  status: string;
  channel?: string;
  durationSec?: number | null;
  startedAt: string | Date;
  other: { number: string; displayName: string } | null;
};

type Item =
  | { kind: "conf"; key: string; at: number; direction: "in" | "out"; conf: ConfRow }
  | { kind: "solo"; key: string; at: number; direction: "in" | "out"; call: CallRow };

type Filter = "all" | "dialed" | "missed";

/* Per-direction accent recipe. FULL literal class strings — Tailwind's JIT
 * can't see classes assembled at runtime. The user spec: missed calls bright
 * RED, dialed (outgoing) vibrant GREEN, received (incoming) clear BLUE.
 * THEME-PAIRED (v2.88): the raw *-500 shades failed contrast on the light
 * theme, so each tone is 600-in-light / 400-in-dark. */
const TONE = {
  missed: {
    bubble: "bg-red-500/12 text-red-600 dark:text-red-400",
    name: "text-red-600 dark:text-red-400",
    label: "text-red-600 dark:text-red-400",
  },
  out: {
    bubble: "bg-green-500/12 text-green-600 dark:text-green-400",
    name: "text-green-600 dark:text-green-400",
    label: "text-green-600 dark:text-green-400",
  },
  in: {
    bubble: "bg-blue-500/12 text-blue-600 dark:text-blue-400",
    name: "text-blue-600 dark:text-blue-400",
    label: "text-blue-600 dark:text-blue-400",
  },
} as const;

const FILTERS: Array<{ key: Filter; label: string; icon: typeof Phone }> = [
  { key: "all", label: "All", icon: Phone },
  { key: "dialed", label: "Dialed", icon: PhoneOutgoing },
  { key: "missed", label: "Missed", icon: PhoneMissed },
];

/** True for the 1:1 rows we surface as standalone entries (never-connected
 *  calls). Answered calls come through conferenceHistory — skipping them here
 *  avoids double-listing. */
function isSoloRow(c: CallRow): boolean {
  if (c.direction === "in") return c.status === "missed" || c.status === "declined";
  // Outgoing: anything that never became a live call (they're "Dialed" rows).
  return ["missed", "declined", "initiated", "ringing", "failed"].includes(c.status);
}

function isMissedItem(it: Item): boolean {
  return it.kind === "solo" && it.direction === "in";
}

/** First letter of a display name for the avatar disc (empty ⇒ icon fallback). */
function initialOf(name: string): string {
  return (name || "").trim().charAt(0).toUpperCase();
}

/** Bucket a call timestamp into a collapsible day-section {key,label}. Pure
 *  presentation — the underlying rows/handlers are untouched. */
function dayBucket(ts: number, now: number): { key: string; label: string } {
  const d = new Date(ts);
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const n = new Date(now);
  const todayStart = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const DAY = 86_400_000;
  let label: string;
  if (startOfDay === todayStart) label = "Today";
  else if (startOfDay === todayStart - DAY) label = "Yesterday";
  else
    label = new Date(startOfDay).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  return { key: String(startOfDay), label };
}

export default function HistoryPage() {
  const { me } = useIdentity();
  const engine = useRelayEngine();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  // ?filter=missed|dialed|all — every missed-call notification (landing toast,
  // Dialer banner, bell panel) deep-links straight into the Missed log here.
  const search = useSearch();
  const urlFilter = useMemo<Filter | null>(() => {
    const f = new URLSearchParams(search).get("filter");
    return f === "missed" || f === "dialed" || f === "all" ? (f as Filter) : null;
  }, [search]);
  const [filter, setFilter] = useState<Filter>(urlFilter ?? "all");
  useEffect(() => {
    if (urlFilter) setFilter(urlFilter);
  }, [urlFilter]);
  // Open (or create) a 1:1 thread with a number and jump straight into it.
  const openThread = trpc.messages.openThread.useMutation({
    onSuccess: (res) => setLocation(`/app/messages?c=${res.conversationId}`),
    // A silently-failed tap is the worst case (v2.88) — say why nothing opened.
    onError: (err) => toast.error(err.message || "Couldn't open that conversation."),
  });

  // Answered calls (2..10 parties) with full roster + duration.
  const conferences = trpc.calls.conferenceHistory.useQuery(undefined, {
    enabled: !!me,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  // 1:1 history — surfaces the rows that never became a live call (missed /
  // declined / unanswered dials); answered calls come via conferenceHistory.
  const oneToOne = trpc.calls.history.useQuery(undefined, {
    enabled: !!me,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  // "Clear History": per-user soft clear on the server (the other parties keep
  // their own logs), then refresh everything the log feeds.
  const clearHistory = trpc.calls.clearHistory.useMutation({
    onSuccess: () => {
      utils.calls.history.invalidate();
      utils.calls.conferenceHistory.invalidate();
      utils.calls.missedSummary.invalidate();
    },
    onError: () => toast.error("Couldn't clear your history — try again."),
  });
  // AlertDialog confirm (v2.88 — native confirm() is gone app-wide).
  const [confirmClear, setConfirmClear] = useState(false);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const c of (conferences.data ?? []) as ConfRow[]) {
      out.push({
        kind: "conf",
        key: "conf-" + c.id,
        at: new Date(c.startedAt).getTime(),
        // The roster is seeded by the CALLER (first entry) — so "first entry is
        // me" means I dialed this call; otherwise I received/joined it.
        direction: c.participants[0]?.isSelf ? "out" : "in",
        conf: c,
      });
    }
    for (const c of (oneToOne.data ?? []) as CallRow[]) {
      if (!isSoloRow(c)) continue;
      out.push({
        kind: "solo",
        key: "solo-" + c.id,
        at: new Date(c.startedAt).getTime(),
        direction: c.direction,
        call: c,
      });
    }
    out.sort((a, b) => b.at - a.at);
    return out;
  }, [conferences.data, oneToOne.data]);

  const counts = useMemo(
    () => ({
      all: items.length,
      dialed: items.filter((it) => it.direction === "out").length,
      missed: items.filter(isMissedItem).length,
    }),
    [items]
  );

  const visible = useMemo(() => {
    if (filter === "dialed") return items.filter((it) => it.direction === "out");
    if (filter === "missed") return items.filter(isMissedItem);
    return items;
  }, [items, filter]);

  // Group the (already filtered + newest-first) rows into collapsible day
  // sections. Purely presentational: the item objects — and every prop the row
  // components receive — are the exact same references as before.
  const sections = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, { key: string; label: string; items: Item[] }>();
    for (const it of visible) {
      const { key, label } = dayBucket(it.at, now);
      let sec = map.get(key);
      if (!sec) {
        sec = { key, label, items: [] };
        map.set(key, sec);
      }
      sec.items.push(it);
    }
    return Array.from(map.values());
  }, [visible]);
  // Collapsed day-sections (by key). Default = all expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleSection = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const loading = conferences.isLoading || oneToOne.isLoading;
  const errored = conferences.isError && oneToOne.isError;
  // Voice-first everywhere (v2.81 protocol): a History redial starts as a
  // VOICE call — video is a mid-call, mutual-consent upgrade, never a default.
  const redial = (num: string) => {
    if (num) engine.dial(num, { voice: true });
  };
  // Explicit video call from a row's blue button — an intentional user choice
  // (same as the Contacts screen's Video action), not a voice-first default.
  const videoCall = (num: string) => {
    if (num) engine.dial(num, { voice: false });
  };
  // Re-create a group call: ring every participant into one conference.
  const redialGroup = (numbers: string[]) => {
    const nums = numbers.filter(Boolean);
    if (nums.length > 1) engine.dialGroup(nums, { voice: true });
    else if (nums.length === 1) engine.dial(nums[0], { voice: true });
  };
  const message = (num: string) => {
    if (num) openThread.mutate({ number: num });
  };
  // Call-back alert (v2.88): "tell me when they're back online" on offline
  // rows — rides the same watch the post-dial voicemail card registers.
  const watchOnline = trpc.directory.watchOnline.useMutation({
    onSuccess: (res) =>
      toast.success(`You'll be alerted when ${res.displayName || res.number} is back online.`),
    onError: (err) => toast.error(err.message || "Couldn't set the alert."),
  });
  const watch = (num: string) => {
    if (num) watchOnline.mutate({ number: num });
  };

  // Live reachability per number (ONE batched query, refreshed with the log):
  // a green/grey LED on each row tells the user BEFORE they redial whether the
  // other side is even reachable — dialing someone offline pages their phone.
  const presenceNumbers = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      if (it.kind === "solo") {
        const other = it.call.other?.number;
        if (other && /^\d{6}$/.test(other)) set.add(other);
      } else {
        for (const p of it.conf.participants) {
          if (!p.isSelf && p.number && /^\d{6}$/.test(p.number)) set.add(p.number);
        }
        if (it.conf.dialedNumber && /^\d{6}$/.test(it.conf.dialedNumber)) set.add(it.conf.dialedNumber);
      }
      if (set.size >= 100) break; // server caps the batch at 100
    }
    return Array.from(set).slice(0, 100).sort();
  }, [items]);
  const presence = trpc.directory.presenceMany.useQuery(
    { numbers: presenceNumbers },
    { enabled: !!me && presenceNumbers.length > 0, refetchInterval: 30_000, refetchIntervalInBackground: false }
  );
  const onlineSet = useMemo(
    () => new Set((presence.data ?? []).filter((p) => p.isOnline).map((p) => p.number)),
    [presence.data]
  );
  // Busy line (v2.88): numbers that are in a live call right now (amber LED).
  const inCallSet = useMemo(
    () => new Set((presence.data ?? []).filter((p) => p.inCall).map((p) => p.number)),
    [presence.data]
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 min-h-0 flex-col px-4 pb-3 pt-4 md:pb-6">
      <header className="mb-3 flex items-center gap-2">
        <Clock className="size-5 text-primary" />
        <h1 className="text-lg font-semibold tracking-tight">Call history</h1>
      </header>

      {/* Filter bar: All / Dialed / Missed segmented control + Clear History
          on the right. Sits ABOVE the scrolling list, so it (and the bottom
          tab bar below the page) stay put while the log scrolls. */}
      <div className="mb-3 flex items-center gap-2">
        <div
          role="tablist"
          aria-label="Filter calls"
          className="flex flex-1 gap-1 rounded-xl bg-muted/50 p-1"
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const Icon = f.icon;
            const n = counts[f.key];
            return (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.key)}
                className={
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-colors " +
                  "outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] " +
                  (active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                <Icon
                  className={
                    "size-3.5 " +
                    (f.key === "missed"
                      ? active ? "text-red-500" : ""
                      : f.key === "dialed"
                        ? active ? "text-green-500" : ""
                        : "")
                  }
                />
                {f.label}
                {n > 0 && (
                  <span
                    className={
                      "min-w-4 rounded-full px-1 text-[10px] font-bold leading-4 " +
                      (f.key === "missed"
                        ? "bg-red-500/15 text-red-500"
                        : "bg-muted text-muted-foreground")
                    }
                  >
                    {n > 99 ? "99+" : n}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Clear history"
          title="Clear your call history"
          disabled={clearHistory.isPending || items.length === 0}
          onClick={() => setConfirmClear(true)}
          className="size-9 shrink-0 rounded-lg text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
        >
          <Trash2 className="size-[18px]" />
        </Button>
      </div>

      <AlertDialog open={confirmClear} onOpenChange={(open) => !open && setConfirmClear(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear your entire call history?</AlertDialogTitle>
            <AlertDialogDescription>
              Every call disappears from YOUR log (the people you called keep theirs).
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmClear(false);
                clearHistory.mutate();
              }}
            >
              Clear history
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl glass-surface-md shadow-xl shadow-black/10">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {errored ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              <p>Couldn't load your call history.</p>
              <button
                type="button"
                onClick={() => { void conferences.refetch(); void oneToOne.refetch(); }}
                className="mt-3 inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-foreground hover:bg-muted/50"
              >
                Retry
              </button>
            </div>
          ) : loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : visible.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {filter === "missed"
                ? "No missed calls. 🎉"
                : filter === "dialed"
                  ? "No dialed calls yet — call someone from the keypad."
                  : "No calls yet. Your conference and call history will appear here — who you dialed, how many people joined, their names and numbers, and how long the call lasted."}
            </div>
          ) : (
            <div>
              {sections.map((sec) => {
                const isCollapsed = collapsed.has(sec.key);
                const sectionMissed = sec.items.some(isMissedItem);
                return (
                  <div key={sec.key}>
                    {/* Collapsible day header: chevron + UPPERCASE label + count,
                        with a danger dot when the day holds a missed call. */}
                    <button
                      type="button"
                      onClick={() => toggleSection(sec.key)}
                      aria-expanded={!isCollapsed}
                      className="flex w-full items-center gap-2 px-4 pt-3 pb-1.5 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="size-3 shrink-0" strokeWidth={2.4} />
                      ) : (
                        <ChevronDown className="size-3 shrink-0" strokeWidth={2.4} />
                      )}
                      <span className="flex-1 text-left text-[11px] font-bold uppercase tracking-[0.12em]">
                        {sec.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground/70">{sec.items.length}</span>
                      {sectionMissed && (
                        <span className="size-2 shrink-0 rounded-full bg-[#e2493b]" aria-hidden />
                      )}
                    </button>
                    {!isCollapsed && (
                      <ul>
                        {sec.items.map((it) =>
                          it.kind === "conf" ? (
                            <ConferenceItem
                              key={it.key}
                              conf={it.conf}
                              direction={it.direction}
                              onRedial={redial}
                              onRedialGroup={redialGroup}
                              onMessage={message}
                              onVideo={videoCall}
                              online={
                                presence.data
                                  ? onlineSet.has(it.conf.dialedNumber || it.conf.participants.find((p) => !p.isSelf)?.number || "")
                                  : undefined
                              }
                              inCall={inCallSet.has(
                                it.conf.dialedNumber || it.conf.participants.find((p) => !p.isSelf)?.number || ""
                              )}
                            />
                          ) : (
                            <SoloItem
                              key={it.key}
                              call={it.call}
                              onRedial={redial}
                              onMessage={message}
                              onVideo={videoCall}
                              onWatch={watch}
                              online={presence.data ? onlineSet.has(it.call.other?.number ?? "") : undefined}
                              inCall={inCallSet.has(it.call.other?.number ?? "")}
                            />
                          )
                        )}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/** A circular, gradient-filled row action (message / video / call / watch),
 *  matching the Claude Design prototype. The accent hex is a shared brand
 *  colour (identical in light + dark), so it's hardcoded per rule; the disc
 *  brightens on hover. */
function RoundAction({
  rgb,
  accent,
  strong,
  label,
  title,
  onClick,
  disabled,
  children,
}: {
  /** "r,g,b" of the accent, for the translucent gradient fill. */
  rgb: string;
  /** Solid accent hex for the icon (currentColor). */
  accent: string;
  /** Slightly stronger fill (the green call button in the prototype). */
  strong?: boolean;
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const hi = strong ? 0.26 : 0.24;
  const lo = strong ? 0.08 : 0.07;
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="grid size-11 shrink-0 place-items-center rounded-full transition hover:brightness-125 disabled:pointer-events-none disabled:opacity-40"
      style={{
        background: `linear-gradient(160deg, rgba(${rgb},${hi}), rgba(${rgb},${lo}))`,
        color: accent,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.15)",
      }}
    >
      {children}
    </button>
  );
}

/** Amber/green/grey reachability LED pinned to a row's icon bubble: amber =
 *  ON A CALL right now (v2.88 busy line — a redial would hit call waiting),
 *  green = online, grey = offline. `undefined` (presence not loaded yet)
 *  renders nothing — no flicker, no wrong claims. */
function PresenceLed({ online, inCall }: { online: boolean | undefined; inCall?: boolean }) {
  if (online === undefined) return null;
  const busy = online && inCall;
  return (
    <span
      aria-label={busy ? "On a call" : online ? "Online" : "Offline"}
      title={
        busy
          ? "On a call right now — you'd ring as call waiting"
          : online
            ? "Online now"
            : "Offline — calling will page their phone"
      }
      className={
        "absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-background " +
        (busy
          ? "bg-amber-400"
          : online
            ? "bg-[color:var(--relay-online,#06d6a0)]"
            : "bg-[color:var(--relay-offline)]")
      }
    />
  );
}

/** The small corner disc that overlaps an avatar's lower-left, showing call
 *  direction: an up-right arrow (out) or down-left arrow (in/missed), tinted
 *  with the row's tone. */
function DirectionBadge({ direction, toneName }: { direction: "in" | "out"; toneName: string }) {
  return (
    <span className="absolute -bottom-1 -left-1 grid size-[18px] place-items-center rounded-full bg-background">
      {direction === "out" ? (
        <ArrowUpRight className={"size-3 " + toneName} strokeWidth={3} />
      ) : (
        <ArrowDownLeft className={"size-3 " + toneName} strokeWidth={3} />
      )}
    </span>
  );
}

function ConferenceItem({
  conf,
  direction,
  onRedial,
  onRedialGroup,
  onMessage,
  onVideo,
  online,
  inCall,
}: {
  conf: ConfRow;
  direction: "in" | "out";
  onRedial: (num: string) => void;
  onRedialGroup: (numbers: string[]) => void;
  onMessage: (num: string) => void;
  onVideo: (num: string) => void;
  online: boolean | undefined;
  inCall?: boolean;
}) {
  const others = conf.participants.filter((p) => !p.isSelf);
  const otherNumbers = others.map((p) => p.number).filter(Boolean);
  const isGroup = conf.partyCount > 2 || otherNumbers.length > 1;
  const tone = direction === "out" ? TONE.out : TONE.in;
  // Title = the party line's name (v2.89) when this room WAS a line, else the
  // other people on the call (or the dialed number as a fallback).
  const title = conf.partyLine
    ? `${conf.partyLineTitle || `Line ${conf.dialedNumber ?? ""}`.trim()} (party line)`
    : others.length > 0
      ? others.map((p) => p.name).join(", ")
      : conf.dialedNumber
        ? `Call to ${conf.dialedNumber}`
        : "Call";
  // Best number to call back: the dialed number, else the first other party.
  const callBack = conf.dialedNumber || others[0]?.number || "";
  // For a GROUP, the call button rings everyone back into one conference —
  // except a PARTY LINE (v2.89), where redialing the LINE number rejoins the
  // room without ringing anyone.
  const callBackAll = () => {
    if (conf.partyLine && conf.dialedNumber) onRedial(conf.dialedNumber);
    else if (isGroup && otherNumbers.length > 1) onRedialGroup(otherNumbers);
    else onRedial(callBack);
  };
  const canCall = isGroup ? otherNumbers.length > 0 : !!callBack;
  const initial = initialOf(others[0]?.name ?? "");

  return (
    <li
      className="border-b border-border/60 px-4 py-3 last:border-b-0 transition-colors hover:bg-muted/30"
      aria-label={`${direction === "out" ? "Outgoing" : "Incoming"} call with ${title}, ${formatDuration(conf.durationSec)} duration`}
    >
      <div className="flex items-center gap-3">
        {isGroup ? (
          // Group → violet-tinted rounded-square Users disc.
          <span
            className="relative grid size-10 shrink-0 place-items-center rounded-xl"
            style={{
              background: "linear-gradient(160deg, rgba(167,139,250,.24), rgba(167,139,250,.07))",
              color: "#a78bfa",
            }}
          >
            <Users className="size-[18px]" />
            <PresenceLed online={online} inCall={inCall} />
          </span>
        ) : (
          // 1:1 answered call → round tone disc + a direction corner badge.
          <span className={"relative grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold " + tone.bubble}>
            {initial || <Phone className="size-[18px]" />}
            <DirectionBadge direction={direction} toneName={tone.name} />
            <PresenceLed online={online} inCall={inCall} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">
            <span className={"font-semibold " + tone.label}>
              {direction === "out" ? "Outgoing" : "Incoming"}
            </span>
            {isGroup ? (
              <>
                {" "}· <Users className="mr-0.5 inline size-3 align-[-1px]" />
                {conf.partyCount} people
              </>
            ) : null}
            {" "}· {formatDuration(conf.durationSec)}
            {conf.dialedNumber ? (
              <span className="font-mono"> · PIN {conf.dialedNumber}</span>
            ) : null}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground/80">
            {formatFullWhen(conf.startedAt)}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <RoundAction
            rgb="251,146,60"
            accent="#fb923c"
            label="Message"
            title="Message"
            disabled={!callBack}
            onClick={() => onMessage(callBack)}
          >
            <MessageSquare className="size-4" />
          </RoundAction>
          {!isGroup && (
            <RoundAction
              rgb="56,189,248"
              accent="#38bdf8"
              label="Video call"
              title="Video call"
              disabled={!callBack}
              onClick={() => onVideo(callBack)}
            >
              <Video className="size-4" />
            </RoundAction>
          )}
          <RoundAction
            rgb="34,197,94"
            accent="#22c55e"
            strong
            label={isGroup ? "Call the group back" : "Call back"}
            title={isGroup ? "Call everyone back (group)" : "Call back"}
            disabled={!canCall}
            onClick={callBackAll}
          >
            {isGroup ? <Users className="size-4" /> : <Phone className="size-4" />}
          </RoundAction>
        </div>
      </div>

      {/* Roster: every participant's name + PIN. */}
      <div className="mt-2 flex flex-wrap gap-1.5 pl-12">
        {conf.participants.map((p) => (
          <span
            key={p.number}
            className={
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold " +
              (p.isSelf
                ? "bg-primary/15 text-primary"
                : "bg-muted/60 text-muted-foreground")
            }
            title={p.number}
            aria-label={p.isSelf ? "You" : `${p.name} (${p.number})`}
          >
            <span className="max-w-[10rem] truncate">
              {p.isSelf ? "You" : p.name}
            </span>
            {p.number ? <span className="font-mono opacity-60">{p.number}</span> : null}
          </span>
        ))}
      </div>
    </li>
  );
}

/** A 1:1 row that never became a live call: an incoming missed/declined call
 *  (bright red) or an outgoing dial nobody answered (vibrant green, since it
 *  belongs to "Dialed"). */
function SoloItem({
  call,
  onRedial,
  onMessage,
  onVideo,
  onWatch,
  online,
  inCall,
}: {
  call: CallRow;
  onRedial: (num: string) => void;
  onMessage: (num: string) => void;
  onVideo: (num: string) => void;
  /** Call-back alert (v2.88): register a "they're back online" watch. */
  onWatch?: (num: string) => void;
  online: boolean | undefined;
  inCall?: boolean;
}) {
  const missedIn = call.direction === "in";
  const tone = missedIn ? TONE.missed : TONE.out;
  const peerNum = call.other?.number ?? "";
  const peerName = call.other?.displayName ?? peerNum ?? "Unknown";
  const label = missedIn
    ? call.status === "declined" ? "Declined" : "Missed call"
    : call.status === "declined"
      ? "Declined by them"
      : call.status === "failed"
        ? "Failed"
        : "No answer";
  const initial = initialOf(call.other?.displayName ?? "");

  return (
    <li
      className="border-b border-border/60 px-4 py-3 last:border-b-0 transition-colors hover:bg-muted/30"
      aria-label={`${label} — ${peerName}`}
    >
      <div className="flex items-center gap-3">
        <span className={"relative grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold " + tone.bubble}>
          {initial || <Phone className="size-[18px]" />}
          <DirectionBadge direction={call.direction} toneName={tone.name} />
          <PresenceLed online={online} inCall={inCall} />
        </span>
        <div className="min-w-0 flex-1">
          <div className={"truncate text-[15px] font-bold " + (missedIn ? tone.name : "text-foreground")}>
            {peerName}
          </div>
          <div className="text-xs text-muted-foreground">
            <span className={"font-semibold " + tone.label}>{label}</span>
            {call.channel === "voice" ? " · Voice" : call.channel === "video" ? " · Video" : ""}
            {peerNum ? <span className="font-mono"> · PIN {peerNum}</span> : null}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground/80">
            {formatFullWhen(call.startedAt)}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Offline peer → offer the v2.88 call-back alert right on the row. */}
          {online === false && onWatch && peerNum ? (
            <RoundAction
              rgb="82,227,208"
              accent="#52e3d0"
              label="Alert me when they're back online"
              title="Alert me when they're back online"
              onClick={() => onWatch(peerNum)}
            >
              <Bell className="size-4" />
            </RoundAction>
          ) : null}
          <RoundAction
            rgb="251,146,60"
            accent="#fb923c"
            label="Message"
            title="Message"
            disabled={!peerNum}
            onClick={() => onMessage(peerNum)}
          >
            <MessageSquare className="size-4" />
          </RoundAction>
          <RoundAction
            rgb="56,189,248"
            accent="#38bdf8"
            label="Video call"
            title="Video call"
            disabled={!peerNum}
            onClick={() => onVideo(peerNum)}
          >
            <Video className="size-4" />
          </RoundAction>
          <RoundAction
            rgb="34,197,94"
            accent="#22c55e"
            strong
            label="Call back"
            title="Call back"
            disabled={!peerNum}
            onClick={() => onRedial(peerNum)}
          >
            <Phone className="size-4" />
          </RoundAction>
        </div>
      </div>
    </li>
  );
}
