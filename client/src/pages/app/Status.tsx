import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, Camera, Type, Trash2, Eye, ChevronLeft, ChevronRight, Send, Video } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { uploadStatusMedia } from "@/lib/uploadAttachment";
import { videoRecorderSupported } from "@/lib/videoNote";
import { VideoRecordSheet } from "@/app/VideoRecordSheet";

/**
 * Rich user status (v2.95) — WhatsApp/story-style ephemeral updates: text,
 * image+caption, video+caption, or audio, visible for 24h to your contacts and
 * anyone who's saved you (v2.99.33 either-direction: statusAudienceAuthorized
 * passes when EITHER side saved the other, so posting reaches the people you've
 * added without requiring them to add you back).
 *
 * - <StatusStrip/> is the horizontal ring row (mounted atop the Messages tab):
 *   "My status" first, then contacts with active statuses (bright ring = unseen).
 * - <StatusComposer/> posts a status (text with a colored background, or a
 *   picked image/video/audio with an optional caption).
 * - <StatusViewer/> is the full-screen story player (progress bars, auto-advance,
 *   tap to navigate, seen-by for your own).
 */

// Text-status backgrounds (CSS gradients). The composer cycles through these.
const BG_OPTIONS = [
  "linear-gradient(135deg,#0ea5e9,#2563eb)",
  "linear-gradient(135deg,#06d6a0,#0891b2)",
  "linear-gradient(135deg,#8b5cf6,#d946ef)",
  "linear-gradient(135deg,#f59e0b,#ef4444)",
  "linear-gradient(135deg,#111827,#374151)",
  "linear-gradient(135deg,#ec4899,#f43f5e)",
];

const DEFAULT_ITEM_MS = 5000; // text/image dwell time

type FeedGroup = {
  owner: { id: number; number: string; displayName: string; avatarUrl: string | null; isMe: boolean };
  items: StatusItem[];
  hasUnseen: boolean;
  latestAt: string | Date;
};
type StatusItem = {
  id: number;
  kind: string;
  text: string | null;
  bgColor: string | null;
  mediaUrl: string | null;
  mimeType: string | null;
  durationMs: number | null;
  createdAt: string | Date;
  expiresAt: string | Date;
};

function initials(name: string): string {
  const p = (name || "").trim().split(/\s+/).slice(0, 2);
  return p.map((s) => s[0]?.toUpperCase() ?? "").join("").slice(0, 2) || "?";
}

/**
 * M15: read a video/audio file's true playback length so the story slide runs
 * for its real duration instead of the flat 5s DEFAULT_ITEM_MS. Loads the file
 * into an off-DOM media element and reads `.duration` on loadedmetadata.
 * Recorded WebM/MediaRecorder blobs often report Infinity until seeked to the
 * end, so we nudge currentTime to force a finite durationchange. Resolves null
 * (→ the 5s fallback) on any error, an unreadable duration, or a 3s timeout, so
 * a weird file can never hang the post.
 */
function readMediaDurationMs(file: File): Promise<number | null> {
  const kind = /^video\//.test(file.type) ? "video" : /^audio\//.test(file.type) ? "audio" : null;
  if (kind == null || typeof document === "undefined") return Promise.resolve(null);
  return new Promise<number | null>((resolve) => {
    const el = document.createElement(kind);
    el.preload = "metadata";
    (el as HTMLMediaElement).muted = true;
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (ms: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { el.removeAttribute("src"); el.load(); } catch { /* ignore */ }
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    const tryRead = (): boolean => {
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) { finish(Math.round(d * 1000)); return true; }
      return false;
    };
    const timer = setTimeout(() => finish(null), 3000);
    el.onloadedmetadata = () => {
      if (tryRead()) return;
      // Infinity duration (WebM) — seek far past the end to coerce a real value.
      try { el.currentTime = 1e101; } catch { finish(null); }
    };
    el.ondurationchange = () => { tryRead(); };
    el.ontimeupdate = () => { tryRead(); };
    el.onerror = () => finish(null);
    el.src = url;
  });
}

/* ───────────────────────── Strip ───────────────────────── */

