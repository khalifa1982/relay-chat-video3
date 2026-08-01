import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X, Camera, Type, Trash2, Eye, ChevronLeft, ChevronRight, Send, Video, Smile, Users } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { uploadStatusMedia } from "@/lib/uploadAttachment";
import { videoRecorderSupported } from "@/lib/videoNote";
import { VideoRecordSheet } from "@/app/VideoRecordSheet";
import { AUDIENCE_OPTIONS, audienceOption } from "@/app/statusAudience";
import { EmojiPicker } from "@/app/EmojiPicker";
import { REACTION_QUICK } from "@/lib/emojiCatalog";
import { useT } from "@/app/i18n";

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

/**
 * One reel — everything a single ring in the strip stands for.
 *
 * `subject` is WHAT THE RING IS ON: a person, or (v2.105.6) a GROUP. It replaced a
 * plain `owner` deliberately rather than sitting beside it: a group is not a person,
 * and a field that sometimes means one and sometimes the other is how a surface
 * comes to render a group under a member's name. `subject.key` is `"p:<id>"` or
 * `"g:<id>"`, so the React key and the strip's identity cannot collide between the
 * two kinds; `identityId` / `conversationId` are non-null in mutually exclusive
 * cases, so anything wanting a real id must say which it means.
 */
export type FeedGroup = {
  subject: {
    key: string;
    kind: "person" | "group";
    identityId: number | null;
    conversationId: number | null;
    number: string;
    displayName: string;
    avatarUrl: string | null;
    /** My own ring. Always false for a group — a group is not me. */
    isMe: boolean;
  };
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
  /** Present only on MY OWN statuses (the server omits it for other people's). */
  audience?: string | null;
  /**
   * Is THIS slide mine — may I delete it and see who watched it? Per-item, because
   * a group reel mixes authors; for a personal reel it equals the reel's own
   * `subject.isMe`.
   */
  mine?: boolean;
  /** Who posted it. Sent only inside a GROUP reel, where the reel has no one author. */
  author?: { id: number; number: string; displayName: string; avatarUrl: string | null };
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
  const t = useT();
  const feed = trpc.status.feed.useQuery(undefined, { staleTime: 20_000, refetchOnWindowFocus: true });
  const [composerOpen, setComposerOpen] = useState(false);
  const [viewerAt, setViewerAt] = useState<number | null>(null); // index into `groups`

  const groups = (feed.data?.groups ?? []) as FeedGroup[];
  const myGroup = groups.find((g) => g.subject.isMe) ?? null;
  const others = groups.filter((g) => !g.subject.isMe);

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
            <StatusAvatar name="You" url={myGroup?.subject.avatarUrl ?? null} ring={myGroup ? "seen" : "none"} />
            <span
              onClick={(e) => { e.stopPropagation(); setComposerOpen(true); }}
              /* v2.106.66 — the ACCENT, per board 1c (`background:var(--rb)`, glyph
                 `#04211a`). It was the PRESENCE GREEN, which in this app means ONLINE and
                 nothing else — the seventh time that colour has been spent on something
                 that is not presence, and the first the standing guard could not catch,
                 because the guard read only `Messages.tsx` and its allow-list matched
                 inside the token NAME. Both halves are fixed in `mentions.test.ts`. */
              className="rcta absolute -bottom-0.5 -right-0.5 grid size-[17px] place-items-center rounded-full ring-[2.5px] ring-background"
            >
              <Plus className="size-3.5" strokeWidth={3} />
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground truncate w-full text-center">{t("status.myStory")}</span>
        </button>

        {others.map((g) => (
          <button
            key={g.subject.key}
            type="button"
            onClick={() => setViewerAt(groups.indexOf(g))}
            className="flex shrink-0 flex-col items-center gap-1.5 w-16"
          >
            <StatusAvatar
              name={g.subject.displayName}
              url={g.subject.avatarUrl}
              ring={g.hasUnseen ? "unseen" : "seen"}
              /* A group with no photo gets the same generic glyph its thread row
                 draws (v2.102.1), not two initials — a group's initials read as a
                 person's and the two rings sit side by side in this strip. */
              group={g.subject.kind === "group"}
            />
            <span className="text-[11px] text-muted-foreground truncate w-full text-center">
              {/* A group is named in full: its title is already short and the first
                  word of "Design team" is not a name anybody recognises. */}
              {g.subject.kind === "group"
                ? g.subject.displayName
                : g.subject.displayName.split(/\s+/)[0]}
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
          /* THE ONE PLACE THAT CHAINS, and only on somebody else's ring (v2.99.90).
             Tapping a friend walks through the remaining friends to the last one;
             tapping MY status shows mine and closes ("on your personal story, with
             its finish, it's closed"). The viewer also skips my group if a chain
             happens to reach it, so this is belt and braces rather than the only
             guard. */
          chain={!groups[viewerAt].subject.isMe}
          onClose={() => { setViewerAt(null); feed.refetch(); }}
        />
      )}
    </div>
  );
}

