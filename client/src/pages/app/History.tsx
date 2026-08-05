import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  ChevronDown,
  ChevronRight,
  Clock,
  Layers,
  MessageSquare,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Search,
  Trash2,
  UserPlus,
  Users,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ListLoading } from "@/app/ListStates";
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
import { presenceDot, type PresenceDotState } from "@/app/presenceDot";
import { useT, translate, type TKey } from "@/app/i18n";
import { matchQuery } from "@/app/searchMatch";
// #117 — the paging primitives, kept pure so the ordering and de-duplication can be
// tested without a database or a browser.
import { mergeHistoryPages, oldestCursor, pageLooksFull, HISTORY_PAGE } from "@/app/historyPages";

/**
 * One person's live reachability, as this screen understands it (v2.99.95).
 *
 * Passed down as a LOOKUP rather than as pre-resolved booleans, because the call
 * site cannot safely decide WHICH number a row is about — it used to try, and on an
 * incoming call it picked the viewer's own number and painted the viewer's presence
 * on the caller's face. Each row now derives its own key from its own data.
 */
export type PresenceSnapshot = { isOnline: boolean; idle: boolean; inCall: boolean };
type PresenceLookup = ((number: string | null | undefined) => PresenceSnapshot | undefined) | undefined;

/**
 * Which number a conference row is ABOUT (v2.99.95) — pure, so the rule can be
 * tested with a row shaped like the owner's screenshot rather than pinned in source.
 *
 * `dialedNumber` is a trap and it caused a real bug. There is ONE shared
 * `conference_history` row per room, and the CALLER seeds `dialedNumber` with the
 * number they dialled — so on the RECIPIENT'S screen it holds the recipient's own
 * number. Reading it as "the peer" made every answered incoming call ask for the
 * viewer's own presence (always online) and paint it on the caller's avatar, and made
 * that row's Message / Video / Call buttons dial the viewer themselves.
 *
 * A PARTY LINE is the one exception: there `dialedNumber` is the LINE's number rather
 * than a person's, and redialling it is what rejoins the room without ringing anybody.
 */
export function conferenceRowKeys(conf: {
  partyLine?: boolean;
  dialedNumber: string | null;
  partyCount: number;
  participants: Array<{ number: string; isSelf: boolean }>;
}): { peerNumber: string; callBack: string; isGroup: boolean; otherNumbers: string[] } {
  const others = conf.participants.filter((p) => !p.isSelf);
  const otherNumbers = others.map((p) => p.number).filter(Boolean);
  const isGroup = conf.partyCount > 2 || otherNumbers.length > 1;
  const peerNumber = otherNumbers[0] || "";
  const callBack = conf.partyLine
    ? conf.dialedNumber || peerNumber
    : peerNumber || conf.dialedNumber || "";
  return { peerNumber, callBack, isGroup, otherNumbers };
}

type ConfRow = {
  id: number;
  roomId: string;
  dialedNumber: string | null;
  partyCount: number;
  startedAt: string | Date;
  endedAt: string | Date;
  durationSec: number;
  /**
   * #116 — how the call was DIALLED, or null/absent when it was never recorded
   * (every conference logged before the column existed, and a party line, which is
   * joined rather than dialled). Optional so an older server's payload simply omits
   * it and the row prints nothing, which is the same as null.
   */
  channel?: "voice" | "video" | null;
  /** Party line (v2.89): this room was a dialable line (`pl-<number>`). */
  partyLine?: boolean;
  /** The line's title (null when the line has since been deleted). */
  partyLineTitle?: string | null;
  participants: Array<{ identityId?: number | null; number: string; name: string; avatarUrl?: string | null; isSelf: boolean; role?: IdentityRole | null }>;
};

type CallRow = {
  id: number;
  direction: "in" | "out";
  status: string;
  channel?: string;
  durationSec?: number | null;
  startedAt: string | Date;
  other: { identityId?: number | null; number: string; displayName: string; avatarUrl?: string | null; role?: IdentityRole | null } | null;
};

type Item =
  | { kind: "conf"; key: string; at: number; direction: "in" | "out"; conf: ConfRow }
  | { kind: "solo"; key: string; at: number; direction: "in" | "out"; call: CallRow };

type Filter = "all" | "dialed" | "received" | "missed";

/**
 * The peer's 6-digit number, in brackets, right after their name (v2.99.77).
 *
 * Owner: *"beside his name up, you put between two brackets his PIN number. No
 * need to mention PIN and the number. Just put his number ... in different
 * color."* So: no label, its own colour, and never wrapped away from the name.
 *
 * `dir="ltr"` + bidi isolation because an Arabic display name would otherwise
 * reorder the digits and the brackets around them.
 *
 * `--relay-green-text`, NOT `--relay-online`, and the difference is MEASURED rather
 * than a naming preference. Green really is this app's word for a RELAY number — the
 * top bar has rendered the viewer's own that way since v2.99.86 — but that release
 * measured the LED hue at **4.46:1 as small text, which FAILS AA**, and added the
 * darker sibling (5.92:1 light / 9.27:1 dark) precisely for a number at this size.
 * This tag was on the LED hue at 12.5px while `Contacts.tsx` rendered THE SAME FACT in
 * the AA-measured one: one number, two greens, and the unreadable one here.
 */
