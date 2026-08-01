import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type CSSProperties, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { useRelayEngine } from "@/app/RelayEngine";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Send,
  Smile,
  Paperclip,
  Plus,
  Mic,
  Image as ImageIcon,
  Phone,
  PhoneCall,
  Video,
  Search,
  MessageSquare,
  MessageSquarePlus,
  X,
  StickyNote,
  Users,
  UserPlus,
  Trash2,
  EyeOff,
  Pin,
  PinOff,
  MailOpen,
  Archive,
  ArchiveRestore,
  Reply,
  SmilePlus,
  Bell,
  BellOff,
  MoreVertical,
  Copy,
  Play,
  Pause,
  Download,
  Timer,
  ChevronDown,
  Voicemail,
  Check,
  CheckCheck,
  Forward,
  Info,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { trpc } from "@/lib/trpc";
import { RoleBadge, roleFromFlags } from "@/app/VerifiedBadge";
import { EmojiPicker } from "@/app/EmojiPicker";
import {
  QUICK_REACTIONS,
  myReaction,
  reactionChips,
  reactionOpFor,
  type MessageReactions,
} from "@shared/reactions";
import { previewOf, previewOfStoryReply } from "@/app/messagePreview";
import { statusReplyOf, storyKindLabel } from "@shared/statusReply";
import { isGroupHidden, useGroupLocks } from "@/app/groupLock";
import { GroupLockGate } from "@/app/GroupLockGate";
import { uploadAttachment, uploadThumbnail } from "@/lib/uploadAttachment";
import { StatusStrip } from "./Status";
import {
  PeerAvatar,
  openPeerProfile,
  openGroupStatus,
  useGroupStatusMap,
  type PeerProfileChatActions,
} from "@/app/PeerOverlays";
import { presenceDot } from "@/app/presenceDot";
import { dayKey, dayLabel, groupMessagesByDay } from "@/app/messageDays";
import { matchQuery } from "@/app/searchMatch";
import { describeProfileStatus } from "@shared/profileStatus";
import { suggestContacts, digitsOf, isNumberQuery } from "@/app/contactSuggest";
import { formatLastSeen } from "@shared/profileFields";
import { isDownscalableImage, processImageForUpload } from "@/lib/imageDownscale";
import { GroupCallScreen, PartyLinesSection } from "./GroupCallScreen";
import { AvatarPicker } from "@/app/AvatarPicker";
import { recorderSupported, startVoiceRecording, type VoiceRecording } from "@/lib/voiceNote";
import { videoRecorderSupported } from "@/lib/videoNote";
import { VideoRecordSheet } from "@/app/VideoRecordSheet";
import { GroupInfoSheet } from "@/app/GroupInfoSheet";
import { SwipeRow, type SwipeAction } from "@/app/SwipeRow";
import { linkify } from "@/lib/linkify";
import { mentionQueryAt, rankMentionMatches, applyMention } from "@shared/mentions";
import { useIdentity } from "@/app/useIdentity";
import { demotablePollInterval } from "@/app/useRealtime";
import { useThreadMuted, isThreadMuted, setThreadMuted, onMutedChange } from "@/app/mutedThreads";
import { useTypers, useTypingConversations } from "@/app/typingStore";
import { bubbleStyleFor, bubbleGlyphColor, nameColorFor, senderAvatarStyle } from "@/app/peerColors";
import { TypingLine } from "@/app/TypingLine";
import { useDraft } from "@/app/draftStore";

/** Own (outgoing) message bubble — the brand "message" orange gradient with
 *  white copy. Received bubbles keep the neutral token surface (theme-safe). */

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("").slice(0, 2) || "??";
}

function timeAgo(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
  return d.toLocaleDateString();
}

/**
 * Per-message stamp (v2.99.72).
 *
 * OWNER: "there is no time and date for each message when it's sent."
 *
 * The time was already there; the DATE was not, and that is a real gap rather than a
 * preference. The thread draws a day separator, but only from the first one onward —
 * every message ABOVE it carried a bare "12:09 PM" with nothing saying which day, so a
 * note from last week was indistinguishable from one an hour ago. The owner's own
 * screenshot shows exactly that: three bubbles reading "12:09 PM" sitting above a
 * "Today" divider.
 *
 * Today stays time-only, because repeating today's date on every bubble is noise.
 * Anything older names the day, and anything from another year names the year too —
 * "Jul 23" silently reads as this year, and being twelve months wrong without saying so
 * is worse than one extra token. Same rule as `formatLastSeen` (v2.99.66), deliberately.
 */
function formatTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (sameDay) return time;
  const day = d.toLocaleDateString([], { month: "short", day: "numeric" });
  const year = d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${day}${year} · ${time}`;
}

/**
 * Full date and time to the SECOND, for the message-info panel (v2.99.74).
 *
 * Deliberately not `formatTime`: that omits today's date (correct on a bubble, where
 * repeating it 40 times is noise) and rounds to the minute. Sent, delivered and read
 * are frequently within the same minute of each other, so a minute-precision panel
 * shows three identical values and answers none of the question it was opened to
 * answer. Here the date and the seconds are the point.
 */
function formatExact(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${date} · ${time}`;
}

/**
 * Is this a self-destructing message? (v2.99.74)
 *
 * Used to withhold FORWARD, whose whole effect is to make a second, permanent copy
 * of something sent on the promise that there would be exactly one temporary one.
 * The forward action refuses these too, but a menu item that cannot do its job
 * should not be offered — the refusal exists as a backstop, not as the UI.
 */
function isExpiringMsg(meta: unknown): boolean {
  return (meta as { expire?: unknown } | null)?.expire != null;
}

/* The story-reply marker (v2.99.80) and its labels live in `shared/statusReply.ts`.
   MOVED there in #115, because the rule now has three readers on both sides of the
   wire: this file's bubble chip, the thread-list projection (server), and the
   reply-quote line below. Two copies of "is this a story reply" is how a thread row and
   the conversation it opens come to disagree about the same message. */

/** True when a message body is ONLY emoji (1-8 glyphs) — rendered big without a
 *  bubble, iMessage-style. Conservative: any non-emoji character disqualifies. */
function isEmojiOnly(body: string | null | undefined): boolean {
  if (!body) return false;
  const t = body.trim();
  if (!t || t.length > 32) return false;
  try {
    // Built via the constructor so the `u`-flag property escapes don't trip the
    // TS downlevel-target check; ‍ = ZWJ, ️ = variation selector.
    const re = new RegExp("^(?:\\p{Extended_Pictographic}|\\p{Emoji_Component}|\\u200d|\\ufe0f|\\s)+$", "u");
    if (!re.test(t)) return false;
    const glyphs = Array.from(t.replace(/\s/g, "")).length;
    return glyphs > 0 && glyphs <= 16; // up to ~8 composed emoji
  } catch {
    return false; // older engines without Unicode property escapes
  }
}


/**
 * The sender's thumbnail beside their name in a group row (v2.103.3).
 *
 * Owner: "each user's message shows a small clickable thumbnail of their profile
 * image beside their name on the left, opening their status/story."
 *
 * `PeerAvatar` already does all of the work — the photo, the initials fallback when
 * a photo 403s, the story ring, and the tap that opens the story or the profile — so
 * this is a gutter, not a new avatar.
 *
 * THE FIXED WIDTH IS THE LOAD-BEARING PART. PeerAvatar draws its ring ONLY when the
 * person has a story (`st?.hasAny ? ring : disc`), so its rendered footprint is 28px
 * without one and ~36px with one. Placed bare in the row that would shift every
 * bubble sideways according to somebody else's story state, and make the whole
 * column JUMP the moment a story is posted or expires 24 hours later. A constant
 * 36px gutter with the avatar centred inside makes the row's geometry independent of
 * that entirely.
 *
 * `show` is false for the later messages of a stacked run, where the sender label is
 * suppressed too (`sameAsPrev`). The gutter still takes its width in that case — an
 * absent spacer is what would slide those bubbles left and visibly break the run.
 *
 * A sender who is no longer in the roster has no member entry, so the avatar is
 * rendered NON-clickable rather than as a button whose handler returns early: a
 * control that looks tappable and does nothing is worse than one that does not.
 */
function SenderThumb({
  member,
  show,
  senderIdentityId,
}: {
  member?: { name: string; number: string; avatarUrl: string | null };
  show: boolean;
  /** Whose disc this is — the hue its initials fallback is tinted with (v2.106.61). */
  senderIdentityId: number;
}) {
  return (
    <span className="w-9 shrink-0 self-start grid place-items-center">
      {show && (
        <PeerAvatar
          number={member?.number}
          name={member?.name}
          avatarUrl={member?.avatarUrl}
          size={28}
          clickable={!!member?.number}
          className="mt-[2px]"
          /* THE PERSON'S OWN COLOUR, now that the bubble no longer carries it
             (v2.106.61). Board frame 3c builds each sender's disc from one hue —
             `linear-gradient(135deg, hsl(H 65% 62%), hsl(H+45 70% 42%))` with near-black
             initials — and it comes from the SAME palette entry as their name, so the
             disc, the name and the typing line cannot disagree about who is who.
             Only the initials fallback is tinted: somebody with a real photo shows the
             photo, exactly as the board's own first sender does. */
          fallbackStyle={senderAvatarStyle({ isGroup: true, senderIdentityId })}
        />
      )}
    </span>
  );
}

/**
 * Which tab this page is mounted under, as a path.
 *
 * The Groups tab is this SAME component served at `/app/groups`, so every in-page
 * navigation — opening a thread, the mobile Back arrow, leaving a thread that was just
 * cleared — has to return to the path it came from. Hardcoding `/app/messages` would
 * move the user to the Messages tab the instant they opened a group, so the bottom
 * bar's active tab would change under a tap that only meant "open this conversation".
 *
 * Read from the LOCATION rather than threaded down as a prop, because the conversation
 * view and the new-message sheet are separate components and a prop would have to be
 * passed through each of them — which is how one of them comes to be forgotten.
 */
function useTabBasePath(): string {
  const [loc] = useLocation();
  return loc.startsWith("/app/groups") ? "/app/groups" : "/app/messages";
}