function StatusAvatar({
  name,
  url,
  ring,
  group = false,
}: {
  name: string;
  url: string | null;
  ring: "unseen" | "seen" | "none";
  /** Draw the generic group glyph instead of initials when there is no photo. */
  group?: boolean;
}) {
  const ringStyle =
    ring === "unseen"
      ? "rstoryring" // v2.106.66 — the ONE recipe (index.css), not a third copy of it
      : ring === "seen"
        ? "bg-border"
        : "bg-transparent";
  return (
    <span className={`grid size-16 place-items-center rounded-full p-[2.5px] ${ringStyle}`}>
      <span className="grid size-full place-items-center overflow-hidden rounded-full bg-background ring-2 ring-background">
        {url ? (
          <img src={url} alt="" className="size-full rounded-full object-cover" />
        ) : group ? (
          <span className="grid size-full place-items-center rounded-full bg-primary/15 text-primary">
            <Users className="size-6" />
          </span>
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
  const t = useT();
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
  /* Audience for THIS post (v2.99.55). Starts from the saved default and can be
     changed per post; `undefined` until the default loads, at which point the
     server would apply the same value anyway, so nothing is lost by an early
     submit. Changing it here does NOT change the saved default — that lives in
     Profile → Status privacy, which is the deliberate split: a one-off story
     shouldn't silently rewrite your standing preference. */
  const privacy = trpc.status.getPrivacy.useQuery(undefined, { staleTime: 60_000 });
  const [audience, setAudience] = useState<"contacts" | "everyone" | null>(null);
  const effectiveAudience = audience ?? privacy.data?.audience ?? "contacts";

  /* WHERE THIS STORY GOES (v2.105.6, #110): my own ring, or one of my groups.
     Read off `messages.threads`, which the Messages tab this composer opens from
     has already fetched — so the picker costs no extra request — and which is
     the same list that decides what a group is called everywhere else. A
     separate "my groups" endpoint would be a second answer to one question.
     Archived groups are included on purpose: archiving is about where a thread
     sits in the list, not about whether you are in it. */
  const threads = trpc.messages.threads.useQuery(undefined, { staleTime: 30_000 });
  const myGroups = useMemo(
    () =>
      (threads.data ?? [])
        .filter((t) => t.kind === "group")
        .map((t) => ({
          id: t.conversationId,
          title: t.title || "Group",
          avatarUrl: t.groupAvatarUrl ?? null,
        })),
    [threads.data],
  );
  /** null ⇒ my own ring (the default, and every pre-v2.105.6 behaviour). */
  const [targetGroupId, setTargetGroupId] = useState<number | null>(null);
  const targetGroup = myGroups.find((g) => g.id === targetGroupId) ?? null;
  /* A group's audience IS its membership — `statusAudienceAuthorized` ignores the
     stored audience once a conversationId is present — so offering contacts/everyone
     alongside a group target would be a control that changes nothing. Hidden rather
     than disabled, and the copy says who will see it instead. */
  const audiencePickerApplies = targetGroupId == null;

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
        if (!body) { toast.error(t("status.writeFirst")); setPosting(false); return; }
        await post.mutateAsync({
          kind: "text",
          text: body,
          bgColor: BG_OPTIONS[bgIndex],
          audience: effectiveAudience,
          // Omitted for a personal story, so the request is byte-identical to
          // every pre-v2.105.6 one.
          ...(targetGroupId != null ? { conversationId: targetGroupId } : {}),
        });
      } else {
        if (!file) { setPosting(false); return; }
        const kind = mediaKindOf(file);
        if (!kind) { toast.error(t("status.pickMedia")); setPosting(false); return; }
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
          audience: effectiveAudience,
          ...(targetGroupId != null ? { conversationId: targetGroupId } : {}),
        });
      }
      toast.success(
        targetGroup
          ? `Story posted to ${targetGroup.title} — everyone in the group can see it for 24h.`
          : `Status posted — ${audienceOption(effectiveAudience).posted}.`,
      );
      onPosted();
    } catch (e) {
      toast.error((e as Error)?.message || t("status.postFailed"));
      setPosting(false);
    }
  }

  /* PORTALLED TO document.body (v2.99.49, owner screenshot: on desktop the
     composer overlapped the conversation and its third tab was cut to "L").
     `position: fixed` is only viewport-relative while NO ancestor establishes a
     containing block — any ancestor with a transform, filter (a backdrop-blur
     counts), or contain does establish one, and this dialog renders from inside
     the Messages column, which has both blurred chrome and a horizontally
     scrolling status strip above it. A portal makes the overlay independent of
     every ancestor by construction, rather than depending on which of them
     happens to have a filter today. */
  return createPortal(
    <div className="fixed inset-0 z-[95] grid place-items-center bg-black/70 backdrop-blur-sm p-3" role="dialog" aria-modal="true">
      <div className="relative w-[min(96vw,440px)] max-h-[92dvh] overflow-y-auto overflow-x-hidden rounded-3xl border border-border/60 bg-card shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <h2 className="font-bold">{t("status.newStory")}</h2>
          <button type="button" onClick={onClose} aria-label={t("status.close")} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted">
            <X className="size-5" />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="flex min-w-0 gap-1 p-3">
          <button
            type="button"
            onClick={() => setMode("text")}
            className={`min-w-0 flex-1 gap-1.5 inline-flex items-center justify-center rounded-xl px-1 py-2 text-sm font-semibold ${mode === "text" ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}
          >
            <Type className="size-4 shrink-0" /> <span className="truncate">Text</span>
          </button>
          {videoRecorderSupported() && (
            <button
              type="button"
              onClick={() => setRecOpen(true)}
              className="min-w-0 flex-1 gap-1.5 inline-flex items-center justify-center rounded-xl px-1 py-2 text-sm font-semibold text-muted-foreground"
            >
              <Video className="size-4 shrink-0" /> <span className="truncate">{t("status.record")}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={`min-w-0 flex-1 gap-1.5 inline-flex items-center justify-center rounded-xl px-1 py-2 text-sm font-semibold ${mode === "media" ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}
          >
            <Camera className="size-4 shrink-0" /> <span className="truncate">{t("status.library")}</span>
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
                placeholder={t("status.typeStory")}
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
                  placeholder={t("status.caption")}
                  className="mt-2 w-full rounded-xl bg-background/70 px-3 py-2 text-sm outline-none"
                />
              )}
            </div>
          )}
        </div>

        {/* WHERE IT GOES (v2.105.6, #110) — my own ring, or one of my groups.
            Rendered only when I am actually in a group: a picker with one option
            is a control that cannot do anything, and every existing user with no
            groups sees exactly the composer they saw before. */}
        {myGroups.length > 0 && (
          <div className="px-3 pb-1">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Post to
            </p>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
              <button
                type="button"
                onClick={() => setTargetGroupId(null)}
                aria-pressed={targetGroupId == null}
                className={`shrink-0 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                  targetGroupId == null
                    ? "border-primary/60 bg-primary/10"
                    : "border-border/60 text-muted-foreground hover:bg-muted/50"
                }`}
              >
                My story
              </button>
              {myGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setTargetGroupId(g.id)}
                  aria-pressed={targetGroupId === g.id}
                  className={`inline-flex max-w-[11rem] shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                    targetGroupId === g.id
                      ? "border-primary/60 bg-primary/10"
                      : "border-border/60 text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <Users className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{g.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Who can watch THIS post (v2.99.55). Two options, per the owner's ask.
            WITHHELD for a group target rather than disabled: a group story's
            audience IS its membership (the server ignores the stored value once a
            conversationId is present), so leaving the control on screen would
            invite someone to pick "Everyone" and believe they had widened it. */}
        {audiencePickerApplies ? (
        <div className="px-3 pb-1">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Who can see this
          </p>
          <div className="flex gap-1.5">
            {AUDIENCE_OPTIONS.map((opt) => {
              const active = effectiveAudience === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAudience(opt.value)}
                  aria-pressed={active}
                  className={`min-w-0 flex-1 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                    active
                      ? "border-primary/60 bg-primary/10"
                      : "border-border/60 text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <opt.Icon className="size-3.5 shrink-0" />
                    <span className="truncate">{opt.label}</span>
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug opacity-80">{opt.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
        ) : (
          <div className="px-3 pb-1">
            <p className="rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              Everyone in <span className="font-semibold">{targetGroup?.title}</span> can see this for
              24h, and it shows under the group — not on your own story.
            </p>
          </div>
        )}

        <div className="px-3 pb-4 pt-2">
          <Button
            type="button"
            onClick={submit}
            disabled={posting || (mode === "text" ? !text.trim() : !file)}
            className="h-12 w-full gap-2 rounded-xl text-base font-semibold"
          >
            {posting ? t("status.posting") : (<><Send className="size-4" /> Share story</>)}
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
    </div>,
    document.body
  );
}

