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
  Radio,
  Search,
  Trash2,
  UserPlus,
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
import { RoleBadge } from "@/app/VerifiedBadge";
import type { IdentityRole } from "@/app/VerifiedBadge";
import { useIdentity } from "@/app/useIdentity";
import { useRelayEngine } from "@/app/RelayEngine";
import { PeerAvatar, openPeerProfile } from "@/app/PeerOverlays";

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
  participants: Array<{ number: string; name: string; avatarUrl?: string | null; isSelf: boolean; role?: IdentityRole | null }>;
};

type CallRow = {
  id: number;
  direction: "in" | "out";
  status: string;
  channel?: string;
  durationSec?: number | null;
  startedAt: string | Date;
  other: { number: string; displayName: string; avatarUrl?: string | null; role?: IdentityRole | null } | null;
};

type Item =
  | { kind: "conf"; key: string; at: number; direction: "in" | "out"; conf: ConfRow }
  | { kind: "solo"; key: string; at: number; direction: "in" | "out"; call: CallRow };

type Filter = "all" | "dialed" | "missed";

/**
 * The peer's 6-digit number, in brackets, right after their name (v2.99.77).
 *
 * Owner: *"beside his name up, you put between two brackets his PIN number. No
 * need to mention PIN and the number. Just put his number ... in different
 * color."* So: no label, its own colour, and never wrapped away from the name.
 *
 * `dir="ltr"` + bidi isolation because an Arabic display name would otherwise
 * reorder the digits and the brackets around them.
 */
function PinTag({ number }: { number: string | null | undefined }) {
  if (!number || !/^\d{6}$/.test(number)) return null;
  return (
    <span
      dir="ltr"
      className="ms-1.5 shrink-0 font-mono text-[12.5px] font-bold text-[color:var(--relay-online,#06d6a0)] [unicode-bidi:isolate]"
    >
      ({number})
    </span>
  );
}

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

/** Everything a History row can be matched on: contact name, number/PIN, and
 *  (for conferences) every participant + the party-line title. */
