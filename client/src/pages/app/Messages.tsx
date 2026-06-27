import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useLocation, useSearch } from "wouter";
import {
  ArrowLeft,
  Send,
  Smile,
  Paperclip,
  Mic,
  StopCircle,
  Image as ImageIcon,
  Phone,
  Search,
  MessageSquarePlus,
  X,
  StickyNote,
  Users,
  UserPlus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { uploadAttachment } from "@/lib/uploadAttachment";
import { linkify } from "@/lib/linkify";
import { useIdentity } from "@/app/useIdentity";

const EMOJI_QUICK = [
  "😀","😂","😊","😍","😉","😎","🤔","🙏",
  "👍","👏","🔥","❤️","💯","🎉","🚀","✨",
  "😢","😭","😡","😴","🥳","🤝","💪","👀",
  "📞","📱","💬","📩","✅","❌","⏰","🎵",
];

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

export default function MessagesPage() {
  const { me } = useIdentity();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const activeConvoIdRaw = params.get("c");
  const activeConvoId = activeConvoIdRaw ? parseInt(activeConvoIdRaw, 10) : null;

  const threads = trpc.messages.threads.useQuery(undefined, {
    refetchInterval: 4_000,
    refetchIntervalInBackground: false,
    enabled: !!me,
  });

  return (
    <div className="h-full flex md:p-6 gap-0 md:gap-6 min-h-0">
      {/* ── thread list (always visible on desktop; hidden when a thread is open on mobile) ── */}
      <aside
        className={
          "md:w-[340px] md:shrink-0 md:border md:border-border md:rounded-2xl md:bg-card flex-col min-h-0 " +
          (activeConvoId == null ? "flex flex-1 md:flex-initial" : "hidden md:flex")
        }
      >
        <header className="flex items-center justify-between px-4 md:px-5 py-4 border-b border-border">
          <h2 className="font-semibold">Messages</h2>
          <NewMessageDialog />
        </header>
        <div className="flex-1 overflow-y-auto">
          {threads.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : (threads.data?.length ?? 0) === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              <MessageSquarePlus className="size-8 mx-auto mb-2 opacity-50" />
              <p>No messages yet.</p>
              <p className="mt-1">Tap the + above to start a conversation.</p>
            </div>
          ) : (
            <ul>
              {threads.data?.map((t) => {
                const isActive = activeConvoId === t.conversationId;
                return (
                  <li key={t.conversationId}>
                    <button
                      type="button"
                      onClick={() => setLocation(`/app/messages?c=${t.conversationId}`)}
                      className={
                        "w-full text-left flex items-start gap-3 px-4 md:px-5 py-3 border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors " +
                        (isActive ? "bg-muted/40" : "")
                      }
                    >
                      <div className="relative">
                        {t.kind === "group" ? (
                          <div
                            className="size-11 rounded-2xl bg-accent/15 grid place-items-center text-accent"
                            aria-label="Group conversation"
                          >
                            <Users className="size-5" />
                          </div>
                        ) : me && t.peerIdentityId === me.id ? (
                          <div
                            className="size-11 rounded-2xl bg-amber-500/15 grid place-items-center text-amber-400"
                            aria-label="Notes to yourself"
                          >
                            <StickyNote className="size-5" />
                          </div>
                        ) : (
                          <>
                            <div className="size-11 rounded-2xl bg-primary/15 grid place-items-center text-primary font-bold text-sm">
                              {initialsFrom(t.peerDisplayName || t.peerNumber)}
                            </div>
                            {t.peerIsOnline && (
                              <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-[color:var(--relay-online)] border-2 border-card" />
                            )}
                          </>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium truncate">
                            {t.peerDisplayName || t.peerNumber}
                          </div>
                          {t.lastMessageAt && (
                            <div className="text-xs text-muted-foreground shrink-0">
                              {timeAgo(t.lastMessageAt)}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <div className="text-xs text-muted-foreground truncate">
                            {t.lastMessageBody || "—"}
                          </div>
                          {t.unreadCount > 0 && (
                            <span className="inline-flex min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs items-center justify-center font-bold shrink-0">
                              {t.unreadCount > 99 ? "99+" : t.unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
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
      refetchInterval: 2_000,
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
    markReadMutation.mutate({ conversationId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, messagesQuery.data?.length]);

  const sendMutation = trpc.messages.send.useMutation({
    onSuccess: () => {
      utils.messages.list.invalidate({ conversationId });
      utils.messages.threads.invalidate();
    },
  });
  const removeMutation = trpc.messages.remove.useMutation({
    onSuccess: () => {
      utils.messages.list.invalidate({ conversationId });
      utils.messages.threads.invalidate();
    },
  });
  function deleteMessage(messageId: number) {
    if (!window.confirm("Unsend this message? It will be removed for everyone.")) return;
    removeMutation.mutate({ messageId });
  }

  // ── composer state ──
  const [text, setText] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [pendingUpload, setPendingUpload] = useState<{ id: number; url: string; mimeType: string; filename?: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  // scroll-to-bottom on new message
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messagesQuery.data?.length, conversationId]);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so re-picking the same file fires onChange
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) {
      alert("File exceeds 40 MB limit");
      return;
    }
    setUploading(true);
    try {
      const json = await uploadAttachment(file, {
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
      });
      setPendingUpload({ id: json.id, url: json.url, mimeType: json.mimeType, filename: json.filename ?? file.name });
    } catch (err) {
      alert("Upload failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUploading(false);
    }
  }

  function send() {
    const body = text.trim();
    if (!body && !pendingUpload) return;
    const kind = pendingUpload
      ? pendingUpload.mimeType.startsWith("image/")
        ? "image"
        : pendingUpload.mimeType.startsWith("video/")
          ? "video"
          : pendingUpload.mimeType.startsWith("audio/")
            ? "audio"
            : "file"
      : "text";
    sendMutation.mutate({
      conversationId,
      kind,
      body: body || null,
      attachmentId: pendingUpload?.id ?? null,
    });
    setText("");
    setPendingUpload(null);
    setEmojiOpen(false);
  }

  function insertEmoji(e: string) {
    setText((s) => s + e);
  }

  // ── voice-note recording ──
  // Safari (especially mobile) does not support "audio/webm". We probe the
  // browser's supported MIME types and pick the first one that works.
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  // Held so an unmount mid-recording can release the mic (onstop wouldn't run).
  const recordStreamRef = useRef<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);

  // Safety net: if the conversation unmounts while recording, stop the recorder
  // and stop every track so the getUserMedia mic doesn't stay live (LED on).
  useEffect(() => {
    return () => {
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        /* ignore */
      }
      recordStreamRef.current?.getTracks().forEach((t) => t.stop());
      recordStreamRef.current = null;
    };
  }, []);

  // Capability: MediaRecorder may be missing entirely on older iOS Safari.
  const recorderSupported =
    typeof window !== "undefined" &&
    typeof window.MediaRecorder === "function";

  function pickAudioMime(): { mimeType: string; ext: string } | null {
    if (typeof window === "undefined" || !window.MediaRecorder) return null;
    const candidates: Array<{ mimeType: string; ext: string }> = [
      { mimeType: "audio/webm;codecs=opus", ext: "webm" },
      { mimeType: "audio/webm", ext: "webm" },
      { mimeType: "audio/mp4", ext: "m4a" }, // Safari
      { mimeType: "audio/aac", ext: "m4a" }, // some Safari builds
      { mimeType: "audio/ogg;codecs=opus", ext: "ogg" },
    ];
    for (const c of candidates) {
      try {
        if (window.MediaRecorder.isTypeSupported(c.mimeType)) return c;
      } catch {
        /* ignore */
      }
    }
    // last-ditch: let the browser pick its default by passing no mimeType
    return { mimeType: "", ext: "bin" };
  }

  async function startRecording() {
    if (!recorderSupported) {
      alert(
        "Voice notes aren't supported by this browser yet. Try the latest Safari/Chrome, or send an audio file via the paperclip instead."
      );
      return;
    }
    try {
      const pick = pickAudioMime();
      if (!pick) {
        alert("No supported audio format found in this browser.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      const rec = pick.mimeType
        ? new MediaRecorder(stream, { mimeType: pick.mimeType })
        : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recordStreamRef.current = null;
        // Use the recorder's actual mimeType (browsers sometimes substitute one).
        const finalMime = rec.mimeType || pick.mimeType || "application/octet-stream";
        const blob = new Blob(chunks, { type: finalMime });
        await uploadBlob(blob, `voice-note.${pick.ext}`);
        setRecording(false);
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (err) {
      alert(
        "Mic access required for voice notes: " +
          (err instanceof Error ? err.message : String(err))
      );
    }
  }
  function stopRecording() {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  }
  async function uploadBlob(blob: Blob, filename: string) {
    setUploading(true);
    try {
      const json = await uploadAttachment(blob, { filename, mimeType: blob.type });
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
      {/* conversation header */}
      <header className="flex items-center gap-3 px-4 md:px-5 py-3 border-b border-border bg-card md:rounded-t-2xl">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setLocation("/app/messages")}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div className="relative">
          {isGroup ? (
            <div className="size-10 rounded-2xl bg-accent/15 grid place-items-center text-accent">
              <Users className="size-5" />
            </div>
          ) : (
            <>
              <div className="size-10 rounded-2xl bg-primary/15 grid place-items-center text-primary font-bold text-sm">
                {initialsFrom(thread?.peerDisplayName || thread?.peerNumber || "??")}
              </div>
              {thread?.peerIsOnline && (
                <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-[color:var(--relay-online)] border-2 border-card" />
              )}
            </>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">
            {thread?.peerDisplayName || thread?.peerNumber || "Conversation"}
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            {isGroup
              ? `${thread?.memberCount ?? infoQuery.data?.members.length ?? ""} members`
              : (thread?.peerNumber ?? "") +
                (thread?.peerIsOnline
                  ? " · online"
                  : thread?.peerLastSeenAt
                    ? ` · last seen ${timeAgo(thread.peerLastSeenAt)}`
                    : "")}
          </div>
        </div>
        {!isGroup && thread?.peerNumber && (
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setLocation(`/app/dialer?to=${encodeURIComponent(thread.peerNumber)}`)}
            aria-label="Call"
          >
            <Phone className="size-5" />
          </Button>
        )}
      </header>

      {/* message list */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 md:px-5 py-4 space-y-2 bg-background md:bg-card"
      >
        {messagesQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (messagesQuery.data?.length ?? 0) === 0 ? (
          <div className="text-center text-sm text-muted-foreground mt-10">
            No messages yet. Say hi 👋
          </div>
        ) : (
          messagesQuery.data?.map((m) => {
            const mine = m.senderIdentityId === me.id;
            return (
              <div
                key={m.id}
                className={"group flex items-end gap-1.5 " + (mine ? "justify-end" : "justify-start")}
              >
                {mine && (
                  <button
                    type="button"
                    aria-label="Unsend message"
                    title="Unsend"
                    onClick={() => deleteMessage(m.id)}
                    disabled={removeMutation.isPending}
                    className="shrink-0 mb-1 size-7 grid place-items-center rounded-full text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-muted/60 hover:text-destructive transition-opacity"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
                <div
                  className={
                    "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm break-words " +
                    (mine
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm")
                  }
                >
                  {isGroup && !mine && (
                    <div className="text-[11px] font-semibold text-accent mb-0.5">
                      {nameById.get(m.senderIdentityId) || "Member"}
                    </div>
                  )}
                  {m.attachment && (
                    <AttachmentView
                      mimeType={m.attachment.mimeType}
                      url={m.attachment.url}
                      filename={m.attachment.filename ?? undefined}
                    />
                  )}
                  {m.body && (
                    <div className="whitespace-pre-wrap leading-relaxed">{linkify(m.body)}</div>
                  )}
                  <div
                    className={
                      "text-[10px] mt-1 " +
                      (mine ? "text-primary-foreground/70" : "text-muted-foreground")
                    }
                  >
                    {formatTime(m.createdAt)}
                    {mine && m.status && (
                      <span className="ml-1.5">
                        {m.status === "read" ? "✓✓" : m.status === "delivered" ? "✓✓" : "✓"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* composer */}
      <div className="px-3 md:px-5 py-3 border-t border-border bg-card md:rounded-b-2xl">
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
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={uploading ? "Uploading…" : "Type a message"}
            disabled={uploading || recording}
            className="flex-1 h-11"
          />
          {text.trim() || pendingUpload ? (
            <Button
              type="button"
              onClick={send}
              disabled={sendMutation.isPending || uploading}
              size="icon"
              className="h-11 w-11 rounded-full"
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
              className="h-11 w-11 rounded-full"
              aria-label={recording ? "Stop" : "Record"}
              disabled={!recorderSupported}
              title={
                recorderSupported
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
    </>
  );
}

/* ────────────────────────────────────────────────────────────── */

function AttachmentView({
  mimeType,
  url,
  filename,
}: {
  mimeType: string;
  url: string;
  filename?: string;
}) {
  if (mimeType.startsWith("image/")) {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img
          src={url}
          alt={filename || "image"}
          className="rounded-xl max-h-72 w-auto mb-1 object-cover"
          loading="lazy"
        />
      </a>
    );
  }
  if (mimeType.startsWith("video/")) {
    return (
      <video src={url} controls className="rounded-xl max-h-72 w-auto mb-1" />
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
      <Button size="icon" variant="ghost" onClick={() => setOpen(true)} aria-label="New message">
        <MessageSquarePlus className="size-5" />
      </Button>
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