function MediaPreview({ file, url }: { file: File; url: string }) {
  const t = useT();
  if (/^image\//.test(file.type)) return <img src={url} alt="" className="max-h-[300px] w-full rounded-xl object-contain" />;
  if (/^video\//.test(file.type)) return <video src={url} controls playsInline className="max-h-[300px] w-full rounded-xl" />;
  if (/^audio\//.test(file.type)) return (
    <div className="grid min-h-[120px] place-items-center gap-3 p-4">
      <div className="text-sm text-muted-foreground">{file.name}</div>
      <audio src={url} controls className="w-full" />
    </div>
  );
  return <div className="p-4 text-sm text-muted-foreground">{t("status.unsupportedFile")}</div>;
}

/* ───────────────────────── Viewer ───────────────────────── */

export function StatusViewer({
  groups,
  startIndex,
  onClose,
  chain = false,
}: {
  groups: FeedGroup[];
  startIndex: number;
  onClose: () => void;
  /**
   * Walk on to the next person's story when this one finishes (v2.99.90).
   *
   * **Defaults to `false`, and that default is the safety property**: the owner
   * wants chaining ONLY from the Messages story strip, on somebody else's ring.
   * Every other entry point — the profile popup, a contact row, a History row, a
   * call tile, and your own story anywhere — shows that one person and closes. A
   * call site added later inherits the restrictive behaviour rather than the
   * surprising one.
   */
  chain?: boolean;
}) {
  const t = useT();
  const [gi, setGi] = useState(startIndex);
  const [ii, setIi] = useState(0);
  const [progress, setProgress] = useState(0); // 0..1 of current item
  const [paused, setPaused] = useState(false);
  const [showViewers, setShowViewers] = useState(false);
  /**
   * The reply band is open / busy (v2.99.80).
   *
   * Deliberately NOT `paused`: that flag is churned by the body wrapper's
   * onPointerUp / onPointerLeave, so the very pointerup that ends the tap opening
   * the composer would clear it and the story would advance mid-sentence. This is
   * its own state, read by the rAF guard — exactly how `showViewers` already
   * works, which is the mechanism this code already proves.
   */
  const [replyOpen, setReplyOpen] = useState(false);
  const markViewed = trpc.status.markViewed.useMutation();
  const remove = trpc.status.remove.useMutation();
  const removeAsAdmin = trpc.status.removeAsGroupAdmin.useMutation();
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
  /* IS THE CURRENT SLIDE MINE — may I delete it and see who watched it?
     PER-ITEM (v2.105.6), not per-reel. Both facts have always been per-item; the
     reel-level flag was only ever a correct proxy because every reel had exactly
     one author. A GROUP reel does not, so reading ownership off the reel would
     offer Delete on a fellow member's slide — a button the server refuses
     (`deleteStatus` is author-scoped), i.e. one that silently does nothing.
     Falls back to the reel's own flag for a payload from an older server. */
  const isMine = item?.mine ?? !!group?.subject.isMe;

  /* #118 — MAY I, AS AN ADMIN, REMOVE SOMEBODY ELSE'S SLIDE FROM MY GROUP?
     Asked LAZILY and only where it can matter: a group reel, on a slide that is
     not mine. Putting the flag on the FEED instead would mean an admin check per
     group on a query every client polls, for a button almost nobody taps — and
     the answer is only ever needed after a deliberate open. `conversationInfo` is
     membership-gated and already backs the group sheet, so this adds no surface. */
  const groupCid = group?.subject.kind === "group" ? group.subject.conversationId : null;
  const groupInfo = trpc.messages.conversationInfo.useQuery(
    { conversationId: groupCid ?? 0 },
    { enabled: groupCid != null && !isMine, retry: false, staleTime: 60_000 },
  );
  /* Only ever true for a group slide somebody ELSE wrote. `isMine` already has the
     author's own Delete, and offering both would put two buttons on one row that do
     the same thing by different authority. Defaults to FALSE while the query is in
     flight or has failed, so a hiccup hides a control rather than showing one the
     server will refuse (the v2.103.3 rule). */
  const canRemoveAsAdmin =
    groupCid != null &&
    !isMine &&
    !!item &&
    !!groupInfo.data?.members?.some((m) => m.isMe && m.isAdmin);

  const itemMs = useMemo(() => {
    if (!item) return DEFAULT_ITEM_MS;
    if ((item.kind === "video" || item.kind === "audio") && item.durationMs && item.durationMs > 0) {
      return Math.min(60_000, item.durationMs);
    }
    return DEFAULT_ITEM_MS;
  }, [item]);

  /* WHO ELSE'S STORY THIS VIEWER MAY WALK ON TO (v2.99.90).
     Owner: "if you are in the message and you click in the other story, it will
     start from the first profile of your friends who published story, and it will
     keep going to the end of the last friend … But on your personal story, with its
     finish, it's closed. No need to take you to the next story of the people who is
     in your contact list. … don't do it in the main profile if you click there or
     anywhere else."
     So chaining is OPT-IN, and it defaults to OFF: a call site that forgets the prop
     gets the single-story behaviour, which is the rule for everywhere except the
     Messages strip. Your OWN story is never part of the chain in either direction —
     it is excluded here rather than at the call site, so a chain that starts on a
     friend can never land on you either. */
  function nextChainable(from: number, step: 1 | -1): number {
    if (!chain) return -1;
    for (let j = from + step; j >= 0 && j < groups.length; j += step) {
      if (!groups[j].subject.isMe) return j;
    }
    return -1;
  }

  // Advance to the next item/group, or close at the very end.
  function next() {
    if (!group) return onClose();
    if (ii + 1 < group.items.length) { setIi(ii + 1); resetTimer(); return; }
    const n = nextChainable(gi, 1);
    if (n >= 0) { setGi(n); setIi(0); resetTimer(); return; }
    onClose();
  }
  function prev() {
    if (ii > 0) { setIi(ii - 1); resetTimer(); return; }
    const p = nextChainable(gi, -1);
    if (p >= 0) { setGi(p); setIi(Math.max(0, groups[p].items.length - 1)); resetTimer(); return; }
    resetTimer(); // already at the very start — restart this item
  }
  function resetTimer() { elapsedRef.current = 0; startRef.current = 0; setProgress(0); }

  // Mark the current item viewed (once) when it becomes visible.
  useEffect(() => {
    if (item && !isMine) markViewed.mutate({ id: item.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  // Close the reply band whenever the story advances. Without this, a draft typed
  // against status A could be sent against status B after an auto-advance — the
  // same class of bug as the reply-target leak fixed in Messages (QA M5). The bar
  // is keyed on the status id too, so its own text state is discarded with it.
  useEffect(() => { setReplyOpen(false); }, [gi, ii]);

  // Progress timer (rAF). Video/audio drive their own playback; the bar tracks
  // wall-clock either way. Pauses while `paused` (press-and-hold / viewers open).
  useEffect(() => {
    resetTimer();
    let cancelled = false;
    const tick = (ts: number) => {
      if (cancelled) return;
      if (paused || showViewers || replyOpen) { startRef.current = ts - elapsedRef.current; rafRef.current = requestAnimationFrame(tick); return; }
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
  }, [gi, ii, itemMs, paused, showViewers, replyOpen]);

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
        <StatusAvatar
          name={group.subject.displayName}
          url={group.subject.avatarUrl}
          ring="none"
          group={group.subject.kind === "group"}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {group.subject.kind === "group"
              ? group.subject.displayName
              : isMine
                ? t("status.myStory")
                : group.subject.displayName}
          </div>
          {/* Relative for the glance, EXACT on press — the owner could not tell when
              a story had been posted, and "16h ago" genuinely does not answer that.
              IN A GROUP the author is named here too (v2.105.6): a group reel
              legitimately mixes authors, so without it a slide would be attributed
              to the group and there would be no way to tell who wrote it. */}
          <div className="truncate text-[11px] text-white/60" title={new Date(item.createdAt).toLocaleString()}>
            {/* Board 2c draws "2 of 3 · 18m ago". The progress bars already encode the
                position, but reading it off them means counting hairlines — the
                number answers "how much of this reel is left" directly, which is the
                question somebody holding a finger on the screen actually has.
                WITHHELD FOR A SINGLE-SLIDE REEL: "1 of 1" is noise, and the bar above
                already says there is only one. */}
            {group.items.length > 1 && (
              <span className="font-mono" dir="ltr">
                {ii + 1} of {group.items.length}
                {" · "}
              </span>
            )}
            {group.subject.kind === "group" && item.author
              ? `${item.mine ? "You" : item.author.displayName} · ${timeAgo(item.createdAt)}`
              : timeAgo(item.createdAt)}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label={t("status.close")} className="rounded-full p-1.5 hover:bg-white/10">
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
        {/* tap zones — navigate only on a quick tap; a press-and-hold pauses.
            While the reply band is open the FIRST tap closes it instead of
            navigating, so tapping away dismisses the composer rather than
            skipping the story you were about to reply to (v2.99.80). */}
        <button type="button" aria-label={t("status.previous")} onClick={() => { if (replyOpen) { setReplyOpen(false); return; } if (Date.now() - pressStartRef.current < HOLD_MS) prev(); }} className="absolute inset-y-0 left-0 w-1/3" />
        <button type="button" aria-label={t("status.next")} onClick={() => { if (replyOpen) { setReplyOpen(false); return; } if (Date.now() - pressStartRef.current < HOLD_MS) next(); }} className="absolute inset-y-0 right-0 w-1/3" />
        {/* desktop chevrons — these bypass the HOLD check, so they need the same
            reply guard or a stray click would advance mid-compose. */}
        <button type="button" onClick={() => { if (replyOpen) { setReplyOpen(false); return; } prev(); }} className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 md:block"><ChevronLeft className="size-5" /></button>
        <button type="button" onClick={() => { if (replyOpen) { setReplyOpen(false); return; } next(); }} className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 md:block"><ChevronRight className="size-5" /></button>
      </div>

      {/* caption */}
      {item.text && item.kind !== "text" && (
        <div className="px-5 pb-3 text-center text-sm">{item.text}</div>
      )}

      {/* SOMEBODY ELSE'S STATUS — react or reply (v2.99.80). Placed here, between
          the caption and the owner footer, because this is the only slot that is
          simultaneously below the tap zones, OUTSIDE the body wrapper (whose
          pointer handlers would fight every keystroke), and a direct child of the
          root column so it takes its own band instead of overlaying the media. */}
      {!isMine && (
        <StatusReplyBar
          // Keyed on the status: an advance discards the bar's own draft rather
          // than carrying it onto the next story.
          key={item.id}
          statusId={item.id}
          expiresAt={item.expiresAt}
          /* The person being replied to is the SLIDE'S AUTHOR, not the reel's
             subject — in a group they differ, and the reply is a private message to
             whoever wrote it (that is what the server does), so naming the group
             here would promise a group-visible reply the code does not send. */
          ownerName={item.author?.displayName ?? group.subject.displayName}
          open={replyOpen}
          setOpen={setReplyOpen}
        />
      )}

      {/* owner footer: audience + seen-by + delete */}
      {isMine && (
        <div className="flex items-center justify-between gap-3 px-5 py-3">
          <button type="button" onClick={() => { setPaused(true); setShowViewers(true); }} className="inline-flex items-center gap-1.5 text-sm text-white/80">
            <Eye className="size-4" /> Viewers
          </button>
          {/* Which audience THIS post went to (v2.99.55). The per-post value is
              frozen at insert, so this is the truth for this story even if the
              default has changed since — which is exactly why it's worth showing. */}
          {item.audience && (
            <span
              className="inline-flex min-w-0 items-center gap-1 text-xs text-white/60"
              title={audienceOption(item.audience).hint}
            >
              {(() => {
                const O = audienceOption(item.audience).Icon;
                return <O className="size-3.5 shrink-0" />;
              })()}
              <span className="truncate">{audienceOption(item.audience).label}</span>
            </span>
          )}
          <button
            type="button"
            disabled={remove.isPending}
            onClick={async () => {
              // v2.99.87 (owner: "i found something that i cant delete and i dunno
              // why it showing"). This used to be
              //   await remove.mutateAsync({ id }).catch(() => {}); invalidate(); next();
              // which is three separate ways to lie about what happened:
              //
              //  1. `.catch(() => {})` swallowed a genuine transport/auth failure.
              //  2. `status.remove` answers `{ ok: false }` — NOT an error — when the
              //     row's identityId is not mine (`deleteStatus` returns false), and
              //     that verdict was thrown away entirely.
              //  3. it then advanced regardless, so the story slid past and came
              //     BACK on the next open. Tapping Delete looked like it worked and
              //     the status stayed forever.
              //
              // Now the verdict is read and a refusal is SAID OUT LOUD.
              //
              // The message deliberately does NOT assert a cause. My first version
              // blamed a second identity on the browser, and the owner's own data
              // then disproved it: both of their statuses sit on the identity they
              // are signed into. The likelier cause is a STALE id — the feed is
              // cached, a story expires at 24h, and tapping Delete on a row the
              // reaper has already removed returns exactly this `ok: false`. Naming
              // a cause I cannot prove is worse than describing the effect and
              // saying what to do about it.
              let ok = false;
              try {
                const res = await remove.mutateAsync({ id: item.id });
                ok = !!res?.ok;
              } catch {
                toast.error("Couldn't reach the server — story not deleted.");
                return;
              }
              // Refresh BOTH reads. `mine` backs the avatar's status pip and the
              // strip's own ring; invalidating only `feed` left them claiming a
              // status that no longer exists.
              await Promise.all([
                utils.status.feed.invalidate(),
                utils.status.mine.invalidate(),
              ]);
              if (!ok) {
                toast.error(
                  "That story is no longer there to delete — it may have already expired. Pull to refresh."
                );
                return; // do NOT advance: the item is still there.
              }
              toast.success(t("status.storyDeleted"));
              // Deleting shifts the array under the index, so re-clamp rather than
              // stepping forward blindly: `next()` from the LAST item walked past
              // the end of a list that had just got shorter.
              setIi((v) => Math.max(0, Math.min(v, (group.items.length - 2) | 0)));
            }}
            className="inline-flex items-center gap-1.5 text-sm text-red-400 disabled:opacity-50"
          >
            <Trash2 className="size-4" /> {remove.isPending ? t("status.deleting") : "Delete"}
          </button>
        </div>
      )}

      {/* #118 — the admin's own row, on a fellow member's group slide. Separate
          from the author footer above rather than a widened version of it: the
          two have different authority and different copy, and one row branching
          on which is which is how a tap comes to call the wrong mutation. */}
      {canRemoveAsAdmin && item && (
        <div className="flex items-center justify-between gap-3 px-5 py-3">
          <span className="min-w-0 truncate text-xs text-white/55">
            You're an admin of this group
          </span>
          <button
            type="button"
            disabled={removeAsAdmin.isPending}
            onClick={async () => {
              // Confirmed, because it removes something SOMEBODY ELSE posted and
              // cannot be undone — the copy says whose and where, since "delete
              // this?" does not distinguish it from the author's own Delete.
              const who = item.author?.displayName || "this member";
              if (
                !window.confirm(
                  `Remove ${who}'s story from ${group?.subject.displayName ?? "this group"}? It disappears for every member. This can't be undone.`,
                )
              ) {
                return;
              }
              try {
                await removeAsAdmin.mutateAsync({ id: item.id });
              } catch {
                // The server answers one message for "gone", "personal story" and
                // "not an admin here", so there is nothing more specific to say.
                toast.error("That story isn't there to remove — pull to refresh.");
                return;
              }
              // Both reads, for the same reason the author path invalidates both:
              // `mine` backs the pip and the strip's ring.
              await Promise.all([
                utils.status.feed.invalidate(),
                utils.status.mine.invalidate(),
              ]);
              toast.success(t("status.storyRemoved"));
              // Re-clamp rather than stepping on: the array just got shorter.
              setIi((v) => Math.max(0, Math.min(v, (group.items.length - 2) | 0)));
            }}
            className="inline-flex items-center gap-1.5 text-sm text-red-400 disabled:opacity-50"
          >
            <Trash2 className="size-4" />
            {removeAsAdmin.isPending ? t("status.removing") : "Remove as admin"}
          </button>
        </div>
      )}

      {showViewers && item && (
        <ViewersSheet statusId={item.id} onClose={() => { setShowViewers(false); setPaused(false); }} />
      )}
    </div>
  );
}

/**
 * React or reply to somebody else's status (v2.99.80).
 *
 * Owner: *"you can make a kind of emoji or put a reply. So it will reply to him on
 * the private message on the message showing that I replied on this status. So put
 * the list of all emojis."*
 *
 * A one-tap emoji and a typed sentence are the SAME server call, differing only in
 * the body — that is what the owner described, and it means one authorization path,
 * one notification, and the reply landing in the inbox where they asked for it.
 */
function StatusReplyBar({
  statusId,
  expiresAt,
  ownerName,
  open,
  setOpen,
}: {
  statusId: number;
  expiresAt: string | Date;
  ownerName: string;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const reply = trpc.status.reply.useMutation();

  /**
   * A status can expire while the viewer sits on it, and the server answers a dead
   * id and an unauthorized one IDENTICALLY on purpose (distinguishing them would be
   * an existence oracle). `expiresAt` is already on the wire, so the honest reason
   * is derived HERE — otherwise the person just gets a refusal with no explanation.
   */
  const expired = new Date(expiresAt).getTime() <= Date.now();

  async function send(body: string) {
    const b = body.trim();
    // In-flight guard: a double-tap on a quick emoji would otherwise be two
    // messages and two unread increments.
    if (!b || sending || expired) return;
    setSending(true);
    setOpen(true); // hold the story while the request is in flight
    try {
      const res = await reply.mutateAsync({ id: statusId, body: b });
      if (!res.ok) {
        toast.error(
          res.reason === "own"
            ? t("status.ownStory")
            : t("status.gone")
        );
        return;
      }
      setText("");
      setPickerOpen(false);
      setOpen(false);
      toast.success(`Sent to ${ownerName}`);
    } catch {
      toast.error(t("status.replyFailed"));
    } finally {
      setSending(false);
    }
  }

  if (expired) {
    return (
      <div className="px-5 py-3 text-center text-xs text-white/50">
        This status has expired.
      </div>
    );
  }

  return (
    // select-text because the viewer root sets select-none, which would otherwise
    // make the input unusable. Width-capped and centred so the composer reads as a
    // composer on a desktop instead of a bar stretched across 1,200px — the story
    // itself is already letterboxed, so a full-width band would not match it.
    <div className="mx-auto w-full max-w-[440px] select-text px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-1">
      {pickerOpen && (
        <EmojiPicker
          tone="dark"
          maxHeight={200}
          className="mb-2"
          onPick={(e) => send(e)}
          onClose={() => {
            setPickerOpen(false);
            setOpen(false);
          }}
        />
      )}

      {/* One-tap reactions. A short row on purpose: this is the tap you make
          without thinking, and the full 1,100-glyph catalogue is one tap further
          in behind the ＋. */}
      <div className="mb-2 flex items-center justify-center gap-1">
        {REACTION_QUICK.map((e) => (
          <button
            key={e}
            type="button"
            disabled={sending}
            onClick={() => send(e)}
            aria-label={`React with ${e}`}
            className="grid size-10 place-items-center rounded-full text-2xl leading-none transition active:scale-90 hover:bg-white/15 disabled:opacity-40"
          >
            {e}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            const next = !pickerOpen;
            setPickerOpen(next);
            setOpen(next);
          }}
          aria-label={t("status.allEmoji")}
          aria-expanded={pickerOpen}
          className="grid size-10 place-items-center rounded-full border border-white/20 text-lg leading-none text-white/70 hover:bg-white/15"
        >
          <Smile className="size-5" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
          // dir="auto" so an Arabic reply lays out right-to-left as typed.
          dir="auto"
          maxLength={2000}
          placeholder={`Reply to ${ownerName}…`}
          aria-label={t("status.replyToStory")}
          className="h-11 min-w-0 flex-1 rounded-full border border-white/20 bg-white/10 px-4 text-sm text-white outline-none placeholder:text-white/40 focus:border-white/40"
        />
        <button
          type="button"
          disabled={!text.trim() || sending}
          onClick={() => void send(text)}
          aria-label={t("status.sendReply")}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-black transition disabled:opacity-30"
        >
          <Send className="size-4" />
        </button>
      </div>
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
  const t = useT();
  const q = trpc.status.viewers.useQuery({ id: statusId }, { staleTime: 5_000 });
  const viewers = q.data?.viewers ?? [];
  return (
    <div className="fixed inset-0 z-[105] flex items-end bg-black/50" onClick={onClose}>
      <div className="w-full rounded-t-3xl bg-card p-4 text-foreground max-h-[60vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
        <div className="mb-2 text-sm font-semibold">Seen by {viewers.length}</div>
        {viewers.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{t("status.noViews")}</div>
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