export default function MessagesPage({
  /**
   * The board's 5th tab (design_handoff_relay_app) renders THIS page filtered to group
   * threads, rather than a second thread list to keep in step. Optional, so
   * `/app/messages` is byte-identical to before.
   */
  only,
}: { only?: "groups" } = {}) {
  const { me } = useIdentity();
  const [location, setLocation] = useLocation();
  const basePath = useTabBasePath();
  // Re-render the thread list when any conversation's mute state changes so the
  // muted icons stay live (the per-item read is otherwise unsubscribed).
  const [, forceMuteTick] = useState(0);
  useEffect(() => onMutedChange(() => forceMuteTick((n) => n + 1)), []);
  const search = useSearch();
  const params = new URLSearchParams(search);
  const activeConvoIdRaw = params.get("c");
  const activeConvoId = activeConvoIdRaw ? parseInt(activeConvoIdRaw, 10) : null;

  const threads = trpc.messages.threads.useQuery(undefined, {
    // SSE-gated (v2.88): 4s is the OFFLINE safety net; while the SSE stream is
    // up (it invalidates this exact query on every message) poll at 30s.
    refetchInterval: demotablePollInterval(4_000, 30_000),
    refetchIntervalInBackground: false,
    enabled: !!me,
  });
  // Live "typing…" state per thread row (one subscription for the whole list).
  const typingConvos = useTypingConversations();
  /* Which of my GROUPS have a live story, keyed by conversation id (v2.105.6).
     Reads the SAME shared status-feed cache the strip above this list reads, so a
     group's ring here and its ring in the strip cannot come to disagree. */
  const groupStatus = useGroupStatusMap();

  // Collapsible, PRESENTATIONAL grouping of the flat thread list into DIRECT /
  // GROUPS / NOTES sections. Derived purely from the existing threads query
  // (no new request, no data-flow change); collapse state is UI-only.
  const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>({});
  /** v2.106.64 — the ad-hoc group-call picker, opened from the Groups tab's call section. */
  const [showGroupCall, setShowGroupCall] = useState(false);
  // Thread-list search (v2.95): filter conversations by peer name/number. Pure
  // client filter over the already-loaded list — instant, no new request.
  const [threadSearch, setThreadSearch] = useState("");
  // The GROUPS tab is this same page narrowed to group threads. The narrowing is a memo
  // of its OWN, ahead of the categories, for two reasons. (1) Narrowing by picking
  // categories below would leak archived DIRECT threads into a tab that says Groups,
  // because "Archived" is defined as `t.archived` regardless of kind — so the INPUT is
  // what has to be filtered, after which every section (Archived included) is correctly
  // group-only and no section needs to know the tab exists. (2) The empty state and the
  // search box both ask "is there anything here at all", and they have to ask it of the
  // SCOPED list: `threads.data.length` counts DMs, so on the Groups tab of an account
  // with DMs and no groups it reads non-zero and the page falls through to the
  // no-search-matches branch, rendering `No conversations match “”`.
  //
  // v2.106.64 — the split is now BOTH ways. Owner: *"from the messages section, remove
  // the group message and just keep it in the group section"*. Messages is DMs and Notes;
  // Groups is groups. The complement is taken on the same INPUT for the same reason the
  // narrowing was: `archived` is kind-agnostic, so filtering by picking categories would
  // leave an archived GROUP sitting in a tab that no longer holds groups.
  const scopedThreads = useMemo(() => {
    const all = threads.data ?? [];
    return only === "groups"
      ? all.filter((t) => t.kind === "group")
      : all.filter((t) => t.kind !== "group");
  }, [threads.data, only]);
  const threadCategories = useMemo(() => {
    const scoped = scopedThreads;
    // v2.99.96: the shared rule, and the GROUP TITLE is searched too — a group was
    // previously findable only if the query happened to appear in the composed peer
    // name, so searching a group by its own title matched nothing.
    const list = threadSearch.trim()
      ? scoped.filter((t) =>
          // v2.102.0: a group is findable by its OWN 6-digit id too, not only its
          // title — which is the point of giving it one.
          matchQuery(threadSearch, [t.peerDisplayName, t.peerNumber, t.title, t.groupNumber]),
        )
      : scoped;
    const meId = me?.id;
    const isNotes = (t: (typeof list)[number]) =>
      meId != null && t.kind !== "group" && t.peerIdentityId === meId;
    const cats: {
      key: string;
      label: string;
      rgb: string;
      hex: string;
      icon: ReactNode;
      rows: typeof list;
    }[] = [
      // v2.106.64 — the sections are built PER SCOPE rather than defined for both and
      // left to filter to nothing. A "Groups" heading declared on the Messages tab is
      // dead code that reads as live: it would silently come back the moment anything
      // upstream stopped excluding groups, which is exactly the regression this split
      // has to survive.
      ...(only === "groups"
        ? [
            {
              key: "groups",
              label: "Group chats",
              rgb: "167,139,250",
              hex: "#a78bfa",
              icon: <Users className="size-3.5" />,
              rows: list.filter((t) => t.kind === "group" && !t.archived),
            },
          ]
        : [
            {
              key: "direct",
              label: "Direct",
              rgb: "251,146,60",
              hex: "#fb923c",
              icon: <MessageSquare className="size-3.5" />,
              rows: list.filter((t) => t.kind !== "group" && !isNotes(t) && !t.archived),
            },
            {
              key: "notes",
              label: "Notes",
              rgb: "251,191,36",
              hex: "#fbbf24",
              icon: <StickyNote className="size-3.5" />,
              rows: list.filter((t) => isNotes(t) && !t.archived),
            },
          ]),
      {
        // v2.103.0 — archived threads leave the other sections and gather here, LAST,
        // which is the whole point of archiving: out of the way but not gone. The
        // section renders only when something is in it (the existing rule below).
        key: "archived",
        label: "Archived",
        rgb: "107,114,128",
        hex: "#6b7280",
        icon: <Archive className="size-3.5" />,
        rows: list.filter((t) => t.archived),
      },
    ];
    return cats.filter((c) => c.rows.length > 0);
    // threadSearch MUST be a dep (QA H3): the memo filters `list` by it, but it
    // was missing here — so typing in the search box re-rendered yet returned the
    // cached unfiltered list (threads.data is stable via structural sharing), and
    // search silently did nothing.
    // `only` is an explicit dep even though `scopedThreads` already moves with it: the
    // section LIST is now derived from it too, and depending on that coupling is how a
    // memo comes to serve a stale section set (the v2.99.22 H3 shape).
  }, [scopedThreads, me, threadSearch, only]);

  /**
   * The swipe actions (v2.103.0). Every one is a TOGGLE reading the row's own state, so
   * a pinned thread offers Unpin rather than Pin — an action that cannot be undone by the
   * same gesture that did it is a trap.
   *
   * Mute is here alongside four server-backed actions but is the odd one out on purpose:
   * it stays per-DEVICE (v2.99.42), because the service worker has to silence a
   * notification without asking the server anything.
   */
  const utils = trpc.useUtils();
  // Delete-a-thread is the one action behind a confirmation (v2.103.0): it takes the
  // conversation out of this person's list and hides their copy of its messages, where
  // the other four are undone by the same gesture that did them.
  const [clearingThread, setClearingThread] = useState<{
    conversationId: number;
    label: string;
  } | null>(null);
  // Derived from the query's own output, so a wire change cannot leave these builders
  // typed against a shape the server no longer sends.
  type ThreadRow = NonNullable<typeof threads.data>[number];
  const threadState = trpc.messages.setThreadState.useMutation({
    onSuccess: () => utils.messages.threads.invalidate(),
    onError: (e) => toast.error(e.message || "Couldn't save that — nothing changed."),
  });

  const swipeLeftActions = (t: ThreadRow): SwipeAction[] => [
    {
      key: "unread",
      label: t.manualUnread ? "Read" : "Unread",
      icon: <MailOpen className="size-5" />,
      color: "#6b7280",
      onSelect: () =>
        threadState.mutate({ conversationId: t.conversationId, unread: !t.manualUnread }),
    },
    {
      key: "pin",
      label: t.pinned ? "Unpin" : "Pin",
      /* v2.106.66 — SKY, NOT `#22c55e`. That hex is `VerifiedBadge`'s `registered` tier
         VERBATIM, and these rows render that badge (line ~883) — so swiping a row put a
         green Pin chip beside a green tier seal, two meanings on one hue a few pixels
         apart. v2.106.40 retired exactly this pairing in the 1:1 header and the tray was
         never swept; this is the same collision one screen along.

         SAID PLAINLY, THE BOARD DOES NOT DECIDE THIS: 1c draws the row at rest, so it
         shows no open tray and specifies no Pin colour. The change is the collision, not
         a match — claiming otherwise would be inventing a spec.

         Sky is what is left once this SCREEN's vocabulary is subtracted: green is the
         registered tier and presence, the accent is UNREAD in that same row (v2.106.42,
         which is also why the pinned MARKER is muted rather than accent), grey is already
         both neutral actions in this tray, amber is Mute, red is Delete, and violet means
         a group in a list that contains groups. */
      icon: t.pinned ? <PinOff className="size-5" /> : <Pin className="size-5" />,
      color: "#0ea5e9",
      onSelect: () => threadState.mutate({ conversationId: t.conversationId, pinned: !t.pinned }),
    },
  ];

  const swipeRightActions = (t: ThreadRow): SwipeAction[] => [
    {
      key: "mute",
      label: isThreadMuted(t.conversationId) ? "Unmute" : "Mute",
      icon: isThreadMuted(t.conversationId) ? <Bell className="size-5" /> : <BellOff className="size-5" />,
      color: "#e0912f",
      onSelect: () => setThreadMuted(t.conversationId, !isThreadMuted(t.conversationId)),
    },
    {
      key: "delete",
      label: "Delete",
      icon: <Trash2 className="size-5" />,
      color: "#dc2626",
      // Behind a confirmation, unlike the other four: it takes the conversation out of
      // this person's list and hides their copy of its messages. The other four are all
      // one tap away from being undone by the same gesture.
      onSelect: () =>
        setClearingThread({
          conversationId: t.conversationId,
          label: t.title || t.peerDisplayName || t.peerNumber || "this chat",
        }),
    },
    {
      key: "archive",
      label: t.archived ? "Unarchive" : "Archive",
      icon: t.archived ? <ArchiveRestore className="size-5" /> : <Archive className="size-5" />,
      color: "#6b7280",
      onSelect: () =>
        threadState.mutate({ conversationId: t.conversationId, archived: !t.archived }),
    },
  ];

  // While a conversation is open on MOBILE, hide the app's top bar so the chat
  // has ONE compact header (name + status) instead of two stacked headers
  // eating a third of the screen. The bottom tab bar stays.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("relay-convo-open", activeConvoId != null);
    return () => document.body.classList.remove("relay-convo-open");
  }, [activeConvoId]);

  return (
    // NOTE: AppShell's bottom tab bar is an IN-FLOW flex sibling BELOW this
    // page's scroll container (not a floating fixed overlay), so this page's
    // h-full ends exactly at the bar's top edge — the composer at the bottom
    // of the conversation column sits immediately ABOVE the nav, and the
    // message list scrolls above both. No clearance padding and no
    // negative-margin hacks are needed (a historical -mb-28 hack hid the
    // composer behind the old fixed nav — never reintroduce one). The
    // message-list flex fix below (flex-col instead of
    // relative-with-only-absolute-children) is what keeps WebKit from
    // collapsing the list area.
    <div className="flex-1 flex md:p-6 gap-0 md:gap-6 min-h-0">
      {/* ── thread list (always visible on desktop; hidden when a thread is open on mobile) ── */}
      <aside
        className={
          "md:w-[340px] md:shrink-0 md:rounded-2xl md:glass-surface-md flex-col min-h-0 " +
          (activeConvoId == null ? "flex flex-1 md:flex-initial" : "hidden md:flex")
        }
      >
        <header className="flex items-center justify-between px-4 md:px-5 py-4 border-b border-border">
          <h2 className="text-base font-extrabold tracking-tight">
            {only === "groups" ? "Groups" : "Messages"}
          </h2>
          <div className="flex items-center gap-1">
            <AutoReplyToggle />
            <NewMessageDialog defaultMode={only === "groups" ? "group" : "dm"} />
          </div>
        </header>
        {/* v2.106.66 — THE STORIES STRIP IS CHROME, NOT THE FIRST ROW OF THE LIST.
            Board 1c's own order is header → strip → search → threads, and its caption reads
            "Stories strip · threads · swipe actions"; the app had it BELOW the search and
            INSIDE the scroller, so it scrolled away with the threads and sat under a field
            it is not part of. Read off the board's markup rather than a description of it.

            Out of the scroller matters more than the order does: a story is a 24h thing and
            the ring is the only signal it exists, so scrolling two threads down used to hide
            every one of them. Above the search because the search narrows THREADS — putting
            a stories row under it implies it filters those too. */}
        <StatusStrip />
        {scopedThreads.length > 0 && (
          <div className="px-3 py-2 border-b border-border/60">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                value={threadSearch}
                onChange={(e) => setThreadSearch(e.target.value)}
                placeholder="Search conversations"
                aria-label="Search conversations"
                className="h-9 w-full rounded-lg border border-border/60 bg-muted/40 pl-9 pr-3 text-sm outline-none focus:border-primary/50"
              />
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {/* v2.106.64 — GROUP CALLS live in the group section, per the owner: *"in the
              group section, add group calls … so in the group section you will have a
              group call and group message"*. A party line is the durable thing a group
              call leaves behind (a titled room with its own 6-digit number you can
              return to), which is why it is what this section lists; an ad-hoc
              conference ends, and its record is History's job rather than a second copy
              here. `PartyLinesSection` is the SAME component the dial picker mounts —
              two lists of the same lines is how the two come to disagree about which
              exist. It sits ABOVE the chats because it is the half that was missing. */}
          {only === "groups" && (
            <GroupCallsSection onOpenPicker={() => setShowGroupCall(true)} />
          )}
          {threads.isError ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              <p>Couldn't load your conversations.</p>
              <button
                type="button"
                onClick={() => threads.refetch()}
                className="mt-3 inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-foreground hover:bg-muted/50"
              >
                Retry
              </button>
            </div>
          ) : threads.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : scopedThreads.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {only === "groups" ? (
                <>
                  <Users className="size-8 mx-auto mb-2 opacity-50" />
                  <p>No groups yet.</p>
                  <p className="mt-1">Tap the + above to start one.</p>
                </>
              ) : (
                <>
                  <MessageSquarePlus className="size-8 mx-auto mb-2 opacity-50" />
                  <p>No messages yet.</p>
                  <p className="mt-1">Tap the + above to start a conversation.</p>
                </>
              )}
            </div>
          ) : threadCategories.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No conversations match “{threadSearch.trim()}”.
            </div>
          ) : (
            <div>
              {threadCategories.map((cat) => {
                // v2.99.96: a COLLAPSED category used to swallow search matches —
                // the filter kept the thread and the header counted it, but the body
                // was gated on collapse state, so a search could show a count beside
                // a heading and render no rows. A query forces every category open.
                const open = threadSearch.trim().length > 0 || !collapsedCats[cat.key];
                const catUnread = cat.rows.some((t) => t.unreadCount > 0);
                return (
                  <section key={cat.key}>
                    {/* Collapsible category header: chevron + colored icon +
                        UPPERCASE label + count + unread dot. */}
                    <button
                      type="button"
                      onClick={() => setCollapsedCats((c) => ({ ...c, [cat.key]: !c[cat.key] }))}
                      className="w-full flex items-center gap-2 px-4 md:px-5 pt-3 pb-1.5 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {open ? (
                        <ChevronDown className="size-3.5 shrink-0" />
                      ) : (
                        <ChevronRight className="size-3.5 shrink-0" />
                      )}
                      <span className="grid place-items-center" style={{ color: cat.hex }}>
                        {cat.icon}
                      </span>
                      <span className="flex-1 text-left text-[11px] font-bold uppercase tracking-[0.12em]">
                        {cat.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{cat.rows.length}</span>
                      {catUnread && (
                        /* The section's own unread pip, same accent as the row counts under
                           it — two colours for one state is how a header comes to disagree
                           with its rows. `bg-primary`, not the 2.26:1 orange literal. */
                        <span className="size-2 rounded-full bg-primary" />
                      )}
                    </button>
                    {open &&
                      cat.rows.map((t) => {
                        /* v2.99.37 — THREAD ROW REDESIGN (owner brief + the
                           Snapchat chat-list reference they supplied; picked by
                           a 3-design / 3-judge panel, winner "Quiet Two-Line"
                           with the judges' agreed grafts).

                           SHAPE: a 60px avatar (its own button — status ring +
                           presence LED), then exactly TWO text lines:
                             line 1  NAME (19px) + tier mark ............ time
                             line 2  [muted] PIN · preview-or-typing · N new
                           No dividers — separation is whitespace (~92px rhythm),
                           which is the "not compact, flexible for the eyes" the
                           owner asked for.

                           DELIBERATELY GONE: the per-row message / voice / video
                           buttons. The conversation's own top bar already has
                           voice + video, and a "message" action is meaningless
                           inside Messages — so the whole row is ONE tap to open.

                           Robustness notes (both were real bugs here before):
                           no fixed row height anywhere (a hard-coded 16px line
                           clipped a badge), and nothing competes for the width
                           (an action cluster once squeezed it to "A…"). The PIN
                           and time carry dir=ltr + unicode-bidi:isolate so they
                           stay intact beside an Arabic (RTL) name. */
                        const isActive = activeConvoId === t.conversationId;
                        const isGroup = t.kind === "group";
                        const isNotes = !!me && !isGroup && t.peerIdentityId === me.id;
                        const isDm = !isGroup && !isNotes;
                        const displayName = isGroup
                          ? t.title || "Group"
                          : isNotes
                            ? "Notes to self"
                            : t.peerDisplayName || t.peerNumber || "Unknown";
                        const typing = typingConvos.includes(t.conversationId);
                        const muted = isThreadMuted(t.conversationId);
                        const unread = t.unreadCount > 0;
                        const tier = isDm ? roleFromFlags(t.peerRole, t.peerVerified) : null;
                        // NNN-NNN. A GROUP now has its own id too (v2.102.0), so this is
                        // no longer 1:1-only; notes-to-self stays blank because that is me.
                        const ownNumber = isGroup ? t.groupNumber : isDm ? t.peerNumber : null;
                        const pin =
                          ownNumber && /^\d{6}$/.test(ownNumber)
                            ? `${ownNumber.slice(0, 3)}-${ownNumber.slice(3)}`
                            : null;
                        /* THE LOCKED-GROUP REDACTION (v2.105.20, #108).
                           A lock whose row still printed "Ahmed: see you at 8" would
                           leak the exact thing it covers — and on a group the preview
                           names a MEMBER as well as their words, so both go.
                           `isGroupHidden`, not `isGroupLocked`: a group unlocked for
                           this session shows its preview normally, because you are
                           already reading it. */
                        const hidden = isGroup && isGroupHidden(t.conversationId);
                        /* #115 — A STORY REPLY GETS ITS CONTEXT.
                           A one-tap reaction IS an emoji-only message, so this row used
                           to show a floating ❤️ with nothing saying what it was about.
                           The lock check stays FIRST: a locked group must not gain a
                           story-reply line, since that would name an activity the lock
                           exists to cover. */
                        const preview = hidden
                          ? "Locked"
                          : !t.lastMessageAt
                            ? "No messages yet"
                            : t.lastMessageStatusReply
                              ? previewOfStoryReply({
                                  mine: !!t.lastMessageMine,
                                  kind: t.lastMessageKind ?? "text",
                                  body: t.lastMessageBody,
                                })
                              : previewOf(t.lastMessageKind ?? "text", t.lastMessageBody);
                        return (
                          <SwipeRow
                            key={t.conversationId}
                            /* EVERY STATE IS OPAQUE, and that is a swipe requirement rather
                               than a style preference (v2.106.60). A dragged row is
                               `:active` for the whole gesture, so a translucent tint here
                               made the row see-through exactly while it was sliding —
                               measured at 35% alpha, with both trays' pucks and the app's
                               live background canvas reading through the row's own name and
                               preview text. `bg-background` also used to sit in the SAME
                               class list as the selected tint, and two `background-color`
                               utilities of equal specificity are decided by stylesheet
                               emission order rather than by the order written here, so
                               which one won was not this file's decision to make; the base
                               now lives only in the branch that wants it.
                               The ladder is three opaque steps of the app's own tokens —
                               rest `--background`, hover `--card`, selected `--muted` —
                               which is the same subtle lift the alpha tints were reaching
                               for, minus the transparency. */
                            rowClassName={
                              "flex items-center gap-3.5 rounded-2xl mx-1.5 my-0.5 px-3 py-3.5 transition-colors " +
                              (isActive ? "bg-muted" : "bg-background hover:bg-card")
                            }
                            left={swipeLeftActions(t)}
                            right={swipeRightActions(t)}
                          >
                            {/* Avatar — its OWN button (status ring → status viewer /
                                profile), so it must stay OUTSIDE the open-thread
                                button: nested buttons are invalid HTML. The fixed
                                64px box keeps every row's text aligned whether or
                                not PeerAvatar adds its ~5px ring. */}
                            <div className="grid size-16 shrink-0 place-items-center">
                              {isGroup ? (
                                (() => {
                                  /* THE GROUP'S STORY RING (v2.105.6, #110).
                                     Unblocked at last: v2.102.1 recorded that a ring
                                     here "would signify nothing" because a group could
                                     not post a story — that was true then and is not
                                     now. Same vocabulary as PeerAvatar: a gradient ring
                                     means an unseen story, a subtle one means seen, and
                                     no ring means no story at all, so one shape does
                                     not acquire a second meaning.
                                     A group with no story stays a plain, NON-clickable
                                     disc rather than a focusable button whose handler
                                     returns early — the v2.103.3 rule: something that
                                     looks tappable and does nothing is worse than
                                     something that is plainly inert. */
                                  const st = groupStatus.get(t.conversationId);
                                  const ring = st?.hasAny
                                    ? st.hasUnseen
                                      ? "rstoryring" // v2.106.66 — the ONE recipe, not a copy
                                      : "bg-border"
                                    : "";
                                  const disc = t.groupAvatarUrl ? (
                                    // The group's own photo (v2.102.0). A broken URL must
                                    // degrade to the glyph below, never to the browser's
                                    // broken-image icon — the same rule PeerAvatar follows.
                                    <img
                                      src={t.groupAvatarUrl}
                                      alt={displayName}
                                      className="size-full rounded-full border border-border/60 bg-muted/40 object-cover"
                                      onError={(e) => {
                                        (e.currentTarget as HTMLImageElement).style.display = "none";
                                      }}
                                    />
                                  ) : (
                                    <div
                                      className="grid size-full place-items-center rounded-full"
                                      style={{ background: "rgba(167,139,250,.16)", color: "#a78bfa" }}
                                      aria-label="Group conversation"
                                    >
                                      <Users className="size-7" />
                                    </div>
                                  );
                                  if (!st?.hasAny) {
                                    return <div className="size-[60px]">{disc}</div>;
                                  }
                                  return (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openGroupStatus(t.conversationId);
                                      }}
                                      aria-label={`${displayName} story`}
                                      title={`${displayName} story`}
                                      className={`grid size-16 place-items-center rounded-full p-[2.5px] ${ring}`}
                                    >
                                      <span className="grid size-full place-items-center overflow-hidden rounded-full bg-background ring-2 ring-background">
                                        {disc}
                                      </span>
                                    </button>
                                  );
                                })()
                              ) : isNotes ? (
                                <div
                                  className="grid size-[60px] place-items-center rounded-full"
                                  style={{ background: "rgba(251,191,36,.16)", color: "#fbbf24" }}
                                  aria-label="Notes to yourself"
                                >
                                  <StickyNote className="size-7" />
                                </div>
                              ) : (
                                <PeerAvatar
                                  number={t.peerNumber}
                                  name={t.peerDisplayName}
                                  avatarUrl={t.peerAvatarUrl}
                                  size={60}
                                >
                                  {(() => {
                                    // v2.99.92: one shared rule for every dot.
                                    const dot = presenceDot({ isOnline: t.peerIsOnline, idle: t.peerIdle });
                                    return (
                                      <span
                                        aria-label={dot.label}
                                        title={dot.label}
                                        className="absolute bottom-0 right-0 size-[15px] rounded-full border-2 border-card"
                                        style={{ background: dot.color, boxShadow: dot.glow || undefined }}
                                      />
                                    );
                                  })()}
                                </PeerAvatar>
                              )}
                            </div>

                            {/* One button holds BOTH text lines (judge graft): the
                                whole text column is the tap target, the text stays
                                selectable, and a screen reader reads the label once
                                instead of the label plus the same content again. */}
                            <button
                              type="button"
                              onClick={() => setLocation(`${basePath}?c=${t.conversationId}`)}
                              aria-current={isActive ? "true" : undefined}
                              aria-label={
                                `Open conversation with ${displayName}` +
                                (unread ? `, ${t.unreadCount} unread` : "") +
                                (typing ? ", typing now" : "")
                              }
                              className="flex min-h-[58px] min-w-0 flex-1 flex-col justify-center gap-[3px] rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                            >
                              {/* LINE 1 — the name owns the width; only the small
                                  tier mark and the right-aligned time share it. */}
                              <div className="flex min-w-0 items-center gap-1.5">
                                <span
                                  dir="auto"
                                  className={
                                    "min-w-0 truncate text-[19px] leading-[1.2] tracking-[-0.01em] text-foreground " +
                                    (unread ? "font-bold" : "font-semibold")
                                  }
                                >
                                  {displayName}
                                </span>
                                {tier && (
                                  /* caption={false}: the stacked tier word is ~22px
                                     tall and has overflowed a one-line row before. */
                                  <RoleBadge role={tier} size={16} caption={false} className="shrink-0" />
                                )}
                                {/* Pinned (v2.103.0) — a small marker, because the pin's
                                    real effect is the SORT: a pinned thread is already at
                                    the top, so this only has to say why. `ms-auto` moves
                                    here so the timestamp still ends the line. */}
                                {t.pinned && (
                                  /* NOT GREEN. Green means ONLINE in this app — it is what
                                     every presence LED is drawn with, and it is why v2.99.86
                                     moved DND off it, v2.106.9 the speaking tile, v2.106.11
                                     the push banner and v2.106.18 the voice waveform. A pin
                                     is not a presence statement, so it was a further meaning
                                     for the one colour that has to carry exactly one.
                                     NOT the accent either, deliberately: the accent now means
                                     UNREAD in this row (see the count and the timestamp
                                     below), and a pinned-but-READ thread must not read as
                                     unread. The pin's real effect is the SORT — it is already
                                     at the top — so this only has to say why, which is a
                                     quiet job. Measured: 6.00:1 light, 6.55:1 dark. */
                                  <Pin
                                    aria-label="Pinned"
                                    className="ms-auto size-3.5 shrink-0 -rotate-45 text-muted-foreground"
                                  />
                                )}
                                {t.lastMessageAt && (
                                  <span
                                    dir="ltr"
                                    className={
                                      (t.pinned ? "shrink-0 pl-1.5 " : "ms-auto shrink-0 pl-1 ") +
                                      "text-[11.5px] tabular-nums [unicode-bidi:isolate] " +
                                      /* Board 1c: unread is the ACCENT. `text-primary`, not
                                         the hardcoded `#fb923c` — measured 2.26:1 on the light
                                         card against AA's 4.5, i.e. the timestamp of an UNREAD
                                         thread was the least readable thing in the row in the
                                         theme the app defaults to (dark was fine at 8.30, which
                                         is why it survived: the board is a dark design and the
                                         app ships light). `text-primary` measures 4.85:1 light
                                         and 11.16:1 dark, and v2.106.4 repointed `--primary` at
                                         `--rb` inside `.dark.relay-v2`, so dark keeps the
                                         cycling accent and only light becomes readable.
                                         AND THE ORANGE MEANT SOMETHING ELSE: the owner asked
                                         for orange on their OWN BUBBLES in their own words
                                         (v2.99.85), so spending it on "unread" put two meanings
                                         on one colour. */
                                      (unread ? "font-semibold text-primary" : "text-muted-foreground")
                                    }
                                  >
                                    {timeAgo(t.lastMessageAt)}
                                  </span>
                                )}
                              </div>

                              {/* LINE 2 — one quiet run. Only the preview flexes, so
                                  the PIN and the unread count can never be clipped;
                                  it may wrap rather than starve the preview. */}
                              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px] leading-snug text-muted-foreground">
                                {muted && <BellOff aria-label="Muted" className="size-3.5 shrink-0 opacity-70" />}
                                {pin && (
                                  <>
                                    <span
                                      dir="ltr"
                                      className="shrink-0 font-mono text-[12px] tabular-nums tracking-tight text-foreground/55 [unicode-bidi:isolate]"
                                    >
                                      {pin}
                                    </span>
                                    <span aria-hidden="true" className="shrink-0 select-none opacity-40">·</span>
                                  </>
                                )}
                                {/* A lock glyph, so "Locked" reads as a state rather
                                    than as somebody's message that happens to say
                                    "Locked". */}
                                {hidden && (
                                  <Lock aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
                                )}
                                {typing && !hidden ? (
                                  /* TYPING IS SUPPRESSED WHILE LOCKED — not as a
                                     separate rule but because line 2 is the lock
                                     notice now. It also happens to be right: "typing"
                                     says somebody in there is active right now, which
                                     is the kind of live detail a privacy screen is
                                     for. */
                                  <span className="flex shrink-0 items-center gap-1 font-medium text-[color:var(--relay-online)]">
                                    typing
                                    <span className="flex items-end gap-[2px]" aria-hidden="true">
                                      {[0, 1, 2].map((i) => (
                                        <span
                                          key={i}
                                          className="size-[3px] rounded-full bg-current motion-safe:animate-pulse"
                                          style={{ animationDelay: `${i * 160}ms` }}
                                        />
                                      ))}
                                    </span>
                                  </span>
                                ) : (
                                  <span
                                    dir="auto"
                                    className={"min-w-0 flex-1 truncate " + (unread ? "text-foreground/90" : "")}
                                  >
                                    {preview}
                                  </span>
                                )}
                                {unread && (
                                  /* Colour + weight, not a heavy pill (the reference's
                                     "2 New Chats" treatment). */
                                  <span className="shrink-0 font-semibold text-[13px] text-primary">
                                    {t.unreadCount > 99 ? "99+" : t.unreadCount} new
                                  </span>
                                )}
                                {/* Hand-marked unread (v2.103.0): a DOT, not a count —
                                    there is no number, and inventing "1 new" would be a
                                    claim about a message that may not exist. Withheld
                                    when a real count is already shown. */}
                                {!unread && t.manualUnread && (
                                  /* Same accent as the count it stands in for — and the same
                                     measurement applies even though this is a FILL rather than
                                     text: at 2.26:1 the orange dot missed the 3:1 that
                                     non-text UI needs on the light card too. */
                                  <span
                                    aria-label="Marked unread"
                                    className="size-2.5 shrink-0 rounded-full bg-primary"
                                  />
                                )}
                              </div>
                            </button>
                          </SwipeRow>
                        );
                      })}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {/* ── conversation view ────────────────────────────────── */}
      <section
        className={
          /* `bg-background` on MOBILE too, not only `md:bg-card`. Both the message list and the
             composer are fully opaque (`--background` and `--card` carry no alpha), so any
             region of this column showing the background CANVAS is by definition a region
             neither of them is covering — i.e. a layout shortfall, which is what the owner
             photographed as "a large empty region with stars" where the composer should be.
             Painting the column's own surface does not fix a shortfall; it makes one look
             like a gap in the app instead of like the app having stopped, which is the
             difference between a screenshot that is diagnostic and one that is not. */
          "flex-1 min-w-0 flex-col min-h-0 bg-background md:rounded-2xl md:border md:border-border md:bg-card " +
          (activeConvoId == null ? "hidden md:flex" : "flex")
        }
      >
        {activeConvoId == null ? (
          <div className="hidden md:flex h-full items-center justify-center text-muted-foreground text-sm">
            Select a conversation
          </div>
        ) : (
          <ConversationView conversationId={activeConvoId} />
        )}
      </section>

      {/* Delete-a-thread confirmation (v2.103.0). The one swipe action behind a
          confirmation, and the copy's job is to say what it does NOT do: nobody else
          loses anything, and the chat comes back by itself if they write again — which
          is what makes this recoverable rather than final. */}
      <AlertDialog
        open={clearingThread !== null}
        onOpenChange={(open) => !open && setClearingThread(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat for you?</AlertDialogTitle>
            <AlertDialogDescription>
              {clearingThread?.label} leaves your list and its messages are hidden on all your
              devices. Everyone else keeps the conversation, and it comes back here if they
              message you again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {/* DELIBERATELY NOT `destructive`, and this is the one worth arguing.
                Every other confirmation in this file destroys something for good; this
                one does not — the thread comes back by itself the moment anybody
                messages you again (v2.103.0 built it that way, and the description
                right above says so). Painting it red would make the warning colour mean
                "a dialog" rather than "you cannot undo this", which is exactly what it
                is here to stop. */}
            <AlertDialogAction
              onClick={() => {
                if (clearingThread) {
                  threadState.mutate({ conversationId: clearingThread.conversationId, clear: true });
                  // Leaving the deleted thread open would show an empty conversation
                  // nobody can get out of except by tapping Back.
                  if (activeConvoId === clearingThread.conversationId) setLocation(basePath);
                }
                setClearingThread(null);
              }}
            >
              Delete for me
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* The ad-hoc picker, mounted at the ROOT rather than inside the scrolling list:
          it is a full-screen surface, and a modal nested in a scroll container that
          unmounts under it is how a picker ends up half on screen. */}
      {showGroupCall && <GroupCallScreen onClose={() => setShowGroupCall(false)} />}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

/**
 * GROUP CALLS, in the group section (v2.106.64).
 *
 * Owner: *"in the group section, add group calls where whenever you create any group
 * calls or conference call, it will be there so in the group section you will have a
 * group call and group message."*
 *
 * WHAT A "GROUP CALL THAT IS THERE" ACTUALLY IS. An ad-hoc conference is over when the
 * last person leaves — nothing persists but the History row, which is History's job. A
 * PARTY LINE is the durable one: a titled room with its own 6-digit number that stays
 * dialable and shows how many are on it right now, which is the thing you can come back
 * to and therefore the thing a list can hold. So this section lists the lines and offers
 * the picker for a call you want to place immediately.
 *
 * `PartyLinesSection` is the SAME component the Dialer's picker mounts, imported rather
 * than reimplemented — two lists of the same lines is how the two come to disagree about
 * which exist, which is the class this repo keeps removing.
 */
function GroupCallsSection({ onOpenPicker }: { onOpenPicker: () => void }) {
  return (
    <div className="border-b border-border/60">
      <div className="flex items-center gap-2 px-4 md:px-5 pt-3 pb-1.5 text-muted-foreground">
        <span className="grid place-items-center" style={{ color: "#22d3ee" }}>
          <PhoneCall className="size-3.5" />
        </span>
        <span className="flex-1 text-left text-[11px] font-bold uppercase tracking-[0.12em]">
          Group calls
        </span>
      </div>
      <div className="px-4 md:px-5 pb-2">
        <button
          type="button"
          onClick={onOpenPicker}
          className="rchip-accent flex min-h-11 w-full items-center justify-center gap-2 rounded-[11px] px-4 text-[12px] font-bold transition"
        >
          <Users className="size-4" />
          Start a group call
        </button>
      </div>
      {/* `onJoined` is a no-op rather than a close: this is a LIST on a tab, not a modal
          over the call, so there is nothing to dismiss — the engine's own call UI takes
          the screen from here. */}
      <PartyLinesSection onJoined={() => {}} defaultOpen />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

function ConversationView({ conversationId }: { conversationId: number }) {
  const { me } = useIdentity();
  const [, setLocation] = useLocation();
  const basePath = useTabBasePath();
  const utils = trpc.useUtils();

  const threadsQuery = trpc.messages.threads.useQuery(undefined, { enabled: !!me });
  const thread = useMemo(
    () => threadsQuery.data?.find((t) => t.conversationId === conversationId),
    [threadsQuery.data, conversationId]
  );

  const isGroup = thread?.kind === "group";
  // Subscribes to the per-group lock so this view re-renders when one is set,
  // removed, unlocked or re-locked (v2.105.20). The value itself is a counter and
  // is deliberately unused: the state that matters lives in localStorage plus an
  // in-memory Set, so the render just re-asks `isGroupHidden` below.
  useGroupLocks();
  // The group's status as ONE string, from the shared formatter — so the header and
  // any later surface cannot phrase the same status differently (v2.101.1).
  const groupStatusText = isGroup
    ? describeProfileStatus(thread?.groupStatus, thread?.groupStatusNote)
    : null;
  // v2.102.1 — tapping the header opens the GROUP's own info sheet (below).
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const [muted, setMuted] = useThreadMuted(conversationId);
  // For groups, fetch the roster so we can label messages with sender names.
  const infoQuery = trpc.messages.conversationInfo.useQuery(
    { conversationId },
    { enabled: !!me && isGroup, staleTime: 60_000 }
  );
  const nameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const mem of infoQuery.data?.members ?? []) m.set(mem.id, mem.displayName || mem.number);
    return m;
  }, [infoQuery.data]);
  /**
   * Board 3c — who an @mention can resolve to.
   *
   * GROUPS ONLY, and that is not an omission: a DM has exactly one other person in
   * it, so there is nobody a mention could disambiguate and highlighting one would
   * be decoration. Empty for a 1:1, which makes `linkify` byte-identical to its
   * pre-3c output there.
   *
   * MYSELF INCLUDED, because being mentioned is exactly the case worth rendering —
   * a group where the one name that never highlights is your own would be the wrong
   * way round.
   */
  /**
   * Board 3c — "5 members · 3 online" in the group header.
   *
   * READ THROUGH `directory.presenceMany`, which is the ONE reader every other
   * surface uses, rather than a second presence rule here. That funnel already
   * applies the guest-privacy suppression (v2.95) and the idle/online distinction
   * (v2.99.92) — re-deriving would be how a header comes to disagree with the LEDs
   * on the very same people, which is the divergence v2.99.95 was about.
   *
   * MYSELF EXCLUDED FROM THE COUNT, because "3 online" is about who else is here:
   * you are reading the screen, so counting yourself tells nobody anything and
   * makes an empty group read as "1 online".
   */
  const memberNumbers = useMemo(
    () =>
      isGroup
        ? (infoQuery.data?.members ?? [])
            .filter((mem) => !mem.isMe && /^\d{6}$/.test(mem.number))
            .map((mem) => mem.number)
        : [],
    [isGroup, infoQuery.data]
  );
  const memberPresence = trpc.directory.presenceMany.useQuery(
    { numbers: memberNumbers },
    { enabled: memberNumbers.length > 0, staleTime: 20_000, refetchInterval: 30_000 }
  );
  /* Rendered only once a real answer has arrived: "0 online" while the query is in
     flight is a claim about a group, and a wrong one. Undefined renders nothing at
     all, which is the honest degraded state. */
  const membersOnline = useMemo(() => {
    const rows = memberPresence.data;
    if (!rows) return undefined;
    return rows.filter((r) => r.isOnline).length;
  }, [memberPresence.data]);
  const mentionRoster = useMemo(
    () =>
      isGroup
        ? (infoQuery.data?.members ?? []).map((mem) => ({
            id: mem.id,
            name: mem.displayName || mem.number,
          }))
        : [],
    [isGroup, infoQuery.data]
  );
  /**
   * The same roster, keeping the two fields `nameById` was throwing away (v2.103.3).
   *
   * Owner: "each user's message shows a small clickable thumbnail of their profile
   * image beside their name on the left, opening their status/story."
   *
   * `conversationInfo` has ALWAYS returned `number` and `avatarUrl` alongside the
   * display name — the memo above simply discarded them — so the sender thumbnail
   * needs no server change at all. Kept as a SECOND map rather than widening the
   * first, because `nameById` has four other readers that want a plain string and
   * changing its value type would touch all of them for no gain.
   */
  /**
   * Am I an admin of THIS group (v2.104.0)? Read from the server's own answer on
   * `conversationInfo` and never inferred, because this decides only what to OFFER —
   * the actual gate is `checkGroupPermission` on the server, since a client-side check
   * on a row twenty people share is a suggestion rather than a rule.
   */
  const iAmGroupAdmin = !!(isGroup && infoQuery.data?.members.find((mem) => mem.isMe)?.isAdmin);

  /* CALL THE GROUP (#113, v2.105.7).
   *
   * The ROUND TRIP IS THE POINT, and it is why this is not just
   * `engine.dialGroup(memberNumbers)`. The server resolves two things the client
   * must not assert: that I am really in this group, and WHO ITS ADMINS ARE. It
   * hands back the numbers to ring plus a signed seed, and the seed — not a
   * client-supplied list — is what makes those admins co-hosts of the room.
   *
   * The dial goes ahead even when `hostSeed` is null (a group with no admin, or a
   * fleet with no signing secret): the call is the point and the seeding is the
   * refinement, so its absence must not cost anybody a call. */
  const engine = useRelayEngine();
  const startGroupCallMutation = trpc.messages.startGroupCall.useMutation();
  async function startGroupCall(voice: boolean) {
    if (!isGroup || !thread) return;
    try {
      const res = await startGroupCallMutation.mutateAsync({
        conversationId: thread.conversationId,
      });
      if (res.targets.length === 0) {
        toast.error("Nobody else in this group has a number to call.");
        return;
      }
      const ok = engine.dialGroup(
        res.targets.map((t) => t.number),
        { voice, seed: res.hostSeed },
      );
      if (!ok) toast.error("Couldn't start the call.");
      else setLocation("/app/call");
    } catch (e) {
      toast.error((e as Error)?.message || "Couldn't start the call.");
    }
  }

  const memberById = useMemo(() => {
    const m = new Map<number, { name: string; number: string; avatarUrl: string | null }>();
    for (const mem of infoQuery.data?.members ?? []) {
      m.set(mem.id, {
        name: mem.displayName || mem.number,
        number: mem.number,
        avatarUrl: mem.avatarUrl ?? null,
      });
    }
    return m;
  }, [infoQuery.data]);

  const messagesQuery = trpc.messages.list.useQuery(
    { conversationId, limit: 100 },
    {
      enabled: !!me,
      // SSE-gated (v2.88): 2s only while the SSE stream is down; 20s while
      // it's up (message events invalidate this query instantly).
      refetchInterval: demotablePollInterval(2_000, 20_000),
      refetchIntervalInBackground: false,
    }
  );

  // mark read whenever we open/refresh
  const markReadMutation = trpc.messages.markRead.useMutation({
    onSuccess: () => {
      utils.messages.threads.invalidate();
    },
  });
  useEffect(() => {
    if (!conversationId) return;
    // Only send a read receipt when the user is actually LOOKING at the thread:
    // the tab is visible AND they're near the bottom (not scrolled up in history).
    // Otherwise a backgrounded/scrolled-up tab gives the sender a false "read".
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    const el = scrollRef.current;
    const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight <= 150;
    if (!nearBottom) return;
    markReadMutation.mutate({ conversationId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, messagesQuery.data?.length]);
  // Re-fire the read receipt when the thread is brought back to the foreground
  // (was hidden while messages arrived), so it doesn't stay stuck "unread".
  useEffect(() => {
    if (!conversationId) return;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const el = scrollRef.current;
      const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight <= 150;
      if (nearBottom) markReadMutation.mutate({ conversationId });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const afterSend = () => {
    utils.messages.list.invalidate({ conversationId });
    utils.messages.threads.invalidate();
  };
  const sendMutation = trpc.messages.send.useMutation({ onSuccess: afterSend });
  /* A SECOND HOOK FOR THE VOICE NOTE, AND THE SEPARATION IS THE POINT.
   *
   * Both sends used to share `sendMutation`, and the text Send button is disabled on
   * `sendMutation.isPending`. The voice-note send is FIRE-AND-FORGET, so a voice request
   * that never settled left `isPending` true forever — after which the accent Send button
   * was still drawn, still looked live, and was permanently dead with nothing on screen
   * saying why. Two independent operations must not share one in-flight flag: a stuck
   * voice note is now a stuck voice note, not a thread you can no longer type in.
   *
   * It also gets a REAL onError. It had none — the upload succeeded, the send failed, and
   * the blob was discarded with no toast and no retry, so a voice note could fail 100%
   * silently while the user believed it had gone. `main.tsx` only console.errors. */
  const voiceSendMutation = trpc.messages.send.useMutation({
    onSuccess: afterSend,
    onError: (e) =>
      toast.error(e.message || "Voice note not sent — tap the mic and try again."),
  });

  /* ── self-destructing messages (v2.96) ──────────────────────────
   * Composer setting: off / view-once / 5s / 10s / 30s → sent as
   * meta.expire. Opening one as the RECIPIENT burns it server-side for
   * everyone (messages.consumeExpiring nulls the row + deletes the
   * attachment); the reader keeps a LOCAL copy on screen for the countdown
   * (or, for view-once, until they leave the thread). */
  type Msg = NonNullable<typeof messagesQuery.data>[number];
  const [expire, setExpire] = useState<null | "once" | 5 | 10 | 30>(null);
  const [revealed, setRevealed] = useState<
    Map<number, { body: string | null; attachment: Msg["attachment"]; until: number | null }>
  >(() => new Map());
  // Blob object-URLs minted for revealed view-once/expiring MEDIA, keyed by
  // message id. The burn revokes the SERVER url (attachmentId nulled → the
  // proxy 403s), so a revealed copy that merely kept the server url would show
  // a broken image the instant it burned. We fetch the bytes into a local blob
  // BEFORE burning and point the copy at that; these must be URL.revokeObjectURL'd
  // when the reveal ends (countdown purge, thread switch, unmount) or they leak.
  const objectUrlsRef = useRef<Map<number, string>>(new Map());
  function revokeReveal(id: number) {
    const u = objectUrlsRef.current.get(id);
    if (u) { URL.revokeObjectURL(u); objectUrlsRef.current.delete(id); }
  }
  function revokeAllReveals() {
    objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    objectUrlsRef.current.clear();
  }
  useEffect(() => {
    // Reveals are per-thread; switching conversations drops them (and frees any
    // local blobs minted for revealed media).
    revokeAllReveals();
    setRevealed(new Map());
    setExpire(null);
  }, [conversationId]);
  // Free any outstanding blobs when the thread view unmounts.
  useEffect(() => () => revokeAllReveals(), []);
  // M11: the content of a locked expiring message is WITHHELD from
  // messages.list — revealing fetches it via this endpoint, which returns it
  // ONCE and burns it server-side (view-once: gone for everyone). Media comes
  // back as a data URL (survives the burn — no live storage url to race), so
  // there's no client-side fetch/blob/revoke to manage anymore.
  const revealExpiringMutation = trpc.messages.revealExpiring.useMutation({
    onSuccess: () => {
      utils.messages.list.invalidate({ conversationId });
      utils.messages.threads.invalidate();
    },
  });
  // Countdown ticker: refresh the "Disappears in Ns" chip and purge timed
  // reveals whose window closed (the burned placeholder takes over).
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!Array.from(revealed.values()).some((r) => r.until != null)) return;
    const t = setInterval(() => {
      const now = Date.now();
      setRevealed((prev) => {
        let changed = false;
        const next = new Map(prev);
        next.forEach((v, k) => {
          if (v.until != null && v.until <= now) {
            next.delete(k);
            revokeReveal(k); // free the local blob whose window just closed
            changed = true;
          }
        });
        return changed ? next : prev;
      });
      forceTick((x) => x + 1);
    }, 300);
    return () => clearInterval(t);
  }, [revealed]);
  const [revealing, setRevealing] = useState<number | null>(null);
  async function revealExpiring(m: Msg) {
    const exp = m.meta as { expire?: "once" | 5 | 10 | 30 } | null;
    const mode = exp?.expire;
    if (mode == null) return;
    if (revealed.has(m.id) || revealing != null) return; // ignore double-taps
    setRevealing(m.id);
    let body: string | null = null;
    let attachment: Msg["attachment"] = null;
    let got = false;
    try {
      // Fetch the withheld content from the server, which burns it as it returns.
      const res = await revealExpiringMutation.mutateAsync({ messageId: m.id });
      if (!res.ok && "tooLarge" in res && res.tooLarge) {
        // v2.99.57: NOTHING was burned — the message is intact. Say so, instead of
        // falling through to the generic path that would leave a blank card.
        toast.error("This attachment is too large to open here. It hasn't been used up.");
        setRevealing(null);
        return;
      }
      if (res.ok) {
        got = true;
        body = res.body ?? null;
        if (res.media) {
          // A data: URL renders directly and survives the burn — no fetch/blob.
          attachment = {
            ...(m.attachment ?? {}),
            url: res.media.dataUrl,
            thumbUrl: null,
            mimeType: res.media.mimeType,
          } as unknown as Msg["attachment"];
        }
      }
    } catch {
      /* transient — handled below, same as an explicit refusal */
    }
    setRevealing(null);
    // v2.99.49: only cache a reveal we actually RECEIVED.
    //
    // M22 made the burn atomic, so a second device/tab that loses the race is now
    // correctly refused ({ok:false}) instead of being handed the content. But this
    // wrote `revealed` unconditionally, so the loser rendered an EMPTY bubble
    // still wearing the "View once — gone when you leave" chip (the `copy` branch
    // is checked before the `burned` branch), and because `revealed.has(id)` was
    // then true the early return above made it unretryable for the rest of the
    // thread session — with `until === null` for view-once, it never self-purged
    // either. Refetch instead: the row's own consumed state drives the honest
    // "This message has disappeared" placeholder, and a TRANSIENT failure
    // (network, 429, the aggregate reveal budget) stays retryable, which matters
    // because in those cases the message was NOT burned.
    if (!got) {
      utils.messages.list.invalidate().catch(() => {});
      return;
    }
    const until = mode === "once" ? null : Date.now() + mode * 1000;
    setRevealed((prev) => {
      const next = new Map(prev);
      next.set(m.id, { body, attachment, until });
      return next;
    });
  }
  const removeMutation = trpc.messages.remove.useMutation({
    // Optimistically drop the message from the visible list the instant the user
    // unsends, so it doesn't linger (or reappear on the next 2s poll) while the
    // server round-trips. Snapshot + restore on failure so a failed unsend
    // doesn't silently vanish the message from the UI while it still exists.
    onMutate: async ({ messageId }) => {
      const input = { conversationId, limit: 100 } as const;
      await utils.messages.list.cancel(input);
      const prev = utils.messages.list.getData(input);
      utils.messages.list.setData(input, (old) =>
        old ? old.filter((m) => m.id !== messageId) : old
      );
      return { prev, input };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) utils.messages.list.setData(context.input, context.prev);
      toast.error("Couldn't unsend that message — restored it.");
    },
    onSettled: () => {
      utils.messages.list.invalidate({ conversationId });
      utils.messages.threads.invalidate();
    },
  });
  /**
   * "Delete for me" (v2.102.2). Optimistic with snapshot-and-restore, the SAME shape
   * unsend uses above — a hide that stayed on screen until the next poll would read as
   * a control that did nothing, and a failed one must put the message back rather than
   * silently vanishing something that still exists for everybody.
   */
  /**
   * v2.104.0 — a group admin removes somebody else's message for everyone.
   *
   * NOT optimistic, unlike `hide` below. Hiding affects only the person doing it, so a
   * rollback is invisible to anybody else; this removes a row twenty people are looking
   * at, and a failure already painted as success would leave the admin believing they
   * had removed something the server refused. It invalidates instead, and the other
   * members learn through the SSE event the endpoint fans out.
   */
  const adminDeleteMutation = trpc.messages.deleteAsAdmin.useMutation({
    onSuccess: async () => {
      await utils.messages.list.invalidate({ conversationId, limit: 100 });
      await utils.messages.threads.invalidate();
      toast.success("Removed for everyone");
    },
    onError: (e) => toast.error(e.message || "Couldn't remove that — it's still here."),
  });

  const hideMutation = trpc.messages.hide.useMutation({
    onMutate: async ({ messageId }) => {
      const input = { conversationId, limit: 100 } as const;
      await utils.messages.list.cancel(input);
      const prev = utils.messages.list.getData(input);
      utils.messages.list.setData(input, (old) =>
        old ? old.filter((m) => m.id !== messageId) : old
      );
      return { prev, input };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) utils.messages.list.setData(context.input, context.prev);
      toast.error("Couldn't delete that for you — it's still here.");
    },
    onSettled: () => {
      utils.messages.list.invalidate({ conversationId });
      // The thread list too: hiding the NEWEST message changes the preview and can
      // change the unread badge, so refreshing only the open thread would leave the
      // list describing a message this person can no longer see.
      utils.messages.threads.invalidate();
    },
  });
  // "I'm typing" ping — throttled to at most once per 3s while actively typing.
  const typingMutation = trpc.messages.typing.useMutation();
  const lastTypingRef = useRef(0);
  function notifyTyping() {
    const now = Date.now();
    if (now - lastTypingRef.current < 3000) return;
    lastTypingRef.current = now;
    typingMutation.mutate({ conversationId });
  }
  // Who's typing in THIS conversation (excludes me; resolved to names below).
  const typers = useTypers(conversationId).filter((id) => id !== me?.id);
  // Unsend confirmation via AlertDialog (v2.88 — native confirm() is gone).
  const [unsendId, setUnsendId] = useState<number | null>(null);
  // "Delete for me" (v2.102.2) — its own confirmation, because it is a DIFFERENT
  // operation from unsend and a shared dialog would have to describe both.
  const [hidingId, setHidingId] = useState<number | null>(null);
  /** v2.104.0 — the message a group admin is about to remove for everyone. */
  const [adminDeleting, setAdminDeleting] = useState<Msg | null>(null);
  /* Board 4c — reactions. `reactingTo` is which message's quick row is open (one at
     a time: two open rows is two things claiming to be "the focused bubble"), and
     `pickerFor` is the message whose `+` opened the full catalogue. */
  const [reactingTo, setReactingTo] = useState<number | null>(null);
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const reactMutation = trpc.messages.react.useMutation({
    /* NOT invalidated on success. The SSE `reaction` event fans to every member
       INCLUDING this device, and that refetch is the one that lands — invalidating
       here as well would fire a second identical request for every tap. A failure
       still needs saying, because the chip has already been drawn optimistically by
       the refetch that the event triggers, and a silent one leaves a reaction that
       looks recorded and is not. */
    onError: () => toast.error("Couldn't save that reaction — try again."),
  });
  /**
   * One tap, from EITHER entry point — the quick row or an existing chip.
   *
   * The op comes from the shared `reactionOpFor` rather than being decided at each
   * site, so the row and the chips cannot come to mean different things by a tap on
   * the same emoji. Closing the row is unconditional: a reaction is a single act, and
   * leaving the row open invites a second tap that would silently undo the first.
   */
  const toggleReaction = (m: Msg, emoji: string) => {
    const mine = myReaction((m as { reactions?: MessageReactions }).reactions, me?.number ?? "");
    const { op } = reactionOpFor(mine, emoji);
    reactMutation.mutate({ messageId: m.id, emoji, op });
    setReactingTo(null);
    setPickerFor(null);
  };
  // v2.99.74 — message Info (sent/delivered/read) and Forward-to-another-thread.
  const [infoOf, setInfoOf] = useState<Msg | null>(null);
  const [forwarding, setForwarding] = useState<Msg | null>(null);
  const [forwardBusy, setForwardBusy] = useState(false);
  // Every conversation EXCEPT this one — forwarding a message back into the thread
  // it is already in is never what anybody means, and offering it invites the tap.
  const forwardTargets = useMemo(
    () => (threadsQuery.data ?? []).filter((t) => t.conversationId !== conversationId),
    [threadsQuery.data, conversationId]
  );

  /**
   * Forward one message into another conversation.
   *
   * Re-SENDS rather than re-pointing a row: the target thread gets its own message
   * with its own receipts, which is what makes forwarding behave like sending. An
   * attachment is carried by id — `messages.send` re-checks that the sender may use
   * that attachment, so this cannot be used to smuggle media the forwarder could not
   * already see.
   *
   * Deliberately never forwards an EXPIRING message: its whole contract is that it
   * exists once and then does not, and copying it into another thread would quietly
   * break that for the person who sent it.
   */
  async function forwardTo(target: { id: number }, m: Msg) {
    setForwardBusy(true);
    try {
      await sendMutation.mutateAsync({
        conversationId: target.id,
        kind: m.attachment ? (m.kind as "image" | "video" | "audio" | "file") : "text",
        body: m.body ?? undefined,
        attachmentId: m.attachment ? (m.attachment as { id: number }).id : undefined,
      });
      toast.success("Forwarded");
      setForwarding(null);
    } catch {
      toast.error("Couldn't forward that message");
    } finally {
      setForwardBusy(false);
    }
  }
  function deleteMessage(messageId: number) {
    setUnsendId(messageId);
  }

  // ── composer state ──
  // The in-progress text + active reply target persist to localStorage (per
  // conversation) so navigating away mid-draft — or a reload — doesn't lose it.
  const { draft, update: updateDraft, clear: clearDraft } = useDraft(conversationId);
  const text = draft.text;
  function setText(updater: string | ((s: string) => string)) {
    updateDraft({ text: typeof updater === "function" ? updater(draft.text) : updater });
  }
  const [emojiOpen, setEmojiOpen] = useState(false);
  // Escape closes the emoji picker, matching MediaLightbox's pattern.
  useEffect(() => {
    if (!emojiOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setEmojiOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [emojiOpen]);
  // Fullscreen media preview (image/video lightbox).
  const [lightbox, setLightbox] = useState<LightboxMedia | null>(null);
  const [replyingTo, setReplyingToState] = useState<{
    id: number;
    senderIdentityId: number;
    body: string | null;
    kind: string;
    // meta MUST ride along (QA H2): previewOf() only masks a disappearing
    // message's body when it can see `meta.expire`. Without it the reply bar
    // printed the raw secret of an expiring message.
    meta?: unknown;
  } | null>(null);
  function setReplyingTo(m: { id: number; senderIdentityId: number; body: string | null; kind: string; meta?: unknown } | null) {
    setReplyingToState(m);
    updateDraft({ replyToId: m?.id ?? null });
  }
  // Reply target is per-conversation (QA M5): a "Replying to Alice" banner from
  // one thread must not leak into the next and post with the wrong replyToId.
  // Clearing it here lets the draft-reconstruct effect below re-hydrate the
  // NEW conversation's own saved reply (if any).
  useEffect(() => { setReplyingToState(null); }, [conversationId]);
  // Quick lookup of a message by id (to render the quoted reply preview).
  const msgById = useMemo(() => {
    const m = new Map<number, { senderIdentityId: number; body: string | null; kind: string; meta?: unknown }>();
    for (const x of messagesQuery.data ?? []) m.set(x.id, x);
    return m;
  }, [messagesQuery.data]);
  // A saved draft's reply target is just an id — reconstruct the rich preview
  // object once its message is available (it's near-always already loaded,
  // since a draft reply was set on a recently-visible message).
  useEffect(() => {
    if (draft.replyToId == null || replyingTo) return;
    const m = msgById.get(draft.replyToId);
    if (m) setReplyingToState({ id: draft.replyToId, senderIdentityId: m.senderIdentityId, body: m.body, kind: m.kind, meta: (m as { meta?: unknown }).meta });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.replyToId, msgById]);
  function senderLabel(identityId: number): string {
    if (me && identityId === me.id) return "You";
    return nameById.get(identityId) || thread?.peerDisplayName || "Them";
  }

  /* Board 4e wants the fullscreen viewer to say WHOSE media this is and WHEN — the
     bubble it was opened from carries both, and the viewer was throwing them away.
     A wrapper rather than new props on `AttachmentView`: that component renders the
     same media inside a bubble that already shows the sender, so teaching it about
     message identity would be giving it a fact it has no use for.
     The caption is the message's own body, which is exactly what sits under the
     image in the thread — an image with a caption should not lose it fullscreen. */
  function openMedia(m: { senderIdentityId: number; createdAt: string | Date; body: string | null }) {
    return (media: { url: string; type: "image" | "video"; name?: string }) =>
      setLightbox({
        ...media,
        sender: senderLabel(m.senderIdentityId),
        at: m.createdAt,
        caption: m.body ?? "",
      });
  }
  function previewOf(msg: { body: string | null; kind: string; meta?: unknown } | undefined): string {
    if (!msg) return "Message";
    // Never quote a self-destructing message's content (v2.96).
    if ((msg.meta as { expire?: unknown } | null)?.expire != null) return "⏱ Disappearing message";
    /* #115 — quoting a story reply used to show a bare emoji here too, so the SECOND
       surface with the gap gets the same shared rule rather than its own wording.
       The expire guard stays AHEAD of it: a locked message must never be described,
       whatever else it happens to be. */
    const sr = statusReplyOf(msg.meta);
    if (sr) return `↩ ${storyKindLabel(sr.kind)}${msg.body ? ` · ${msg.body.slice(0, 60)}` : ""}`;
    if (msg.body) return msg.body.length > 80 ? msg.body.slice(0, 80) + "…" : msg.body;
    return msg.kind === "image" ? "📷 Photo"
      : msg.kind === "video" ? "🎬 Video"
      : msg.kind === "audio" ? "🎤 Voice message"
      : msg.kind === "file" ? "📎 Attachment"
      : "Message";
  }
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [pendingUpload, setPendingUpload] = useState<{ id: number; url: string; mimeType: string; filename?: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  // In-app video recorder (v2.96.2): iOS blocks the SYSTEM camera's video
  // recording while on a call, so the image button opens a chooser — record
  // in-app (works mid-call) or pick from the library.
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [videoRecOpen, setVideoRecOpen] = useState(false);
  // A picked-but-unsent attachment must not follow the user into a DIFFERENT
  // conversation when they switch threads — it would otherwise sit silently
  // staged and get attached to whatever they next send there.
  useEffect(() => {
    setPendingUpload(null);
  }, [conversationId]);

  // ── in-conversation search ──
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  const searchResults = trpc.messages.search.useQuery(
    { conversationId, query: debouncedSearch },
    { enabled: !!me && searchOpen && debouncedSearch.length > 0 }
  );
  function closeSearch() {
    setSearchOpen(false);
    setSearchInput("");
    setDebouncedSearch("");
  }

  /* What the peer's profile popup gets when it is opened from THIS conversation
     (v2.99.66): the search and notification controls that used to crowd the
     header, plus the full last-seen line with its clock. Rebuilt whenever the
     inputs change so the popup never acts on a stale mute value. */
  const peerProfileChat: PeerProfileChatActions = useMemo(
    () => ({
      onSearch: () => setSearchOpen(true),
      muted,
      onToggleMute: () => setMuted(!muted),
      lastSeenText: thread?.peerLastSeenAt
        ? formatLastSeen(new Date(thread.peerLastSeenAt).getTime(), Date.now()) || null
        : null,
    }),
    [muted, setMuted, thread?.peerLastSeenAt]
  );

  // Tapping the header: a GROUP opens its own info sheet, where until now the tap did
  // nothing at all for a group (it only ever opened a peer's profile for a DM), so a
  // dead tap becomes the way in. ONE handler for both kinds, because two would be two
  // places that can come to disagree about which tap does what.
  const openHeader = () => {
    if (isGroup) setGroupInfoOpen(true);
    // A DM opens the peer's profile popup (v2.96 spec: "click anywhere on the name …
    // see their profile") — carrying this conversation's search + notification
    // controls and the full last-seen line, which the header has no room for
    // (v2.99.66).
    else if (thread?.peerNumber) openPeerProfile(thread.peerNumber, peerProfileChat);
  };

  // scroll-to-bottom on new message — but DON'T yank the user down while they're
  // reading history. Only auto-scroll when already near the bottom; always jump
  // when the thread itself changes (opening a thread should land at the bottom).
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevConvoRef = useRef<number | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threadChanged = prevConvoRef.current !== conversationId;
    prevConvoRef.current = conversationId;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (threadChanged || fromBottom <= 150) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messagesQuery.data?.length, conversationId]);

  // "Scroll to bottom" floating button — shown once the user has scrolled UP
  // away from the latest message, so catching back up after reading history
  // doesn't require manually dragging the scrollbar.
  const [showScrollButton, setShowScrollButton] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Bug fix: catching back up by scrolling to the bottom after reading
    // history used to never re-fire the read receipt — only a NEW message
    // arriving or the tab regaining focus did. If neither happened again, the
    // thread stayed "unread" forever (badge lit, sender never got ✓✓) even
    // though the user had actually read everything. Debounced so a scroll
    // gesture doesn't fire a mutation per frame.
    let markReadT: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollButton(fromBottom > 150);
      if (fromBottom <= 150 && document.visibilityState === "visible") {
        if (markReadT) clearTimeout(markReadT);
        markReadT = setTimeout(() => {
          markReadMutation.mutate({ conversationId });
        }, 400);
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (markReadT) clearTimeout(markReadT);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);
  function scrollToBottom() {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }

  async function uploadFile(file: File) {
    if (file.size > 40 * 1024 * 1024) {
      toast.error("File exceeds the 40 MB limit.");
      return;
    }
    setUploading(true);
    try {
      let json;
      // PHOTOS (v2.89): downscale on-canvas before upload (cap 2048px, webp
      // q≈0.85 / jpeg fallback, original kept when it's already smaller) and
      // ship a ≤512px thumbnail alongside — bubbles render the thumb, tapping
      // opens the full image. GIFs skip (animation) and ANY pipeline failure
      // falls back to the untouched original upload path.
      const processed = isDownscalableImage(file.type)
        ? await processImageForUpload(file).catch(() => null)
        : null;
      if (processed) {
        let thumbKey: string | undefined;
        if (processed.thumb) {
          try {
            const t = await uploadThumbnail(processed.thumb.blob, { mimeType: processed.thumb.mime });
            thumbKey = t.storageKey;
          } catch {
            /* thumbs are best-effort — the full image still uploads */
          }
        }
        json = await uploadAttachment(processed.main.blob, {
          filename: processed.main.filename,
          mimeType: processed.main.mime,
          width: processed.main.width,
          height: processed.main.height,
          thumbKey,
        });
      } else {
        json = await uploadAttachment(file, {
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
        });
      }
      setPendingUpload({ id: json.id, url: json.url, mimeType: json.mimeType, filename: json.filename ?? file.name });
    } catch (err) {
      toast.error("Upload failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUploading(false);
    }
  }
  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so re-picking the same file fires onChange
    if (!file) return;
    await uploadFile(file);
  }
  // Paste an image/video straight from the clipboard (e.g. a screenshot) into
  // the composer, reusing the same upload path + 40MB limit as the picker.
  // Plain-text pastes are a no-op here — the browser handles those natively.
  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const file = Array.from(e.clipboardData?.files || []).find(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
    );
    if (!file) return;
    e.preventDefault();
    void uploadFile(file);
  }

  async function send() {
    const body = text.trim();
    if (!body && !pendingUpload) return;
    const upload = pendingUpload;
    const reply = replyingTo;
    const kind = upload
      ? upload.mimeType.startsWith("image/")
        ? "image"
        : upload.mimeType.startsWith("video/")
          ? "video"
          : upload.mimeType.startsWith("audio/")
            ? "audio"
            : "file"
      : "text";
    // QA M3: never attach an expire in a group thread (one shared row burns for
    // all on the first open). The toggle is already hidden in groups; this is the
    // defensive backstop so a stale value can't slip a disappearing message in.
    const exp = isGroup ? null : expire;
    // Clear the composer immediately (snappy), but if the send FAILS restore the
    // text/reply/attachment so the message is never silently lost — the user can
    // just tap send again. (Prevents the "I typed a message and it vanished" bug.)
    clearDraft();
    setReplyingToState(null);
    setPendingUpload(null);
    setEmojiOpen(false);
    setExpire(null); // per-send setting — never silently sticks to the next message
    try {
      await sendMutation.mutateAsync({
        conversationId,
        kind,
        body: body || null,
        attachmentId: upload?.id ?? null,
        replyToId: reply?.id ?? null,
        meta: exp != null ? { expire: exp } : undefined,
      });
    } catch (e) {
      setText(body);
      if (reply) setReplyingToState(reply);
      if (upload) setPendingUpload(upload);
      if (exp != null) setExpire(exp);
      /* THE SERVER'S OWN REASON, not a guess about the network.
       *
       * This was a bare `catch` reporting "check your connection" for EVERY failure — and
       * the failures that actually happen here are not connection failures. "You can't
       * message this person." (they blocked you), "not a member of this conversation", a
       * stale `replyToId` rehydrated from a saved draft, an attachment that is not yours,
       * a lost identity: every one of them read as a network blip, and tapping send again
       * never helped. Being told to retry something that can never succeed is exactly
       * "I cannot send messages".
       *
       * Every other mutation in this file already surfaces `e.message`; this was the one
       * that did not. The connection wording survives only as the fallback for an error
       * that genuinely carries no message. */
      const why = e instanceof Error ? e.message.trim() : "";
      toast.error(why || "Message not sent — check your connection and tap send again.");
    }
  }

  function insertEmoji(e: string) {
    setText((s) => s + e);
  }

  /* Board 3c — the @mention autocomplete. Only ever open in a GROUP: a DM has one
     other person in it, so there is nobody to disambiguate. */
  const composerRef = useRef<HTMLInputElement | null>(null);
  const [mentionQuery, setMentionQuery] = useState<{ query: string; start: number } | null>(null);
  const mentionMatches = useMemo(
    () =>
      mentionQuery && mentionRoster.length
        ? rankMentionMatches(mentionQuery.query, mentionRoster)
        : [],
    [mentionQuery, mentionRoster]
  );
  /** Re-read the token at the caret after any edit or caret move. */
  function syncMentionQuery(el: HTMLInputElement | null) {
    if (!isGroup || !el) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(mentionQueryAt(el.value, el.selectionStart ?? el.value.length));
  }
  /**
   * Complete the mention being typed.
   *
   * THE CARET IS RESTORED IMPERATIVELY AFTER THE STATE WRITE, because React
   * re-renders a controlled input with the caret at the END — so inserting a mention
   * mid-sentence would jump the cursor past everything the user had already written.
   * The `requestAnimationFrame` waits for that render rather than fighting it.
   */
  function pickMention(member: { id: number; name: string }) {
    const el = composerRef.current;
    if (!el) return;
    const applied = applyMention(el.value, el.selectionStart ?? el.value.length, member);
    if (!applied) return;
    setText(applied.text);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const cur = composerRef.current;
      if (!cur) return;
      cur.focus();
      cur.setSelectionRange(applied.caret, applied.caret);
    });
  }

  // ── voice-note recording ──
  // The MediaRecorder plumbing (Safari-safe MIME probing, mic release, cap)
  // lives in the SHARED client/src/lib/voiceNote.ts since v2.88 — the same
  // helpers power the after-dial voicemail prompt.
  const recordingRef = useRef<VoiceRecording | null>(null);
  // Still mounted? Guards the mic-acquisition await (v2.99.36) AND releases a
  // live recording if the user navigates away mid-record.
  const recorderAliveRef = useRef(true);
  useEffect(() => {
    recorderAliveRef.current = true;
    return () => {
      recorderAliveRef.current = false;
      try { recordingRef.current?.cancel(); } catch { /* */ }
      recordingRef.current = null;
    };
  }, []);
  const [recording, setRecording] = useState(false);
  // v2.99.72: pause/resume and discard, so a recording is not a one-way trip to Send.
  const [recPaused, setRecPaused] = useState(false);
  const getRecording = useCallback(() => recordingRef.current, []);
  function toggleRecPause() {
    const rec = recordingRef.current;
    if (!rec) return;
    if (rec.state() === "paused") {
      rec.resume();
      setRecPaused(false);
    } else {
      rec.pause();
      // Read the state back rather than assuming: an engine without pause support
      // leaves the recorder running, and the UI must not claim otherwise.
      setRecPaused(rec.state() === "paused");
    }
  }
  function discardRecording() {
    // `cancel()` resolves `done` with null, so the upload never happens — the note is
    // gone rather than sent-and-unsent.
    try {
      recordingRef.current?.cancel();
    } catch {
      /* a wedged recorder must not stop Discard from working */
    }
    /* DISCARD RETURNS THE COMPOSER UNCONDITIONALLY, WITHOUT WAITING FOR THE RECORDER.
     *
     * `setRecording(false)` also runs in the recording promise's `.finally()`, and that is
     * the normal path — but it can only run once the promise SETTLES, and the whole reason
     * this was unrecoverable is that the promise could hang. While `recording` is true the
     * composer is REPLACED by the recording bar, so a recorder that never answered took
     * the text field and the send button with it and left its own Discard button as a
     * no-op. `voiceNote.ts` now guarantees the promise settles; this is the belt to that
     * braces, and it is cheap: setting the flag twice is idempotent, while relying on one
     * mechanism is how "there is no way out of this screen" happened. */
    recordingRef.current = null;
    setRecording(false);
    setRecPaused(false);
  }

  // Safety net: if the conversation unmounts while recording, cancel so the
  // getUserMedia mic doesn't stay live (LED on).
  useEffect(() => {
    return () => {
      recordingRef.current?.cancel();
      recordingRef.current = null;
    };
  }, []);

  /* LEAVING A THREAD ENDS THE RECORDING, and the missing sibling of this is 300 lines
   * above: `pendingUpload` IS reset on a conversation change, for exactly the reason that
   * an attachment picked in one chat must not be sent to the next one. A recording had no
   * such reset — so switching threads mid-record left the recording bar sitting over the
   * NEW conversation with a live mic and a take belonging to the OLD one, and whichever
   * thread was open when it stopped is where it landed.
   *
   * `discardRecording` already cancels the recorder, nulls the ref and clears both flags
   * unconditionally, so this needs no new mechanism — only the call nobody made. */
  useEffect(() => {
    return () => {
      discardRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  async function startRecording() {
    if (!recorderSupported()) {
      toast.error(
        "Voice notes aren't supported by this browser yet. Try the latest Safari/Chrome, or send an audio file via the paperclip instead."
      );
      return;
    }
    try {
      const rec = await startVoiceRecording();
      // v2.99.36: if this thread view unmounted while the mic was being
      // acquired, nothing will ever hold this handle — cancel it at once or the
      // microphone stays captured (indicator lit) with no way to stop it.
      if (!recorderAliveRef.current) { rec.cancel(); return; }
      recordingRef.current = rec;
      setRecording(true);
      setRecPaused(false);
      void rec.done
        .then(async (result) => {
          /* THE COMPOSER COMES BACK BEFORE THE UPLOAD, NOT AFTER IT — the v2.106.30
           * lock-out, one step downstream.
           *
           * The recording is OVER by the time this runs: the take is in hand and the mic
           * is released. But `recording` stayed true across the whole upload, and while it
           * is true the composer is REPLACED by the recording bar — whose three controls
           * are all disabled mid-upload. So a 60-second voice note on a slow uplink left
           * the person with no text field, no send and no way out for as long as the
           * transfer took, and if the transfer hung, indefinitely. Settling the promise
           * was the fix for the recorder; this is the same rule applied to the step after
           * it — the bar exists to represent a LIVE recording, so it must not outlive one.
           *
           * The `.finally()` below is KEPT and becomes idempotent: these are cheap flag
           * writes, and relying on one mechanism is how the original lock-out happened. */
          recordingRef.current = null;
          setRecording(false);
          setRecPaused(false);
          if (!result) return; // cancelled / empty
          // uploadBlob() re-throws on failure (it only resets `uploading` in
          // its own finally) — catch here or the error escapes into a void handler.
          try {
            await uploadBlob(result.blob, `voice-note.${result.ext}`, result.durationMs);
          } catch {
            toast.error("Failed to save voice note");
          }
        })
        .finally(() => {
          recordingRef.current = null;
          setRecording(false);
          setRecPaused(false);
        });
    } catch (err) {
      toast.error(
        "Mic access required for voice notes: " +
          (err instanceof Error ? err.message : String(err))
      );
    }
  }
  function stopRecording() {
    recordingRef.current?.stop();
  }
  async function uploadBlob(blob: Blob, filename: string, durationMs?: number) {
    setUploading(true);
    try {
      const json = await uploadAttachment(blob, { filename, mimeType: blob.type, durationMs });
      const exp = expire;
      setExpire(null);
      // Its OWN mutation, so a stuck voice send cannot disable the text Send button —
      // and it reports its own failures, which it never used to.
      voiceSendMutation.mutate({
        conversationId,
        kind: "audio",
        body: null,
        attachmentId: json.id,
        // Voice notes honor the composer's disappearing setting too (v2.96).
        meta: exp != null ? { expire: exp } : undefined,
      });
    } finally {
      setUploading(false);
    }
  }

  if (!me) return null;

  /* ── THE GROUP LOCK (v2.105.20, #108) ──────────────────────────────────────
     A FULL EARLY RETURN, and that is the whole reason the lock is hard to walk
     around. Every route into a conversation ends here — a thread-row tap, a
     `?c=<id>` deep link, a notification tap, a reload, the swipe row's own
     navigation — so gating the VIEW covers all of them by construction, where
     gating each entry point would have needed a check per route and one of them
     would have been forgotten.

     It replaces the HEADER too, not just the message list, because the header
     opens the group's details (its roster, its photo, its own lock control) and
     leaving that reachable would hand out most of what the lock covers. The cost
     is that the details cannot be used to remove a forgotten lock — which is why
     `attemptOpenGroup` accepts the app passcode at the gate itself.

     `useGroupLocks()` above is what makes this re-evaluate: without a subscription
     a correct code would change the module's state and leave the gate on screen.
     It is also the ONE mechanism — the gate has no success callback, because two
     ways to drive one transition is how the forgotten one leaves it stuck. */
  if (isGroup && isGroupHidden(conversationId)) {
    return (
      <>
        <header className="flex items-center gap-2 border-b border-border/70 bg-card/90 px-2 py-2 md:rounded-t-2xl md:px-4">
          <button
            type="button"
            aria-label="Back"
            className="grid size-8 shrink-0 place-items-center md:hidden hover:brightness-110"
            style={{ color: "#52e3d0" }}
            onClick={() => setLocation(basePath)}
          >
            <ChevronLeft className="size-6" />
          </button>
          {/* The NAME is shown, and only the name. The thread list already shows it
              (that is what makes a locked group findable at all), so repeating it
              here leaks nothing the previous screen did not — while a nameless lock
              screen would leave somebody unsure which group they had opened. */}
          <span dir="auto" className="min-w-0 truncate text-[15px] font-semibold">
            {thread?.title || "Group"}
          </span>
          <Lock aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        </header>
        <GroupLockGate conversationId={conversationId} title={thread?.title || "Group"} />
      </>
    );
  }

  return (
    <>
      {/* conversation header — ONE compact bar (the app's top bar is hidden on
          mobile while a chat is open): back, avatar + presence LED, name +
          verified badge, and a live status line (typing… > online > last seen). */}
      <header className="shrink-0 flex items-center gap-2 px-2 md:px-4 py-2 border-b border-border/70 bg-card/90 supports-[backdrop-filter]:bg-card/70 supports-[backdrop-filter]:backdrop-blur-md md:rounded-t-2xl">
        <button
          type="button"
          aria-label="Back"
          className="md:hidden grid place-items-center size-8 shrink-0 hover:brightness-110"
          style={{ color: "#52e3d0" }}
          onClick={() => setLocation(basePath)}
        >
          <ChevronLeft className="size-6" />
        </button>
        <div className="relative shrink-0">
          {isGroup ? (
            /* The group's own photo when it has one (v2.102.1) — this disc still drew
               the generic glyph even for a group with a picture, so the thread row and
               its own header disagreed about the same group. A broken URL falls back to
               the glyph, never the browser's broken-image icon. */
            thread?.groupAvatarUrl ? (
              <img
                src={thread.groupAvatarUrl}
                alt=""
                className="size-9 rounded-full border border-border/60 bg-muted/40 object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div
                className="size-9 rounded-full grid place-items-center"
                style={{ background: "rgba(167,139,250,.16)", color: "#a78bfa" }}
              >
                <Users className="size-4.5" />
              </div>
            )
          ) : (
            /* Real profile photo + status ring (v2.96); tap = status/profile. */
            <PeerAvatar
              number={thread?.peerNumber}
              name={thread?.peerDisplayName}
              avatarUrl={thread?.peerAvatarUrl}
              size={36}
            >
              {/* Presence LED: green = online, grey = offline (v2.88 —
                  red used to read as "busy/error"). */}
              {(() => {
                const dot = presenceDot({ isOnline: thread?.peerIsOnline, idle: thread?.peerIdle });
                return (
                  <span
                    aria-label={dot.label}
                    title={dot.label}
                    className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card"
                    style={{ background: dot.color, boxShadow: dot.glow || undefined }}
                  />
                );
              })()}
            </PeerAvatar>
          )}
        </div>
        <div
          className="flex-1 min-w-0 leading-tight"
          role={isGroup || thread?.peerNumber ? "button" : undefined}
          tabIndex={isGroup || thread?.peerNumber ? 0 : undefined}
          onClick={openHeader}
          onKeyDown={(e) => {
            if ((isGroup || thread?.peerNumber) && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              openHeader();
            }
          }}
        >
          <div className="font-semibold text-[15px] truncate flex items-center gap-1.5">
            <span className="truncate">
              {isGroup
                ? thread?.title || thread?.peerDisplayName || "Group"
                : thread?.peerDisplayName || thread?.peerNumber || "Conversation"}
            </span>
            {/* A group has no tier — the badge describes a person's account. */}
            {thread && !isGroup && (
              <RoleBadge role={roleFromFlags(thread.peerRole, thread.peerVerified)} size={15} />
            )}
          </div>
          <div className="text-[11px] truncate flex items-center gap-1.5">
            {/* v2.99.10 (owner): show the peer's PIN next to the name area on
                every 1:1 thread — "where's the name, the PIN should show". */}
            {!isGroup && thread?.peerNumber && /^\d{6}$/.test(thread.peerNumber) && (
              <span className="font-mono text-muted-foreground" dir="ltr">
                {thread.peerNumber.slice(0, 3)}-{thread.peerNumber.slice(3)}
              </span>
            )}
            {/* The GROUP's own 6-digit id (v2.102.0), in the same place a person's
                sits — so the two read as the same kind of fact. dir="ltr" so an RTL
                locale cannot reorder the digits. */}
            {isGroup && thread?.groupNumber && /^\d{6}$/.test(thread.groupNumber) && (
              <span className="font-mono text-muted-foreground" dir="ltr">
                {thread.groupNumber.slice(0, 3)}-{thread.groupNumber.slice(3)}
              </span>
            )}
            {/* The group's status label, from the SAME vocabulary a person's uses. */}
            {isGroup && groupStatusText && (
              <span className="truncate text-muted-foreground">{groupStatusText}</span>
            )}
            {((!isGroup && thread?.peerNumber) || (isGroup && thread?.groupNumber)) && (
              <span className="text-muted-foreground/40">·</span>
            )}
            {/* TYPING IS ANNOUNCED ONCE, and this arm is the one that goes.
                It used to fire here AND in `TypingLine` above the composer at the same
                time — the same fact twice on one screen — and in a GROUP it also DROPPED
                "5 members · 3 online" the moment anybody typed, so the header lost the
                group's size to repeat something already visible.
                `TypingLine` is the one kept because it is strictly better: it names WHO is
                typing and colours each person with `nameColorFor`, which an anonymous
                "typing…" cannot, and it sits OUTSIDE the scroll container so it can never
                push the list. Scoped to non-group here rather than removed outright, so a
                1:1 header — which has no members line to protect — is unchanged. */}
            {typers.length > 0 && !isGroup ? (
              <span className="text-[color:var(--relay-online)] font-medium animate-pulse">typing…</span>
            ) : isGroup ? (
              <span className="text-muted-foreground">
                {`${thread?.memberCount ?? infoQuery.data?.members.length ?? ""} members`}
                {/* Board 3c. Withheld entirely when nobody else is online, rather
                    than shown as a zero: "0 online" spends a line saying nothing,
                    and the member count above it already carries the group's size.
                    Green because it is PRESENCE — the one thing green means in this
                    app — using the AA-measured text token rather than the LED hue,
                    which fails contrast at this size (v2.99.86). */}
                {membersOnline != null && membersOnline > 0 && (
                  <>
                    <span className="text-muted-foreground/40"> · </span>
                    <span className="text-[color:var(--relay-green-text)] font-medium">
                      {membersOnline} online
                    </span>
                  </>
                )}
              </span>
            ) : thread?.peerIsOnline && thread?.peerIdle ? (
              // Backgrounded (v2.99.92) — "away", not "online", and not the
              // "last seen 3s ago" that minimising used to produce.
              <span className="text-muted-foreground font-medium">away</span>
            ) : thread?.peerIsOnline ? (
              <span className="text-[color:var(--relay-online)] font-medium">online</span>
            ) : thread?.peerLastSeenAt ? (
              // Short stamp here (the header is one cramped line); the profile
              // popup carries the full date + time.
              <span className="text-muted-foreground truncate">last seen {timeAgo(thread.peerLastSeenAt)}</span>
            ) : (
              <span className="text-muted-foreground">offline</span>
            )}
          </div>
        </div>
        {/* The bell and the magnifier used to live here permanently (v2.99.66,
            owner): on a phone they squeezed the name to "Ibrahi…" and left the
            "last seen" line with nothing after it. Both are conversation-scoped,
            so they moved into the peer's profile — tap the name — where there is
            room for a label and for the full last-seen date and time. Only the
            close-search affordance stays inline, and only while search is open,
            because that one is about the panel currently on screen. */}
        {searchOpen && (
          <Button
            size="icon"
            variant="ghost"
            onClick={closeSearch}
            aria-label="Close search"
            title="Close search"
            className="size-8 shrink-0 text-primary"
          >
            <X className="size-5" />
          </Button>
        )}
        {!isGroup && thread?.peerNumber && (
          <>
            {/* BOARD 1d: VIDEO first, then CALL — and the call chip is the ACCENT while
                video is neutral glass, because a 1:1 conversation's primary action is to
                ring the person.
                THAT ALSO RETIRES A REAL COLLISION: the voice chip was `#22c55e`, which is
                the exact hex `VerifiedBadge.tsx` uses for the `registered` tier — and this
                header renders that badge about 40px to the left of it. Two different
                meanings on one green, side by side, in the owner's own screenshot. */}
            <AccentCircle
              rgb="255,255,255"
              hex="#ffffff"
              title="Video call"
              size={34}
              onClick={() => setLocation(`/app/dialer?to=${encodeURIComponent(thread.peerNumber)}&video=1`)}
            >
              <Video className="size-4" />
            </AccentCircle>
            <button
              type="button"
              title="Voice call"
              aria-label="Voice call"
              onClick={() => setLocation(`/app/dialer?to=${encodeURIComponent(thread.peerNumber)}&voice=1`)}
              className="rchip-accent grid size-[34px] shrink-0 place-items-center rounded-[12px] transition active:scale-95 motion-reduce:transition-none"
            >
              <Phone className="size-4" />
            </button>
          </>
        )}
        {/* CALL THIS GROUP (#113, v2.105.7) — the precondition the ask needed.
            Until now a group conversation had NO call button at all (both of the
            buttons above are gated on `!isGroup && peerNumber`), so there was no
            way to start a call AS a group and therefore nothing for group roles to
            seed. The picker on the Group Call screen dials arbitrary NUMBERS and
            carries no conversation, which is why it cannot do this. */}
        {isGroup && thread && (
          <>
            <AccentCircle
              rgb="34,197,94"
              hex="#22c55e"
              title="Call the group"
              size={34}
              onClick={() => void startGroupCall(true)}
            >
              <Phone className="size-4" />
            </AccentCircle>
            <AccentCircle
              rgb="56,189,248"
              hex="#38bdf8"
              title="Video call the group"
              size={34}
              onClick={() => void startGroupCall(false)}
            >
              <Video className="size-4" />
            </AccentCircle>
          </>
        )}
      </header>

      {/* message list — min-h-0 lets this flex child shrink so the composer
          stays pinned at the bottom (without it, the list grows to fit content
          and shoves the input into the middle of the screen). Wrapped in a
          relative + flex-col container (NOT a relative-with-only-absolute-
          children box — Safari doesn't reliably compute flex-grow height for a
          flex item whose entire content is taken out of flow, which collapsed
          this whole area to near-zero height) so the search overlay +
          scroll-to-bottom button can still be positioned over the real,
          properly-sized scroll container. */}
      <div className="relative flex flex-col flex-1 min-h-0">
      {searchOpen && (
        <div className="absolute inset-0 z-20 flex flex-col bg-background md:bg-card">
          <div className="px-3 md:px-5 py-2.5 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                autoFocus
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search in this conversation…"
                className="pl-10"
              />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-3 md:px-5 py-3 space-y-2">
            {debouncedSearch.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground mt-10">
                Type to search this conversation.
              </div>
            ) : searchResults.isLoading ? (
              <div className="text-sm text-muted-foreground">Searching…</div>
            ) : (searchResults.data?.length ?? 0) === 0 ? (
              <div className="text-center text-sm text-muted-foreground mt-10">
                No messages match “{debouncedSearch}”.
              </div>
            ) : (
              <>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">
                  Results
                </div>
                {searchResults.data?.map((m) => {
                  const mine = m.senderIdentityId === me.id;
                  return (
                    <div key={m.id} className={"flex " + (mine ? "justify-end" : "justify-start")}>
                      <div
                        style={bubbleStyleFor({ mine, isGroup, senderIdentityId: m.senderIdentityId })}
                        className="max-w-[85%] rounded-2xl px-3.5 py-2 text-sm break-words shadow-sm border"
                      >
                        {isGroup && !mine && (
                          <div
                            className="text-[11px] font-semibold mb-0.5"
                            style={{ color: nameColorFor({ isGroup, senderIdentityId: m.senderIdentityId }) }}
                          >
                            {nameById.get(m.senderIdentityId) || "Member"}
                          </div>
                        )}
                        {m.attachment && (
                          <AttachmentView
                            mimeType={m.attachment.mimeType}
                            url={m.attachment.url}
                            filename={m.attachment.filename ?? undefined}
                            thumbUrl={m.attachment.thumbUrl ?? null}
                            width={m.attachment.width ?? null}
                            height={m.attachment.height ?? null}
                            durationMs={m.attachment.durationMs ?? null}
                            mine={mine}
                            glyph={bubbleGlyphColor({ mine: !!mine, isGroup, senderIdentityId: m.senderIdentityId })}
                            onOpen={openMedia(m)}
                          />
                        )}
                        {m.body && (
                          <div className="whitespace-pre-wrap leading-relaxed">{linkify(m.body, mentionRoster)}</div>
                        )}
                        {/* The SAME stamp treatment as the conversation bubble (v2.106.62).
                            Found by this release's own pin: I moved the conversation stamp to
                            the board's mono 8.5px with per-side colours and left this one on
                            the old flat `text-white/70` at 9px — so a search result and the
                            message it points at rendered their time two different ways. */}
                        <div
                          className="font-mono text-[8.5px] mt-1"
                          style={{ color: mine ? "#9fb0ab" : "#7d8f8a" }}
                        >
                          {formatTime(m.createdAt)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 md:px-5 py-4 space-y-0.5 bg-background md:bg-card flex flex-col"
      >
        {/* Anchors a short conversation to the BOTTOM (iMessage-style) instead
            of floating at the top with a void below — flex-col + this auto
            top-margin spacer push content down when it doesn't fill the view. */}
        <div className="mt-auto shrink-0" aria-hidden="true" />
        {messagesQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (messagesQuery.data?.length ?? 0) === 0 ? (
          <div className="text-center text-sm text-muted-foreground mt-10">
            No messages yet. Say hi 👋
          </div>
        ) : (
          /* ONE <section> PER DAY, so the header can be sticky (v2.105.3).
             The pill has been here since v2.71, but it lived inside the first
             message's own wrapper — and `position: sticky` is bounded by its
             containing block, so there it would have unstuck the instant that
             single bubble scrolled past, which reads as a glitch rather than a
             feature. A day has to be a BOX for its header to ride it.

             The messages are still indexed against the FLAT array, which is
             load-bearing: the stacking rules read each message's neighbours, and
             two of those comparisons legitimately cross a day boundary (23:59 and
             00:01 are two minutes apart), so recomputing them per-day slice would
             stack a pair together straddling the header just inserted between
             them. */
          groupMessagesByDay(messagesQuery.data ?? []).map((day) => (
            <section key={day.key} className="space-y-0.5">
              {/* `top-0` pins to the scrollport, not to this section, so the pill
                  rides the whole day and is then pushed out by the next day's
                  header. z-10 keeps it above the bubbles and BELOW the search
                  overlay (z-20) and the lightbox (z-[90]) — a date pill floating
                  over an opened photo would be absurd. OPAQUE, not the old
                  translucent bg-muted/70: scrolled bubbles used to be visible
                  through it, which is invisible while the pill is in the flow and
                  obvious the moment it starts overlapping content. */}
              <div className="sticky top-0 z-10 flex justify-center py-1.5">
                {/* BOARD 3c'S DIVIDER IS BARE TEXT, and reconciling that with STICKY is the
                    whole of this (v2.106.62). The board draws `mono 9px / .22em / #68797c`
                    with no pill at all; this shipped as a `bg-muted` pill with a ring and a
                    shadow at 10px / .26em, which reads as a chip of content rather than a
                    divider.

                    IT CANNOT SIMPLY LOSE THE BACKING. The board's frame is a static mock, so
                    it never had to solve what v2.105.3 solved here: this header is STICKY, and
                    bubbles scroll behind it — bare letters with a transparent background have
                    message text sliding through them, which is exactly the defect that release
                    made the pill opaque to fix.

                    SO THE BACKING MATCHES THE SCROLL CONTAINER'S OWN SURFACE rather than
                    contrasting with it: `bg-background md:bg-card` is character-for-character
                    what the scroller sets, so the pill is invisible against it and READS as
                    the board's bare text while still occluding what passes underneath. The
                    ring and the shadow go, because those are what made it a chip.

                    Still z-10: above the bubbles, below the search overlay (z-20) and the
                    lightbox (z-[90]) — a date pill over an opened photo would be absurd. */}
                <span
                  className="rounded-full bg-background md:bg-card px-2.5 py-0.5 font-mono text-[9px] font-semibold uppercase"
                  /* `#708285`, not the board's `#68797c` — the closest value to the board's
                     that clears AA on BOTH of our scroll surfaces. Measured: the board's own
                     hue is 4.46:1 on our mobile `--background` (fine — that is essentially
                     the surface the board drew it on) but only 4.13:1 on the DESKTOP `--card`,
                     which is lighter and which the board never drew. One step lighter gives
                     5.05 / 4.67, so the colour moves as little as possible from what was
                     specified while being legible on the surface we actually have. */
                  style={{ letterSpacing: ".22em", color: "#708285" }}
                >
                  {day.label}
                </span>
              </div>
              {day.items.map(({ item: m, index: i }) => {
            const arr = messagesQuery.data ?? [];
            const mine = m.senderIdentityId === me.id;
            const prev = arr[i - 1];
            const next = arr[i + 1];
            // WhatsApp-style grouping: tighten consecutive runs from the same
            // sender within ~5 min, and only the LAST bubble of a run gets the
            // tail + timestamp (the rest are "stacked").
            const GROUP_MS = 5 * 60_000;
            const sameAsPrev =
              // The day comparison is what stops a 23:59 bubble and a 00:01 one
              // stacking across the header between them. It used to ride on
              // `!showDay`; now that the header is a section's, it is stated
              // directly rather than inferred from a variable that no longer
              // exists here.
              !!prev && dayKey(prev.createdAt) === dayKey(m.createdAt) &&
              prev.senderIdentityId === m.senderIdentityId &&
              new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS;
            const sameAsNext =
              !!next && next.senderIdentityId === m.senderIdentityId &&
              dayKey(next.createdAt) === dayKey(m.createdAt) &&
              new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() < GROUP_MS;
            const lastOfGroup = !sameAsNext;
            /* THE TAIL CORNER IS THE BOARD'S 5px, not Tailwind's `rounded-*-sm` (v2.106.62).
               Frames 1d and 3c both spell it out: `16px 16px 16px 5px` for a received bubble
               and `16px 16px 5px 16px` for mine — a small notch on the side the speaker is
               on. In Tailwind v4 `rounded-bl-sm` is 2px, which at bubble scale is close
               enough to a square corner to read as one, so the "shaped" the owner keeps
               asking for was not actually there.

               ONLY THE LAST BUBBLE OF A RUN GETS IT, which is a deliberate deviation: the
               board's frames show single messages, so they cannot say what a stacked run
               should do, and tailing every bubble is what makes a run stop reading as one
               run. */
            const tail = mine
              ? (lastOfGroup ? "rounded-br-[5px]" : "")
              : (lastOfGroup ? "rounded-bl-[5px]" : "");
            return (
              <div key={m.id}>
                {/* Board 4c — the quick row, ABOVE the bubble it is about. In flow
                    rather than floating, so it cannot clip off either edge of a
                    phone (see QuickReact). */}
                {reactingTo === m.id && (
                  <QuickReact
                    mine={!!mine}
                    current={myReaction(
                      (m as { reactions?: MessageReactions }).reactions,
                      me?.number ?? ""
                    )}
                    onPick={(e) => toggleReaction(m, e)}
                    onMore={() => {
                      setPickerFor(m.id);
                      setReactingTo(null);
                    }}
                    onClose={() => setReactingTo(null)}
                  />
                )}
                <div
                  className={
                    "group flex items-end gap-1.5 " + (mine ? "justify-end" : "justify-start") +
                    (sameAsPrev ? " mt-0.5" : " mt-2")
                  }
                >
                {/* v2.103.3: the sender thumbnail, ONE insertion rather than three.
                    This row is the single container wrapping BOTH the emoji-only
                    branch and the ordinary bubble branch below, so putting the gutter
                    here covers every kind of received group message — including the
                    attachment and status-reply shapes — instead of repeating it per
                    branch, which is how three copies of the sender label came to
                    exist in the first place. Only for a group, and only for somebody
                    else's message: my own bubbles are already unambiguous. */}
                {isGroup && !mine && (
                  <SenderThumb member={memberById.get(m.senderIdentityId)} show={!sameAsPrev} senderIdentityId={m.senderIdentityId} />
                )}
                {mine && (
                  <MessageMenu
                    mine
                    onReply={() => setReplyingTo(m)}
                    onCopy={m.body ? () => {
                      navigator.clipboard?.writeText(m.body!)
                        .then(() => toast.success("Copied"))
                        .catch(() => toast.error("Failed to copy"));
                    } : undefined}
                    onReact={() => setReactingTo(m.id)}
                    onForward={isExpiringMsg(m.meta) ? undefined : () => setForwarding(m)}
                    onInfo={() => setInfoOf(m)}
                    onHide={() => setHidingId(m.id)}
                    onDelete={() => deleteMessage(m.id)}
                  />
                )}
                {(() => {
                  const sr = statusReplyOf(m.meta);
                  // Emoji-only messages render BIG without a bubble (iMessage-style).
                  //
                  // A STATUS REPLY is excluded even when its body is one emoji
                  // (v2.99.80): a one-tap status reaction is *precisely* an
                  // emoji-only message, and this branch has no bubble and therefore
                  // nowhere to put the "replied to your status" chip — the recipient
                  // would see a floating ❤️ with no idea what it was about, which is
                  // the one thing the owner asked for.
                  const emojiOnly =
                    !m.attachment && m.replyToId == null && !sr && isEmojiOnly(m.body);
                  if (emojiOnly) {
                    return (
                      <div className="max-w-[75%] px-1 py-0.5">
                        {/* v2.99.85: this branch has no bubble, and it also had no
                            SENDER NAME — so in a group an emoji-only message arrived
                            as a bare 🔥 attached to nobody, while every text message
                            from the same person was labelled. Visible in the owner's
                            own group screenshot. Same label, same per-person colour as
                            the bubble path, so the two cannot drift. */}
                        {isGroup && !mine && !sameAsPrev && (
                          <div
                            className="text-[11px] font-semibold mb-0.5"
                            style={{ color: nameColorFor({ isGroup, senderIdentityId: m.senderIdentityId }) }}
                          >
                            {nameById.get(m.senderIdentityId) || "Member"}
                          </div>
                        )}
                        <div className="text-4xl leading-tight">{m.body}</div>
                        <div className={"text-[10px] mt-0.5 text-muted-foreground " + (mine ? "text-right" : "")}>
                          {formatTime(m.createdAt)}
                          <Receipt status={m.status} mine={!!mine} />
                        </div>
                      </div>
                    );
                  }
                  return (
                <div
                  // v2.99.85 (owner): mine orange, the other side of a 1:1 BLUE, and in
                  // a group every member their own colour — all from one module, so a
                  // bubble and that person's name can never disagree about who they are.
                  // The received bubble was a neutral grey token surface; the owner has
                  // asked for colour, and colour is what tells you who is speaking in a
                  // group without reading the label.
                  style={bubbleStyleFor({ mine, isGroup, senderIdentityId: m.senderIdentityId })}
                  className={
                    "max-w-[75%] rounded-2xl px-3 py-1.5 text-sm break-words shadow-sm border " + tail
                  }
                >
                  {isGroup && !mine && !sameAsPrev && (
                    <div
                      className="text-[11px] font-semibold mb-0.5"
                      style={{ color: nameColorFor({ isGroup, senderIdentityId: m.senderIdentityId }) }}
                    >
                      {nameById.get(m.senderIdentityId) || "Member"}
                    </div>
                  )}
                  {/* STATUS REPLY (v2.99.80): this message was sent from the story
                      viewer, so say what it was about. Rendered from the marker's
                      own snapshot and NEVER from a live lookup: a status is
                      deliberately unreachable after 24h, so anything that fetched
                      would show a broken tile forever afterwards. Withheld while a
                      self-destructing message is still locked, mirroring how the
                      whole received menu is withheld there. */}
                  {sr && !(m as { locked?: boolean }).locked && (
                    <div
                      className={
                        "mb-1 rounded-lg border-l-2 pl-2 py-0.5 text-[11px] leading-tight " +
                        (mine
                          ? "border-white/50 bg-white/15 text-white/90"
                          : "border-[#a78bfa]/60 bg-[#a78bfa]/10 text-foreground/80")
                      }
                    >
                      {/* The label and the kind glyph are bidi-isolated so an
                          Arabic excerpt beside them cannot reorder the phrase. */}
                      <span className="font-semibold [unicode-bidi:isolate]" dir="ltr">
                        ↩ {mine ? "Replied to their story" : "Replied to your story"}
                      </span>
                      <span className="opacity-80 [unicode-bidi:isolate]" dir="ltr">
                        {" · "}
                        {storyKindLabel(sr.kind)}
                      </span>
                      {sr.excerpt && (
                        <span className="opacity-70" dir="auto">
                          {" "}
                          “{sr.excerpt}”
                        </span>
                      )}
                    </div>
                  )}
                  {m.replyToId != null && (() => {
                    /* BOARD 3c'S REPLY QUOTE — an accent-tinted panel with an accent left
                       border, and the quoted person's name in THEIR OWN hue:

                         margin-top:4px; padding:6px 9px; border-radius:9px;
                         background: rgba(var(--rb-rgb),.08);
                         border-left: 2.5px solid var(--rb);
                         name  9.5px/700 in the ORIGINAL sender's colour
                         text 10.5px #9fb0ab, one line, ellipsised

                       THIS IS WHAT v2.106.61 EXISTED TO UNLOCK, and `peerColors.ts` says so:
                       on a saturated per-person fill an accent panel cannot read, because the
                       accent would be competing with a different strong hue in every bubble.
                       A neutral surface is what lets one accent mean one thing everywhere.

                       THE NAME CARRIES THE COLOUR, which is the point of the quote rather than
                       decoration — it answers "whose message is this replying to" before you
                       read a word, from the SAME `nameColorFor` the sender label and the
                       typing line use, so a quote can never disagree with the bubble it
                       quotes about who that person is.

                       ONE LINE, ELLIPSISED, deliberately: a quote that wraps to three lines
                       stops being a reference and becomes a second message. The board sets
                       `white-space:nowrap` for exactly that.

                       MINE KEEPS THE WHITE TREATMENT. The accent on a translucent orange is
                       readable (that is why the mention and the tick moved onto it this
                       release), but an accent-tinted panel with an accent border INSIDE an
                       orange bubble is two tints fighting for the same few pixels, and the
                       board only ever draws a quote on a received bubble — so it has nothing
                       to say about this case and white is what already worked. */
                    const quoted = msgById.get(m.replyToId);
                    const quotedId = quoted?.senderIdentityId ?? -1;
                    return (
                      <div
                        className={
                          "mb-1 rounded-[9px] py-1 ps-2 pe-2.5 leading-tight " +
                          (mine ? "border-l-[2.5px] border-white/50 bg-white/15" : "border-l-[2.5px]")
                        }
                        style={
                          mine
                            ? undefined
                            : {
                                // A LITERAL fallback, never `var(--rb, var(--rb))` — that is a
                                // custom-property cycle and the browser drops the whole
                                // declaration, leaving a panel with no tint at all (v2.106.7).
                                backgroundColor: "rgba(var(--rb-rgb, 63,224,197),.08)",
                                borderLeftColor: "var(--rb, #3FE0C5)",
                              }
                        }
                      >
                        <div
                          className="text-[9.5px] font-semibold"
                          style={
                            mine
                              ? { color: "rgba(255,255,255,.9)" }
                              : { color: nameColorFor({ isGroup, senderIdentityId: quotedId }) }
                          }
                        >
                          {senderLabel(quotedId)}
                        </div>
                        <div
                          className="overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px]"
                          style={{ color: mine ? "rgba(255,255,255,.75)" : "#9fb0ab" }}
                        >
                          {previewOf(quoted)}
                        </div>
                      </div>
                    );
                  })()}
                  {/* Voicemail label (v2.88): an audio message recorded after a
                      failed call carries meta.voicemail — say so, phone-style. */}
                  {(m.meta as { voicemail?: boolean } | null)?.voicemail && (
                    <div
                      className={
                        "mb-0.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide " +
                        "text-white/80"
                      }
                    >
                      <Voicemail className="size-3.5" /> Voicemail
                    </div>
                  )}
                  {(() => {
                    /* Self-destruct (v2.96): meta.expire = "once" | 5 | 10 | 30.
                       Recipient sees a locked card until they tap; opening burns
                       the row server-side and shows a LOCAL copy for the
                       countdown (view-once: until they leave the thread). */
                    const exp = m.meta as { expire?: "once" | 5 | 10 | 30; consumedAt?: number } | null;
                    const expiring = exp?.expire != null;
                    // M11: the server now WITHHOLDS a locked message's body +
                    // attachment (`m.locked`), so "empty content" alone no longer
                    // means burned — a locked message is tap-to-view, and only a
                    // real consume (consumedAt) is burned.
                    const serverLocked = (m as { locked?: boolean }).locked === true;
                    const burned = expiring && !serverLocked && exp?.consumedAt != null;
                    const copy = expiring ? revealed.get(m.id) : undefined;
                    const chip = (label: string) => (
                      <div
                        className={
                          "mt-1 flex items-center gap-1 text-[10px] font-semibold " +
                          "text-white/75"
                        }
                      >
                        <Timer className="size-3" /> {label}
                      </div>
                    );
                    const content = (body: string | null, att: Msg["attachment"]) => (
                      <>
                        {att && (
                          <AttachmentView
                            mimeType={att.mimeType}
                            url={att.url}
                            filename={att.filename ?? undefined}
                            thumbUrl={att.thumbUrl ?? null}
                            width={att.width ?? null}
                            height={att.height ?? null}
                            /* v2.99.74: this was missing, and it is why a VIEW-ONCE
                               voice note still showed a frozen bar after v2.99.73 —
                               the ordinary bubble passed the stored duration but this
                               path did not, and the fill is computed as cur/dur, so an
                               unknown duration pins the bar at 0 however well playback
                               is going. */
                            durationMs={
                              (att as { durationMs?: number | null }).durationMs ?? null
                            }
                            glyph={bubbleGlyphColor({ mine: !!mine, isGroup, senderIdentityId: m.senderIdentityId })}
                            mine={mine}
                            onOpen={openMedia(m)}
                          />
                        )}
                        {/* THE MENTION ROSTER HAS TO BE PASSED HERE, and until v2.106.62 it
                            was not — which meant board 3c's accent `@mention` had NEVER
                            rendered in a conversation. `content()` is the ordinary path
                            (`if (!expiring) return content(m.body, m.attachment)` below), so
                            this bare `linkify(body)` was every non-expiring message; the only
                            call site that DID pass the roster is the search-results list,
                            i.e. the one place almost nobody looks. v2.106.17 built the
                            resolver, the composer picker and the shared `findMentions`, and
                            the single render that matters got no arguments. */}
                        {body && <div className="whitespace-pre-wrap leading-relaxed">{linkify(body, mentionRoster)}</div>}
                      </>
                    );
                    if (!expiring) return content(m.body, m.attachment);
                    if (copy) {
                      const left =
                        copy.until != null ? Math.max(0, Math.ceil((copy.until - Date.now()) / 1000)) : null;
                      return (
                        <>
                          {content(copy.body, copy.attachment)}
                          {chip(left != null ? `Disappears in ${left}s` : "View once — gone when you leave")}
                        </>
                      );
                    }
                    if (burned) {
                      return (
                        <div
                          className={
                            "flex items-center gap-1.5 py-0.5 text-[12.5px] italic " +
                            "text-white/75"
                          }
                        >
                          <Timer className="size-3.5 shrink-0" />
                          {mine ? "Viewed — this message has disappeared" : "This message has disappeared"}
                        </div>
                      );
                    }
                    if (mine) {
                      return (
                        <>
                          {content(m.body, m.attachment)}
                          {chip(exp!.expire === "once" ? "View once" : `Disappears ${exp!.expire}s after opening`)}
                        </>
                      );
                    }
                    const loadingThis = revealing === m.id;
                    return (
                      <button
                        type="button"
                        onClick={() => revealExpiring(m)}
                        disabled={loadingThis}
                        className="my-0.5 flex w-56 max-w-full items-center gap-2.5 rounded-xl bg-[#a78bfa]/10 px-2.5 py-2 text-left transition hover:bg-[#a78bfa]/20 active:scale-[0.98] disabled:opacity-70"
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#a78bfa]/15 text-[#a78bfa]">
                          <Timer className={"size-4" + (loadingThis ? " animate-spin" : "")} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold">{loadingThis ? "Opening…" : "Tap to view"}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {exp!.expire === "once"
                              ? "Can be viewed once, then it disappears"
                              : `Disappears ${exp!.expire}s after you open it`}
                          </span>
                        </span>
                      </button>
                    );
                  })()}
                  {/* WhatsApp-style meta: tiny time + ticks, tucked bottom-right.
                      Receipt owns its own mine/status guard, so there is no outer
                      condition here to fall out of step with it. */}
                  {/* Board 1d/3c: `IBM Plex Mono` 8.5px, right-aligned, `#7d8f8a` inside a
                      received bubble and `#9fb0ab` inside mine — the own bubble's tint is
                      warmer, so its stamp needs to sit a step lighter to read the same. Both
                      replace a flat `text-white/70`, which was chosen when every bubble was a
                      saturated fill and is now brighter than the board's on the glass. */}
                  <div
                    className="flex justify-end items-center gap-1 font-mono text-[8.5px] leading-none mt-0.5 -mb-0.5"
                    style={{ color: mine ? "#9fb0ab" : "#7d8f8a" }}
                  >
                    {formatTime(m.createdAt)}
                    <Receipt status={m.status} mine={!!mine} />
                  </div>
                </div>
                  );
                })()}
                {!mine && (() => {
                  // QA H2: a still-LOCKED expiring message (received, meta.expire
                  // set, not yet revealed by me, not burned) must NOT be
                  // extractable without burning. Copy would write the plaintext
                  // to the clipboard and Reply would surface it in the composer —
                  // neither calls consumeExpiring, so the "view once" guarantee
                  // was defeated with one tap. Suppress the whole menu until the
                  // recipient taps to view (which burns it); once revealed
                  // locally or burned, the normal menu returns.
                  const exp = m.meta as { expire?: unknown; consumedAt?: number } | null;
                  const isExpiring = exp?.expire != null;
                  const burned = isExpiring && (exp?.consumedAt != null || (!m.body && !m.attachment));
                  const locked = isExpiring && !revealed.has(m.id) && !burned;
                  if (locked) return null;
                  return (
                  <MessageMenu
                    onReply={() => setReplyingTo(m)}
                    onCopy={m.body ? () => {
                      navigator.clipboard?.writeText(m.body!)
                        .then(() => toast.success("Copied"))
                        .catch(() => toast.error("Failed to copy"));
                    } : undefined}
                    onReact={() => setReactingTo(m.id)}
                    onForward={isExpiring ? undefined : () => setForwarding(m)}
                    onInfo={() => setInfoOf(m)}
                    onHide={() => setHidingId(m.id)}
                    // v2.104.0: offered only when the SERVER has said this person is a
                    // group admin. Behind a confirmation, because it removes somebody
                    // else's words for everybody and cannot be undone — the same bar
                    // "delete this chat" is held to.
                    onAdminDelete={iAmGroupAdmin ? () => setAdminDeleting(m) : undefined}
                  />
                  );
                })()}
                </div>
                {/* Board 4c — the chips, on the bubble's bottom edge. ONE insertion
                    in the per-message wrapper rather than inside a bubble branch, so
                    it covers the emoji-only shape and the attachment shapes too (the
                    v2.103.3 gutter argument). */}
                <ReactionChips
                  reactions={(m as { reactions?: MessageReactions }).reactions}
                  myPin={me?.number ?? ""}
                  mine={!!mine}
                  onToggle={(e) => toggleReaction(m, e)}
                />
                {/* The full catalogue, opened by the row's `+`. It reuses the SAME
                    picker the composer uses rather than a second one, because two
                    emoji lists is how they come to hold different glyphs (v2.99.80
                    consolidated three into one for exactly that reason). */}
                {pickerFor === m.id && (
                  <div className={"flex " + (mine ? "justify-end" : "justify-start") + " mt-1"}>
                    <EmojiPicker
                      className="w-full max-w-sm"
                      onPick={(e) => toggleReaction(m, e)}
                      onClose={() => setPickerFor(null)}
                    />
                  </div>
                )}
              </div>
            );
              })}
            </section>
          ))
        )}
      </div>
      {showScrollButton && !searchOpen && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Scroll to latest messages"
          title="Scroll to latest"
          className="absolute bottom-4 right-4 z-10 grid place-items-center size-10 rounded-full bg-card border border-border shadow-lg text-foreground hover:bg-muted/60 transition-opacity motion-reduce:transition-none"
        >
          <ChevronDown className="size-5" />
        </button>
      )}
      </div>

      {/* typing indicator — the walking capital + per-person colour live in
          TypingLine, which is its OWN component so its several-times-a-second tick
          cannot re-render this whole conversation (the v2.99.67 mistake). */}
      <TypingLine typers={typers} isGroup={isGroup} labelFor={senderLabel} />

      {/* composer — `shrink-0` is LOAD-BEARING even though it changes nothing today.
          This row and the header are the two things the conversation column must never
          give up, and both were surviving only on the flex automatic-minimum-size rule
          (an item's min-height defaults to its content). That rule stops applying the
          moment either element becomes a scroll container or takes a `min-h-0` — at which
          point the list, which legitimately grows, wins and the composer is squeezed to
          nothing. The owner's report was a missing composer; declaring the intent costs
          two words and removes the dependency on a default. */}
      <div className="shrink-0 px-3 md:px-5 py-3 border-t border-border bg-card md:rounded-b-2xl">
        {replyingTo && (
          <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/60 border-l-2 border-[#fb923c] text-sm">
            <Reply className="size-4 shrink-0 text-[#fb923c]" />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-[#fb923c]">
                Replying to {senderLabel(replyingTo.senderIdentityId)}
              </div>
              <div className="truncate text-xs text-muted-foreground">{previewOf(replyingTo)}</div>
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Cancel reply"
            >
              <X className="size-4" />
            </button>
          </div>
        )}
        {pendingUpload && (
          <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-muted text-sm">
            <Paperclip className="size-4 shrink-0" />
            <span className="flex-1 truncate">{pendingUpload.filename || pendingUpload.mimeType}</span>
            <button
              type="button"
              onClick={() => setPendingUpload(null)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Remove attachment"
            >
              <X className="size-4" />
            </button>
          </div>
        )}
        {/* Board 3c — the @mention picker, IN FLOW above the composer. Not floating,
            for the same reason the reaction row is not: an absolutely-positioned list
            over a composer that sits above the tab bar and the on-screen keyboard needs
            measuring and clamping, and gets it wrong on exactly the phone it matters
            on. `onMouseDown` with preventDefault rather than `onClick`, because a
            click fires AFTER blur — and blur closes the picker, so the row would
            unmount from under the tap. */}
        {mentionMatches.length > 0 && (
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {mentionMatches.map((mem) => (
              <button
                key={mem.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(mem);
                }}
                className="shrink-0 rounded-full border border-border/60 bg-card/80 px-3 py-1.5 text-xs font-medium transition hover:bg-muted/60 active:scale-95 motion-reduce:transition-none"
              >
                {/* `text-primary`, not the raw accent: measured 1.59:1 on the light card
                    against AA's 4.5, versus 4.59:1 here. v2.106.4 repointed `--primary` at
                    `--rb` inside `.dark.relay-v2` precisely so accent UI follows the
                    cycling hue in dark (7.12:1) while light keeps a measured value — so
                    reaching for the variable directly routes around the infrastructure
                    built for this. Fills are unaffected; this is only ever about text. */}
                <span className="text-primary">@</span>
                {mem.name}
              </button>
            ))}
          </div>
        )}
        {/* The shared, categorised, searchable picker (v2.99.80). This was a
            hand-written 32-glyph grid; the catalogue behind the new component
            carries ~1,100 across ten categories and is the SAME one the status
            reply band uses, so the two surfaces can't drift apart the way the
            three separate lists in this repo had. Stays open after a pick, because
            people insert several. */}
        {emojiOpen && (
          <EmojiPicker className="mb-2" onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />
        )}
        {/* ONE menu behind the "+" (v2.99.66, owner: "put the attachment and the
            image into one icon like you click a plus… so it will give more space
            for the input box of chatting"). Media and Attach file used to be two
            separate composer buttons, which cost ~44px of the row on every
            screen for actions used occasionally. */}
        {attachMenuOpen && (
          <div className="mb-2 grid grid-cols-2 gap-2">
            {/* In-app recorder: works even DURING a call — iOS blocks the
                system camera's video recording there, ours records in-page. */}
            {videoRecorderSupported() && (
              <button
                type="button"
                onClick={() => { setAttachMenuOpen(false); setVideoRecOpen(true); }}
                className="flex items-center justify-center gap-2 rounded-xl bg-[#38bdf8]/12 px-3 py-3 text-sm font-semibold text-[#38bdf8] active:scale-95 transition-transform"
              >
                <Video className="size-4 shrink-0" /> <span className="truncate">Record video</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => { setAttachMenuOpen(false); imageRef.current?.click(); }}
              className="flex items-center justify-center gap-2 rounded-xl bg-muted/60 px-3 py-3 text-sm font-semibold text-foreground active:scale-95 transition-transform"
            >
              <ImageIcon className="size-4 shrink-0" /> <span className="truncate">Photo &amp; video</span>
            </button>
            <button
              type="button"
              onClick={() => { setAttachMenuOpen(false); fileRef.current?.click(); }}
              className="flex items-center justify-center gap-2 rounded-xl bg-muted/60 px-3 py-3 text-sm font-semibold text-foreground active:scale-95 transition-transform"
            >
              <Paperclip className="size-4 shrink-0" /> <span className="truncate">Attach file</span>
            </button>
            {/* v2.106.64 — VOICE NOTE lives here now, beside the other things you can
                attach, per the owner: *"on the attachment inside the chat on the plus
                button add the voice note beside of the other features set as video
                photos"*. It carries the SAME guards the mic button had, and they are not
                decoration: `uploading` is what stops a tap opening the recording bar with
                a LIVE microphone while all three of its controls are already disabled by
                that same flag — a recording nobody could stop, discard or send
                (v2.99.72). An unsupported recorder disables the row and SAYS why rather
                than hiding it, so the absence is explained instead of looking like a
                missing feature. */}
            <button
              type="button"
              onClick={() => { setAttachMenuOpen(false); startRecording(); }}
              disabled={!recorderSupported() || uploading}
              title={
                recorderSupported()
                  ? "Record a voice note"
                  : "Voice notes need a newer browser — use Attach file for an audio file instead"
              }
              className="flex items-center justify-center gap-2 rounded-xl bg-muted/60 px-3 py-3 text-sm font-semibold text-foreground active:scale-95 transition-transform disabled:opacity-50"
            >
              <Mic className="size-4 shrink-0" /> <span className="truncate">Voice note</span>
            </button>
          </div>
        )}
        {expire !== null && (
          <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-[#a78bfa]/10 border-l-2 border-[#a78bfa] text-sm">
            <Timer className="size-4 shrink-0 text-[#a78bfa]" />
            <span className="flex-1 text-xs text-muted-foreground">
              {expire === "once"
                ? "Disappearing: they can view this ONCE — then it's gone for both of you."
                : `Disappearing: gone ${expire} seconds after they open it.`}
            </span>
            <button
              type="button"
              onClick={() => setExpire(null)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Turn off disappearing"
            >
              <X className="size-4" />
            </button>
          </div>
        )}
        {recording ? (
          /* While recording the whole row becomes the recording bar: the old UI
             offered only a red Stop, which also sent — so there was no way to
             discard a misfire except sending it and unsending it after. */
          <RecordingBar
            get={getRecording}
            paused={recPaused}
            onTogglePause={toggleRecPause}
            onCancel={discardRecording}
            onSend={stopRecording}
            busy={uploading}
          />
        ) : (
        <div className="flex items-end gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setEmojiOpen((v) => !v)}
            aria-label="Emoji"
          >
            <Smile className="size-5" />
          </Button>
          {/* Self-destruct toggle (v2.96): off → view-once → 5s → 10s → 30s.
              Applies to the NEXT send (text, media, or voice note).
              QA M3: 1:1 ONLY. In a group the message is one shared row, so the
              FIRST member to open it burns it for EVERYONE — the rest just see
              "This message has disappeared". Until per-recipient burn exists,
              hide the control in groups (the convo-switch effect keeps `expire`
              null on entry, and the send path re-guards on !isGroup). */}
          {!isGroup && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() =>
              setExpire((v) =>
                v === null ? "once" : v === "once" ? 5 : v === 5 ? 10 : v === 10 ? 30 : null
              )
            }
            aria-label={
              expire === null
                ? "Make the next message disappear"
                : `Disappearing: ${expire === "once" ? "view once" : `${expire} seconds`}`
            }
            title="Disappearing message: tap to cycle off · view-once · 5s · 10s · 30s"
            className={expire !== null ? "bg-[#a78bfa]/15 text-[#a78bfa] hover:text-[#a78bfa]" : ""}
          >
            {expire === null ? (
              <Timer className="size-5" />
            ) : (
              <span className="text-[11px] font-extrabold leading-none">
                {expire === "once" ? "1×" : `${expire}s`}
              </span>
            )}
          </Button>
          )}
          <input
            ref={imageRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={handleFile}
          />
          <input ref={fileRef} type="file" className="hidden" onChange={handleFile} />
          {/* BOARD 1d: THE ATTACH CLIP LIVES INSIDE THE FIELD, not beside it.
              Measured at 390px the row was emoji + attach + timer + field + mic, leaving the
              text field 190px against the board's 274 — the field is what the screen is for
              and it was the smallest thing in the row. Moving this one control inside
              recovers its whole 42px cell without removing anything.
              LOGICAL properties (`pe-11`, `end-1`), not `pr-`/`right-`: this app renders
              Arabic and the owner's own thread has an Arabic message in it, so the reserved
              space and the button have to swap sides with the text direction. */}
          <div className="relative min-w-0 flex-1">
          <Input
            ref={composerRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              syncMentionQuery(e.target);
              if (e.target.value.trim()) notifyTyping();
            }}
            onSelect={(e) => syncMentionQuery(e.currentTarget)}
            onBlur={() => setMentionQuery(null)}
            onKeyDown={(e) => {
              /* Enter completes the top match while the picker is open, rather than
                 sending — otherwise typing "@da" and pressing Enter sends a fragment
                 to a group instead of finishing the name. Escape closes it without
                 clearing the draft. */
              if (mentionMatches.length && e.key === "Escape") {
                e.preventDefault();
                setMentionQuery(null);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                if (mentionMatches.length) {
                  e.preventDefault();
                  pickMention(mentionMatches[0]);
                  return;
                }
                e.preventDefault();
                send();
              }
            }}
            onPaste={handlePaste}
            placeholder={uploading ? "Uploading…" : "Type a message"}
            disabled={uploading || recording}
            className="h-11 w-full rounded-full ps-4 pe-11"
          />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setAttachMenuOpen((v) => !v)}
              aria-label={attachMenuOpen ? "Close attach menu" : "Attach media or a file"}
              title="Attach media or a file"
              aria-expanded={attachMenuOpen}
              className={
                "absolute end-1 top-1/2 size-9 -translate-y-1/2 rounded-full " +
                (attachMenuOpen ? "bg-muted/60 text-primary" : "")
              }
            >
              <Plus className={"size-5 transition-transform" + (attachMenuOpen ? " rotate-45" : "")} />
            </Button>
          </div>
          {/* v2.106.64 — SEND IS PERMANENT, and the mic is gone from this position.
              Owner: *"in place of the voice icon in the bar put send button as icon … and
              inside the plus it will have everything that you already added, including the
              voice note."*

              What the swap cost: the composer's primary control CHANGED MEANING on the
              first keystroke, so the button you were aiming at became a different action
              under your thumb — and it was the reason recording had to be reachable from
              a position that is really Send's. Now the position means one thing.

              The disabled state is honest rather than a trap: it enables the instant there
              is anything to send, so it is never a control that always refuses (the
              v2.103.3 rule) — it is Send, greyed because there is nothing to send yet.

              The RECORDING branch that used to live here was already unreachable: while
              `recording` the whole row is replaced by `RecordingBar` (v2.99.72), so its
              `recording ? stopRecording` arm could never render. Removing it removes dead
              code rather than a capability. */}
          <Button
            type="button"
            onClick={send}
            disabled={(!text.trim() && !pendingUpload) || sendMutation.isPending || uploading}
            size="icon"
            /* Board 1d: the composer's primary is the ACCENT circle. The orange stays
               where the owner asked for it in v2.99.85 — on their own message BUBBLES —
               which is a different thing from the send button. `.rcta` carries the board's
               on-accent `#04211a`, which stays legible across all twelve palette hues
               where white fails on the yellow and lime entries. */
            className="rcta h-11 w-11 rounded-full border-0 disabled:opacity-50"
            aria-label="Send"
            title="Send"
          >
            <Send className="size-4" />
          </Button>
        </div>
        )}
      </div>

      {lightbox && <MediaLightbox media={lightbox} onClose={() => setLightbox(null)} />}
      {/* The group's own name, photo and status (v2.102.1) — the editor for the data
          v2.102.0 added. Mounted at the view's root, outside the scroll area, so
          closing it can never unmount an open avatar picker from under the user. */}
      {isGroup && (
        <GroupInfoSheet
          open={groupInfoOpen}
          onClose={() => setGroupInfoOpen(false)}
          conversationId={conversationId}
          title={thread?.title ?? null}
          number={thread?.groupNumber ?? null}
          avatarUrl={thread?.groupAvatarUrl ?? null}
          status={thread?.groupStatus ?? null}
          statusNote={thread?.groupStatusNote ?? null}
        />
      )}
      {/* In-app video recorder (v2.96.2): the clip lands in the normal
          attachment flow (pendingUpload), so captions and the disappearing
          timer apply before Send — and it works even during a call. */}
      {videoRecOpen && (
        <VideoRecordSheet
          maxMs={60_000}
          onClose={() => setVideoRecOpen(false)}
          onUse={(r) => {
            setVideoRecOpen(false);
            void uploadFile(new File([r.blob], `video-note.${r.ext}`, { type: r.mimeType }));
          }}
        />
      )}
      {/* ── Message info (v2.99.74): sent / delivered / read ── */}
      <AlertDialog open={infoOf !== null} onOpenChange={(open) => !open && setInfoOf(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Message info</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 pt-1 text-left">
                {(() => {
                  const m = infoOf;
                  if (!m) return null;
                  const iSent = m.senderIdentityId === me?.id;
                  const rows: Array<{ label: string; at: string | Date | null }> = [
                    { label: "Sent", at: m.createdAt },
                    { label: "Delivered", at: m.deliveredAt ?? null },
                    { label: "Read", at: m.readAt ?? null },
                  ];
                  return (
                    <>
                      {rows.map((r) => (
                        <div key={r.label} className="flex items-baseline justify-between gap-4">
                          <span className="text-xs uppercase tracking-wider text-muted-foreground">
                            {r.label}
                          </span>
                          <span className="text-sm tabular-nums">
                            {r.at ? (
                              formatExact(r.at)
                            ) : (
                              /* An honest dash, not a guess. Every message that predates
                                 v2.99.74 has no stored delivered/read time, and inventing
                                 one would make this panel lie about the very thing it
                                 exists to report. */
                              <span className="text-muted-foreground">—</span>
                            )}
                          </span>
                        </div>
                      ))}
                      {!iSent && (
                        <p className="pt-1 text-[0.72rem] leading-relaxed text-muted-foreground/80">
                          These are the times recorded on your side for a message you
                          received.
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Forward to another conversation (v2.99.74) ── */}
      <AlertDialog open={forwarding !== null} onOpenChange={(open) => !open && setForwarding(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Forward to…</AlertDialogTitle>
            <AlertDialogDescription>
              {forwarding && (forwarding.meta as { expire?: unknown } | null)?.expire != null
                ? "This is a disappearing message — forwarding it would break the promise it was sent under, so it can't be forwarded."
                : "Pick a conversation. It's sent as a new message there, with its own delivery receipts."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {forwarding && (forwarding.meta as { expire?: unknown } | null)?.expire == null && (
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {forwardTargets.map((t) => (
                <button
                  key={t.conversationId}
                  type="button"
                  disabled={forwardBusy}
                  onClick={() => void forwardTo({ id: t.conversationId }, forwarding)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                >
                  <span className="truncate" dir="auto">
                    {t.title || t.peerDisplayName || t.peerNumber || "Conversation"}
                  </span>
                </button>
              ))}
              {forwardTargets.length === 0 && (
                <p className="px-1 py-2 text-sm text-muted-foreground">
                  No other conversations yet.
                </p>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* "Delete for me" confirmation (v2.102.2). Its own dialog, and the copy's job is
          to make the difference from Unsend unmistakable — "for everyone" vs "only for
          you" is the whole distinction, and getting it wrong is not recoverable. */}
      <AlertDialog open={hidingId !== null} onOpenChange={(open) => !open && setHidingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this message for you?</AlertDialogTitle>
            <AlertDialogDescription>
              It disappears from this conversation on all your devices. Everyone else keeps
              it, and they aren't told. You can't get it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              destructive
              onClick={() => {
                if (hidingId !== null) hideMutation.mutate({ messageId: hidingId });
                setHidingId(null);
              }}
            >
              Delete for me
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* v2.104.0 — the group-admin removal. The ONLY new action behind a confirmation,
          for the reason "delete for me" is: this one cannot be undone and it acts on
          somebody else's words in front of twenty people. The copy names WHOSE message
          and says the sender is not told, because an admin should know that before they
          tap rather than discover it afterwards. */}
      <AlertDialog open={adminDeleting !== null} onOpenChange={(open) => !open && setAdminDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this message for everyone?</AlertDialogTitle>
            <AlertDialogDescription>
              {adminDeleting
                ? `${nameById.get(adminDeleting.senderIdentityId) || "This member"}'s message disappears for every member of the group. They aren't told, and it can't be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              destructive
              onClick={() => {
                if (adminDeleting) {
                  adminDeleteMutation.mutate({ conversationId, messageId: adminDeleting.id });
                }
                setAdminDeleting(null);
              }}
            >
              Remove for everyone
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unsend confirmation (v2.88 — AlertDialog, not native confirm()). */}
      <AlertDialog open={unsendId !== null} onOpenChange={(open) => !open && setUnsendId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsend this message?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be removed for everyone in this conversation. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              destructive
              onClick={() => {
                if (unsendId !== null) removeMutation.mutate({ messageId: unsendId });
                setUnsendId(null);
              }}
            >
              Unsend
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ────────────────────────────────────────────────────────────── */

/** Small circular gradient action button used by thread rows + the conversation
 *  header. The accent is passed as an "r,g,b" tint plus its solid hex so the
 *  brand colours stay consistent (message=orange, voice=green, video=blue). */
function AccentCircle({
  rgb,
  hex,
  title,
  onClick,
  size = 32,
  children,
}: {
  rgb: string;
  hex: string;
  title: string;
  onClick: () => void;
  size?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="grid place-items-center rounded-full shrink-0 transition-[filter] hover:brightness-110"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(160deg, rgba(${rgb},.26), rgba(${rgb},.08))`,
        color: hex,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.15)",
      }}
    >
      {children}
    </button>
  );
}

/**
 * Delivery receipt for one of MY messages (v2.99.74).
 *
 * Owner: "will you send the message? It shows you what check if it's delivered. I mean
 * the other user is online and he received, but he didn't open it. It should show second
 * check mark beside that. If he heard it, it will turn both check marks into blue
 * colour means delivered, and any type of message either voice text video whatever."
 *
 * Before this, one tick and two ticks were the SAME state: `messages.status` had a
 * `delivered` value that nothing ever set, so the UI rendered "✓✓" for read and "✓" for
 * everything else — sent and delivered were indistinguishable. Now:
 *
 *   sent       → one tick, muted        (left this device)
 *   delivered  → two ticks, muted       (their app has it, unopened)
 *   read       → two ticks, BLUE        (they opened it)
 *   failed     → one tick struck out    (never left)
 *
 * Applies to every kind — text, voice, video, file — because it keys off the message
 * row's status, not the payload.
 */
function Receipt({ status, mine }: { status?: string | null; mine: boolean }) {
  if (!mine || !status) return null;
  const read = status === "read";
  const twoTicks = read || status === "delivered";
  const failed = status === "failed";
  /* Only ever rendered on our OWN bubbles (see the guard above). Board 1c: "accent =
     read, grey = delivered", so READ now takes the cycling accent rather than a fixed
     blue — the state change the owner asked to see at a glance, in the app's one accent.

     READ IS THE ACCENT AGAIN (v2.106.62), AND THE REASON IT LEFT WAS A MEASUREMENT ON THE
     WRONG SURFACE — a correction to the paragraph that used to sit here.

     It said the board "draws the outgoing bubble as a translucent ACCENT tint" and treated
     that as something the owner's orange request overrode. Read off the board's own markup,
     frames 1d and 3c both fill the outgoing bubble `rgba(245,140,60,.17)` — orange, not the
     accent — and draw the ✓✓ in `var(--rb)` on it. So there was no conflict, and the app's
     SOLID `#fb923c` gradient was its own choice. v2.106.40 then measured the tick against
     that solid fill and correctly found the accent invisible on it. Right number, wrong
     surface.

     RE-MEASURED on the board's fill, worst case across all 12 accent hues (mobile
     `--background` / desktop `--card`):

       accent on the OLD solid #fb923c            1.06:1     <- the old finding, confirmed
       accent on the board's .17 tint       5.44 / 4.82:1     <- clears AA
       white                                     16.4:1
       white 55%                            5.77 / 5.44:1
       white 45%                            4.35 / 4.13:1

     So read = the accent and delivered = white at **45%**, not 55%. That alpha is the whole
     point of re-measuring rather than just flipping read back: at 55% delivered (5.77/5.44)
     would OUTRANK read (5.44/4.82) and reinstate the exact inversion v2.106.40 existed to
     fix — the more important state being the fainter one. At 45% there is a real gap, so
     read is unambiguously the louder of the two AND the app's read-vs-delivered vocabulary
     is the same accent here as it already is on a card (the thread row, Message info).

     ONE mechanism, deliberately. The first cut set a grey CLASS and then overrode it with
     an inline colour for the read case — and the mutation run showed the class could be
     deleted with no visible change at all, because an inline `style` beats it. Two
     individually-removable mechanisms are dead weight that reads as load-bearing
     (v2.105.17), so the colour is decided in exactly one expression.

     A LITERAL fallback, never `var(--rb, var(--rb))`: that is a custom-property cycle and
     the browser drops the declaration, leaving the tick with no colour (v2.106.7). */
  const tickStyle = {
    color: read ? "var(--rb, #3FE0C5)" : "rgba(255,255,255,0.45)",
  };
  const label = failed
    ? "Not sent"
    : read
      ? "Read"
      : twoTicks
        ? "Delivered"
        : "Sent";
  return (
    <span
      className="ml-1 inline-flex items-center"
      style={tickStyle}
      title={label}
      aria-label={label}
      role="img"
    >
      {failed ? (
        <span className="text-[11px] line-through opacity-80">✓</span>
      ) : twoTicks ? (
        <CheckCheck className="size-3.5" strokeWidth={3} />
      ) : (
        <Check className="size-3.5" strokeWidth={3} />
      )}
    </span>
  );
}

/** Three-dot context menu for a message (Reply / Forward / Copy / Info / Delete).
 *  Always tappable on mobile (the old hover-only buttons were invisible on touch). */
/**
 * The quick-react row (board 4c) — five shortcuts plus `+` for the full picker.
 *
 * RENDERED INLINE ABOVE THE ROW RATHER THAN AS A FLOATING POPOVER. The board draws
 * it "above the focused bubble", and an absolutely-positioned bar over a bubble that
 * can sit at either edge of a phone needs measuring and then clamping — which is
 * exactly the class of bug this file has already paid for twice (the ⋮ menu clipped
 * off the left edge in v2.99.0, and the video-consent card ran off the right in
 * v2.99.54). In flow it is above the bubble by construction and cannot leave the
 * viewport at any width.
 *
 * MY CURRENT REACTION IS LIT, so the row doubles as the "remove" control: the
 * contract's toggle needs no second affordance and tapping the lit one takes it back.
 */
function QuickReact({
  mine,
  current,
  onPick,
  onMore,
  onClose,
}: {
  mine?: boolean;
  current: string | null;
  onPick: (emoji: string) => void;
  onMore: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className={"flex " + (mine ? "justify-end" : "justify-start") + " mb-1"}
      role="group"
      aria-label="React to this message"
    >
      <div className="rsheet flex items-center gap-0.5 rounded-full border border-border/60 px-1 py-1 shadow-lg">
        {QUICK_REACTIONS.map((e) => {
          const on = current === e;
          return (
            <button
              key={e}
              type="button"
              aria-label={on ? `Remove ${e} reaction` : `React with ${e}`}
              aria-pressed={on}
              onClick={() => onPick(e)}
              className={
                "grid size-8 place-items-center rounded-full text-lg leading-none transition active:scale-90 motion-reduce:transition-none " +
                (on ? "" : "hover:bg-foreground/10")
              }
              style={on ? { background: "rgba(var(--rb-rgb), 0.22)" } : undefined}
            >
              {e}
            </button>
          );
        })}
        <button
          type="button"
          aria-label="More reactions"
          onClick={onMore}
          className="grid size-8 place-items-center rounded-full text-muted-foreground transition hover:bg-foreground/10 active:scale-90 motion-reduce:transition-none"
        >
          <Plus className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Close reactions"
          onClick={onClose}
          className="grid size-8 place-items-center rounded-full text-muted-foreground transition hover:bg-foreground/10 active:scale-90 motion-reduce:transition-none"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * The chips under a bubble (board 4c): emoji + count when above 1, MY reaction
 * accent-tinted and everybody else's neutral glass.
 *
 * ONE INSERTION FOR EVERY MESSAGE SHAPE. It hangs off the per-message wrapper rather
 * than off the bubble, so it covers the emoji-only branch, the attachment shapes and
 * the ordinary bubble alike — the argument v2.103.3 made for the sender gutter, and
 * the reason three copies of the sender label once had to be kept in step by hand.
 *
 * TAPPING A CHIP TOGGLES, which is the same rule as the quick row and goes through
 * the same shared `reactionOpFor`, so the two entry points cannot come to disagree
 * about what a tap on one emoji means.
 */
function ReactionChips({
  reactions,
  myPin,
  mine,
  onToggle,
}: {
  reactions: MessageReactions | null | undefined;
  myPin: string;
  mine?: boolean;
  onToggle: (emoji: string) => void;
}) {
  const chips = reactionChips(reactions, myPin);
  if (!chips.length) return null;
  return (
    <div className={"flex flex-wrap gap-1 " + (mine ? "justify-end pr-1" : "justify-start pl-1") + " -mt-1"}>
      {chips.map((c) => (
        <button
          key={c.emoji}
          type="button"
          onClick={() => onToggle(c.emoji)}
          aria-pressed={c.mine}
          aria-label={
            (c.mine ? `Remove your ${c.emoji} reaction` : `React with ${c.emoji}`) +
            (c.count > 1 ? `, ${c.count} reactions` : "")
          }
          className={
            "flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[11px] leading-none transition active:scale-95 motion-reduce:transition-none " +
            (c.mine ? "" : "border-border/60 bg-card/70 hover:bg-muted/60")
          }
          style={
            c.mine
              ? {
                  /* Literal fallbacks, never `var(--rb, var(--rb))`: a custom property
                     that references itself is a CYCLE, which resolves to the
                     guaranteed-invalid value and makes the browser DROP the whole
                     declaration — a chip with no fill and no border at all. That trap
                     bit v2.106.7 and is forbidden by test. */
                  background: "rgba(var(--rb-rgb, 63, 224, 197), 0.18)",
                  borderColor: "rgba(var(--rb-rgb, 63, 224, 197), 0.45)",
                }
              : undefined
          }
        >
          <span>{c.emoji}</span>
          {/* The count is withheld at 1, per the contract: "1" beside a single emoji
              is a number that tells you nothing the chip does not already say. */}
          {c.count > 1 && <span className="tabular-nums opacity-80">{c.count}</span>}
        </button>
      ))}
    </div>
  );
}

function MessageMenu({
  mine,
  onReply,
  onReact,
  onCopy,
  onForward,
  onInfo,
  onHide,
  onDelete,
  onAdminDelete,
}: {
  mine?: boolean;
  onReply: () => void;
  /** Board 4c — open the quick-react row for this message. Offered on ANYBODY'S
   *  message including my own, because reacting to your own is a normal thing to do
   *  and there is no rule against it anywhere in the store. */
  onReact?: () => void;
  onCopy?: () => void;
  /** v2.99.74 — send this message's content on to another conversation. */
  onForward?: () => void;
  /** v2.99.74 — sent / delivered / read times for this message. */
  onInfo?: () => void;
  /**
   * v2.102.2 — hide it for me alone. Offered on anybody's message, because unlike
   * `onDelete` (unsend) it changes nothing for the other people in the conversation.
   */
  onHide?: () => void;
  onDelete?: () => void;
  /**
   * v2.104.0 — a group ADMIN removes somebody else's message for everyone. A separate
   * prop from `onDelete` (unsend), and a separate item in the menu, because the two have
   * different authority and the copy has to say which. Passed only when the server has
   * said this person is an admin, so the item simply does not exist otherwise — a control
   * that is always refused is worse than an absent one.
   */
  onAdminDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0 mb-1">
      <button
        type="button"
        aria-label="Message options"
        onClick={() => setOpen((v) => !v)}
        // v2.99.85 (owner: "the three dots is not clear. it's very light color. you
        // need to make it highlighted. it means that a three dots. you can click on
        // it"). It was 35% opacity on a phone and INVISIBLE until hover on desktop —
        // a control nobody could tell was a control. It is now a real chip: a filled
        // circle with a border, fully opaque, on every screen. The desktop
        // hover-reveal is gone rather than kept at a higher opacity, because "appears
        // on hover" is exactly what made it undiscoverable, and a touch screen has no
        // hover to discover it with.
        className="grid size-8 place-items-center rounded-full border border-border bg-muted/80 text-foreground shadow-sm hover:bg-muted active:scale-95 transition"
      >
        <MoreVertical className="size-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={
              // Open toward the screen INTERIOR, never off the edge: the ⋮ for
              // MY messages sits at the far LEFT of the row (justify-end puts the
              // menu button before the bubble), so the menu must grow rightward
              // (left-0); received messages have the ⋮ on the right, so grow
              // leftward (right-0). The old mapping was reversed, which clipped
              // the menu off the left edge on wide own-bubbles (e.g. voice notes).
              "absolute z-50 bottom-8 min-w-36 rounded-xl border border-border bg-card p-1 shadow-xl " +
              (mine ? "left-0" : "right-0")
            }
          >
            <button
              type="button"
              onClick={() => { onReply(); setOpen(false); }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <Reply className="size-4" /> Reply
            </button>
            {onReact && (
              <button
                type="button"
                onClick={() => { onReact(); setOpen(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <SmilePlus className="size-4" /> React
              </button>
            )}
            {onCopy && (
              <button
                type="button"
                onClick={() => { onCopy(); setOpen(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <Copy className="size-4" /> Copy
              </button>
            )}
            {onForward && (
              <button
                type="button"
                onClick={() => { onForward(); setOpen(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <Forward className="size-4" /> Forward
              </button>
            )}
            {onInfo && (
              <button
                type="button"
                onClick={() => { onInfo(); setOpen(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <Info className="size-4" /> Info
              </button>
            )}
            {/* "Delete for me" (v2.102.2, owner #81) — offered on EVERY message,
                including somebody else's, because it changes nothing for anybody but
                the person tapping it. Unsend below is the other operation entirely and
                stays ours-only. */}
            {onHide && (
              <button
                type="button"
                onClick={() => { onHide(); setOpen(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <EyeOff className="size-4" /> Delete for me
              </button>
            )}
            {mine && onDelete && (
              <button
                type="button"
                onClick={() => { onDelete(); setOpen(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-4" /> Unsend
              </button>
            )}
            {/* v2.104.0 — the group-admin override. Never shown on my OWN message: that
                is Unsend's job and it is already offered above, and the server refuses
                it there too ("own-message"). The wording names the blast radius, because
                "delete" alone is what makes somebody remove a message for twenty people
                believing they hid it for themselves. */}
            {!mine && onAdminDelete && (
              <button
                type="button"
                onClick={() => { onAdminDelete(); setOpen(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-4" /> Remove for everyone
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AttachmentView({
  mimeType,
  url,
  filename,
  thumbUrl,
  width,
  height,
  durationMs,
  mine = false,
  glyph,
  onOpen,
}: {
  mimeType: string;
  url: string;
  filename?: string;
  /** ≤512px thumbnail (v2.89) — bubbles render this; tap opens the full url. */
  thumbUrl?: string | null;
  /** Pixel dimensions of the FULL image — drive an explicit aspect-ratio so
   *  the bubble reserves its box before the bytes arrive (no layout shift). */
  width?: number | null;
  height?: number | null;
  /** Recorded audio length (v2.99.72) — already stored on every voice note this app
   *  records, so the player shows a real total without probing the media element. */
  durationMs?: number | null;
  /** Own-bubble styling (white-on-orange) vs received (theme tokens). */
  mine?: boolean;
  /** The bubble's own dark gradient stop, for a glyph on a white on-bubble control.
   *  Threaded rather than derived here, because this component knows nothing about who
   *  sent the message — and the sender is what picks the hue. */
  glyph?: string;
  onOpen?: (m: { url: string; type: "image" | "video"; name?: string }) => void;
}) {
  // A thumb/image that 404s/403s used to render as a broken white rectangle —
  // fall back to the tappable file card instead (v2.96).
  const [imgBroken, setImgBroken] = useState(false);
  if (mimeType.startsWith("image/")) {
    if (imgBroken) return <FileCard url={url} filename={filename || "Image"} mine={mine} />;
    // Thumbnail in the bubble (falls back to the full url for legacy/GIF
    // rows) → click opens the FULL-SIZE image in the in-app lightbox.
    const hasDims = typeof width === "number" && width > 0 && typeof height === "number" && height > 0;
    return (
      <button
        type="button"
        onClick={() => onOpen?.({ url, type: "image", name: filename })}
        className="block mb-1"
        aria-label="Open image"
      >
        <img
          src={thumbUrl || url}
          alt={filename || "image"}
          width={hasDims ? width! : undefined}
          height={hasDims ? height! : undefined}
          style={hasDims ? { aspectRatio: `${width} / ${height}` } : undefined}
          className="rounded-xl max-h-64 w-auto max-w-full object-cover bg-black/20 hover:opacity-90 transition-opacity"
          loading="lazy"
          onError={() => setImgBroken(true)}
        />
      </button>
    );
  }
  if (mimeType.startsWith("video/")) {
    return (
      <button
        type="button"
        onClick={() => onOpen?.({ url, type: "video", name: filename })}
        className="relative block mb-1 group/vid"
        aria-label="Play video"
      >
        <video src={url} className="rounded-xl max-h-64 w-auto bg-black/40" muted preload="metadata" />
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid size-12 place-items-center rounded-full bg-black/55 text-white shadow-lg">
            <Play className="size-6 translate-x-0.5" />
          </span>
        </span>
      </button>
    );
  }
  if (mimeType.startsWith("audio/")) {
    return <VoiceNotePlayer url={url} mine={mine} durationMs={durationMs} glyph={glyph} />;
  }
  return <FileCard url={url} filename={filename} mine={mine} />;
}

/**
 * Board 1d's 18-bar waveform.
 *
 * A FIXED pattern rather than a decode of the audio, and that is a deliberate limit rather
 * than a shortcut: real amplitudes need the whole file fetched and put through an
 * AudioContext, which on the owner's own thread of six voice notes is six decodes for
 * decoration — and the board draws a stylised wave, not an analysis. Deterministic per
 * index, so a note looks the same every time it is opened.
 */
const WAVE_BARS = [38, 62, 100, 74, 46, 88, 58, 30, 70, 96, 54, 42, 80, 64, 34, 90, 50, 26] as const;

function fmtClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Custom voice-note / audio player (v2.96) — replaces the browser's default
 * `<audio controls>` (a mismatched white pill on our dark bubbles) with an
 * inline WhatsApp-style player: round play/pause, a seekable progress track
 * with a live clock, and a download affordance. The HTMLAudioElement is
 * created lazily on first play so a thread of 50 voice notes costs nothing.
 */
/**
 * Voice-note player (v2.96, largely rewritten in v2.99.72).
 *
 * OWNER: "when you click to play, the sound is played, but the control doesn't show
 * that it's moving, which second you reach. It only stays there like it's not played."
 *
 * TWO REAL BUGS, and the screenshot showed both — a scrubber pinned at the start with
 * "0:00" beside "· · ·":
 *
 *   1. THE DURATION PROBE DESTROYED PLAYBACK. MediaRecorder blobs report
 *      `duration === Infinity` until seeked past the end, and the workaround for that
 *      ran on `loadedmetadata` — which fires just AFTER the click that started
 *      playback. So pressing play seeked the element to `Number.MAX_SAFE_INTEGER`,
 *      which clamps to the end, fires `ended`, and resets the clock to 0. Audio you
 *      had already heard start, with a control frozen at zero: exactly the report.
 *      The probe now never runs while playing — it waits for a pause — and uses the
 *      `1e101` form that the codebase's own `readMediaDurationMs` already uses,
 *      rather than MAX_SAFE_INTEGER, which several engines refuse outright.
 *
 *   2. THE DURATION WAS ALREADY KNOWN AND WENT UNREAD. Every voice note recorded in
 *      the app stores its real length in `attachments.durationMs`, and `messages.list`
 *      already hands the whole attachment row to the client. Seeding from it means the
 *      common case needs NO probe at all, shows a real total immediately, and the
 *      scrubber is seekable before the first play.
 *
 * The clock is also driven by rAF while playing rather than by `timeupdate`, which
 * browsers fire about four times a second — enough to look like stuttering on a short
 * note, which is the other half of "it doesn't look like it's moving".
 */
function VoiceNotePlayer({
  url,
  mine,
  durationMs,
  glyph,
}: {
  url: string;
  mine: boolean;
  /** Recorded length from the attachment row, when the sender's client stored one. */
  durationMs?: number | null;
  /** The bubble's own dark gradient stop, for a glyph on the white play disc. */
  glyph?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const seeded = typeof durationMs === "number" && durationMs > 0 ? durationMs / 1000 : 0;
  const [dur, setDur] = useState(seeded);
  const [cur, setCur] = useState(0);
  // True only while the element is being seeked to read its length. Suppresses the
  // clock so the probe's own position never reaches the UI.
  const probingRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  // Stop playback when the bubble unmounts (thread switch / unsend).
  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      audioRef.current?.pause();
    },
    []
  );

  /** Read a MediaRecorder blob's real length. Only ever called while PAUSED. */
  const probeDuration = (a: HTMLAudioElement) => {
    if (probingRef.current || !a.paused) return;
    probingRef.current = true;
    const at = a.currentTime;
    const finish = () => {
      a.removeEventListener("timeupdate", finish);
      const d = a.duration;
      if (Number.isFinite(d) && d > 0) setDur(d);
      // Put the playhead back exactly where the listener left it.
      try {
        a.currentTime = Number.isFinite(at) ? at : 0;
      } catch {
        /* some engines refuse a seek before the first play */
      }
      probingRef.current = false;
    };
    a.addEventListener("timeupdate", finish);
    try {
      // 1e101, not MAX_SAFE_INTEGER: the same value readMediaDurationMs uses, and the
      // one engines actually accept for "seek past the end".
      a.currentTime = 1e101;
    } catch {
      probingRef.current = false;
      a.removeEventListener("timeupdate", finish);
    }
  };

  const ensure = (): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current;
    const a = new Audio(url);
    a.preload = "metadata";
    a.addEventListener("loadedmetadata", () => {
      const d = a.duration;
      if (Number.isFinite(d) && d > 0) {
        setDur(d);
      } else if (!seeded) {
        // Unknown length AND nothing stored for it. Defer the probe until playback
        // stops — running it now is what used to break the very click that triggered
        // it. A note with a stored duration never needs this at all.
        if (a.paused) probeDuration(a);
      }
    });
    a.addEventListener("timeupdate", () => {
      if (!probingRef.current) setCur(a.currentTime || 0);
    });
    a.addEventListener("ended", () => {
      setCur(0);
      if (!Number.isFinite(a.duration) && !seeded) probeDuration(a);
    });
    a.addEventListener("pause", () => setPlaying(false));
    a.addEventListener("play", () => setPlaying(true));
    audioRef.current = a;
    return a;
  };

  // v2.99.74 — LEARN THE LENGTH BEFORE THE FIRST PLAY, when nothing told us.
  //
  // The progress fill is `cur / dur`, so an unknown duration pins the bar at zero no
  // matter how well playback is going. v2.99.73 made the probe SAFE by deferring it
  // until the element was paused — but on a first play that means it never runs during
  // that play, so the bar still sat still for its whole length. Probing on MOUNT closes
  // that: by the time anyone presses play the length is known, and the note is seekable
  // before it is ever played.
  //
  // Only when we have nothing stored, so the normal case still costs no request at
  // all: every note this app records stores its length. The cost lands only on notes
  // from before that existed — those get one `preload="metadata"` header fetch on
  // mount instead of on first play, which is the price of a bar that moves.
  useEffect(() => {
    if (seeded > 0) return;
    // Creating the element is the point: it starts the metadata load and installs the
    // `loadedmetadata` listener, which runs the probe itself once the header arrives
    // and turns out not to carry a duration. On mount `readyState` is normally 0, so
    // the direct call below only fires when the metadata is already cached.
    const a = ensure();
    if (a.readyState >= 1) probeDuration(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Smooth clock while playing. `timeupdate` alone fires ~4Hz, which on a 3-second
  // note reads as a control that barely moves.
  useEffect(() => {
    if (!playing) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    const tick = () => {
      const a = audioRef.current;
      if (a && !probingRef.current) {
        setCur(a.currentTime || 0);
        // Second net: many engines only settle a MediaRecorder blob's duration once
        // enough of it has buffered, which can happen mid-playback. Pick it up rather
        // than leaving the bar frozen for a note whose length nobody ever recorded.
        const d = a.duration;
        if (Number.isFinite(d) && d > 0) setDur((prev) => (prev > 0 ? prev : d));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing]);

  const toggle = () => {
    const a = ensure();
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = ensure();
    if (!Number.isFinite(dur) || dur <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = frac * dur;
    setCur(a.currentTime);
  };

  const frac = dur > 0 && Number.isFinite(dur) ? Math.min(1, cur / dur) : 0;
  const sub = "text-white/70";
  const track = "bg-white/25";
  const fill = "bg-white";

  return (
    <div className={"my-1 flex w-60 max-w-full items-center gap-2.5 " + "text-white"}>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play voice note"}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-white ring-1 ring-black/10 active:scale-95 transition-transform"
        /* A SOLID WHITE DISC WITH THE BUBBLE'S OWN DARK STOP AS THE GLYPH, and this is a
           correction to my own v2.106.18: `.rchip-accent` is a CARD recipe, measured on
           `--card`, and this control sits on a SATURATED BUBBLE — a surface it was never
           measured for.
           MEASURED across all 36 bubble surfaces the app can draw (own orange, peer blue
           and the 16 group hues, both gradient stops of each): the accent glyph on its own
           accent tint on the bubble is 1.16:1 at worst and FAILS AA on 30 of the 36. That
           is the near-invisible play triangle in the owner's own screenshot.
           The disc is white so it reads as a control on every hue by construction, and the
           glyph takes the bubble's DARKER stop so it borrows the bubble's identity instead
           of introducing a nineteenth colour: 4.92:1 at worst, 0 of 36 failing.
           `ring-black/10` because the white disc alone is only 1.92:1 against the palest
           bubble — the glyph carries the identification, the hairline carries the edge. */
        style={{ color: glyph }}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-[1px]" />}
      </button>
      <div className="min-w-0 flex-1">
        {/* BOARD 1d: an 18-BAR WAVEFORM, not a progress slider. This is the dominant
            element in the owner's own screenshot of the conversation and the largest
            single visual delta on the frame.
            The bar HEIGHTS are a fixed pattern rather than a decode of the audio: reading
            real amplitudes needs the whole file fetched and put through an AudioContext,
            which on a thread of six voice notes is six decodes for decoration — and the
            board draws a stylised wave, not an analysis. The pattern is deterministic per
            bar index so a note looks the same every time it is opened.
            Everything the slider did is kept: the same click-to-seek element, the same
            `role="slider"` and aria values, and the same `frac` rAF driver. */}
        <div
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(dur) || 0}
          aria-valuenow={Math.round(cur)}
          onClick={seek}
          className="flex h-[22px] cursor-pointer items-center gap-[1.8px]"
        >
          {WAVE_BARS.map((h, i) => (
            <span
              key={i}
              className={
                "min-w-0 flex-1 rounded-full transition-colors motion-reduce:transition-none " +
                ((i + 1) / WAVE_BARS.length <= frac ? fill : track)
              }
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
        <div className={"mt-1 flex items-center justify-between font-mono text-[10px] " + sub}>
          <span>{fmtClock(cur)}</span>
          <span>{dur > 0 && Number.isFinite(dur) ? fmtClock(dur) : "· · ·"}</span>
        </div>
      </div>
      <a
        href={url}
        download={true}
        target="_blank"
        rel="noreferrer"
        aria-label="Download audio"
        className={
          "grid size-7 shrink-0 place-items-center rounded-full transition hover:brightness-110 " +
          "bg-white/15"
        }
      >
        <Download className="size-3.5" />
      </a>
    </div>
  );
}

/**
 * Live recording bar (v2.99.72).
 *
 * OWNER: "when you record the voice, [it] doesn't show that you are talking. Like, it
 * just turned red, and there is no wave when you talk… and then you need to click on
 * the red to send, or there's no choice to delete the voice, or you can pause the
 * voice, or you cancel the voice and you want to re-record again."
 *
 * All three were true. Recording replaced the mic button with a red square and nothing
 * else: no feedback that the microphone was hearing anything, and Stop was the ONLY
 * exit — which also sent. So a misfire, a cough, or a change of mind had no way out
 * except sending the note and unsending it afterwards.
 *
 * This replaces the whole composer row while recording with: discard · live waveform ·
 * elapsed clock · pause/resume · send.
 *
 * THE WAVEFORM IS REAL. It reads RMS off a WebAudio analyser tapped from the same
 * MediaStream the recorder is using, so the bars move because the microphone is
 * actually hearing you — a decorative animation would have looked identical while
 * telling you nothing, which is the complaint.
 *
 * The bars are written IMPERATIVELY from one rAF loop rather than through React state.
 * At 60fps a state update per frame would re-render the entire thread on every frame,
 * which is the mistake the landing page had to be rescued from in v2.99.67.
 */
function RecordingBar({
  get,
  paused,
  onTogglePause,
  onCancel,
  onSend,
  busy,
}: {
  /** Getter, not the handle: the recorder is replaced on each new take. */
  get: () => VoiceRecording | null;
  paused: boolean;
  onTogglePause: () => void;
  onCancel: () => void;
  onSend: () => void;
  busy: boolean;
}) {
  const BARS = 30;
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);
  const clockRef = useRef<HTMLSpanElement | null>(null);
  const histRef = useRef<number[]>([]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      // ~20 samples/sec. Faster buys nothing at this bar width and costs battery on
      // a phone, which is a lesson this project has already paid for once.
      if (t - last < 50) return;
      last = t;
      const rec = get();
      const lvl = rec && !paused ? rec.level() : 0;
      const hist = histRef.current;
      hist.push(lvl);
      if (hist.length > BARS) hist.shift();
      for (let i = 0; i < BARS; i++) {
        const el = barsRef.current[i];
        if (!el) continue;
        // Newest sample on the RIGHT, so the wave scrolls the way people read.
        const v = hist[hist.length - BARS + i] ?? 0;
        el.style.transform = `scaleY(${0.12 + Math.min(1, v) * 0.88})`;
      }
      if (clockRef.current && rec) {
        clockRef.current.textContent = fmtClock(Math.floor(rec.elapsedMs() / 1000));
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [get, paused]);

  return (
    <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card/70 px-2 py-1.5">
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        aria-label="Discard recording"
        title="Discard this recording"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-destructive/15 text-destructive transition active:scale-95 disabled:opacity-50"
      >
        <Trash2 className="size-4" />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          aria-hidden
          className={
            "size-2 shrink-0 rounded-full " +
            (paused ? "bg-muted-foreground" : "bg-destructive motion-safe:animate-pulse")
          }
        />
        <span
          ref={clockRef}
          className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
        >
          0:00
        </span>
        {/* The wave. aria-hidden because a screen reader gains nothing from 30 bars —
            the state is announced by the buttons and the clock. */}
        <span aria-hidden className="flex h-6 min-w-0 flex-1 items-center gap-[2px] overflow-hidden">
          {Array.from({ length: BARS }, (_, i) => (
            <span
              key={i}
              ref={(el) => {
                barsRef.current[i] = el;
              }}
              className="h-6 w-full min-w-[2px] origin-center rounded-full"
              style={{
                transform: "scaleY(0.12)",
                /* Board 4d, and this is a VOCABULARY fix rather than a restyle.
                   These bars were painted with `--relay-online` — the presence
                   green, which in this app means ONLINE and nothing else: it is
                   what every LED is drawn with, which is why v2.99.86 moved DND
                   off it, v2.106.9 moved the speaking tile off it and v2.106.11
                   moved the push banner off it. A green waveform is a fourth
                   meaning for the one colour that has to carry exactly one.
                   Recording is ACTIVE, which is what the accent means after
                   v2.106.6 — and the literal fallback is deliberate, because
                   `var(--rb, var(--rb))` is a custom-property cycle the browser
                   drops entirely (v2.106.7).
                   The DOT stays red: red-means-recording is a convention older
                   than this app and does not collide with destructive here,
                   since the only destructive control in the bar is the discard
                   button, which is a filled chip rather than a hairline. */
                background: paused
                  ? "rgba(var(--rb-rgb, 63, 224, 197), 0.28)"
                  : "var(--rb, #3FE0C5)",
              }}
            />
          ))}
        </span>
      </div>

      <button
        type="button"
        onClick={onTogglePause}
        disabled={busy}
        aria-label={paused ? "Resume recording" : "Pause recording"}
        title={paused ? "Resume" : "Pause"}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground/10 text-foreground transition active:scale-95 disabled:opacity-50"
      >
        {paused ? <Mic className="size-4" /> : <Pause className="size-4" />}
      </button>
      <button
        type="button"
        onClick={onSend}
        disabled={busy}
        aria-label="Send voice note"
        title="Send"
        className="rcta grid size-9 shrink-0 place-items-center rounded-full transition active:scale-95 disabled:opacity-50"
      >
        <Send className="size-4" />
      </button>
    </div>
  );
}

/** Styled generic-attachment card (v2.96) — replaces the bare underlined
 *  link: icon tile + filename + an explicit open/download affordance. */
function FileCard({ url, filename, mine }: { url: string; filename?: string; mine: boolean }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={
        "my-1 flex w-60 max-w-full items-center gap-2.5 rounded-xl px-2.5 py-2 transition hover:brightness-110 " +
        "bg-white/15 text-white"
      }
    >
      <span
        className={
          "grid size-9 shrink-0 place-items-center rounded-lg " +
          "bg-white/20 text-white"
        }
      >
        <Paperclip className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{filename || "Attachment"}</span>
        <span className={"block text-[10.5px] " + "text-white/70"}>
          Tap to open or download
        </span>
      </span>
      <Download className="size-4 shrink-0 opacity-70" />
    </a>
  );
}

/** Fullscreen media preview with a close (X). Closes on backdrop click + Escape. */
/** What the fullscreen viewer needs beyond the bytes: whose it is, when, and its caption. */
type LightboxMedia = {
  url: string;
  type: "image" | "video";
  name?: string;
  /** Already resolved to a label ("You" / a name) by the thread that opened it. */
  sender?: string;
  at?: string | Date;
  caption?: string;
};

/**
 * Board 4e. The viewer used to be bytes on black with a close and a download and
 * nothing else — no sender, no time, no caption, so a photo opened fullscreen lost
 * every piece of context the bubble around it had.
 *
 * The end-to-end line is the board's, and it is worth saying HERE specifically:
 * fullscreen is where somebody is most likely to screenshot or share, and this is
 * the app's one chance to say what the file's handling actually is.
 */
function MediaLightbox({
  media,
  onClose,
}: {
  media: LightboxMedia;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <X className="size-5" />
      </button>
      {/* Download the full-size original (v2.96). */}
      <a
        href={media.url}
        download={media.name || true}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        aria-label="Download"
        className="absolute right-16 top-4 grid size-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <Download className="size-5" />
      </a>
      {/* Sender + when, top-left, clear of the two controls top-right. Rendered only
          when the opener supplied them, so a caller that has not (or an older one)
          gets exactly the previous chrome rather than an empty row. */}
      {(media.sender || media.at) && (
        <div className="absolute left-4 top-4 max-w-[55vw] text-white" onClick={(e) => e.stopPropagation()}>
          {media.sender && <div className="truncate text-sm font-semibold" dir="auto">{media.sender}</div>}
          {media.at && (
            <div className="mt-0.5 font-mono text-[11px] text-white/70" dir="ltr">
              {new Date(media.at).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>
          )}
        </div>
      )}
      <div
        className="flex max-h-[90vh] max-w-[92vw] flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        {media.type === "image" ? (
          <img src={media.url} alt={media.name || "image"} className="max-h-[78vh] max-w-[92vw] rounded-lg object-contain" />
        ) : (
          <video src={media.url} controls autoPlay className="max-h-[78vh] max-w-[92vw] rounded-lg" />
        )}
        {media.caption && (
          <p className="max-w-[92vw] text-center text-sm text-white/90" dir="auto">
            {media.caption}
          </p>
        )}
      </div>
      {/* The board's footer. `pointer-events-none` so it can never swallow the tap
          that closes the viewer — the whole backdrop is the close target.

          THE WORDING IS CORRECTED, because the old one was a FALSE CLAIM ON SCREEN. RELAY
          has no end-to-end encryption and cannot: `drizzle/schema.ts` stores `body` as
          plain `text`, and `server/v2db.ts` runs `like(messages.body, '%…%')` — a database
          substring match, which is only possible on plaintext the server can read. Media is
          the same: the object is served through a cookie-gated proxy, not sealed to a key
          only the recipient holds.
          What IS true is what v2.99.14 built: the bytes travel over TLS and the URL is not
          shareable — the proxy streams them itself rather than redirecting to a presigned
          storage URL, so a media link cannot be opened outside the app. That is worth
          saying, and it is a promise the code keeps.
          Board 1d's "END-TO-END ENCRYPTED" centre chip is DECLINED for the same reason,
          rather than built: a security claim the app cannot honour is worse than no claim,
          and this one would have been printed in the middle of every conversation. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-5 text-center font-mono text-[10px] font-semibold uppercase text-white/45"
        style={{ letterSpacing: ".22em" }}
      >
        Encrypted in transit · stays in the app
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

/**
 * Away auto-reply switch, in the Messages header (v2.99.66).
 *
 * Owner: "this is the auto reply inside the message. You have it as a feature,
 * but you should allow the user to enable and disable it. You don't enable it by
 * default… whenever you enter the message section, give him type of option."
 *
 * It is OFF for everyone until switched on — the server treats a NULL column as
 * off — because it posts a line in your name into a conversation you are not
 * watching. Optimistic, with rollback, so the switch never lies about its state.
 */
function AutoReplyToggle() {
  const utils = trpc.useUtils();
  const me = trpc.identity.whoami.useQuery();
  const on = me.data?.autoReplyEnabled === true;
  const [open, setOpen] = useState(false);
  const set = trpc.identity.setAutoReply.useMutation({
    onMutate: async ({ enabled }) => {
      const prev = utils.identity.whoami.getData();
      utils.identity.whoami.setData(undefined, (d) => (d ? { ...d, autoReplyEnabled: enabled } : d));
      return { prev };
    },
    onError: (_e, _v, cxt) => {
      if (cxt?.prev !== undefined) utils.identity.whoami.setData(undefined, cxt.prev);
      toast.error("Couldn't change auto-reply. Try again.");
    },
    onSuccess: ({ enabled }) => {
      toast.success(enabled ? "Auto-reply is on while you're away" : "Auto-reply is off");
    },
  });

  if (!me.data) return null;
  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label="Message options"
        title="Message options"
        className={"size-8 " + (on ? "text-primary" : "text-muted-foreground")}
      >
        <StickyNote className="size-5" />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-w-sm rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Message options</AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              Turn the away auto-reply on or off.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            disabled={set.isPending}
            onClick={() => set.mutate({ enabled: !on })}
            className="flex w-full items-start gap-3 rounded-2xl border border-border/60 p-3 text-left active:scale-[0.99] transition-transform"
          >
            <span
              className={
                "mt-0.5 h-6 w-10 shrink-0 rounded-full p-0.5 transition-colors " +
                (on ? "bg-primary" : "bg-muted")
              }
            >
              <span
                className={
                  "block size-5 rounded-full bg-white transition-transform " + (on ? "translate-x-4" : "")
                }
              />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Auto-reply when I'm away</span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                If someone messages you while you're offline, RELAY replies once to let them know
                you'll get back to them. Off by default.
              </span>
            </span>
          </button>
          <AlertDialogFooter>
            <AlertDialogCancel>Done</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function NewMessageDialog({ defaultMode = "dm" }: { defaultMode?: "dm" | "group" } = {}) {
  const [, setLocation] = useLocation();
  const basePath = useTabBasePath();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  // The Groups tab opens this on the GROUP side, because a + on a screen that lists
  // only groups meaning "new DM" is a control that does the wrong thing by default.
  // Both modes stay reachable from the toggle either way — this picks the landing
  // side, it does not remove a mode.
  const [mode, setMode] = useState<"dm" | "group">(defaultMode);
  /**
   * What has been typed — a NUMBER OR A NAME (v2.99.93).
   *
   * Owner: start a conversation "by first digit or first letter". This field used to
   * strip every non-digit on the way in, so a name could not be typed at all and you
   * had to know the six digits by heart. It now holds the raw query; `number` for
   * the request is DERIVED, so the submit path still only ever sees six digits.
   */
  const [number, setNumber] = useState("");
  // Only loaded while the sheet is open — no cost to the thread list behind it.
  const contactsQ = trpc.contacts.list.useQuery(undefined, { enabled: open, staleTime: 30_000 });
  // group-builder state
  const [groupTitle, setGroupTitle] = useState("");
  /* v2.106.66 — the group's photo, chosen BEFORE the group exists. The owner reported that
     picking one did nothing, and it never could: this sheet had no picker at all, and the
     server's `createGroup` schema accepted only a title and members. The url is held here
     and sent with the create — `AvatarPicker` uploads into the CALLER's own storage
     namespace, which is exactly what the server's ownership gate requires, so a photo can
     legitimately be chosen before there is any conversation to attach it to. */
  const [groupAvatar, setGroupAvatar] = useState<string | null>(null);
  const [groupAvatarOpen, setGroupAvatarOpen] = useState(false);
  const [groupNumbers, setGroupNumbers] = useState<string[]>([]);
  const [groupInput, setGroupInput] = useState("");

  function resetAll() {
    setOpen(false);
    // Back to the tab's OWN default, not a hardcoded "dm" — otherwise closing the
    // sheet on the Groups tab silently leaves it on the DM side for the next open.
    setMode(defaultMode);
    setNumber("");
    setGroupTitle("");
    setGroupAvatar(null);
    setGroupNumbers([]);
    setGroupInput("");
  }

  const openThread = trpc.messages.openThread.useMutation({
    onSuccess: (res) => {
      setOpen(false);
      setNumber("");
      setLocation(`${basePath}?c=${res.conversationId}`);
    },
  });
  const createGroup = trpc.messages.createGroup.useMutation({
    onSuccess: (res) => {
      utils.messages.threads.invalidate();
      resetAll();
      /* v2.106.64 — a NEW GROUP always lands on the Groups tab, never on `basePath`.
         `useTabBasePath` exists so opening a conversation does not change the active tab
         under a tap that only meant "open this" — and that rule still holds for every
         other navigation here. This is the one case it must NOT: the sheet's Direct/Group
         toggle is reachable from the Messages tab, so creating a group there used to land
         on `/app/messages?c=<groupId>` — a group conversation on a tab whose list, since
         this release, cannot contain it. The user would close it and find nothing, with
         the group only reachable by switching tabs. The destination genuinely IS a
         groups-tab object, so the tab moves with it. */
      setLocation(`/app/groups?c=${res.conversationId}`);
    },
  });
  /** Add by the typed number, or by a number a suggestion supplied. */
  function addGroupNumber(explicit?: string) {
    const n = (explicit ?? digitsOf(groupInput)).slice(0, 6);
    if (n.length === 6 && !groupNumbers.includes(n)) {
      setGroupNumbers((xs) => [...xs, n]);
    }
    setGroupInput("");
  }
  const openSelfThread = trpc.messages.openSelfThread.useMutation({
    onSuccess: (res) => {
      setOpen(false);
      setNumber("");
      setLocation(`${basePath}?c=${res.conversationId}`);
    },
  });
  const pending = openThread.isPending || openSelfThread.isPending || createGroup.isPending;
  const errorMessage =
    openThread.error?.message ??
    openSelfThread.error?.message ??
    createGroup.error?.message ??
    null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="New message"
        title="New message"
        /* BOARD 1c: the compose chip is the ACCENT chip. It was a hand-rolled orange tint
           carrying an orange GLYPH — accent-on-its-own-tint, the v2.106.31 pattern, and it
           measured 1.77:1 in light (the tint itself is only 1.28:1 against the card, so the
           chip barely existed either). `.rchip-accent` is the recipe built for exactly this
           and it is the ONLY one that carries a per-theme text colour, which an inline style
           cannot express. */
        className="rchip-accent grid place-items-center w-[34px] h-[34px] rounded-[10px] shrink-0 hover:brightness-110"
      >
        <MessageSquarePlus className="size-[18px]" />
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={resetAll}>
          <div
            /* Board 3d: the sheet's material is the shared `.rsheet` recipe (v2.106.10),
               which is dark-scoped and declares NOTHING in light — so `bg-card` stays as
               the light-theme surface underneath rather than being replaced. */
            className="rsheet w-full max-w-sm rounded-2xl bg-card border border-border p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">{mode === "group" ? "New group" : "New conversation"}</h3>
              <Button size="icon" variant="ghost" onClick={resetAll}>
                <X className="size-4" />
              </Button>
            </div>

            {/* Direct / Group toggle */}
            {/* Board 3d's segmented control: an inset well (rgba(0,0,0,.32), radius 13,
                padding 5) whose SELECTED half is the cycling accent — the same "you are
                here" language as the tab bar's pill (v2.106.2), so one idea of selection
                covers the app. Inline rather than a composed Tailwind class because a
                runtime-built colour class is invisible to the JIT and renders unstyled. */}
            <div
              role="group"
              aria-label="Conversation type"
              className="grid grid-cols-2 gap-[7px] rounded-[13px] p-[5px] mb-4 border"
              style={{ background: "rgba(0,0,0,.32)", borderColor: "rgba(255,255,255,.08)" }}
            >
              <button
                type="button"
                aria-pressed={mode === "dm"}
                onClick={() => setMode("dm")}
                className={
                  "flex items-center justify-center gap-1.5 rounded-[9px] py-[9px] text-[13px] transition-colors " +
                  (mode === "dm" ? "font-bold border" : "font-semibold text-muted-foreground hover:text-foreground")
                }
                style={
                  mode === "dm"
                    ? {
                        /* Literal fallbacks, never `var(--rb, var(--rb))`: a
                           self-referencing custom property is a CYCLE, resolves to the
                           guaranteed-invalid value, and the browser DROPS the whole
                           declaration — leaving the selected half with no fill at all
                           (the v2.106.7 trap). */
                        background: "rgba(var(--rb-rgb, 63, 224, 197), 0.20)",
                        borderColor: "rgba(var(--rb-rgb, 63, 224, 197), 0.50)",
                        color: "#f2fffa",
                      }
                    : undefined
                }
              >
                <MessageSquarePlus className="size-3.5" /> Direct
              </button>
              <button
                type="button"
                aria-pressed={mode === "group"}
                onClick={() => setMode("group")}
                className={
                  "flex items-center justify-center gap-1.5 rounded-[9px] py-[9px] text-[13px] transition-colors " +
                  (mode === "group" ? "font-bold border" : "font-semibold text-muted-foreground hover:text-foreground")
                }
                style={
                  mode === "group"
                    ? {
                        background: "rgba(var(--rb-rgb, 63, 224, 197), 0.20)",
                        borderColor: "rgba(var(--rb-rgb, 63, 224, 197), 0.50)",
                        color: "#f2fffa",
                      }
                    : undefined
                }
              >
                <Users className="size-3.5" /> Group
              </button>
            </div>

            {mode === "dm" ? (
              <>
                {/* Quick action: note to self */}
                <button
                  type="button"
                  onClick={() => openSelfThread.mutate()}
                  disabled={pending}
                  className="w-full text-left flex items-center gap-3 rounded-xl border border-border bg-muted/20 hover:bg-muted/40 transition-colors px-3 py-3 mb-4 disabled:opacity-50"
                >
                  <span className="size-10 rounded-xl bg-amber-500/15 grid place-items-center text-amber-400 shrink-0">
                    <StickyNote className="size-5" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium text-sm">Note to self</span>
                    <span className="block text-xs text-muted-foreground">
                      Save links, ideas, and attachments to your own thread.
                    </span>
                  </span>
                </button>

                <div className="relative my-2">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-card px-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                      or message someone
                    </span>
                  </div>
                </div>

                <label className="mb-2 block font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">
                  RELAY number
                </label>
                <div className="flex gap-2">
                  <Input
                    value={number}
                    // NOT digit-stripped any more (v2.99.93) — that is what made a
                    // name untypeable. Bounded at 64 so it stays a search box.
                    onChange={(e) => setNumber(e.target.value.slice(0, 64))}
                    placeholder="Number or name"
                    // `text`, not numeric: a numeric keypad cannot type a name, and
                    // the whole point is that either works.
                    inputMode="text"
                    autoComplete="off"
                    aria-label="Search your contacts by number or name"
                  />
                  <Button
                    // Enabled on SIX DIGITS only — the request takes a number, so a
                    // half-typed name must not be submittable. A name is opened by
                    // tapping its suggestion, which supplies the number.
                    onClick={() => openThread.mutate({ number: digitsOf(number) })}
                    disabled={digitsOf(number).length !== 6 || !isNumberQuery(number) || pending}
                  >
                    <Search className="size-4 mr-1.5" /> Open
                  </Button>
                </div>
                <SuggestList
                  contacts={contactsQ.data ?? []}
                  query={number}
                  busy={pending}
                  onPick={(n) => openThread.mutate({ number: n })}
                />
              </>
            ) : (
              <>
                <div className="mb-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setGroupAvatarOpen(true)}
                    aria-label={groupAvatar ? "Change the group photo" : "Choose a group photo"}
                    className="relative grid size-[52px] shrink-0 place-items-center overflow-hidden rounded-[14px] border border-border bg-muted/40 transition hover:border-primary/50"
                  >
                    {groupAvatar ? (
                      <img src={groupAvatar} alt="" className="size-full object-cover" />
                    ) : (
                      <Users className="size-6 text-[#a78bfa]" />
                    )}
                    <span className="absolute -bottom-0.5 -end-0.5 grid size-5 place-items-center rounded-full bg-background">
                      <Plus className="size-3.5 text-primary" />
                    </span>
                  </button>
                  <p className="text-xs text-muted-foreground">
                    {groupAvatar ? "Group photo set." : "Add a group photo (optional)."}
                  </p>
                </div>
                <label className="mb-2 block font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">
                  Group name
                </label>
                {/* Board 3d draws this field with an ACCENT focus ring (border .45 plus
                    a 3px .12 halo) — it is the one field on the sheet that MUST be
                    filled, so the frame gives it the emphasis. Applied on focus-within
                    rather than permanently: an always-lit field stops meaning "you are
                    typing here". Literal fallbacks, never a self-referencing
                    `var(--rb, var(--rb))`, which is a cycle the browser drops entirely
                    (the v2.106.7 trap). */}
                <div className="mb-4 rounded-[13px] transition-shadow focus-within:shadow-[0_0_0_3px_rgba(var(--rb-rgb,63,224,197),0.12)]">
                  <Input
                    value={groupTitle}
                    onChange={(e) => setGroupTitle(e.target.value.slice(0, 128))}
                    placeholder="e.g. Weekend Trip"
                    className="rounded-[13px]"
                  />
                </div>
                <label className="mb-2 block font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">
                  Add members by number
                </label>
                <div className="flex gap-2">
                  <Input
                    value={groupInput}
                    // Same as the DM field (v2.99.93): a name is typeable, and
                    // `addGroupNumber` derives the digits.
                    onChange={(e) => setGroupInput(e.target.value.slice(0, 64))}
                    onKeyDown={(e) => { if (e.key === "Enter") addGroupNumber(); }}
                    placeholder="Number or name"
                    inputMode="text"
                  />
                  <Button
                    variant="secondary"
                    // Six digits only, same rule as the DM field: a half-typed name
                    // is not a member.
                    onClick={() => addGroupNumber()}
                    disabled={digitsOf(groupInput).length !== 6 || !isNumberQuery(groupInput)}
                  >
                    <UserPlus className="size-4" />
                  </Button>
                </div>
                <SuggestList
                  contacts={contactsQ.data ?? []}
                  query={groupInput}
                  busy={false}
                  selectable
                  // Already-added members are withheld: a suggestion that does
                  // nothing when tapped reads as broken.
                  exclude={groupNumbers}
                  onPick={(n) => addGroupNumber(n)}
                />
                {groupNumbers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {groupNumbers.map((n) => (
                      /* Board 3d: a selected member is an ACCENT chip (fill .14, border
                         .4, 10.5px/700 in the accent) rather than a neutral grey pill —
                         these are choices the person has made, and the accent is what
                         "selected" means everywhere else in this app now. */
                      <span
                        key={n}
                        /* `.rchip-accent` rather than a hand-rolled copy of it: this
                           carried the class's OWN values (a .14 fill and a .40 border) and
                           differed only in missing its light-theme text colour — measured
                           1.47:1 against AA's 4.5, versus 5.17:1 with the class. A duplicate
                           of a recipe is how the copy misses the fix the original received. */
                        className="rchip-accent inline-flex items-center gap-1 rounded-[16px] px-2.5 py-[5px] font-mono text-[10.5px] font-bold"
                      >
                        {n.slice(0, 3)} {n.slice(3)}
                        <button
                          type="button"
                          aria-label={`Remove ${n}`}
                          onClick={() => setGroupNumbers((xs) => xs.filter((x) => x !== n))}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <Button
                  className="w-full mt-4"
                  onClick={() =>
                    createGroup.mutate({
                      title: groupTitle.trim(),
                      numbers: groupNumbers,
                      avatarUrl: groupAvatar,
                    })
                  }
                  disabled={pending || groupTitle.trim().length === 0 || groupNumbers.length === 0}
                >
                  <Users className="size-4 mr-1.5" />
                  {/* Board 3d: "Create group · 4 members". The COUNT INCLUDES YOU,
                      because you are in the group you are creating — a count reading 3
                      for a group of 4 would be wrong about the thing it names. */}
                  {createGroup.isPending
                    ? "Creating…"
                    : groupNumbers.length
                      ? `Create group · ${groupNumbers.length + 1} members`
                      : "Create group"}
                </Button>
              </>
            )}
            {errorMessage && (
              <p className="mt-3 text-sm text-destructive">{errorMessage}</p>
            )}
          </div>
        </div>
      )}
      {/* ONE picker component, an injected sink (v2.102.1). There is no conversation yet,
          so `onSave` only holds the url — the write happens with the create. A second
          picker would be a second copy of the upload pipeline, the emoji renderer, the
          animated-GIF path, the 4 MB cap and the mime check, which is the duplicate
          v2.99.89 found and removed. */}
      <AvatarPicker
        open={groupAvatarOpen}
        onClose={() => setGroupAvatarOpen(false)}
        displayName={groupTitle || "Group"}
        title="Choose a group photo"
        removeLabel="the group photo"
        onSave={async (url) => setGroupAvatar(url)}
      />
    </>
  );
}

/* ============================================================
   Contact suggestions for the New-conversation sheet (v2.99.93).

   Owner: start a conversation "by first digit or first letter". The ranking rules
   live in `contactSuggest.ts` and are unit-tested there — a source pin cannot tell
   you whether typing `7` actually surfaces 777777, and that is the whole feature.

   Renders NOTHING when there is nothing to offer, rather than an empty box or a
   "no matches" row: the field still works by number, so an absent list is not an
   error state and saying so would just be noise under every unmatched keystroke.
   ============================================================ */
function SuggestList({
  contacts,
  query,
  busy,
  exclude,
  selectable,
  onPick,
}: {
  contacts: Array<{ number: string; displayName?: string | null; blocked?: boolean | null; favorite?: boolean | null; isOnline?: boolean | null; avatarUrl?: string | null; idle?: boolean | null }>;
  query: string;
  busy: boolean;
  exclude?: string[];
  /**
   * Board 3d draws the group picker's rows with an accent CHECK CIRCLE on the right.
   *
   * OPT-IN RATHER THAN ON EVERY ROW, because this list is SHARED with the DM field,
   * where tapping a row OPENS a thread rather than selecting a member — a tick there
   * would promise a multi-select that does not exist. One list, two meanings, and the
   * caller says which.
   */
  selectable?: boolean;
  onPick: (number: string) => void;
}) {
  const skip = new Set(exclude ?? []);
  const hits = suggestContacts(contacts, query, 6).filter((c) => !skip.has(c.number));
  if (hits.length === 0) return null;
  return (
    <ul className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-border divide-y divide-border/60">
      {hits.map((c) => {
        const dot = presenceDot(c);
        return (
          <li key={c.number}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(c.number)}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-foreground/[0.04] active:bg-foreground/[0.07] disabled:opacity-50"
            >
              <span className="relative shrink-0">
                {c.avatarUrl ? (
                  <img src={c.avatarUrl} alt="" className="size-8 rounded-full object-cover" />
                ) : (
                  <span
                    className="grid size-8 place-items-center rounded-full text-[11px] font-bold"
                    /* A FILL, which is the accent's correct use (dark glyph on accent
                       measures 10:1) — but on the FIXED cyan the cycling accent replaced in
                       v2.106.7, so every other accent surface breathed and this one did not.
                       The fallback is a LITERAL, never `var(--rb, var(--rb))`: a
                       self-referencing custom property is a cycle, which resolves to the
                       guaranteed-invalid value and makes the browser DROP the declaration
                       entirely — a disc with no fill at all. */
                    style={{ background: "var(--rb, #3FE0C5)", color: "#04211a" }}
                  >
                    {(c.displayName || c.number).slice(0, 2).toUpperCase()}
                  </span>
                )}
                <span
                  aria-label={dot.label}
                  className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card"
                  style={{ background: dot.color, boxShadow: dot.glow || undefined }}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium" dir="auto">
                  {c.displayName || "Unnamed"}
                </span>
                {/* The number stays LTR + bidi-isolated so an Arabic name above
                    cannot reorder the digits (the v2.99.77 lesson). */}
                <span
                  dir="ltr"
                  className="block font-mono text-[11px] tabular-nums text-muted-foreground [unicode-bidi:isolate]"
                >
                  {c.number.slice(0, 3)}-{c.number.slice(3)}
                </span>
              </span>
              {selectable && (
                /* Empty until tapped — an already-added contact is WITHHELD from this
                   list entirely (a suggestion that does nothing when tapped reads as
                   broken), so a filled tick could never be reached here. It is the
                   affordance saying "tapping adds", not a state. */
                <span
                  aria-hidden
                  className="grid size-5 shrink-0 place-items-center rounded-full border"
                  style={{ borderColor: "rgba(var(--rb-rgb, 63, 224, 197), 0.45)" }}
                >
                  {/* 1.59:1 on the light card as the raw accent; 4.59:1 as `text-primary`,
                      which clears both AA text and the 3:1 non-text-contrast bar a glyph
                      this size is judged against. */}
                  <Plus className="size-3 text-primary" />
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
