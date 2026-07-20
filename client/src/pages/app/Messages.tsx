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
import { VerifiedBadge } from "@/app/VerifiedBadge";
import { previewOf } from "@/app/messagePreview";
import { uploadAttachment, uploadThumbnail } from "@/lib/uploadAttachment";
import { isDownscalableImage, processImageForUpload } from "@/lib/imageDownscale";
import { recorderSupported, startVoiceRecording, type VoiceRecording } from "@/lib/voiceNote";
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
  const threadCategories = useMemo(() => {
    const list = threads.data ?? [];
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
  }, [threads.data, me]);

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
        <div className="flex-1 overflow-y-auto">
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
                        const isActive = activeConvoId === t.conversationId;
                        const isDm = t.kind !== "group" && !(me && t.peerIdentityId === me.id);
                        return (
                          <div
                            key={t.conversationId}
                            className={
                              "flex items-center gap-2.5 px-4 md:px-5 py-2 border-b border-border last:border-b-0 transition-colors " +
                              (isActive ? "bg-muted/40" : "hover:bg-muted/30")
                            }
                          >
                            <button
                              type="button"
                              onClick={() => setLocation(`/app/messages?c=${t.conversationId}`)}
                              className="flex-1 min-w-0 flex items-center gap-3 text-left"
                            >
                              <div className="relative shrink-0">
                                {t.kind === "group" ? (
                                  <div
                                    className="size-[42px] rounded-full grid place-items-center"
                                    style={{ background: "rgba(167,139,250,.16)", color: "#a78bfa" }}
                                    aria-label="Group conversation"
                                  >
                                    <Users className="size-5" />
                                  </div>
                                ) : me && t.peerIdentityId === me.id ? (
                                  <div
                                    className="size-[42px] rounded-full grid place-items-center"
                                    style={{ background: "rgba(251,191,36,.16)", color: "#fbbf24" }}
                                    aria-label="Notes to yourself"
                                  >
                                    <StickyNote className="size-5" />
                                  </div>
                                ) : (
                                  <>
                                    <div className="size-[42px] rounded-full bg-primary/15 grid place-items-center text-primary font-bold text-sm">
                                      {initialsFrom(t.peerDisplayName || t.peerNumber)}
                                    </div>
                                    {/* Presence LED: green = online, grey = offline
                                        (red used to read as "busy/error" — v2.88). */}
                                    <span
                                      aria-label={t.peerIsOnline ? "Online" : "Offline"}
                                      className={
                                        "absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card " +
                                        (t.peerIsOnline
                                          ? "bg-[color:var(--relay-online)]"
                                          : "bg-[color:var(--relay-offline)]")
                                      }
                                    />
                                  </>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="font-semibold text-[14.5px] truncate flex items-center gap-1.5">
                                    {isThreadMuted(t.conversationId) && (
                                      <BellOff className="size-3.5 shrink-0 text-muted-foreground" />
                                    )}
                                    <span className="truncate">{t.peerDisplayName || t.peerNumber}</span>
                                    {t.peerVerified && <VerifiedBadge size={14} />}
                                  </div>
                                  {t.lastMessageAt && (
                                    <div className="text-[10.5px] font-mono text-muted-foreground shrink-0">
                                      {timeAgo(t.lastMessageAt)}
                                    </div>
                                  )}
                                </div>
                                <div className="mt-0.5">
                                  {typingConvos.includes(t.conversationId) ? (
                                    <div className="text-xs font-medium text-[color:var(--relay-online)] truncate animate-pulse">
                                      typing…
                                    </div>
                                  ) : (
                                    <div className="text-[12.5px] text-muted-foreground truncate">
                                      {t.lastMessageAt ? previewOf(t.lastMessageKind ?? "text", t.lastMessageBody) : "No messages yet"}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </button>
                            {/* Quick actions: message (orange) + DM voice (green) / video (blue). */}
                            <div className="flex items-center gap-1 shrink-0">
                              {t.unreadCount > 0 && (
                                <span
                                  className="inline-flex min-w-[18px] h-[18px] px-1.5 rounded-full text-white text-[10px] items-center justify-center font-extrabold"
                                  style={{ background: "linear-gradient(135deg,#fb923c,#c2410c)" }}
                                >
                                  {t.unreadCount > 99 ? "99+" : t.unreadCount}
                                </span>
                              )}
                              <AccentCircle
                                rgb="251,146,60"
                                hex="#fb923c"
                                title="Message"
                                onClick={() => setLocation(`/app/messages?c=${t.conversationId}`)}
                              >
                                <MessageSquare className="size-3.5" />
                              </AccentCircle>
                              {isDm && (
                                <>
                                  <AccentCircle
                                    rgb="34,197,94"
                                    hex="#22c55e"
                                    title="Voice call"
                                    onClick={() => setLocation(`/app/dialer?to=${encodeURIComponent(t.peerNumber)}&voice=1`)}
                                  >
                                    <Phone className="size-3.5" />
                                  </AccentCircle>
                                  <AccentCircle
                                    rgb="56,189,248"
                                    hex="#38bdf8"
                                    title="Video call"
                                    onClick={() => setLocation(`/app/dialer?to=${encodeURIComponent(t.peerNumber)}&video=1`)}
                                  >
                                    <Video className="size-3.5" />
                                  </AccentCircle>
                                </>
                              )}
                            </div>
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
  } | null>(null);
  function setReplyingTo(m: { id: number; senderIdentityId: number; body: string | null; kind: string } | null) {
    setReplyingToState(m);
    updateDraft({ replyToId: m?.id ?? null });
  }
  // Quick lookup of a message by id (to render the quoted reply preview).
  const msgById = useMemo(() => {
    const m = new Map<number, { senderIdentityId: number; body: string | null; kind: string }>();
    for (const x of messagesQuery.data ?? []) m.set(x.id, x);
    return m;
  }, [messagesQuery.data]);
  // A saved draft's reply target is just an id — reconstruct the rich preview
  // object once its message is available (it's near-always already loaded,
  // since a draft reply was set on a recently-visible message).
  useEffect(() => {
    if (draft.replyToId == null || replyingTo) return;
    const m = msgById.get(draft.replyToId);
    if (m) setReplyingToState({ id: draft.replyToId, senderIdentityId: m.senderIdentityId, body: m.body, kind: m.kind });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.replyToId, msgById]);
  function senderLabel(identityId: number): string {
    if (me && identityId === me.id) return "You";
    return nameById.get(identityId) || thread?.peerDisplayName || "Them";
  }
  function previewOf(msg: { body: string | null; kind: string } | undefined): string {
    if (!msg) return "Message";
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
    const onScroll = () => {
      const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollButton(fromBottom > 150);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
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
    // Clear the composer immediately (snappy), but if the send FAILS restore the
    // text/reply/attachment so the message is never silently lost — the user can
    // just tap send again. (Prevents the "I typed a message and it vanished" bug.)
    clearDraft();
    setReplyingToState(null);
    setPendingUpload(null);
    setEmojiOpen(false);
    try {
      await sendMutation.mutateAsync({
        conversationId,
        kind,
        body: body || null,
        attachmentId: upload?.id ?? null,
        replyToId: reply?.id ?? null,
      });
    } catch {
      setText(body);
      if (reply) setReplyingToState(reply);
      if (upload) setPendingUpload(upload);
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
      sendMutation.mutate({
        conversationId,
        kind: "audio",
        body: null,
        attachmentId: json.id,
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
            <>
              <div className="size-9 rounded-full bg-primary/15 grid place-items-center text-primary font-bold text-[13px]">
                {initialsFrom(thread?.peerDisplayName || thread?.peerNumber || "??")}
              </div>
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
            </>
          )}
        </div>
        <div className="flex-1 min-w-0 leading-tight">
          <div className="font-semibold text-[15px] truncate flex items-center gap-1.5">
            <span className="truncate">{thread?.peerDisplayName || thread?.peerNumber || "Conversation"}</span>
            {thread?.peerVerified && <VerifiedBadge size={15} />}
          </div>
          <div className="text-[11px] truncate">
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
                  {m.attachment && (
                    <AttachmentView
                      mimeType={m.attachment.mimeType}
                      url={m.attachment.url}
                      filename={m.attachment.filename ?? undefined}
                      thumbUrl={m.attachment.thumbUrl ?? null}
                      width={m.attachment.width ?? null}
                      height={m.attachment.height ?? null}
                      onOpen={setLightbox}
                    />
                  )}
                  {m.body && (
                    <div className="whitespace-pre-wrap leading-relaxed">{linkify(m.body)}</div>
                  )}
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
                {!mine && (
                  <MessageMenu
                    onReply={() => setReplyingTo(m)}
                    onCopy={m.body ? () => {
                      navigator.clipboard?.writeText(m.body!)
                        .then(() => toast.success("Copied"))
                        .catch(() => toast.error("Failed to copy"));
                    } : undefined}
                  />
                )}
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
            onClick={() => imageRef.current?.click()}
            aria-label="Image"
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
              "absolute z-50 bottom-8 min-w-36 rounded-xl border border-border bg-card p-1 shadow-xl " +
              (mine ? "right-0" : "left-0")
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
  onOpen?: (m: { url: string; type: "image" | "video"; name?: string }) => void;
}) {
  if (mimeType.startsWith("image/")) {
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
          className="rounded-xl max-h-64 w-auto max-w-full object-cover hover:opacity-90 transition-opacity"
          loading="lazy"
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
        <video src={url} className="rounded-xl max-h-64 w-auto" muted preload="metadata" />
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid size-12 place-items-center rounded-full bg-black/55 text-white">
            <Play className="size-6 translate-x-0.5" />
          </span>
        </span>
      </button>
    );
  }
  if (mimeType.startsWith("audio/")) {
    return <audio src={url} controls className="my-1 w-full max-w-xs" />;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 underline underline-offset-2 mb-1"
    >
      <Paperclip className="size-4" /> {filename || "attachment"}
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