function PinTag({ number }: { number: string | null | undefined }) {
  if (!number || !/^\d{6}$/.test(number)) return null;
  return (
    <span
      dir="ltr"
      className="ms-1.5 shrink-0 font-mono text-[12.5px] font-bold text-[color:var(--relay-green-text)] [unicode-bidi:isolate]"
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

/* v2.106.85: the tab label is a dictionary KEY — a module-level constant cannot
   call a hook, and the tab strip is the only thing that renders it. */
const FILTERS: Array<{ key: Filter; labelKey: TKey; icon: typeof Phone }> = [
  { key: "all", labelKey: "history.all", icon: Phone },
  { key: "dialed", labelKey: "history.dialed", icon: PhoneOutgoing },
  // v2.99.98 (owner): "there is a tabs, all the dial and received. You should add
  // received". RECEIVED means a call that came in AND WAS ANSWERED — see
  // isReceivedItem for why that has exactly one possible definition here.
  { key: "received", labelKey: "history.received", icon: PhoneIncoming },
  { key: "missed", labelKey: "history.missed", icon: PhoneMissed },
];

/**
 * An incoming call that was ANSWERED (v2.99.98).
 *
 * This has exactly one available definition, and it is worth writing down why.
 * `call_history.status` is NEVER written as "answered": its only two writers are
 * `recordCallStart` (which writes "initiated") and `recordMissedCall` (which writes
 * "missed" or "declined"), there is no `update(callHistory)` anywhere in the server,
 * and nothing calls `calls.logStart` at all — so `answeredAt` is always NULL and
 * EVERY answered call, 1:1 included, exists only as a `conference_history` row.
 *
 * So: a conference row whose direction is inbound. The direction itself comes from
 * roster order, which is sound because the dial path seeds the roster with the CALLER
 * first and that insertion order survives into the stored JSON verbatim.
 */
function isReceivedItem(it: Item): boolean {
  return it.kind === "conf" && it.direction === "in";
}

/**
 * The key that groups a log by PERSON (v2.99.98).
 *
 * Identity first, number only as a fallback: grouping on the number would split one
 * person's calls in two the moment they renumber, because the number moves and the
 * identity does not. A roster entry we can no longer resolve has no identity, and its
 * number is then the best key available.
 *
 * A GROUP call gets its own key per room rather than being filed under one member —
 * a five-way call is not "a call with Ahmed", and putting it under him would make the
 * count beside his name wrong.
 */
export function historyPeerKey(it: Item): string {
  if (it.kind === "solo") {
    const o = it.call.other;
    if (o?.identityId != null) return `id:${o.identityId}`;
    return o?.number ? `num:${o.number}` : `solo:${it.call.id}`;
  }
  const k = conferenceRowKeys(it.conf);
  if (k.isGroup) return `room:${it.conf.roomId || it.conf.id}`;
  const peer = it.conf.participants.find((p) => !p.isSelf);
  if (peer?.identityId != null) return `id:${peer.identityId}`;
  return peer?.number ? `num:${peer.number}` : `conf:${it.conf.id}`;
}

/**
 * The name to put on a grouped row — the same name the individual rows show, so the
 * group header and the calls under it can never disagree about who this is.
 *
 * ── IT RETURNS A KEY BESIDE THE TEXT, AND THAT IS THE ONLY SHAPE THAT WORKS ──
 * This is a module-level function, so it cannot call a hook and cannot translate
 * anything itself. The two tempting alternatives are both wrong: returning finished
 * English leaves the row untranslatable, and mapping that English back to a key at the
 * render site is the `text → key` lookup the dictionary's own rule forbids — a copy
 * edit would silently drop the translation. So it returns `{ text, key, vars }`, the
 * same shape `peerPresenceLines` uses, and `text` is DERIVED from the key rather than written
 * twice so the two halves cannot come to disagree.
 *
 * `key` is NULL for a person's own NAME, which is data rather than copy and is the
 * same in every language.
 */
export function groupTitleOf(it: Item): {
  text: string;
  key: TKey | null;
  vars?: Record<string, string | number>;
} {
  const named = (text: string) => ({ text, key: null, vars: undefined });
  const phrase = (key: TKey, vars?: Record<string, string | number>) => ({
    text: translate("en", key, vars),
    key,
    vars,
  });
  if (it.kind === "solo") {
    const name = it.call.other?.displayName || it.call.other?.number;
    return name ? named(name) : phrase("history.unknown");
  }
  const c = it.conf;
  if (c.partyLine) {
    const title = c.partyLineTitle || translate("en", "history.lineNamed", { number: c.dialedNumber ?? "" }).trim();
    return phrase("history.partyLineNamed", { title });
  }
  const others = c.participants.filter((p) => !p.isSelf);
  if (others.length > 1) return phrase("history.groupOf", { count: others.length + 1 });
  const name = others[0]?.name || others[0]?.number || c.dialedNumber;
  return name ? named(name) : phrase("history.call");
}

/**
 * Which band a count falls in — see `dict/history.ts`'s header, and the shape
 * `guestExpiryKey` established. Arabic needs the DUAL at 2 (where the numeral vanishes
 * into the word) and different forms at 3-10 and 11+, so a whole key is picked per
 * band rather than a number being dropped into one sentence.
 *
 * EACH RETURNS LITERAL KEYS, never `` `history.callCount${band}` ``. A template literal
 * needs an `as TKey` cast, which switches the type checker OFF for precisely the strings
 * that have to match the dictionary; and the dead-key sweep looks for each key's TEXT in
 * the sources, so a composed key reads as having no reader and a whole family looks like
 * coverage nobody consumes. `guestExpiryKey` returns literals for the same two reasons.
 *
 * Exported where a test drives them: whether "1 calls" ever renders, or Arabic ever puts
 * a numeral where the dual belongs, is what a source pin cannot answer.
 */
export function callCountKey(n: number): TKey {
  if (n <= 1) return "history.callCountOne";
  if (n === 2) return "history.callCountTwo";
  return n <= 10 ? "history.callCountFew" : "history.callCountMany";
}
function missedCountKey(n: number): TKey {
  if (n <= 1) return "history.missedCountOne";
  if (n === 2) return "history.missedCountTwo";
  return n <= 10 ? "history.missedCountFew" : "history.missedCountMany";
}
export function loadedCountKey(n: number): TKey {
  if (n <= 1) return "history.loadedCountOne";
  if (n === 2) return "history.loadedCountTwo";
  return n <= 10 ? "history.loadedCountFew" : "history.loadedCountMany";
}
function inCallCountKey(n: number): TKey {
  if (n <= 1) return "history.inCallCountOne";
  if (n === 2) return "history.inCallCountTwo";
  return n <= 10 ? "history.inCallCountFew" : "history.inCallCountMany";
}

/** A person's calls, newest first, with the newest one standing for the group. */
export interface PeerGroup {
  key: string;
  items: Item[];
  /** The most recent call, which supplies the name, avatar and actions. */
  head: Item;
  /** How many calls in THIS LOG — never a lifetime total; see the note at the UI. */
  count: number;
  at: number;
  missed: number;
}

/**
 * Collapse a list into one entry per person.
 *
 * Pure and exported so the counting can be tested without a DOM — the owner's ask is
 * "it will say this user called you ten times", and a count that is wrong is worse
 * than no count.
 *
 * DELIBERATELY INDEPENDENT OF INPUT ORDER. The first cut relied on the caller passing
 * a newest-first list and took the first row it saw as the head; the mutation run then
 * showed the final sort could be deleted with no test noticing, because a sorted input
 * makes insertion order already correct. Rather than pin the precondition, the
 * precondition is gone: the head is chosen by COMPARING timestamps, so this is right
 * for any input and both the head choice and the ordering are load-bearing.
 */
export function groupByPeer(items: Item[]): PeerGroup[] {
  const byKey = new Map<string, PeerGroup>();
  for (const it of items) {
    const key = historyPeerKey(it);
    const g = byKey.get(key);
    if (g) {
      g.items.push(it);
      g.count += 1;
      if (isMissedItem(it)) g.missed += 1;
      if (it.at > g.at) {
        g.at = it.at;
        g.head = it;
      }
    } else {
      byKey.set(key, { key, items: [it], head: it, count: 1, at: it.at, missed: isMissedItem(it) ? 1 : 0 });
    }
  }
  // Each group's own calls newest-first, then the groups newest-first.
  // `Array.from` rather than iterating the Map directly: this project targets ES5, so
  // `for (const x of map.values())` is a TS2802 build error (the trap from v2.99.72).
  const out = Array.from(byKey.values());
  for (const g of out) g.items.sort((a, b) => b.at - a.at);
  return out.sort((a, b) => b.at - a.at);
}

/**
 * Which rows a tab shows — pure, so "Received never contains a missed call" is a fact
 * that can be tested rather than a line that can be read.
 */
export function filterItems(items: Item[], filter: Filter): Item[] {
  if (filter === "dialed") return items.filter((it) => it.direction === "out");
  if (filter === "received") return items.filter(isReceivedItem);
  if (filter === "missed") return items.filter(isMissedItem);
  return items;
}

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

/**
 * Every FIELD a History row can be matched on (v2.99.96) — a list, never one joined
 * string.
 *
 * Two real bugs came out of the old joined-haystack version. It stripped non-digits
 * from the WHOLE glued string before comparing, so a digit run spanning two fields
 * matched — a false positive. And it included the viewer's own roster entry, so
 * searching your own name matched every single conference row.
 *
 * `dialedNumber` is still searched, because somebody may genuinely remember the number
 * they dialled — but it is one field among many rather than a fallback for the peer.
 */
function searchFieldsOf(it: Item, savedNameOf?: (num: string) => string | undefined): Array<string | null | undefined> {
  if (it.kind === "solo") {
    const num = it.call.other?.number ?? "";
    return [it.call.other?.displayName, num, savedNameOf?.(num)];
  }
  const c = it.conf;
  const out: Array<string | null | undefined> = [c.dialedNumber, c.partyLineTitle];
  for (const p of c.participants) {
    // SELF EXCLUDED: your own name is on every row, so including it made every
    // conference row match a search for yourself.
    if (p.isSelf) continue;
    out.push(p.name, p.number, savedNameOf?.(p.number));
  }
  return out;
}

/** Bucket a call timestamp into a collapsible day-section {key,label}. Pure
 *  presentation — the underlying rows/handlers are untouched.
 *
 *  A module-level function cannot call a hook, so the two FIXED labels come back as
 *  dictionary keys and the render site translates them (the `FILTERS` shape). Older
 *  days keep a formatted DATE, which is not copy — it is `toLocaleDateString`, and
 *  making it follow the app's language rather than the browser's is the same
 *  locale-aware-date work `formatFullWhen` needs, so it is named as still-English
 *  rather than half-done here. */
function dayBucket(ts: number, now: number): { key: string; label: string; labelKey: TKey | null } {
  const d = new Date(ts);
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const n = new Date(now);
  const todayStart = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const DAY = 86_400_000;
  let label: string;
  let labelKey: TKey | null = null;
  if (startOfDay === todayStart) {
    labelKey = "history.today";
    label = translate("en", labelKey);
  } else if (startOfDay === todayStart - DAY) {
    labelKey = "history.yesterday";
    label = translate("en", labelKey);
  } else
    label = new Date(startOfDay).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  return { key: String(startOfDay), label, labelKey };
}

export default function HistoryPage() {
  const t = useT();
  const { me } = useIdentity();
  const engine = useRelayEngine();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  // ?filter=missed|dialed|all — every missed-call notification (landing toast,
  // Dialer banner, bell panel) deep-links straight into the Missed log here.
  const search = useSearch();
  const urlFilter = useMemo<Filter | null>(() => {
    const f = new URLSearchParams(search).get("filter");
    // "received" included (v2.99.98) so a deep link can land on it like the others.
    return f === "missed" || f === "dialed" || f === "received" || f === "all" ? (f as Filter) : null;
  }, [search]);
  const [filter, setFilter] = useState<Filter>(urlFilter ?? "all");
  /** Collapse repeated calls from the same person into one row (v2.99.98). */
  const [grouped, setGrouped] = useState(false);
  /** Which grouped rows have been opened to show the individual calls. */
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const toggleGroup = (key: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  useEffect(() => {
    if (urlFilter) setFilter(urlFilter);
  }, [urlFilter]);
  // Open (or create) a 1:1 thread with a number and jump straight into it.
  const openThread = trpc.messages.openThread.useMutation({
    onSuccess: (res) => setLocation(`/app/messages?c=${res.conversationId}`),
    // A silently-failed tap is the worst case (v2.88) — say why nothing opened.
    onError: (err) => toast.error(err.message || t("history.openFailed")),
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

  /* ── #117 — REACHING PAST THE NEWEST PAGE ────────────────────────────────
     Both payloads are capped at 100 rows, so search and per-person grouping could
     only ever see the most recent 100 calls (flagged in v2.99.96 and v2.99.98).

     THE POLLED QUERIES ABOVE ARE UNTOUCHED, and that is the design. They refetch
     every 30s for every open History tab, so raising their page size would multiply
     that traffic for everybody to serve a search almost nobody runs — the same trade
     v2.102.2 refused for the thread list's aggregate. Older pages are fetched only
     when asked for, and then KEPT: they are held here rather than in the query cache
     precisely so the 30s poll never re-fetches them. Paging is therefore O(1) on the
     polling cost no matter how far back somebody has gone. */
  const [olderCalls, setOlderCalls] = useState<CallRow[][]>([]);
  const [olderConfs, setOlderConfs] = useState<ConfRow[][]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Both windows are reset when the log is cleared or the identity changes — a kept
  // page would otherwise survive a "Clear history" and reappear under it.
  useEffect(() => {
    setOlderCalls([]);
    setOlderConfs([]);
  }, [me?.id]);

  const callRows = useMemo(
    () => mergeHistoryPages<CallRow>(oneToOne.data ?? [], olderCalls),
    [oneToOne.data, olderCalls],
  );
  const confRows = useMemo(
    () => mergeHistoryPages<ConfRow>(conferences.data ?? [], olderConfs),
    [conferences.data, olderConfs],
  );
  /* More to load when EITHER newest page came back full. Derived rather than
     server-reported: both procedures return a bare ARRAY, and switching them to
     `{rows, hasMore}` would break every client mid-rolling-deploy (an older bundle
     gets an object where it expects an array and renders an empty log). */
  const mayHaveOlder =
    pageLooksFull(oneToOne.data, HISTORY_PAGE) ||
    pageLooksFull(conferences.data, HISTORY_PAGE) ||
    olderCalls.some((p) => p.length >= HISTORY_PAGE) ||
    olderConfs.some((p) => p.length >= HISTORY_PAGE);

  async function loadOlder() {
    if (loadingOlder) return;
    setLoadingOlder(true);
    try {
      // Each side pages on ITS OWN cursor: the two logs are different tables with
      // unrelated ids, so one shared cursor would skip rows in whichever is denser.
      const [calls, confs] = await Promise.all([
        utils.calls.history.fetch({ before: oldestCursor(callRows) ?? undefined }),
        utils.calls.conferenceHistory.fetch({ before: oldestCursor(confRows) ?? undefined }),
      ]);
      if (calls.length) setOlderCalls((p) => [...p, calls as CallRow[]]);
      if (confs.length) setOlderConfs((p) => [...p, confs as ConfRow[]]);
      if (!calls.length && !confs.length) toast.info(t("history.thatsAll"));
    } catch {
      // A silently-failed tap is the worst case (v2.88) — say why nothing loaded.
      toast.error(t("history.loadOlderFailed"));
    } finally {
      setLoadingOlder(false);
    }
  }

  // "Clear History": per-user soft clear on the server (the other parties keep
  // their own logs), then refresh everything the log feeds.
  const clearHistory = trpc.calls.clearHistory.useMutation({
    onSuccess: () => {
      /* #117 — DROP THE KEPT OLDER PAGES TOO. They live in component state precisely
         so the 30s poll never re-fetches them, which also means invalidating the
         queries cannot reach them: without this, "Clear history" would empty the newest
         page and leave every older page on screen underneath it. */
      setOlderCalls([]);
      setOlderConfs([]);
      utils.calls.history.invalidate();
      utils.calls.conferenceHistory.invalidate();
      utils.calls.missedSummary.invalidate();
    },
    onError: () => toast.error(t("history.clearFailed")),
  });
  // AlertDialog confirm (v2.88 — native confirm() is gone app-wide).
  const [confirmClear, setConfirmClear] = useState(false);

  /* #117 — built from the MERGED windows, not the raw queries. That one change is what
     makes search, the filter counts and per-person grouping reach as far back as the
     reader has loaded, because all three are derived from `items`. */
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const c of confRows) {
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
    for (const c of callRows) {
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
  }, [confRows, callRows]);

  const counts = useMemo(
    () => ({
      all: items.length,
      dialed: items.filter((it) => it.direction === "out").length,
      received: items.filter(isReceivedItem).length,
      missed: items.filter(isMissedItem).length,
    }),
    [items]
  );

  // One-tap contact conversion (v2.96): which history peers are ALREADY saved
  // (hides the + button), and the add mutation itself.
  //
  // Declared HERE rather than further down (v2.99.96) because the search filter
  // below needs the saved names: a call from somebody saved as "Dad" was findable in
  // Contacts and not in History, since History only ever knew their real name.
  const contactsQ = trpc.contacts.list.useQuery(undefined, {
    enabled: !!me,
    staleTime: 30_000,
  });
  const savedNumbers = useMemo(
    () => new Set((contactsQ.data ?? []).map((c) => c.number)),
    [contactsQ.data]
  );
  const savedNameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contactsQ.data ?? []) if (c.displayName) m.set(c.number, c.displayName);
    return (num: string) => m.get(num);
  }, [contactsQ.data]);

  // Search across the log by contact name / number / PIN (v2.95). Local filter
  // over the already-loaded items — instant, no new request.
  const [historySearch, setHistorySearch] = useState("");
  const visible = useMemo(() => {
    let v = filterItems(items, filter);
    if (historySearch.trim()) {
      v = v.filter((it) => matchQuery(historySearch, searchFieldsOf(it, savedNameOf)));
    }
    return v;
  }, [items, filter, historySearch, savedNameOf]);

  // Group the (already filtered + newest-first) rows into collapsible day
  // sections. Purely presentational: the item objects — and every prop the row
  // components receive — are the exact same references as before.
  const sections = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, { key: string; label: string; labelKey: TKey | null; items: Item[] }>();
    for (const it of visible) {
      const { key, label, labelKey } = dayBucket(it.at, now);
      let sec = map.get(key);
      if (!sec) {
        sec = { key, label, labelKey, items: [] };
        map.set(key, sec);
      }
      sec.items.push(it);
    }
    return Array.from(map.values());
  }, [visible]);

  /** One row per person, newest first — only computed when grouping is on. */
  const peerGroups = useMemo(() => (grouped ? groupByPeer(visible) : []), [grouped, visible]);
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
      toast.success(t("history.watchSet", { name: res.displayName || res.number })),
    onError: (err) => toast.error(err.message || t("history.watchFailed")),
  });
  const watch = (num: string) => {
    if (num) watchOnline.mutate({ number: num });
  };

  const addContact = trpc.contacts.upsert.useMutation({
    onSuccess: () => {
      utils.contacts.list.invalidate();
      toast.success(t("history.added"));
    },
    onError: (err) => toast.error(err.message || t("history.addFailed")),
  });
  const quickAdd = (num: string, name: string) => {
    if (num) addContact.mutate({ number: num, displayName: name || undefined });
  };

  // Live reachability per number (ONE batched query, refreshed with the log):
  // a green/grey LED on each row tells the user BEFORE they redial whether the
  // other side is even reachable — dialing someone offline pages their phone.
  const presenceNumbers = useMemo(() => {
    const set = new Set<string>();
    // Never ask for our OWN presence (v2.99.95). We are online by definition
    // while looking at this screen, so a self entry can only ever come back
    // green — and that green then has to be attached to somebody, which is
    // exactly the bug below. It would also make `inCallSet` probe
    // `directory.liveRoom` for our own number.
    const self = me?.number ?? "";
    const add = (n: string | null | undefined) => {
      if (n && n !== self && /^\d{6}$/.test(n)) set.add(n);
    };
    for (const it of items) {
      if (it.kind === "solo") {
        add(it.call.other?.number);
      } else {
        // The roster is the ONLY source of a peer's number here. `dialedNumber`
        // is deliberately NOT added: for an OUTGOING call it is already in the
        // roster, and for an INCOMING one it is the viewer's own number (the
        // caller seeds it, and there is one shared conference_history row per
        // room) — so adding it bought nothing and cost the bug fixed below.
        for (const p of it.conf.participants) {
          if (!p.isSelf) add(p.number);
        }
      }
      if (set.size >= 100) break; // server caps the batch at 100
    }
    return Array.from(set).slice(0, 100).sort();
  }, [items, me?.number]);
  const presence = trpc.directory.presenceMany.useQuery(
    { numbers: presenceNumbers },
    { enabled: !!me && presenceNumbers.length > 0, refetchInterval: 30_000, refetchIntervalInBackground: false }
  );
  const onlineSet = useMemo(
    () => new Set((presence.data ?? []).filter((p) => p.isOnline).map((p) => p.number)),
    [presence.data]
  );
  // Backgrounded-but-signed-in (v2.99.92). `presenceMany` has carried `idle`
  // since then and this screen threw it away, so a minimised person read as
  // full-strength green here while Contacts said "away" — one person, two
  // answers, which is the class of divergence `presenceDot` exists to end.
  const idleSet = useMemo(
    () => new Set((presence.data ?? []).filter((p) => p.idle).map((p) => p.number)),
    [presence.data]
  );
  // Busy line (v2.88): numbers that are in a live call right now (amber LED).
  const inCallSet = useMemo(
    () => new Set((presence.data ?? []).filter((p) => p.inCall).map((p) => p.number)),
    [presence.data]
  );
  /**
   * ONE lookup handed to the rows, so a row derives its own key from its own
   * data instead of the call site guessing which number to ask about — which is
   * how an incoming call ended up rendering the VIEWER'S presence on the
   * caller's face. `undefined` means "not loaded yet": the LED draws nothing
   * rather than claiming offline.
   */
  const presenceOf = useMemo(() => {
    if (!presence.data) return undefined;
    return (num: string | null | undefined) => {
      const n = num ?? "";
      if (!n) return undefined;
      return { isOnline: onlineSet.has(n), idle: idleSet.has(n), inCall: inCallSet.has(n) };
    };
  }, [presence.data, onlineSet, idleSet, inCallSet]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 min-h-0 flex-col px-4 pb-3 pt-4 md:pb-6">
      <header className="mb-3 flex items-center gap-2">
        <Clock className="size-5 text-primary" />
        <h1 className="text-lg font-semibold tracking-tight">{t("history.title")}</h1>
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
          {/* `start-3` is LOGICAL so the glyph moves to the field's leading edge in
              Arabic, and the field's `ps-9` moves with it — the padding exists to
              reserve room for THIS icon, so the two have to flip together or the
              glyph lands on top of the text. `top-1/2 -translate-y-1/2` is VERTICAL
              centring and is direction-independent, so it stays exactly as it is. */}
          <Search className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={historySearch}
            onChange={(e) => setHistorySearch(e.target.value)}
            placeholder={t("history.search")}
            aria-label={t("history.searchLabel")}
            className="h-9 w-full rounded-lg border border-border/60 bg-muted/40 ps-9 pe-3 text-sm outline-none focus:border-primary/50"
          />
        </div>
      )}
      {/* Filter bar: All / Dialed / Missed segmented control + Clear History
          on the right. Sits ABOVE the scrolling list, so it (and the bottom
          tab bar below the page) stay put while the log scrolls. */}
      <div className="mb-3 flex flex-col gap-2">
        <div
          role="tablist"
          aria-label={t("history.filter")}
          className="flex gap-1 rounded-xl bg-muted/50 p-1"
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
                  // STACKED, and measured rather than guessed: side by side, an 87px
                  // tab at 390px leaves the label ~39px and "Received" needs ~58, so
                  // every label but "All" was clipped at every phone width. On two
                  // lines the icon and count share the top and the label gets the
                  // tab's full width.
                  "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[11px] font-semibold transition-colors " +
                  "outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] " +
                  /* Board 1b: the selected filter chip is the accent, not a neutral
                     raised tile — the same "you are here" language as the tab bar's
                     pill, so one idea of selection covers the whole app. */
                  (active
                    ? "rchip-accent shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                <span className="flex items-center gap-1">
                <Icon
                  className={
                    "size-3.5 shrink-0 " +
                    (f.key === "missed"
                      ? active ? "text-red-500" : ""
                      : f.key === "dialed"
                        ? active ? "text-green-500" : ""
                        : f.key === "received"
                          ? active ? "text-blue-500" : ""
                          : "")
                  }
                />
                {n > 0 && (
                  <span
                    className={
                      "min-w-4 shrink-0 rounded-full px-1 text-[10px] font-bold leading-4 " +
                      (f.key === "missed"
                        ? "bg-red-500/15 text-red-500"
                        : "bg-muted text-muted-foreground")
                    }
                  >
                    {n > 99 ? "99+" : n}
                  </span>
                )}
                </span>
                <span className="max-w-full truncate">{t(f.labelKey)}</span>
              </button>
            );
          })}
        </div>

        {/* Row 2 — the MODIFIER and the destructive action, apart from the filters.
            v2.99.98 put Group inside the tab strip, and on a phone that was the bug the
            owner reported: four filters (icon + label + count) plus a fifth control need
            about 500px and a phone has ~390, so with `flex-1` and no `min-w-0` the labels
            collided and the row was unreadable. Measured, not guessed — see
            client/src/pages/app/historyFilterFit.test.ts.

            Splitting it is also the better hierarchy: the filters are ONE choice (which
            calls), while grouping is a modifier that composes with whichever is chosen. */}
        <div className="flex items-center gap-2">
          {/* v2.99.98 (owner): "there is something called grouping. Grouping means
              grouping, if a person who called you several time, it will group his
              number of notification into one."

              It sits in the tab row where the owner expects it, but it is a TOGGLE
              (aria-pressed) rather than a fifth exclusive tab — grouping is
              orthogonal to filtering, so this way you can group inside Missed or
              Received as well, which an exclusive tab could not do. A "Grouping tab"
              would also have meant the same rows as All, just stacked. */}
          <button
            type="button"
            aria-pressed={grouped}
            onClick={() => setGrouped((g) => !g)}
            title={
              grouped
                ? t("history.groupOn")
                : t("history.groupOff")
            }
            className={
              "flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors " +
              "outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] " +
              (grouped
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            <Layers className={"size-3.5 " + (grouped ? "text-violet-400" : "")} />
            {t("history.group")}
          </button>
          <span className="flex-1" />
          <Button
            size="icon"
            variant="ghost"
            aria-label={t("history.clear")}
            title={t("history.clearHint")}
            disabled={clearHistory.isPending || items.length === 0}
            onClick={() => setConfirmClear(true)}
            className="size-9 shrink-0 rounded-lg text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
          >
            <Trash2 className="size-[18px]" />
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmClear} onOpenChange={(open) => !open && setConfirmClear(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("history.clearTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("history.clearBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              destructive
              onClick={() => {
                setConfirmClear(false);
                clearHistory.mutate();
              }}
            >
              {t("history.clear")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl glass-surface-md shadow-xl shadow-black/10">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {errored ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              <p>{t("history.loadFailed")}</p>
              <button
                type="button"
                onClick={() => { void conferences.refetch(); void oneToOne.refetch(); }}
                className="mt-3 inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-foreground hover:bg-muted/50"
              >
                {t("common.retry")}
              </button>
            </div>
          ) : loading ? (
            <ListLoading label={t("history.loading")} />
          ) : visible.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {historySearch.trim()
                ? t("history.noMatches", { query: historySearch.trim() })
                : filter === "missed"
                  ? t("history.noneMissed")
                  : filter === "dialed"
                    ? t("history.noneDialed")
                    : filter === "received"
                      ? t("history.noneReceived")
                      : t("history.none")}
            </div>
          ) : grouped ? (
            /* GROUPED: one row per person, newest first, tap to expand.
               The count says "in this log" and not a lifetime total, and that
               wording is load-bearing: both call payloads are hard-capped at 100
               rows server-side, so a lifetime figure would be a number we cannot
               actually know. Claiming one would be worse than being specific. */
            <div>
              {peerGroups.map((g) => {
                const isOpen = openGroups.has(g.key);
                return (
                  <section key={g.key}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.key)}
                      aria-expanded={isOpen}
                      className="w-full flex items-center gap-2 border-b-2 border-border px-4 py-3 text-start transition-colors hover:bg-muted/30"
                    >
                      {isOpen ? (
                        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2.4} />
                      ) : (
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2.4} />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-bold text-foreground" dir="auto">
                          {/* A person's NAME is data and comes back with no key; every
                              other title is a phrase and comes back as one. */}
                          {(() => {
                            const gt = groupTitleOf(g.head);
                            return gt.key ? t(gt.key, gt.vars) : gt.text;
                          })()}
                        </span>
                        <span className="block text-[12.5px] text-muted-foreground">
                          {/* A WHOLE KEY PER BAND, never "1 call" + an "s". English needs
                              one/other; Arabic needs the dual at 2 and two more forms
                              above it, which no suffix can express. */}
                          {t(callCountKey(g.count), { count: g.count })}
                          {g.missed > 0 && (
                            <span className="text-red-600 dark:text-red-400">
                              {" · "}
                              {t(missedCountKey(g.missed), { count: g.missed })}
                            </span>
                          )}
                          {" · "}
                          {formatFullWhen(new Date(g.at))}
                        </span>
                      </span>
                    </button>
                    {isOpen && (
                      <ul className="bg-muted/20">
                        {g.items.map((it) =>
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
                              presenceOf={presenceOf}
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
                              presenceOf={presenceOf}
                            />
                          )
                        )}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          ) : (
            <div>
              {sections.map((sec) => {
                // v2.99.96: a COLLAPSED day section used to swallow search
                // matches — filtered in, counted in the header, never rendered. A
                // query forces every day open.
                const isCollapsed = !historySearch.trim() && collapsed.has(sec.key);
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
                      {/* Board 1b: "day headers (mono, .26em)" — the wide mono tracking
                          is what makes a day read as a divider rather than as a row. */}
                      <span
                        className="flex-1 text-start font-mono text-[10px] font-bold uppercase"
                        style={{ letterSpacing: ".26em" }}
                      >
                        {sec.labelKey ? t(sec.labelKey) : sec.label}
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
                              presenceOf={presenceOf}
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
                              presenceOf={presenceOf}
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
          {/* #117 — LOAD OLDER CALLS.
              The affordance that makes search and grouping reach past the newest page.
              Rendered only when there may BE more (the newest page came back full), so
              a short log never shows a control that would do nothing — the v2.103.3
              rule: a button that looks live and always refuses is worse than one that
              is not there.
              It sits below BOTH list branches, outside the grouped/flat conditional, so
              paging works the same whichever view is open. */}
          {mayHaveOlder && visible.length > 0 && (
            <div className="px-4 py-5 text-center">
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted/50 disabled:opacity-60"
              >
                {loadingOlder ? t("history.loadingOlder") : t("history.loadOlder")}
              </button>
              {/* Say what the reach currently IS, so the counts above are read for what
                  they are — a figure over what is loaded, not a lifetime total. */}
              <div className="mt-2 text-[11px] text-muted-foreground">
                {t(loadedCountKey(items.length), { count: items.length })}
              </div>
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

/**
 * The reachability LED pinned to a row's icon bubble.
 *
 * v2.99.95: this drew its own three-way ternary and knew nothing about `idle`, so a
 * backgrounded person read as full-strength green here while Contacts said "away" —
 * one person, two answers. It now defers to `presenceDot`, the single rule every dot
 * in the app shares, rather than becoming a fourth inline copy of it (v2.99.77 was
 * exactly that bug).
 *
 * A missing verdict renders NOTHING — no flicker and no wrong claim — which is why
 * the prop is the whole snapshot rather than a boolean that has to default somehow.
 */
/** History's own tooltip per presence state — exhaustive over the union, so adding a
 *  fifth state is a compile error here rather than a row that silently reads
 *  "Offline". */
const HISTORY_PRESENCE_TITLE: Record<PresenceDotState, TKey> = {
  inCall: "history.presence.onCall",
  online: "history.presence.online",
  away: "history.presence.away",
  offline: "history.presence.offline",
};

function PresenceLed({ p }: { p: PresenceSnapshot | undefined }) {
  const t = useT();
  if (!p) return null;
  const dot = presenceDot(p);
  return (
    <span
      aria-label={t(dot.labelKey)}
      /* SWITCHED ON THE STATE, NEVER ON THE ENGLISH LABEL. This used to compare
         `dot.label` against "On a call" / "Online" / "Away" — which worked only for
         as long as nobody edited those four words, and would have fallen silently
         through to the "offline" branch the moment somebody did, with every test
         still green. The tooltips are History's OWN wording (they name the
         CONSEQUENCE — "calling will page their phone" — rather than the state), so
         the mapping stays here; what moved is what it keys on. */
      title={t(HISTORY_PRESENCE_TITLE[dot.state])}
      // `-end-0.5` so the LED sits on the disc's TRAILING corner in both
      // directions — the same logical edge GroupInfoSheet and GroupCallScreen use
      // for the identical affordance. It must flip together with DirectionBadge's
      // `-start-1` below: the two share one avatar and are on OPPOSITE corners on
      // purpose, so mirroring one alone would stack them in Arabic. `-bottom-0.5`
      // is vertical and direction-independent.
      className="absolute -end-0.5 -bottom-0.5 size-3 rounded-full border-2 border-background"
      style={{ background: dot.color, boxShadow: dot.glow || undefined }}
    />
  );
}

/** The small corner disc that overlaps an avatar's LEADING lower corner, showing
 *  call direction: an up-right arrow (out) or down-left arrow (in/missed), tinted
 *  with the row's tone.
 *
 *  `-start-1` is logical, and it is paired with PresenceLed's `-end-0.5`: both
 *  badges hang off the SAME avatar on opposite corners so they never overlap, so
 *  they have to mirror together — flipping one alone would stack them in Arabic.
 *  The ARROW GLYPHS themselves are deliberately NOT mirrored: they encode
 *  incoming-vs-outgoing rather than reading order, and `TONE`/`DirectionBadge`
 *  pair them with a colour that means the same thing in both directions. */
function DirectionBadge({ direction, toneName }: { direction: "in" | "out"; toneName: string }) {
  return (
    <span className="absolute -bottom-1 -start-1 grid size-[18px] place-items-center rounded-full bg-background">
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
  presenceOf,
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
  presenceOf: PresenceLookup;
}) {
  const t = useT();
  const others = conf.participants.filter((p) => !p.isSelf);
  // The peer key, the call-back target and the group verdict all come from ONE
  // pure rule (see conferenceRowKeys) so this row cannot disagree with itself.
  const { peerNumber, callBack, isGroup, otherNumbers } = conferenceRowKeys(conf);
  const tone = direction === "out" ? TONE.out : TONE.in;
  // Title = the party line's name (v2.89) when this room WAS a line, else the
  // other people on the call (or the dialed number as a fallback).
  const title = conf.partyLine
    ? t("history.partyLineNamed", {
        title: conf.partyLineTitle || t("history.lineNamed", { number: conf.dialedNumber ?? "" }).trim(),
      })
    : others.length > 0
      ? others.map((p) => p.name).join(", ")
      : conf.dialedNumber
        ? t("history.callTo", { number: conf.dialedNumber })
        : t("history.call");
  /**
   * A group row draws NO presence LED. The disc it would sit on is a generic
   * `Users` glyph standing for N people, and N people do not have one presence —
   * picking an arbitrary member's and showing it as the group's is a guess
   * presented as a fact. Grey would be equally wrong, so it is simply absent.
   */
  const rowPresence = isGroup ? undefined : presenceOf?.(peerNumber);
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
      /* One whole key per direction rather than the direction word substituted into a
         shared sentence: nesting a translated word inside another translated sentence
         is the seam that stops Arabic ordering either of them freely. */
      aria-label={t(direction === "out" ? "history.confRowOut" : "history.confRowIn", {
        title,
        duration: formatDuration(conf.durationSec),
      })}
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
            <PresenceLed p={rowPresence} />
          </PeerAvatar>
        )}
        <div className="min-w-0 flex-1 basis-48">
          {!isGroup && peer?.number ? (
            <button
              type="button"
              onClick={() => openPeerProfile(peer.number)}
              className="flex max-w-full items-baseline text-start text-[15px] font-bold text-foreground outline-none focus-visible:underline"
              aria-label={t("peer.viewNamedProfile", { name: peer.name })}
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
                direction, then direction, then the duration, then the media type.
                #116: `conference_history.channel` now records how the call was
                DIALLED, so this no longer has to guess — and a row from before that
                column existed carries NULL and prints nothing rather than a
                confident "Voice" nobody recorded. */}
            {isGroup ? (
              <>
                <span className="font-semibold text-foreground">
                  <Users className="me-0.5 inline size-3 align-[-1px]" />
                  {t("history.groupOf", { count: conf.partyCount })}
                </span>
                {" · "}
              </>
            ) : null}
            <span className={"font-semibold " + tone.label}>
              {t(direction === "out" ? "history.outgoing" : "history.incoming")}
            </span>
            {" "}· {formatDuration(conf.durationSec)}
            {/* #116 — nothing at all when the channel was never recorded. */}
            {conf.channel === "voice" ? ` · ${t("history.voice")}` : conf.channel === "video" ? ` · ${t("history.video")}` : ""}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground/80">
            {formatFullWhen(conf.startedAt)}
          </div>
        </div>
        {/* `ms-auto` pins the action cluster to the row's TRAILING edge in both
            directions — physical `ml-auto` would have shoved it to the middle-left
            of an Arabic row, away from the thumb. */}
        <div className="ms-auto flex items-center gap-1.5">
          {/* Not saved yet → one-tap add-to-contacts (v2.96, 1:1 only). */}
          {!isGroup && !saved && onAddContact && peer?.number ? (
            <RoundAction
              rgb="167,139,250"
              accent="#a78bfa"
              label={t("history.addToContacts")}
              title={t("history.addToContacts")}
              onClick={() => onAddContact(peer.number, peer.name ?? "")}
            >
              <UserPlus className="size-4" />
            </RoundAction>
          ) : null}
          <RoundAction
            rgb="251,146,60"
            accent="#fb923c"
            label={t("history.message")}
            title={t("history.message")}
            disabled={!callBack}
            onClick={() => onMessage(callBack)}
          >
            <MessageSquare className="size-4" />
          </RoundAction>
          {!isGroup && (
            <RoundAction
              rgb="56,189,248"
              accent="#38bdf8"
              label={t("history.videoCall")}
              title={t("history.videoCall")}
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
            label={isGroup ? t("history.callGroupBack") : t("history.callBack")}
            title={isGroup ? t("history.callEveryoneBack") : t("history.callBack")}
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
          is gone entirely there.

          `ps-12` indents the roster past the avatar disc above it, so it has to follow
          the avatar to the trailing side in Arabic rather than staying left and hanging
          under nothing. */}
      {isGroup && others.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5 ps-12">
          {others.map((p) => (
            <li
              key={p.number || p.name}
              className="inline-flex items-baseline gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
              aria-label={p.number ? `${p.name} (${p.number})` : p.name}
            >
              <span className="max-w-[10rem] truncate" dir="auto">{p.name}</span>
              <RoleBadge role={p.role ?? null} size={11} className="self-center" />
              {/* Same token as PinTag above, for the same measured reason — this one
                  inherits the chip's 11px, i.e. smaller still.
                  The comment sits ABOVE the ternary rather than inside it: after `?` the
                  parser wants ONE expression and reads a braced JSX comment there as an
                  object literal, which is the exact parse error v2.106.93 recorded in
                  this same file. (And a JSX comment may not itself contain the closing
                  block-comment sequence — writing one out here is what broke the second
                  attempt.) */}
              {p.number ? (
                <span
                  dir="ltr"
                  className="font-mono font-bold text-[color:var(--relay-green-text)] [unicode-bidi:isolate]"
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
  presenceOf,
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
  presenceOf: PresenceLookup;
}) {
  const t = useT();
  const missedIn = call.direction === "in";
  const tone = missedIn ? TONE.missed : TONE.out;
  const peerNum = call.other?.number ?? "";
  // A solo row has exactly one peer and the server resolves it by identityId, so
  // there is no ambiguity here — but it goes through the same lookup as every
  // other row so the rule for "which number is this row about" lives in one place.
  const rowPresence = presenceOf?.(peerNum);
  const peerName = call.other?.displayName ?? peerNum ?? t("history.unknown");
  const label = missedIn
    ? call.status === "declined" ? t("history.declined") : t("history.missedCall")
    : call.status === "declined"
      ? t("history.declinedByThem")
      : call.status === "failed"
        ? t("history.failed")
        : t("history.noAnswer");

  return (
    <li
      className="border-b-2 border-border px-4 py-3.5 last:border-b-0 transition-colors hover:bg-muted/30"
      /* Punctuation around two values that are already localised where they are
         produced — no words of its own, so no dictionary entry. */
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
          <PresenceLed p={rowPresence} />
        </PeerAvatar>
        <div className="min-w-0 flex-1 basis-48">
          <button
            type="button"
            onClick={() => peerNum && openPeerProfile(peerNum)}
            className={
              "flex max-w-full items-baseline text-start text-[15px] font-bold outline-none focus-visible:underline " +
              (missedIn ? tone.name : "text-foreground")
            }
            aria-label={t("peer.viewNamedProfile", { name: peerName })}
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
            {call.channel === "voice" ? ` · ${t("history.voice")}` : call.channel === "video" ? ` · ${t("history.video")}` : ""}
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
        {/* `ms-auto` pins the action cluster to the row's TRAILING edge in both
            directions — physical `ml-auto` would have shoved it to the middle-left
            of an Arabic row, away from the thumb. */}
        <div className="ms-auto flex items-center gap-1.5">
          {/* Not saved yet → one-tap add-to-contacts (v2.96). */}
          {!saved && onAddContact && peerNum ? (
            <RoundAction
              rgb="167,139,250"
              accent="#a78bfa"
              label={t("history.addToContacts")}
              title={t("history.addToContacts")}
              onClick={() => onAddContact(peerNum, call.other?.displayName ?? "")}
            >
              <UserPlus className="size-4" />
            </RoundAction>
          ) : null}
          {/* Offline peer → offer the v2.88 call-back alert right on the row. */}
          {rowPresence && !rowPresence.isOnline && onWatch && peerNum ? (
            <RoundAction
              rgb="82,227,208"
              accent="#52e3d0"
              label={t("history.alertWhenBack")}
              title={t("history.alertWhenBack")}
              onClick={() => onWatch(peerNum)}
            >
              <Bell className="size-4" />
            </RoundAction>
          ) : null}
          <RoundAction
            rgb="251,146,60"
            accent="#fb923c"
            label={t("history.message")}
            title={t("history.message")}
            disabled={!peerNum}
            onClick={() => onMessage(peerNum)}
          >
            <MessageSquare className="size-4" />
          </RoundAction>
          <RoundAction
            rgb="56,189,248"
            accent="#38bdf8"
            label={t("history.videoCall")}
            title={t("history.videoCall")}
            disabled={!peerNum}
            onClick={() => onVideo(peerNum)}
          >
            <Video className="size-4" />
          </RoundAction>
          <RoundAction
            rgb="34,197,94"
            accent="#22c55e"
            strong
            label={t("history.callBack")}
            title={t("history.callBack")}
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
 * Live-call rejoin card — board frame 5b (v2.99.9; rebuilt to the frame).
 *
 * For a number currently in a call that the viewer was part of,
 * `directory.liveRoom` returns the live roster + host (or null — for a
 * stranger's call, an ended call, or a non-signaling instance). Tapping Join
 * asks the host to let you back in (a knock); the engine surfaces the host's
 * approval and, once granted, drops you into the live call.
 *
 * ── THE CARD WAS PAINTED IN THE PRESENCE GREEN, WHICH IS THE ONE THING GREEN
 *    MAY NOT MEAN ──
 * The surface, the disc and the Join button all read `--relay-online`. That hue
 * means ONLINE and nothing else — it is what every presence LED in the app is
 * drawn with, which is why v2.99.86 moved DND off it, v2.106.9 the speaking
 * tile, v2.106.11 the push banner, v2.106.18 the voice waveform and v2.106.42
 * the pinned-thread marker. "A call is live" is an ACTIVITY and Join is a CTA,
 * and the board says so in as many words ("Green means ONLINE, and nothing
 * else… that's what the accent is for"). So the whole card moves to the accent,
 * which is also what frame 5b draws.
 *
 * `--primary` rather than a raw `var(--rb)`: v2.106.4 repointed `--primary` at
 * the cycling accent inside `.dark.relay-v2` precisely so accent UI follows the
 * hue in dark while light keeps a measured value — the raw variable as TEXT
 * measures ~1.7:1 on a light card and fails AA. The solid Join fill is `.rcta`,
 * the shared primary-CTA recipe, which carries the board's `#04211a` on-accent
 * text (legible across all twelve hues, where white fails on the yellow and
 * lime entries) and the accent glow.
 *
 * ── THE DISC FOLLOWS THIS SCREEN'S OWN GROUP/PERSON LANGUAGE ──
 * The frame draws a squircle for the room and a circle for a person, which is
 * already the distinction every row here makes. A room with more than one other
 * person in it gets the violet `Users` squircle a group conference row uses;
 * borrowing one member's photo for a multi-party room would be the same guess
 * v2.99.77 forbids for a group row's presence LED — N people do not have one
 * face any more than they have one presence. With exactly one person in the
 * room, `number` provably IS that person, so they get their real photo, story
 * ring and profile tap like every other 1:1 row.
 *
 * `liveRoom` returns names and a host and DELIBERATELY no pins and no avatars
 * (the router says why: the caller was in this call, but we still don't hand
 * back a machine-dialable roster). So the group disc has no initials to draw —
 * the glyph is the honest mark, not a placeholder.
 */
function LiveRejoinCard({ number }: { number: string }) {
  const t = useT();
  const engine = useRelayEngine();
  const q = trpc.directory.liveRoom.useQuery(
    { number },
    { refetchInterval: 15_000, refetchOnWindowFocus: true },
  );
  const info = q.data;
  if (!info) return null;
  const names = info.members.map((m) => m.name).filter(Boolean);
  /* The viewer is NEVER counted here: `liveRoomInfo` refuses to advertise a room
     the requester is already an active member of, so `count` is other people. */
  const isGroup = info.count > 1;
  /* The room's identity is the people in it. The count is NOT a fallback title —
     it already renders on the line below, and printing it twice would be the
     card telling you the same number in two type sizes; `history.call` is this
     file's established title fallback (a conference row uses it too). */
  const title =
    names.length === 0
      ? t("history.call")
      : names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
  return (
    <div className="mb-2.5 flex items-center gap-3 rounded-2xl border border-primary/40 bg-primary/5 p-3">
      {isGroup ? (
        <span
          className="grid size-10 shrink-0 place-items-center rounded-xl"
          style={{
            background: "linear-gradient(160deg, rgba(167,139,250,.24), rgba(167,139,250,.07))",
            color: "#a78bfa",
          }}
        >
          <Users className="size-[18px]" />
        </span>
      ) : (
        <PeerAvatar number={number} name={names[0]} avatarUrl={null} size={40} fallbackClassName="text-sm" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-bold text-foreground" dir="auto">
          {title}
        </div>
        {/* One sub-line, in the frame's own order: the live pip, then what is
            happening, then who is hosting. `flex-wrap` rather than a second row,
            so a long host name reflows instead of squeezing the run that says
            the call is live down to nothing on a 320px phone. */}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {/* Decorative: the words beside it already say the call is live, so a
              screen reader must not hear it twice. Opacity-only and behind
              `motion-safe`, because a repainting animation on the app's densest
              scrolling screen is the cost class v2.99.84 measured out. */}
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-primary motion-safe:animate-pulse"
          />
          <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-primary">
            {t("history.liveNow")} · {t(inCallCountKey(info.count), { count: info.count })}
          </span>
          {info.hostName ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground" dir="auto">
              · {t("history.hostedBy", { name: info.hostName })}
            </span>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          engine.knock(number);
          toast(t("history.knocked"));
        }}
        className="rcta shrink-0 rounded-xl px-4 py-2 text-xs font-bold transition-transform active:scale-95"
      >
        {t("history.join")}
      </button>
    </div>
  );
}
