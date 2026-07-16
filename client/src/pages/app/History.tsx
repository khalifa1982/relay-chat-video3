import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  Bell,
  Clock,
  Phone,
  Users,
  MessageSquare,
  PhoneMissed,
  PhoneOutgoing,
  PhoneIncoming,
  Trash2,
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

  const loading = conferences.isLoading || oneToOne.isLoading;
  const errored = conferences.isError && oneToOne.isError;
  // Voice-first everywhere (v2.81 protocol): a History redial starts as a
  // VOICE call — video is a mid-call, mutual-consent upgrade, never a default.
  const redial = (num: string) => {
    if (num) engine.dial(num, { voice: true });
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
                      "min-w-4 rounded-full px-1 text-[10px] leading-4 " +
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
          className="size-9 shrink-0 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
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
            <ul>
              {visible.map((it) =>
                it.kind === "conf" ? (
                  <ConferenceItem
                    key={it.key}
                    conf={it.conf}
                    direction={it.direction}
                    onRedial={redial}
                    onRedialGroup={redialGroup}
                    onMessage={message}
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
                    onWatch={watch}
                    online={presence.data ? onlineSet.has(it.call.other?.number ?? "") : undefined}
                    inCall={inCallSet.has(it.call.other?.number ?? "")}
                  />
                )
              )}
            </ul>
          )}
        </div>
      </section>
    </div>
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

function ConferenceItem({
  conf,
  direction,
  onRedial,
  onRedialGroup,
  onMessage,
  online,
  inCall,
}: {
  conf: ConfRow;
  direction: "in" | "out";
  onRedial: (num: string) => void;
  onRedialGroup: (numbers: string[]) => void;
  onMessage: (num: string) => void;
  online: boolean | undefined;
  inCall?: boolean;
}) {
  const others = conf.participants.filter((p) => !p.isSelf);
  const otherNumbers = others.map((p) => p.number).filter(Boolean);
  const isGroup = conf.partyCount > 2 || otherNumbers.length > 1;
  const tone = direction === "out" ? TONE.out : TONE.in;
  const Icon = isGroup ? Users : direction === "out" ? PhoneOutgoing : PhoneIncoming;
  // Title = the other people on the call (or the dialed number as a fallback).
  const title =
    others.length > 0
      ? others.map((p) => p.name).join(", ")
      : conf.dialedNumber
        ? `Call to ${conf.dialedNumber}`
        : "Call";
  // Best number to call back: the dialed number, else the first other party.
  const callBack = conf.dialedNumber || others[0]?.number || "";
  // For a GROUP, the call button rings everyone back into one conference.
  const callBackAll = () => {
    if (isGroup && otherNumbers.length > 1) onRedialGroup(otherNumbers);
    else onRedial(callBack);
  };
  const canCall = isGroup ? otherNumbers.length > 0 : !!callBack;

  return (
    <li
      className="border-b border-border/60 px-4 py-3 last:border-b-0 hover:bg-muted/30 transition-colors"
      aria-label={`${direction === "out" ? "Outgoing" : "Incoming"} call with ${title}, ${formatDuration(conf.durationSec)} duration`}
    >
      <div className="flex items-center gap-3">
        <span className={"relative grid size-9 shrink-0 place-items-center rounded-xl " + tone.bubble}>
          <Icon className="size-[18px]" />
          <PresenceLed online={online} inCall={inCall} />
        </span>
        <div className="min-w-0 flex-1">
          <div className={"truncate font-medium " + tone.name}>{title}</div>
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
        <Button
          size="icon"
          variant="ghost"
          disabled={!callBack}
          aria-label="Message"
          title="Message"
          onClick={() => onMessage(callBack)}
          className="size-11"
        >
          <MessageSquare className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          disabled={!canCall}
          aria-label={isGroup ? "Call the group back" : "Call back"}
          title={isGroup ? "Call everyone back (group)" : "Call back"}
          onClick={callBackAll}
          className="size-11"
        >
          {isGroup ? <Users className="size-4" /> : <Phone className="size-4" />}
        </Button>
      </div>

      {/* Roster: every participant's name + PIN. */}
      <div className="mt-2 flex flex-wrap gap-1.5 pl-12">
        {conf.participants.map((p) => (
          <span
            key={p.number}
            className={
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] " +
              (p.isSelf
                ? "bg-primary/15 text-primary"
                : "bg-muted/60 text-muted-foreground")
            }
            title={p.number}
            aria-label={p.isSelf ? "You" : `${p.name} (${p.number})`}
          >
            <span className="max-w-[10rem] truncate font-medium">
              {p.isSelf ? "You" : p.name}
            </span>
            {p.number ? <span className="font-mono opacity-70">{p.number}</span> : null}
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
  onWatch,
  online,
  inCall,
}: {
  call: CallRow;
  onRedial: (num: string) => void;
  onMessage: (num: string) => void;
  /** Call-back alert (v2.88): register a "they're back online" watch. */
  onWatch?: (num: string) => void;
  online: boolean | undefined;
  inCall?: boolean;
}) {
  const missedIn = call.direction === "in";
  const tone = missedIn ? TONE.missed : TONE.out;
  const Icon = missedIn ? PhoneMissed : PhoneOutgoing;
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
      className="border-b border-border/60 px-4 py-3 last:border-b-0 hover:bg-muted/30 transition-colors"
      aria-label={`${label} — ${peerName}`}
    >
      <div className="flex items-center gap-3">
        <span className={"relative grid size-9 shrink-0 place-items-center rounded-xl " + tone.bubble}>
          <Icon className="size-[18px]" />
          <PresenceLed online={online} inCall={inCall} />
        </span>
        <div className="min-w-0 flex-1">
          <div className={"truncate font-medium " + tone.name}>{peerName}</div>
          <div className="text-xs text-muted-foreground">
            <span className={"font-semibold " + tone.label}>{label}</span>
            {call.channel === "voice" ? " · Voice" : call.channel === "video" ? " · Video" : ""}
            {peerNum ? <span className="font-mono"> · PIN {peerNum}</span> : null}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground/80">
            {formatFullWhen(call.startedAt)}
          </div>
        </div>
        {/* Offline peer → offer the v2.88 call-back alert right on the row. */}
        {online === false && onWatch && peerNum ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Alert me when they're back online"
            title="Alert me when they're back online"
            onClick={() => onWatch(peerNum)}
            className="size-11"
          >
            <Bell className="size-4" />
          </Button>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          disabled={!peerNum}
          aria-label="Message"
          title="Message"
          onClick={() => onMessage(peerNum)}
          className="size-11"
        >
          <MessageSquare className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          disabled={!peerNum}
          aria-label="Call back"
          title="Call back"
          onClick={() => onRedial(peerNum)}
          className="size-11"
        >
          <Phone className="size-4" />
        </Button>
      </div>
    </li>
  );
}