export function StatusStrip() {
  const feed = trpc.status.feed.useQuery(undefined, { staleTime: 20_000, refetchOnWindowFocus: true });
  const [composerOpen, setComposerOpen] = useState(false);
  const [viewerAt, setViewerAt] = useState<number | null>(null); // index into `groups`

  const groups = (feed.data?.groups ?? []) as FeedGroup[];
  const myGroup = groups.find((g) => g.owner.isMe) ?? null;
  const others = groups.filter((g) => !g.owner.isMe);

  return (
    <div className="border-b border-border/60 px-3 py-3">
      <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
        {/* My status tile — opens my viewer if I have items, else the composer. */}
        <button
          type="button"
          onClick={() => (myGroup ? setViewerAt(groups.indexOf(myGroup)) : setComposerOpen(true))}
          className="flex shrink-0 flex-col items-center gap-1.5 w-16"
        >
          <div className="relative">
            <StatusAvatar name="You" url={myGroup?.owner.avatarUrl ?? null} ring={myGroup ? "seen" : "none"} />
            <span
              onClick={(e) => { e.stopPropagation(); setComposerOpen(true); }}
              className="absolute -bottom-0.5 -right-0.5 grid size-5 place-items-center rounded-full bg-[color:var(--relay-online,#06d6a0)] text-[#04201b] ring-2 ring-background"
            >
              <Plus className="size-3.5" strokeWidth={3} />
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground truncate w-full text-center">My status</span>
        </button>

        {others.map((g) => (
          <button
            key={g.owner.id}
            type="button"
            onClick={() => setViewerAt(groups.indexOf(g))}
            className="flex shrink-0 flex-col items-center gap-1.5 w-16"
          >
            <StatusAvatar name={g.owner.displayName} url={g.owner.avatarUrl} ring={g.hasUnseen ? "unseen" : "seen"} />
            <span className="text-[11px] text-muted-foreground truncate w-full text-center">
              {g.owner.displayName.split(/\s+/)[0]}
            </span>
          </button>
        ))}

        {others.length === 0 && !myGroup && (
          <span className="text-xs text-muted-foreground/80 pl-1">
            Share a photo, video, or a line — visible for 24h to your contacts.
          </span>
        )}
      </div>

      {composerOpen && (
        <StatusComposer
          onClose={() => setComposerOpen(false)}
          onPosted={() => { setComposerOpen(false); feed.refetch(); }}
        />
      )}
      {viewerAt !== null && groups[viewerAt] && (
        <StatusViewer
          groups={groups}
          startIndex={viewerAt}
          onClose={() => { setViewerAt(null); feed.refetch(); }}
        />
      )}
    </div>
  );
}

function StatusAvatar({ name, url, ring }: { name: string; url: string | null; ring: "unseen" | "seen" | "none" }) {
  const ringStyle =
    ring === "unseen"
      ? "bg-gradient-to-tr from-[#06d6a0] via-[#0ea5e9] to-[#8b5cf6]"
      : ring === "seen"
        ? "bg-border"
        : "bg-transparent";
  return (
    <span className={`grid size-16 place-items-center rounded-full p-[2.5px] ${ringStyle}`}>
      <span className="grid size-full place-items-center overflow-hidden rounded-full bg-background ring-2 ring-background">
        {url ? (
          <img src={url} alt="" className="size-full rounded-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center rounded-full bg-primary/15 text-primary font-bold text-sm">
            {initials(name)}
          </span>
        )}
      </span>
    </span>
  );
}

/* ───────────────────────── Composer ───────────────────────── */

