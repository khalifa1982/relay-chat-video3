import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type CSSProperties, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Send,
  Smile,
  Paperclip,
  Mic,
  StopCircle,
  Image as ImageIcon,
  Phone,
  Video,
  Search,
  MessageSquare,
  MessageSquarePlus,
  X,
  StickyNote,
  Users,
  UserPlus,
  Trash2,
  Reply,
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
import { previewOf } from "@/app/messagePreview";
import { uploadAttachment, uploadThumbnail } from "@/lib/uploadAttachment";
import { StatusStrip } from "./Status";
import { PeerAvatar, openPeerProfile } from "@/app/PeerOverlays";
import { isDownscalableImage, processImageForUpload } from "@/lib/imageDownscale";
import { recorderSupported, startVoiceRecording, type VoiceRecording } from "@/lib/voiceNote";
import { videoRecorderSupported } from "@/lib/videoNote";
import { VideoRecordSheet } from "@/app/VideoRecordSheet";
import { linkify } from "@/lib/linkify";
import { useIdentity } from "@/app/useIdentity";
import { demotablePollInterval } from "@/app/useRealtime";
import { useThreadMuted, isThreadMuted, onMutedChange } from "@/app/mutedThreads";
import { useTypers, useTypingConversations } from "@/app/typingStore";
import { useDraft } from "@/app/draftStore";

const EMOJI_QUICK = [
  "😀","😂","😊","😍","😉","😎","🤔","🙏",
  "👍","👏","🔥","❤️","💯","🎉","🚀","✨",
  "😢","😭","😡","😴","🥳","🤝","💪","👀",
  "📞","📱","💬","📩","✅","❌","⏰","🎵",
];

/** Own (outgoing) message bubble — the brand "message" orange gradient with
 *  white copy. Received bubbles keep the neutral token surface (theme-safe). */
const OWN_BUBBLE_STYLE: CSSProperties = {
  background: "linear-gradient(135deg,#fb923c,#c2410c)",
  color: "#fff",
  borderColor: "rgba(255,255,255,.18)",
};

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

function formatTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

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