function searchTextOf(it: Item): string {
  if (it.kind === "solo") {
    return `${it.call.other?.displayName ?? ""} ${it.call.other?.number ?? ""}`;
  }
  const c = it.conf;
  return [
    c.dialedNumber ?? "",
    c.partyLineTitle ?? "",
    ...c.participants.map((p) => `${p.name} ${p.number}`),
  ].join(" ");
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

  // Search across the log by contact name / number / PIN (v2.95). Local filter
  // over the already-loaded items — instant, no new request.
  const [historySearch, setHistorySearch] = useState("");
  const visible = useMemo(() => {
    let v =
      filter === "dialed"
        ? items.filter((it) => it.direction === "out")
        : filter === "missed"
          ? items.filter(isMissedItem)
          : items;
    const q = historySearch.trim().toLowerCase();
    if (q) {
      const qDigits = q.replace(/\D/g, "");
      v = v.filter((it) => {
        const hay = searchTextOf(it).toLowerCase();
        return hay.includes(q) || (qDigits.length > 0 && hay.replace(/\D/g, "").includes(qDigits));
      });
    }
    return v;
  }, [items, filter, historySearch]);

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

  // One-tap contact conversion (v2.96): which history peers are ALREADY saved
  // (hides the + button), and the add mutation itself.
  const contactsQ = trpc.contacts.list.useQuery(undefined, {
    enabled: !!me,
    staleTime: 30_000,
  });
  const savedNumbers = useMemo(
    () => new Set((contactsQ.data ?? []).map((c) => c.number)),
    [contactsQ.data]
  );
  const addContact = trpc.contacts.upsert.useMutation({
    onSuccess: () => {
      utils.contacts.list.invalidate();
      toast.success("Added to your contacts.");
    },
    onError: (err) => toast.error(err.message || "Couldn't add the contact."),
  });
  const quickAdd = (num: string, name: string) => {
    if (num) addContact.mutate({ number: num, displayName: name || undefined });
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

      {/* Live-call rejoin (v2.99.9): any recent call that is STILL ALIVE and
          that you were part of shows a "Live now · Join" card — tap Join to ask
          the host to let you back in. Only numbers currently in a call are
          probed (via the busy LED set), and directory.liveRoom returns a card
          only for a room you were actually in. */}
      {Array.from(inCallSet).slice(0, 4).map((num) => (
        <LiveRejoinCard key={num} number={num} />
      ))}

      {/* Search across the log by name / number / PIN. */}
      {items.length > 0 && (
        <div className="mb-2.5 relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={historySearch}
            onChange={(e) => setHistorySearch(e.target.value)}
            placeholder="Search calls by name or number"
            aria-label="Search calls"
            className="h-9 w-full rounded-lg border border-border/60 bg-muted/40 pl-9 pr-3 text-sm outline-none focus:border-primary/50"
          />
        </div>
      )}
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
              {historySearch.trim()
                ? `No calls match “${historySearch.trim()}”.`
                : filter === "missed"
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
                              onAddContact={quickAdd}
                              saved={savedNumbers.has(
                                it.conf.participants.find((p) => !p.isSelf)?.number ?? ""
                              )}
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
                              onAddContact={quickAdd}
                              saved={savedNumbers.has(it.call.other?.number ?? "")}
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
  onAddContact,
  saved,
  online,
  inCall,
}: {
  conf: ConfRow;
  direction: "in" | "out";
  onRedial: (num: string) => void;
  onRedialGroup: (numbers: string[]) => void;
  onMessage: (num: string) => void;
  onVideo: (num: string) => void;
  /** One-tap contact conversion (v2.96) for the 1:1 peer — hidden when saved. */
  onAddContact?: (num: string, name: string) => void;
  saved?: boolean;
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
  // The 1:1 peer (for the avatar / profile popup / quick-add).
  const peer = others[0] ?? null;

  return (
    <li
      className="border-b-2 border-border px-4 py-3.5 last:border-b-0 transition-colors hover:bg-muted/30"
      aria-label={`${direction === "out" ? "Outgoing" : "Incoming"} call with ${title}, ${formatDuration(conf.durationSec)} duration`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
          // 1:1 answered call → photo + status ring (v2.96); no-photo
          // initials keep the direction tone tint.
          <PeerAvatar
            number={peer?.number || null}
            name={peer?.name}
            avatarUrl={peer?.avatarUrl}
            size={40}
            fallbackClassName={tone.bubble + " text-sm"}
          >
            <DirectionBadge direction={direction} toneName={tone.name} />
            <PresenceLed online={online} inCall={inCall} />
          </PeerAvatar>
        )}
        <div className="min-w-0 flex-1 basis-48">
          {!isGroup && peer?.number ? (
            <button
              type="button"
              onClick={() => openPeerProfile(peer.number)}
              className="flex max-w-full items-baseline text-left text-[15px] font-bold text-foreground outline-none focus-visible:underline"
              aria-label={`View ${peer.name}'s profile`}
            >
              <span className="truncate" dir="auto">{title}</span>
              <RoleBadge role={peer.role ?? null} size={14} className="ms-1 self-center" />
              <PinTag number={peer.number} />
            </button>
          ) : (
            <div className="truncate text-[15px] font-bold text-foreground" dir="auto">{title}</div>
          )}
          <div className="truncate text-xs text-muted-foreground">
            {/* Group first, so "Group" reads as the KIND of call before its
                direction, then direction, then the duration. A group's media type
                is deliberately absent: `conference_history` stores no channel, so
                claiming Voice or Video here would be a guess. */}
            {isGroup ? (
              <>
                <span className="font-semibold text-foreground">
                  <Users className="mr-0.5 inline size-3 align-[-1px]" />
                  Group · {conf.partyCount}
                </span>
                {" · "}
              </>
            ) : null}
            <span className={"font-semibold " + tone.label}>
              {direction === "out" ? "Outgoing" : "Incoming"}
            </span>
            {" "}· {formatDuration(conf.durationSec)}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground/80">
            {formatFullWhen(conf.startedAt)}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {/* Not saved yet → one-tap add-to-contacts (v2.96, 1:1 only). */}
          {!isGroup && !saved && onAddContact && peer?.number ? (
            <RoundAction
              rgb="167,139,250"
              accent="#a78bfa"
              label="Add to contacts"
              title="Add to contacts"
              onClick={() => onAddContact(peer.number, peer.name ?? "")}
            >
              <UserPlus className="size-4" />
            </RoundAction>
          ) : null}
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

      {/* Roster — GROUPS ONLY, and never yourself (v2.99.77).
          Owner: *"you don't need to put myself because it's showing my name ...
          they will see all others except themselves."* On a 1:1 row the roster was
          pure repetition of the name and number already on the line above, so it
          is gone entirely there. */}
      {isGroup && others.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5 pl-12">
          {others.map((p) => (
            <li
              key={p.number || p.name}
              className="inline-flex items-baseline gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
              aria-label={p.number ? `${p.name} (${p.number})` : p.name}
            >
              <span className="max-w-[10rem] truncate" dir="auto">{p.name}</span>
              <RoleBadge role={p.role ?? null} size={11} className="self-center" />
              {p.number ? (
                <span
                  dir="ltr"
                  className="font-mono font-bold text-[color:var(--relay-online,#06d6a0)] [unicode-bidi:isolate]"
                >
                  ({p.number})
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
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
  onAddContact,
  saved,
  online,
  inCall,
}: {
  call: CallRow;
  onRedial: (num: string) => void;
  onMessage: (num: string) => void;
  onVideo: (num: string) => void;
  /** Call-back alert (v2.88): register a "they're back online" watch. */
  onWatch?: (num: string) => void;
  /** One-tap contact conversion (v2.96) — hidden when already saved. */
  onAddContact?: (num: string, name: string) => void;
  saved?: boolean;
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

  return (
    <li
      className="border-b-2 border-border px-4 py-3.5 last:border-b-0 transition-colors hover:bg-muted/30"
      aria-label={`${label} — ${peerName}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* Photo + status ring (v2.96); no-photo initials keep the tone tint. */}
        <PeerAvatar
          number={peerNum || null}
          name={call.other?.displayName}
          avatarUrl={call.other?.avatarUrl}
          size={40}
          fallbackClassName={tone.bubble + " text-sm"}
        >
          <DirectionBadge direction={call.direction} toneName={tone.name} />
          <PresenceLed online={online} inCall={inCall} />
        </PeerAvatar>
        <div className="min-w-0 flex-1 basis-48">
          <button
            type="button"
            onClick={() => peerNum && openPeerProfile(peerNum)}
            className={
              "flex max-w-full items-baseline text-left text-[15px] font-bold outline-none focus-visible:underline " +
              (missedIn ? tone.name : "text-foreground")
            }
            aria-label={`View ${peerName}'s profile`}
          >
            <span className="truncate" dir="auto">{peerName}</span>
            {/* Owner: "immediately put the badge" — right after the last name, and
                BEFORE the number, so name → tier → number reads in that order. No
                caption: the colour is the tier (v2.99.78). */}
            <RoleBadge role={call.other?.role ?? null} size={14} className="ms-1 self-center" />
            <PinTag number={peerNum} />
          </button>
          <div className="truncate text-xs text-muted-foreground">
            <span className={"font-semibold " + tone.label}>{label}</span>
            {call.channel === "voice" ? " · Voice" : call.channel === "video" ? " · Video" : ""}
            {/* A missed/unanswered call has no duration to show, so it is only
                rendered when there genuinely is one. The peer's number now lives
                beside the name, and OUR OWN number is never shown anywhere in the
                log — the owner already knows their own. */}
            {call.durationSec ? ` · ${formatDuration(call.durationSec)}` : ""}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground/80">
            {formatFullWhen(call.startedAt)}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {/* Not saved yet → one-tap add-to-contacts (v2.96). */}
          {!saved && onAddContact && peerNum ? (
            <RoundAction
              rgb="167,139,250"
              accent="#a78bfa"
              label="Add to contacts"
              title="Add to contacts"
              onClick={() => onAddContact(peerNum, call.other?.displayName ?? "")}
            >
              <UserPlus className="size-4" />
            </RoundAction>
          ) : null}
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

/**
 * Live-call rejoin card (v2.99.9). For a number currently in a call that the
 * viewer was part of, `directory.liveRoom` returns the live roster + host (or
 * null — for a stranger's call, an ended call, or a non-signaling instance).
 * Tapping Join asks the host to let you back in (a knock); the engine surfaces
 * the host's approval and, once granted, drops you into the live call.
 */
function LiveRejoinCard({ number }: { number: string }) {
  const engine = useRelayEngine();
  const q = trpc.directory.liveRoom.useQuery(
    { number },
    { refetchInterval: 15_000, refetchOnWindowFocus: true },
  );
  const info = q.data;
  if (!info) return null;
  const names = info.members.map((m) => m.name).filter(Boolean);
  const preview =
    names.length === 0
      ? `${info.count} in the call`
      : names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
  return (
    <div className="mb-2.5 flex items-center gap-3 rounded-2xl border border-[color:var(--relay-online,#06d6a0)]/40 bg-[color:var(--relay-online,#06d6a0)]/10 p-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[color:var(--relay-online,#06d6a0)]/20 text-[color:var(--relay-online,#06d6a0)]">
        <Radio className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          Live now
          <span className="text-xs font-normal text-muted-foreground">· {info.count} in the call</span>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {preview}
          {info.hostName ? ` · hosted by ${info.hostName}` : ""}
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          engine.knock(number);
          toast("Asked the host to let you in…");
        }}
        className="shrink-0 rounded-full bg-[color:var(--relay-online,#06d6a0)] px-4 py-2 text-xs font-semibold text-black active:scale-95 transition-transform"
      >
        Join
      </button>
    </div>
  );
}