function StatusComposer({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }) {
  const [mode, setMode] = useState<"text" | "media">("text");
  const [text, setText] = useState("");
  const [caption, setCaption] = useState("");
  const [bgIndex, setBgIndex] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  // In-app recorder (v2.96.2) — iOS blocks the SYSTEM camera's video
  // recording while on a call; this records in-page instead.
  const [recOpen, setRecOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const post = trpc.status.post.useMutation();

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const u = URL.createObjectURL(file);
    setPreviewUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  function pickFile(f: File | null) {
    if (!f) return;
    setFile(f);
    setMode("media");
  }

  function mediaKindOf(f: File): "image" | "video" | "audio" | null {
    if (/^image\//.test(f.type)) return "image";
    if (/^video\//.test(f.type)) return "video";
    if (/^audio\//.test(f.type)) return "audio";
    return null;
  }

  async function submit() {
    if (posting) return;
    setPosting(true);
    try {
      if (mode === "text") {
        const body = text.trim();
        if (!body) { toast.error("Write something first."); setPosting(false); return; }
        await post.mutateAsync({ kind: "text", text: body, bgColor: BG_OPTIONS[bgIndex] });
      } else {
        if (!file) { setPosting(false); return; }
        const kind = mediaKindOf(file);
        if (!kind) { toast.error("Pick an image, video, or audio file."); setPosting(false); return; }
        // M15: for video/audio, capture the real playback length so the viewer
        // holds the slide for its true duration (not a flat 5s). Best-effort —
        // null falls back to DEFAULT_ITEM_MS server- and viewer-side.
        let durationMs: number | undefined;
        if (kind === "video" || kind === "audio") {
          const ms = await readMediaDurationMs(file);
          if (ms && ms > 0) durationMs = Math.min(10 * 60_000, ms);
        }
        const { storageKey } = await uploadStatusMedia(file, { mimeType: file.type });
        await post.mutateAsync({
          kind,
          mediaKey: storageKey,
          mimeType: file.type,
          text: caption.trim() || undefined,
          durationMs,
        });
      }
      toast.success("Status posted — visible for 24h to your contacts and anyone who's saved you.");
      onPosted();
    } catch (e) {
      toast.error((e as Error)?.message || "Couldn't post your status.");
      setPosting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[95] grid place-items-center bg-black/70 backdrop-blur-sm p-3" role="dialog" aria-modal="true">
      <div className="relative w-[min(96vw,440px)] overflow-hidden rounded-3xl border border-border/60 bg-card shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <h2 className="font-bold">New status</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted-foreground hover:bg-muted">
            <X className="size-5" />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1 p-3">
          <button
            type="button"
            onClick={() => setMode("text")}
            className={`flex-1 gap-1.5 inline-flex items-center justify-center rounded-xl py-2 text-sm font-semibold ${mode === "text" ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}
          >
            <Type className="size-4" /> Text
          </button>
          {videoRecorderSupported() && (
            <button
              type="button"
              onClick={() => setRecOpen(true)}
              className="flex-1 gap-1.5 inline-flex items-center justify-center rounded-xl py-2 text-sm font-semibold text-muted-foreground"
            >
              <Video className="size-4" /> Record
            </button>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={`flex-1 gap-1.5 inline-flex items-center justify-center rounded-xl py-2 text-sm font-semibold ${mode === "media" ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}
          >
            <Camera className="size-4" /> Library
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*,audio/*"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {/* Preview area */}
        <div className="px-3 pb-3">
          {mode === "text" ? (
            <div
              className="relative grid min-h-[220px] place-items-center rounded-2xl p-5 text-center"
              style={{ background: BG_OPTIONS[bgIndex] }}
            >
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 700))}
                autoFocus
                placeholder="Type a status…"
                rows={3}
                className="w-full resize-none bg-transparent text-center text-xl font-semibold text-white placeholder-white/70 outline-none"
              />
              <button
                type="button"
                onClick={() => setBgIndex((i) => (i + 1) % BG_OPTIONS.length)}
                className="absolute bottom-2 right-2 rounded-full bg-black/30 px-2.5 py-1 text-[11px] font-medium text-white"
              >
                Color
              </button>
            </div>
          ) : (
            <div className="rounded-2xl bg-black/40 p-2">
              {previewUrl && file ? (
                <MediaPreview file={file} url={previewUrl} />
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="grid min-h-[200px] w-full place-items-center rounded-xl border-2 border-dashed border-border/70 text-sm text-muted-foreground"
                >
                  Tap to choose a photo, video, or audio file
                </button>
              )}
              {file && (
                <input
                  value={caption}
                  onChange={(e) => setCaption(e.target.value.slice(0, 700))}
                  placeholder="Add a caption…"
                  className="mt-2 w-full rounded-xl bg-background/70 px-3 py-2 text-sm outline-none"
                />
              )}
            </div>
          )}
        </div>

        <div className="px-3 pb-4">
          <Button
            type="button"
            onClick={submit}
            disabled={posting || (mode === "text" ? !text.trim() : !file)}
            className="h-12 w-full gap-2 rounded-xl text-base font-semibold"
          >
            {posting ? "Posting…" : (<><Send className="size-4" /> Share status</>)}
          </Button>
        </div>
      </div>
      {/* In-app recorder → the clip becomes the picked file (30s story cap). */}
      {recOpen && (
        <VideoRecordSheet
          maxMs={30_000}
          onClose={() => setRecOpen(false)}
          onUse={(r) => {
            setRecOpen(false);
            pickFile(new File([r.blob], `status-video.${r.ext}`, { type: r.mimeType }));
          }}
        />
      )}
    </div>
  );
}

function MediaPreview({ file, url }: { file: File; url: string }) {
  if (/^image\//.test(file.type)) return <img src={url} alt="" className="max-h-[300px] w-full rounded-xl object-contain" />;
  if (/^video\//.test(file.type)) return <video src={url} controls playsInline className="max-h-[300px] w-full rounded-xl" />;
  if (/^audio\//.test(file.type)) return (
    <div className="grid min-h-[120px] place-items-center gap-3 p-4">
      <div className="text-sm text-muted-foreground">{file.name}</div>
      <audio src={url} controls className="w-full" />
    </div>
  );
  return <div className="p-4 text-sm text-muted-foreground">Unsupported file.</div>;
}

/* ───────────────────────── Viewer ───────────────────────── */

export function StatusViewer({
  groups,
  startIndex,
  onClose,
}: {
  groups: FeedGroup[];
  startIndex: number;
  onClose: () => void;
}) {
  const [gi, setGi] = useState(startIndex);
  const [ii, setIi] = useState(0);
  const [progress, setProgress] = useState(0); // 0..1 of current item
  const [paused, setPaused] = useState(false);
  const [showViewers, setShowViewers] = useState(false);
  const markViewed = trpc.status.markViewed.useMutation();
  const remove = trpc.status.remove.useMutation();
  const utils = trpc.useUtils();
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const elapsedRef = useRef<number>(0);
  // L5: distinguish a quick TAP (navigate) from a press-and-HOLD (pause). The
  // tap-zone buttons overlay the body, so without this a hold-to-pause fired
  // prev()/next() on release — on the first item prev() just restarted it,
  // which read as "holding restarts the story". A release after HOLD_MS is a
  // hold, so navigation is suppressed and only the pause/resume happens.
  const pressStartRef = useRef<number>(0);
  const HOLD_MS = 220;

  const group = groups[gi];
  const item = group?.items[ii];
  const isMine = !!group?.owner.isMe;

  const itemMs = useMemo(() => {
    if (!item) return DEFAULT_ITEM_MS;
    if ((item.kind === "video" || item.kind === "audio") && item.durationMs && item.durationMs > 0) {
      return Math.min(60_000, item.durationMs);
    }
    return DEFAULT_ITEM_MS;
  }, [item]);

  // Advance to the next item/group, or close at the very end.
  function next() {
    if (!group) return onClose();
    if (ii + 1 < group.items.length) { setIi(ii + 1); resetTimer(); return; }
    if (gi + 1 < groups.length) { setGi(gi + 1); setIi(0); resetTimer(); return; }
    onClose();
  }
  function prev() {
    if (ii > 0) { setIi(ii - 1); resetTimer(); return; }
    if (gi > 0) { const p = gi - 1; setGi(p); setIi(Math.max(0, groups[p].items.length - 1)); resetTimer(); return; }
    resetTimer(); // already at the very start — restart this item
  }
  function resetTimer() { elapsedRef.current = 0; startRef.current = 0; setProgress(0); }

  // Mark the current item viewed (once) when it becomes visible.
  useEffect(() => {
    if (item && !isMine) markViewed.mutate({ id: item.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  // Progress timer (rAF). Video/audio drive their own playback; the bar tracks
  // wall-clock either way. Pauses while `paused` (press-and-hold / viewers open).
  useEffect(() => {
    resetTimer();
    let cancelled = false;
    const tick = (ts: number) => {
      if (cancelled) return;
      if (paused || showViewers) { startRef.current = ts - elapsedRef.current; rafRef.current = requestAnimationFrame(tick); return; }
      if (!startRef.current) startRef.current = ts;
      elapsedRef.current = ts - startRef.current;
      const p = Math.min(1, elapsedRef.current / itemMs);
      setProgress(p);
      if (p >= 1) { next(); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { cancelled = true; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gi, ii, itemMs, paused, showViewers]);

  if (!group || !item) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black text-white select-none">
      {/* progress bars */}
      <div className="flex gap-1 px-3 pt-3">
        {group.items.map((it, idx) => (
          <div key={it.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25">
            <div
              className="h-full bg-white"
              style={{ width: idx < ii ? "100%" : idx === ii ? `${progress * 100}%` : "0%" }}
            />
          </div>
        ))}
      </div>

      {/* header */}
      <div className="flex items-center gap-2.5 px-4 py-2.5">
        <StatusAvatar name={group.owner.displayName} url={group.owner.avatarUrl} ring="none" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{isMine ? "My status" : group.owner.displayName}</div>
          <div className="text-[11px] text-white/60">{timeAgo(item.createdAt)}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 hover:bg-white/10">
          <X className="size-6" />
        </button>
      </div>

      {/* body */}
      <div
        className="relative flex-1"
        onPointerDown={() => { pressStartRef.current = Date.now(); setPaused(true); }}
        onPointerUp={() => setPaused(false)}
        onPointerLeave={() => setPaused(false)}
      >
        <StatusBody item={item} />
        {/* tap zones — navigate only on a quick tap; a press-and-hold pauses. */}
        <button type="button" aria-label="Previous" onClick={() => { if (Date.now() - pressStartRef.current < HOLD_MS) prev(); }} className="absolute inset-y-0 left-0 w-1/3" />
        <button type="button" aria-label="Next" onClick={() => { if (Date.now() - pressStartRef.current < HOLD_MS) next(); }} className="absolute inset-y-0 right-0 w-1/3" />
        {/* desktop chevrons */}
        <button type="button" onClick={prev} className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 md:block"><ChevronLeft className="size-5" /></button>
        <button type="button" onClick={next} className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 md:block"><ChevronRight className="size-5" /></button>
      </div>

      {/* caption */}
      {item.text && item.kind !== "text" && (
        <div className="px-5 pb-3 text-center text-sm">{item.text}</div>
      )}

      {/* owner footer: seen-by + delete */}
      {isMine && (
        <div className="flex items-center justify-between px-5 py-3">
          <button type="button" onClick={() => { setPaused(true); setShowViewers(true); }} className="inline-flex items-center gap-1.5 text-sm text-white/80">
            <Eye className="size-4" /> Viewers
          </button>
          <button
            type="button"
            onClick={async () => {
              await remove.mutateAsync({ id: item.id }).catch(() => {});
              await utils.status.feed.invalidate();
              next();
            }}
            className="inline-flex items-center gap-1.5 text-sm text-red-400"
          >
            <Trash2 className="size-4" /> Delete
          </button>
        </div>
      )}

      {showViewers && item && (
        <ViewersSheet statusId={item.id} onClose={() => { setShowViewers(false); setPaused(false); }} />
      )}
    </div>
  );
}

function StatusBody({ item }: { item: StatusItem }) {
  if (item.kind === "text") {
    return (
      <div className="grid size-full place-items-center p-8 text-center" style={{ background: item.bgColor ?? "#111827" }}>
        <div className="text-2xl font-semibold leading-snug">{item.text}</div>
      </div>
    );
  }
  if (item.kind === "image") {
    return <div className="grid size-full place-items-center"><img src={item.mediaUrl ?? ""} alt="" className="max-h-full max-w-full object-contain" /></div>;
  }
  if (item.kind === "video") {
    return <div className="grid size-full place-items-center"><video src={item.mediaUrl ?? ""} autoPlay playsInline controls={false} className="max-h-full max-w-full" /></div>;
  }
  if (item.kind === "audio") {
    return (
      <div className="grid size-full place-items-center gap-4 p-8">
        <div className="grid size-24 place-items-center rounded-full bg-white/10 text-4xl">🎵</div>
        <audio src={item.mediaUrl ?? ""} autoPlay controls className="w-[min(90vw,420px)]" />
      </div>
    );
  }
  return null;
}

function ViewersSheet({ statusId, onClose }: { statusId: number; onClose: () => void }) {
  const q = trpc.status.viewers.useQuery({ id: statusId }, { staleTime: 5_000 });
  const viewers = q.data?.viewers ?? [];
  return (
    <div className="fixed inset-0 z-[105] flex items-end bg-black/50" onClick={onClose}>
      <div className="w-full rounded-t-3xl bg-card p-4 text-foreground max-h-[60vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
        <div className="mb-2 text-sm font-semibold">Seen by {viewers.length}</div>
        {viewers.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No views yet.</div>
        ) : (
          <ul className="space-y-1">
            {viewers.map((v) => (
              <li key={v.id} className="flex items-center gap-3 py-1.5">
                <StatusAvatar name={v.displayName} url={v.avatarUrl} ring="none" />
                <span className="text-sm">{v.displayName}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function timeAgo(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