/** Local Y-M-D key so messages can be grouped under a date divider. */
function dayKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** WhatsApp-style date pill: "Today" / "Yesterday" / "June 28, 2026". */
function dayLabel(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const today = new Date();
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return "Today";
  if (dayKey(d) === dayKey(yest)) return "Yesterday";
  return d.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

export default function MessagesPage() {
  const { me } = useIdentity();
  const [location, setLocation] = useLocation();
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

  // Collapsible, PRESENTATIONAL grouping of the flat thread list into DIRECT /
  // GROUPS / NOTES sections. Derived purely from the existing threads query
  // (no new request, no data-flow change); collapse state is UI-only.
  const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>({});
  // Thread-list search (v2.95): filter conversations by peer name/number. Pure
  // client filter over the already-loaded list — instant, no new request.
  const [threadSearch, setThreadSearch] = useState("");
  const threadCategories = useMemo(() => {
    const q = threadSearch.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    const all = threads.data ?? [];
    const list = q
      ? all.filter(
          (t) =>
            (t.peerDisplayName || "").toLowerCase().includes(q) ||
            (qDigits.length > 0 && (t.peerNumber || "").includes(qDigits)),
        )
      : all;
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
      {
        key: "direct",
        label: "Direct",
        rgb: "251,146,60",
        hex: "#fb923c",
        icon: <MessageSquare className="size-3.5" />,
        rows: list.filter((t) => t.kind !== "group" && !isNotes(t)),
      },
      {
        key: "groups",
        label: "Groups",
        rgb: "167,139,250",
        hex: "#a78bfa",
        icon: <Users className="size-3.5" />,
        rows: list.filter((t) => t.kind === "group"),
      },
      {
        key: "notes",
        label: "Notes",
        rgb: "251,191,36",
        hex: "#fbbf24",
        icon: <StickyNote className="size-3.5" />,
        rows: list.filter(isNotes),
      },
    ];
    return cats.filter((c) => c.rows.length > 0);
    // threadSearch MUST be a dep (QA H3): the memo filters `list` by it, but it
    // was missing here — so typing in the search box re-rendered yet returned the
    // cached unfiltered list (threads.data is stable via structural sharing), and
    // search silently did nothing.
  }, [threads.data, me, threadSearch]);

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
          <h2 className="text-base font-extrabold tracking-tight">Messages</h2>
          <NewMessageDialog />
        </header>
        {(threads.data?.length ?? 0) > 0 && (
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
          {/* Rich user status (story-style) — rings for me + contacts, above the threads. */}
          <StatusStrip />
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
          ) : (threads.data?.length ?? 0) === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              <MessageSquarePlus className="size-8 mx-auto mb-2 opacity-50" />
              <p>No messages yet.</p>
              <p className="mt-1">Tap the + above to start a conversation.</p>
            </div>
          ) : threadCategories.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No conversations match “{threadSearch.trim()}”.
            </div>
          ) : (
            <div>
              {threadCategories.map((cat) => {
                const open = !collapsedCats[cat.key];
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
                        <span className="size-2 rounded-full" style={{ background: "#fb923c" }} />
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
                        // NNN-NNN — 1:1 only (a group has no number; notes-to-self is me).
                        const pin =
                          isDm && t.peerNumber && /^\d{6}$/.test(t.peerNumber)
                            ? `${t.peerNumber.slice(0, 3)}-${t.peerNumber.slice(3)}`
                            : null;
                        const preview = t.lastMessageAt
                          ? previewOf(t.lastMessageKind ?? "text", t.lastMessageBody)
                          : "No messages yet";
                        return (
                          <div
                            key={t.conversationId}
                            className={
                              "flex items-center gap-3.5 rounded-2xl mx-1.5 my-0.5 px-3 py-3.5 transition-colors " +
                              (isActive ? "bg-muted/45" : "hover:bg-muted/25 active:bg-muted/35")
                            }
                          >
                            {/* Avatar — its OWN button (status ring → status viewer /
                                profile), so it must stay OUTSIDE the open-thread
                                button: nested buttons are invalid HTML. The fixed
                                64px box keeps every row's text aligned whether or
                                not PeerAvatar adds its ~5px ring. */}
                            <div className="grid size-16 shrink-0 place-items-center">
                              {isGroup ? (
                                <div
                                  className="grid size-[60px] place-items-center rounded-full"
                                  style={{ background: "rgba(167,139,250,.16)", color: "#a78bfa" }}
                                  aria-label="Group conversation"
                                >
                                  <Users className="size-7" />
                                </div>
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
                                  <span
                                    aria-label={t.peerIsOnline ? "Online" : "Offline"}
                                    className={
                                      "absolute bottom-0 right-0 size-[15px] rounded-full border-2 border-card " +
                                      (t.peerIsOnline
                                        ? "bg-[color:var(--relay-online)]"
                                        : "bg-[color:var(--relay-offline)]")
                                    }
                                  />
                                </PeerAvatar>
                              )}
                            </div>

                            {/* One button holds BOTH text lines (judge graft): the
                                whole text column is the tap target, the text stays
                                selectable, and a screen reader reads the label once
                                instead of the label plus the same content again. */}
                            <button
                              type="button"
                              onClick={() => setLocation(`/app/messages?c=${t.conversationId}`)}
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
                                {t.lastMessageAt && (
                                  <span
                                    dir="ltr"
                                    className={
                                      "ms-auto shrink-0 pl-1 text-[11.5px] tabular-nums [unicode-bidi:isolate] " +
                                      (unread ? "font-semibold text-[#fb923c]" : "text-muted-foreground")
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
                                {typing ? (
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
                                  <span className="shrink-0 font-semibold text-[13px] text-[#fb923c]">
                                    {t.unreadCount > 99 ? "99+" : t.unreadCount} new
                                  </span>
                                )}
                              </div>
                            </button>
                          </div>
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
          "flex-1 min-w-0 flex-col min-h-0 md:rounded-2xl md:border md:border-border md:bg-card " +
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
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

function ConversationView({ conversationId }: { conversationId: number }) {
  const { me } = useIdentity();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const threadsQuery = trpc.messages.threads.useQuery(undefined, { enabled: !!me });
  const thread = useMemo(
    () => threadsQuery.data?.find((t) => t.conversationId === conversationId),
    [threadsQuery.data, conversationId]
  );

  const isGroup = thread?.kind === "group";
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

  const sendMutation = trpc.messages.send.useMutation({
    onSuccess: () => {
      utils.messages.list.invalidate({ conversationId });
      utils.messages.threads.invalidate();
    },
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
  const [lightbox, setLightbox] = useState<{ url: string; type: "image" | "video"; name?: string } | null>(null);
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
  function previewOf(msg: { body: string | null; kind: string; meta?: unknown } | undefined): string {
    if (!msg) return "Message";
    // Never quote a self-destructing message's content (v2.96).
    if ((msg.meta as { expire?: unknown } | null)?.expire != null) return "⏱ Disappearing message";
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
    } catch {
      setText(body);
      if (reply) setReplyingToState(reply);
      if (upload) setPendingUpload(upload);
      if (exp != null) setExpire(exp);
      toast.error("Message not sent — check your connection and tap send again.");
    }
  }

  function insertEmoji(e: string) {
    setText((s) => s + e);
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

  // Safety net: if the conversation unmounts while recording, cancel so the
  // getUserMedia mic doesn't stay live (LED on).
  useEffect(() => {
    return () => {
      recordingRef.current?.cancel();
      recordingRef.current = null;
    };
  }, []);

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
      void rec.done
        .then(async (result) => {
          if (!result) return; // cancelled / empty
          // uploadBlob() re-throws on failure (it only resets `uploading` in
          // its own finally) — catch here or `recording` sticks true forever.
          try {
            await uploadBlob(result.blob, `voice-note.${result.ext}`, result.durationMs);
          } catch {
            toast.error("Failed to save voice note");
          }
        })
        .finally(() => {
          recordingRef.current = null;
          setRecording(false);
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
      sendMutation.mutate({
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

  return (
    <>
      {/* conversation header — ONE compact bar (the app's top bar is hidden on
          mobile while a chat is open): back, avatar + presence LED, name +
          verified badge, and a live status line (typing… > online > last seen). */}
      <header className="flex items-center gap-2 px-2 md:px-4 py-2 border-b border-border/70 bg-card/90 supports-[backdrop-filter]:bg-card/70 supports-[backdrop-filter]:backdrop-blur-md md:rounded-t-2xl">
        <button
          type="button"
          aria-label="Back"
          className="md:hidden grid place-items-center size-8 shrink-0 hover:brightness-110"
          style={{ color: "#52e3d0" }}
          onClick={() => setLocation("/app/messages")}
        >
          <ChevronLeft className="size-6" />
        </button>
        <div className="relative shrink-0">
          {isGroup ? (
            <div
              className="size-9 rounded-full grid place-items-center"
              style={{ background: "rgba(167,139,250,.16)", color: "#a78bfa" }}
            >
              <Users className="size-4.5" />
            </div>
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
              <span
                aria-label={thread?.peerIsOnline ? "Online" : "Offline"}
                className={
                  "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card " +
                  (thread?.peerIsOnline
                    ? "bg-[color:var(--relay-online)]"
                    : "bg-[color:var(--relay-offline)]")
                }
              />
            </PeerAvatar>
          )}
        </div>
        <div
          className="flex-1 min-w-0 leading-tight"
          role={!isGroup && thread?.peerNumber ? "button" : undefined}
          tabIndex={!isGroup && thread?.peerNumber ? 0 : undefined}
          onClick={() => {
            // Tapping the NAME opens the peer's profile popup (v2.96 spec:
            // "click anywhere on the name … see their profile").
            if (!isGroup && thread?.peerNumber) openPeerProfile(thread.peerNumber);
          }}
          onKeyDown={(e) => {
            if (!isGroup && thread?.peerNumber && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              openPeerProfile(thread.peerNumber);
            }
          }}
        >
          <div className="font-semibold text-[15px] truncate flex items-center gap-1.5">
            <span className="truncate">{thread?.peerDisplayName || thread?.peerNumber || "Conversation"}</span>
            {thread && <RoleBadge role={roleFromFlags(thread.peerRole, thread.peerVerified)} size={15} />}
          </div>
          <div className="text-[11px] truncate flex items-center gap-1.5">
            {/* v2.99.10 (owner): show the peer's PIN next to the name area on
                every 1:1 thread — "where's the name, the PIN should show". */}
            {!isGroup && thread?.peerNumber && /^\d{6}$/.test(thread.peerNumber) && (
              <span className="font-mono text-muted-foreground" dir="ltr">
                {thread.peerNumber.slice(0, 3)}-{thread.peerNumber.slice(3)}
              </span>
            )}
            {!isGroup && thread?.peerNumber && <span className="text-muted-foreground/40">·</span>}
            {typers.length > 0 ? (
              <span className="text-[color:var(--relay-online)] font-medium animate-pulse">typing…</span>
            ) : isGroup ? (
              <span className="text-muted-foreground">{`${thread?.memberCount ?? infoQuery.data?.members.length ?? ""} members`}</span>
            ) : thread?.peerIsOnline ? (
              <span className="text-[color:var(--relay-online)] font-medium">online</span>
            ) : thread?.peerLastSeenAt ? (
              <span className="text-muted-foreground">last seen {timeAgo(thread.peerLastSeenAt)}</span>
            ) : (
              <span className="text-muted-foreground">offline</span>
            )}
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setMuted(!muted)}
          aria-label={muted ? "Unmute conversation" : "Mute conversation"}
          title={muted ? "Muted — tap to unmute" : "Mute notifications"}
          className={"size-8 shrink-0 " + (muted ? "text-muted-foreground" : "")}
        >
          {muted ? <BellOff className="size-5" /> : <Bell className="size-5" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          aria-label={searchOpen ? "Close search" : "Search this conversation"}
          title={searchOpen ? "Close search" : "Search messages"}
          className={"size-8 shrink-0 " + (searchOpen ? "text-primary" : "")}
        >
          {searchOpen ? <X className="size-5" /> : <Search className="size-5" />}
        </Button>
        {!isGroup && thread?.peerNumber && (
          <>
            <AccentCircle
              rgb="34,197,94"
              hex="#22c55e"
              title="Voice call"
              size={34}
              onClick={() => setLocation(`/app/dialer?to=${encodeURIComponent(thread.peerNumber)}&voice=1`)}
            >
              <Phone className="size-4" />
            </AccentCircle>
            <AccentCircle
              rgb="56,189,248"
              hex="#38bdf8"
              title="Video call"
              size={34}
              onClick={() => setLocation(`/app/dialer?to=${encodeURIComponent(thread.peerNumber)}&video=1`)}
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
                        style={mine ? OWN_BUBBLE_STYLE : undefined}
                        className={
                          "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm break-words shadow-sm border " +
                          (mine ? "" : "bg-muted/70 text-foreground border-white/10")
                        }
                      >
                        {isGroup && !mine && (
                          <div className="text-[11px] font-semibold text-primary mb-0.5">
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
                            mine={mine}
                            onOpen={setLightbox}
                          />
                        )}
                        {m.body && (
                          <div className="whitespace-pre-wrap leading-relaxed">{linkify(m.body)}</div>
                        )}
                        <div className={"text-[10px] mt-1 " + (mine ? "text-white/70" : "text-muted-foreground")}>
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
          messagesQuery.data?.map((m, i, arr) => {
            const mine = m.senderIdentityId === me.id;
            const prev = arr[i - 1];
            const next = arr[i + 1];
            // Insert a date pill whenever the calendar day changes.
            const showDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
            // WhatsApp-style grouping: tighten consecutive runs from the same
            // sender within ~5 min, and only the LAST bubble of a run gets the
            // tail + timestamp (the rest are "stacked").
            const GROUP_MS = 5 * 60_000;
            const sameAsPrev =
              !showDay && !!prev && prev.senderIdentityId === m.senderIdentityId &&
              new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS;
            const sameAsNext =
              !!next && next.senderIdentityId === m.senderIdentityId &&
              dayKey(next.createdAt) === dayKey(m.createdAt) &&
              new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() < GROUP_MS;
            const lastOfGroup = !sameAsNext;
            const tail = mine ? (lastOfGroup ? "rounded-br-sm" : "") : (lastOfGroup ? "rounded-bl-sm" : "");
            return (
              <div key={m.id}>
                {showDay && (
                  <div className="flex justify-center my-3">
                    <span className="px-3 py-1 rounded-full bg-muted/70 text-[11px] font-medium text-muted-foreground shadow-sm">
                      {dayLabel(m.createdAt)}
                    </span>
                  </div>
                )}
                <div
                  className={
                    "group flex items-end gap-1.5 " + (mine ? "justify-end" : "justify-start") +
                    (sameAsPrev ? " mt-0.5" : " mt-2")
                  }
                >
                {mine && (
                  <MessageMenu
                    mine
                    onReply={() => setReplyingTo(m)}
                    onCopy={m.body ? () => {
                      navigator.clipboard?.writeText(m.body!)
                        .then(() => toast.success("Copied"))
                        .catch(() => toast.error("Failed to copy"));
                    } : undefined}
                    onDelete={() => deleteMessage(m.id)}
                  />
                )}
                {(() => {
                  // Emoji-only messages render BIG without a bubble (iMessage-style).
                  const emojiOnly = !m.attachment && m.replyToId == null && isEmojiOnly(m.body);
                  if (emojiOnly) {
                    return (
                      <div className="max-w-[75%] px-1 py-0.5">
                        <div className="text-4xl leading-tight">{m.body}</div>
                        <div className={"text-[10px] mt-0.5 text-muted-foreground " + (mine ? "text-right" : "")}>
                          {formatTime(m.createdAt)}
                          {mine && m.status && <span className="ml-1">{m.status === "read" ? "✓✓" : "✓"}</span>}
                        </div>
                      </div>
                    );
                  }
                  return (
                <div
                  style={mine ? OWN_BUBBLE_STYLE : undefined}
                  className={
                    "max-w-[75%] rounded-2xl px-3 py-1.5 text-sm break-words shadow-sm border " +
                    // Own bubbles carry the brand "message" orange gradient (see
                    // OWN_BUBBLE_STYLE); received bubbles keep the neutral
                    // translucent token surface (iMessage-style gray) instead of
                    // the old hard-coded loud blue.
                    (mine ? "" : "bg-muted/70 text-foreground border-white/10 ") + tail
                  }
                >
                  {isGroup && !mine && !sameAsPrev && (
                    <div className="text-[11px] font-semibold text-primary mb-0.5">
                      {nameById.get(m.senderIdentityId) || "Member"}
                    </div>
                  )}
                  {m.replyToId != null && (
                    <div
                      className={
                        "mb-1 rounded-lg border-l-2 pl-2 py-0.5 text-[11px] leading-tight " +
                        (mine
                          ? "border-white/50 bg-white/15 text-white/90"
                          : "border-foreground/30 bg-foreground/10 text-foreground/80")
                      }
                    >
                      <span className="font-semibold">{senderLabel(msgById.get(m.replyToId)?.senderIdentityId ?? -1)}</span>
                      <span className="opacity-80"> · {previewOf(msgById.get(m.replyToId))}</span>
                    </div>
                  )}
                  {/* Voicemail label (v2.88): an audio message recorded after a
                      failed call carries meta.voicemail — say so, phone-style. */}
                  {(m.meta as { voicemail?: boolean } | null)?.voicemail && (
                    <div
                      className={
                        "mb-0.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide " +
                        (mine ? "text-white/80" : "text-primary")
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
                          (mine ? "text-white/75" : "text-[#a78bfa]")
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
                            mine={mine}
                            onOpen={setLightbox}
                          />
                        )}
                        {body && <div className="whitespace-pre-wrap leading-relaxed">{linkify(body)}</div>}
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
                            (mine ? "text-white/75" : "text-muted-foreground")
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
                  {/* WhatsApp-style meta: tiny time + ticks, tucked bottom-right. */}
                  <div
                    className={
                      "flex justify-end items-center gap-1 text-[10px] leading-none mt-0.5 -mb-0.5 " +
                      (mine ? "text-white/70" : "text-muted-foreground")
                    }
                  >
                    {formatTime(m.createdAt)}
                    {mine && m.status && (
                      <span>
                        {/* sent (✓) vs read (✓✓) — kept distinct on purpose. */}
                        {m.status === "read" ? "✓✓" : "✓"}
                      </span>
                    )}
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
                  />
                  );
                })()}
                </div>
              </div>
            );
          })
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

      {/* typing indicator */}
      {typers.length > 0 && (
        <div className="px-4 md:px-5 pb-1 -mt-1 text-xs text-muted-foreground flex items-center gap-1.5">
          <span className="inline-flex gap-0.5" aria-hidden="true">
            <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "300ms" }} />
          </span>
          {typers.length === 1
            ? `${senderLabel(typers[0])} is typing…`
            : typers.length === 2
              ? `${senderLabel(typers[0])} and ${senderLabel(typers[1])} are typing…`
              : "Several people are typing…"}
        </div>
      )}

      {/* composer */}
      <div className="px-3 md:px-5 py-3 border-t border-border bg-card md:rounded-b-2xl">
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
        {emojiOpen && (
          <div className="mb-2 grid grid-cols-8 gap-1 p-2 rounded-xl bg-muted">
            {EMOJI_QUICK.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => insertEmoji(e)}
                className="aspect-square rounded-lg text-2xl hover:bg-card transition-colors"
              >
                {e}
              </button>
            ))}
          </div>
        )}
        {attachMenuOpen && (
          <div className="mb-2 grid grid-cols-2 gap-2">
            {/* In-app recorder: works even DURING a call — iOS blocks the
                system camera's video recording there, ours records in-page. */}
            <button
              type="button"
              onClick={() => { setAttachMenuOpen(false); setVideoRecOpen(true); }}
              className="flex items-center justify-center gap-2 rounded-xl bg-[#38bdf8]/12 px-3 py-3 text-sm font-semibold text-[#38bdf8] active:scale-95 transition-transform"
            >
              <Video className="size-4" /> Record video
            </button>
            <button
              type="button"
              onClick={() => { setAttachMenuOpen(false); imageRef.current?.click(); }}
              className="flex items-center justify-center gap-2 rounded-xl bg-muted/60 px-3 py-3 text-sm font-semibold text-foreground active:scale-95 transition-transform"
            >
              <ImageIcon className="size-4" /> Photo & video library
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              // With an in-app recorder available, offer Record vs Library;
              // otherwise keep the direct library picker.
              if (videoRecorderSupported()) setAttachMenuOpen((v) => !v);
              else imageRef.current?.click();
            }}
            aria-label="Photo or video"
            className={attachMenuOpen ? "bg-muted/60" : ""}
          >
            <ImageIcon className="size-5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => fileRef.current?.click()}
            aria-label="Attach"
          >
            <Paperclip className="size-5" />
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
          <Input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value.trim()) notifyTyping();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            onPaste={handlePaste}
            placeholder={uploading ? "Uploading…" : "Type a message"}
            disabled={uploading || recording}
            className="flex-1 h-11 rounded-full px-4"
          />
          {text.trim() || pendingUpload ? (
            <Button
              type="button"
              onClick={send}
              disabled={sendMutation.isPending || uploading}
              size="icon"
              className="h-11 w-11 rounded-full border-0"
              style={{ background: "linear-gradient(135deg,#fb923c,#c2410c)", color: "#fff" }}
              aria-label="Send"
            >
              <Send className="size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              variant={recording ? "destructive" : "default"}
              size="icon"
              className="h-11 w-11 rounded-full border-0"
              style={recording ? undefined : { background: "linear-gradient(135deg,#3FE0C5,#6EE7FF)", color: "#08211d" }}
              aria-label={recording ? "Stop" : "Record"}
              disabled={!recorderSupported()}
              title={
                recorderSupported()
                  ? recording
                    ? "Stop recording"
                    : "Record a voice note"
                  : "Voice notes need a newer browser \u2014 use the paperclip to attach an audio file instead"
              }
            >
              {recording ? <StopCircle className="size-5" /> : <Mic className="size-5" />}
            </Button>
          )}
        </div>
      </div>

      {lightbox && <MediaLightbox media={lightbox} onClose={() => setLightbox(null)} />}
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

/** Three-dot context menu for a message (Reply / Copy / Delete). Always tappable
 *  on mobile (the old hover-only buttons were invisible on touch). */
function MessageMenu({
  mine,
  onReply,
  onCopy,
  onDelete,
}: {
  mine?: boolean;
  onReply: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0 mb-1">
      <button
        type="button"
        aria-label="Message options"
        onClick={() => setOpen((v) => !v)}
        className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted/60 hover:text-foreground opacity-35 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 active:opacity-100 transition-opacity"
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
            {onCopy && (
              <button
                type="button"
                onClick={() => { onCopy(); setOpen(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <Copy className="size-4" /> Copy
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
  mine = false,
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
  /** Own-bubble styling (white-on-orange) vs received (theme tokens). */
  mine?: boolean;
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
    return <VoiceNotePlayer url={url} mine={mine} />;
  }
  return <FileCard url={url} filename={filename} mine={mine} />;
}

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
function VoiceNotePlayer({ url, mine }: { url: string; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [dur, setDur] = useState(0);
  const [cur, setCur] = useState(0);

  // Stop playback when the bubble unmounts (thread switch / unsend).
  useEffect(() => () => audioRef.current?.pause(), []);

  const ensure = (): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current;
    const a = new Audio(url);
    a.preload = "metadata";
    a.addEventListener("loadedmetadata", () => {
      if (a.duration === Infinity) {
        // MediaRecorder blobs report Infinity until seeked past the end —
        // the standard workaround: jump far ahead, read the real duration.
        const fix = () => {
          a.removeEventListener("timeupdate", fix);
          setDur(a.duration);
          a.currentTime = 0;
        };
        a.addEventListener("timeupdate", fix);
        a.currentTime = Number.MAX_SAFE_INTEGER;
      } else {
        setDur(a.duration || 0);
      }
    });
    a.addEventListener("timeupdate", () => setCur(a.currentTime || 0));
    a.addEventListener("ended", () => setCur(0));
    a.addEventListener("pause", () => setPlaying(false));
    a.addEventListener("play", () => setPlaying(true));
    audioRef.current = a;
    return a;
  };

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
  const sub = mine ? "text-white/70" : "text-muted-foreground";
  const track = mine ? "bg-white/25" : "bg-foreground/15";
  const fill = mine ? "bg-white" : "bg-[color:var(--relay-online,#06d6a0)]";

  return (
    <div className={"my-1 flex w-60 max-w-full items-center gap-2.5 " + (mine ? "text-white" : "text-foreground")}>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play voice note"}
        className={
          "grid size-9 shrink-0 place-items-center rounded-full active:scale-95 transition-transform " +
          (mine
            ? "bg-white/20 text-white"
            : "bg-[color:var(--relay-online,#06d6a0)]/15 text-[color:var(--relay-online,#06d6a0)]")
        }
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-[1px]" />}
      </button>
      <div className="min-w-0 flex-1">
        <div
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(dur) || 0}
          aria-valuenow={Math.round(cur)}
          onClick={seek}
          className={"relative h-1.5 cursor-pointer rounded-full " + track}
        >
          <div className={"absolute inset-y-0 left-0 rounded-full " + fill} style={{ width: `${frac * 100}%` }} />
          <div
            className={"absolute top-1/2 size-3 -translate-y-1/2 rounded-full shadow " + fill}
            style={{ left: `calc(${frac * 100}% - 6px)` }}
          />
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
          (mine ? "bg-white/15" : "bg-foreground/10")
        }
      >
        <Download className="size-3.5" />
      </a>
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
        (mine ? "bg-white/15 text-white" : "bg-foreground/10 text-foreground")
      }
    >
      <span
        className={
          "grid size-9 shrink-0 place-items-center rounded-lg " +
          (mine ? "bg-white/20 text-white" : "bg-primary/15 text-primary")
        }
      >
        <Paperclip className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{filename || "Attachment"}</span>
        <span className={"block text-[10.5px] " + (mine ? "text-white/70" : "text-muted-foreground")}>
          Tap to open or download
        </span>
      </span>
      <Download className="size-4 shrink-0 opacity-70" />
    </a>
  );
}

/** Fullscreen media preview with a close (X). Closes on backdrop click + Escape. */
function MediaLightbox({
  media,
  onClose,
}: {
  media: { url: string; type: "image" | "video"; name?: string };
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
      <div className="max-h-[90vh] max-w-[92vw]" onClick={(e) => e.stopPropagation()}>
        {media.type === "image" ? (
          <img src={media.url} alt={media.name || "image"} className="max-h-[90vh] max-w-[92vw] rounded-lg object-contain" />
        ) : (
          <video src={media.url} controls autoPlay className="max-h-[90vh] max-w-[92vw] rounded-lg" />
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

function NewMessageDialog() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"dm" | "group">("dm");
  const [number, setNumber] = useState("");
  // group-builder state
  const [groupTitle, setGroupTitle] = useState("");
  const [groupNumbers, setGroupNumbers] = useState<string[]>([]);
  const [groupInput, setGroupInput] = useState("");

  function resetAll() {
    setOpen(false);
    setMode("dm");
    setNumber("");
    setGroupTitle("");
    setGroupNumbers([]);
    setGroupInput("");
  }

  const openThread = trpc.messages.openThread.useMutation({
    onSuccess: (res) => {
      setOpen(false);
      setNumber("");
      setLocation(`/app/messages?c=${res.conversationId}`);
    },
  });
  const createGroup = trpc.messages.createGroup.useMutation({
    onSuccess: (res) => {
      utils.messages.threads.invalidate();
      resetAll();
      setLocation(`/app/messages?c=${res.conversationId}`);
    },
  });
  function addGroupNumber() {
    const n = groupInput.replace(/\D/g, "").slice(0, 6);
    if (n.length === 6 && !groupNumbers.includes(n)) {
      setGroupNumbers((xs) => [...xs, n]);
    }
    setGroupInput("");
  }
  const openSelfThread = trpc.messages.openSelfThread.useMutation({
    onSuccess: (res) => {
      setOpen(false);
      setNumber("");
      setLocation(`/app/messages?c=${res.conversationId}`);
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
        className="grid place-items-center w-[34px] h-[34px] rounded-[10px] shrink-0 hover:brightness-110"
        style={{
          background: "linear-gradient(160deg,rgba(251,146,60,.3),rgba(251,146,60,.1))",
          color: "#fb923c",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,.15)",
        }}
      >
        <MessageSquarePlus className="size-[18px]" />
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={resetAll}>
          <div
            className="w-full max-w-sm rounded-2xl bg-card border border-border p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">{mode === "group" ? "New group" : "New conversation"}</h3>
              <Button size="icon" variant="ghost" onClick={resetAll}>
                <X className="size-4" />
              </Button>
            </div>

            {/* Direct / Group toggle */}
            <div role="group" aria-label="Conversation type" className="grid grid-cols-2 gap-1 rounded-xl bg-muted/50 p-1 mb-4">
              <button
                type="button"
                aria-pressed={mode === "dm"}
                onClick={() => setMode("dm")}
                className={
                  "flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-colors " +
                  (mode === "dm" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
                }
              >
                <MessageSquarePlus className="size-3.5" /> Direct
              </button>
              <button
                type="button"
                aria-pressed={mode === "group"}
                onClick={() => setMode("group")}
                className={
                  "flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-colors " +
                  (mode === "group" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
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

                <label className="text-xs uppercase tracking-widest text-muted-foreground mb-2 block">
                  RELAY number
                </label>
                <div className="flex gap-2">
                  <Input
                    value={number}
                    onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="6-digit number"
                    inputMode="numeric"
                    className="font-mono"
                  />
                  <Button
                    onClick={() => openThread.mutate({ number })}
                    disabled={number.length !== 6 || pending}
                  >
                    <Search className="size-4 mr-1.5" /> Open
                  </Button>
                </div>
              </>
            ) : (
              <>
                <label className="text-xs uppercase tracking-widest text-muted-foreground mb-2 block">
                  Group name
                </label>
                <Input
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value.slice(0, 128))}
                  placeholder="e.g. Weekend Trip"
                  className="mb-4"
                />
                <label className="text-xs uppercase tracking-widest text-muted-foreground mb-2 block">
                  Add members by number
                </label>
                <div className="flex gap-2">
                  <Input
                    value={groupInput}
                    onChange={(e) => setGroupInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    onKeyDown={(e) => { if (e.key === "Enter") addGroupNumber(); }}
                    placeholder="6-digit number"
                    inputMode="numeric"
                    className="font-mono"
                  />
                  <Button variant="secondary" onClick={addGroupNumber} disabled={groupInput.length !== 6}>
                    <UserPlus className="size-4" />
                  </Button>
                </div>
                {groupNumbers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {groupNumbers.map((n) => (
                      <span key={n} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-mono">
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
                  onClick={() => createGroup.mutate({ title: groupTitle.trim(), numbers: groupNumbers })}
                  disabled={pending || groupTitle.trim().length === 0 || groupNumbers.length === 0}
                >
                  <Users className="size-4 mr-1.5" />
                  {createGroup.isPending ? "Creating…" : `Create group${groupNumbers.length ? ` (${groupNumbers.length + 1})` : ""}`}
                </Button>
              </>
            )}
            {errorMessage && (
              <p className="mt-3 text-sm text-destructive">{errorMessage}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
