import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAutoplay } from "@/app/useAutoplay";
import { Plus, X, Camera, Type, Trash2, Eye, ChevronDown, ChevronLeft, ChevronRight, Send, Video, Smile, Users, Pencil } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { uploadStatusMedia } from "@/lib/uploadAttachment";
import { videoRecorderSupported } from "@/lib/videoNote";
import { VideoRecordSheet } from "@/app/VideoRecordSheet";
import { ImageEditSheet } from "@/app/ImageEditSheet";
import { MediaEditSheet } from "@/app/MediaEditSheet";
import { AUDIENCE_OPTIONS, audienceOption } from "@/app/statusAudience";
import { EmojiPicker } from "@/app/EmojiPicker";
import { REACTION_QUICK } from "@/lib/emojiCatalog";
import { useT, useLocale, type TKey } from "@/app/i18n";
import { formatDateTimeIn } from "@/app/dateLocale";
import type { StatusAudience } from "@/app/statusAudience";

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

/**
 * Board 4b's five gradient swatches — the text story's background.
 *
 * ── THE 64-CHARACTER TRAP, WHICH IS WHY THESE ARE HEX AND NOT hsl() ────────────────
 * The board writes its own background as
 *   `linear-gradient(160deg,hsl(200 70% 30%),hsl(255 60% 32%) 60%,hsl(300 50% 28%))`
 * and that string is **78 characters**. `sanitizeStatusBg` (server/v2routers.ts) does
 * `v.trim().slice(0, 64)` BEFORE its allowlist regex runs, so the closing paren is cut,
 * the gradient no longer matches, and the function returns **null** — the story would
 * post with no background at all, silently, with nothing on either side saying why.
 * Pasting the frame verbatim does not work. Every entry here is therefore the board's
 * own colour converted to hex, which is both shorter and identical on screen, and the
 * test beside this file drives the REAL sanitizer over the REAL array so a future
 * addition cannot quietly cross that line again.
 *
 * ── ONE STRING PER OPTION, SO THE SWATCH CANNOT LIE ABOUT THE RESULT ───────────────
 * The board draws each swatch as a small 2-stop 135deg gradient while rendering the
 * SCREEN as a richer 3-stop 160deg one — a mock's shorthand for "this swatch is that
 * background". Shipping that literally would mean the dot you tap is a different
 * gradient from the story you get. There is exactly ONE value per option here, used
 * for the canvas and for the swatch alike, so the swatch is a true miniature.
 *
 * Entry 0 is the board's own screen gradient (the one frame 4b actually renders, third
 * stop included); 1–4 are its remaining swatch colours at the same 160deg. Nothing is
 * invented. Stories already posted keep whatever `bgColor` they stored, so changing
 * this list is not a migration.
 */
export const BG_OPTIONS = [
  "linear-gradient(160deg,#175e82,#392183 60%,#6b246b)",
  "linear-gradient(160deg,#24a866,#1f96ad)",
  "linear-gradient(160deg,#e64d19,#c32273)",
  "linear-gradient(160deg,#ecb613,#cf5417)",
  "#0c1114",
];

const DEFAULT_ITEM_MS = 5000; // text/image dwell time

/**
 * Board 4b's four composer tabs — Text · Photo · Video · Audio.
 *
 * The ids are the SERVER'S OWN status kinds ("image", not "photo"), so `mediaKindOf`
 * lands on a tab directly and there is no id→kind translation table to get wrong. Only
 * the visible LABEL says "Photo", which is the board's word and the one people use.
 *
 * `accept` is per tab rather than one shared `image/*,video/*,audio/*` input: the board
 * asks for three separate media tabs, and a tab that opens a picker showing everything
 * is three tabs pretending to be different. It is a HINT, never a guarantee — `pickFile`
 * re-derives the real kind from the file it is handed.
 *
 * ── THE LABELS ARE KEYS, NOT WORDS ────────────────────────────────────────────────
 * This constant is module-level and cannot call a hook, so it carries the KEY and the
 * render site translates — the `labelKey` pattern `PROFILE_STATUS_META` and
 * `CATEGORY_META` already use. The keys are `status.tab*` and are the tabs' OWN, which
 * is the point: the near-miss `profile.photo` is "الصورة" WITH the definite article
 * because it labels a row in Profile, and borrowing it would tie a tab here to a row
 * there — one key with two meanings, the trap this codebase keeps removing.
 */
type ComposerTab = "text" | "image" | "video" | "audio";

const MEDIA_TABS: readonly {
  tab: Exclude<ComposerTab, "text">;
  labelKey: TKey;
  accept: string;
}[] = [
  { tab: "image", labelKey: "status.tabPhoto", accept: "image/*" },
  { tab: "video", labelKey: "status.tabVideo", accept: "video/*" },
  { tab: "audio", labelKey: "status.tabAudio", accept: "audio/*" },
];

/** The accept filter for a tab; the text tab has no picker, so it falls back to all. */
function acceptForTab(tab: ComposerTab): string {
  return MEDIA_TABS.find((m) => m.tab === tab)?.accept ?? "image/*,video/*,audio/*";
}

/**
 * Board 4b's tab pill, and its chips further down, are WHITE ON A DARK SCRIM rather
 * than the app's `.rchip-accent`.
 *
 * That is a contrast decision, not a style one. `.rchip-accent` colours its label with
 * the cycling accent and is measured against the app's own `--card`; these float on an
 * author-chosen gradient which may be the yellow/orange entry, where accent-on-gradient
 * is unreadable. A dark scrim under white text is legible over all five by construction,
 * and it is what the frame itself draws.
 */
function TabPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      /* `min-h-11` = 44px. The frame draws these pills at ~26px tall, which is under the
         board's own rule 9 (>=44px hit targets on a 390x812 phone) — the drawn height is
         a look, not a target, so the pill keeps the frame's 11px type and gains the
         height it needs to be tappable. Caught by this file's own rule-9 sweep, which
         measured the frame-faithful version at 34.5px. */
      className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-3.5 py-2 text-[11px] transition-colors ${
        active
          ? "border-white/55 bg-black/40 font-bold text-white"
          : "border-white/25 bg-black/25 font-semibold text-white/75 hover:bg-black/40"
      }`}
    >
      {label}
    </button>
  );
}

/** The frame's bottom-bar chip: an icon, a word, and a caret that reflects open state. */
function GlassChip({
  onClick,
  expanded,
  label,
  children,
}: {
  onClick: () => void;
  expanded: boolean;
  /** Names the control for a screen reader; the visible text is the current VALUE. */
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={label}
      className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-1.5 rounded-full border border-white/30 bg-black/35 px-3 py-2 text-[11px] font-semibold text-white backdrop-blur-md"
    >
      {children}
      <ChevronDown
        className={`size-3.5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
        aria-hidden="true"
      />
    </button>
  );
}

/**
 * The audience options' words, keyed on the option's own VALUE.
 *
 * `statusAudience.ts` is the one place these options live and its header records why:
 * two surfaces render them, and nothing FAILS when two screens promise different things
 * about one setting. It is a plain module-level constant, so it cannot call a hook — the
 * same constraint `CATEGORY_META` and `PROFILE_STATUS_META` are under, and the same
 * answer: it carries the English, the KEY is named here, and the render site translates.
 *
 * Keyed on the value rather than looked up by the English text, because a text lookup
 * silently drops the translation the moment somebody edits a word.
 */
const AUDIENCE_KEYS: Record<
  StatusAudience,
  { label: TKey; hint: TKey; posted: TKey }
> = {
  contacts: {
    label: "status.audContacts",
    hint: "status.audContactsHint",
    posted: "status.postedContacts",
  },
  everyone: {
    label: "status.audEveryone",
    hint: "status.audEveryoneHint",
    posted: "status.postedEveryone",
  },
};

/**
 * Fail closed on the way in, exactly as `audienceOption` does: anything that is not the
 * literal "everyone" resolves to the PRIVATE option. A value we do not recognise must
 * never be labelled as the wider one.
 */
function audienceKeys(v: string | null | undefined) {
  return v === "everyone" ? AUDIENCE_KEYS.everyone : AUDIENCE_KEYS.contacts;
}

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
            <StatusAvatar name={t("status.you")} url={myGroup?.subject.avatarUrl ?? null} ring={myGroup ? "seen" : "none"} />
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
          <span className="text-xs text-muted-foreground/80 ps-1">
            {t("status.emptyStrip")}
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
  /* `tn` keeps the group's name INSIDE the sentence for the audience note below. */
  const { tn } = useLocale();
  /* Resolved OUT HERE rather than inside the memo below. The group list maps over
     threads, and naming that loop variable `t` would shadow the translator — the exact
     collision `dict/messages.ts` records for the swipe-action builder. The loop variable
     is renamed there too, because removing a shadow beats aliasing around it. */
  const groupFallback = t("status.groupFallback");
  /* Hoisted out of the swatch's own `aria-label`. Partly because five identical `t()`
     calls in a map is waste, but mainly because writing the key INSIDE a template
     literal attribute puts the string `status.` into an `aria-label=` in the source,
     and `storyVsStatus.test.ts` reads visible-string attributes straight out of the
     file — so the key's own prefix reads to that sweep as a story being called a
     status. Resolving the word first keeps the attribute free of key names. */
  const colorLabel = t("status.color");
  /**
   * Board 4b's four tabs. `mode` is DERIVED from the tab rather than being a second
   * piece of state: they answer one question ("is this a text story or a media one"),
   * and two independent flags is how a screen comes to show the text canvas while
   * `submit()` posts a photo. Every existing `mode === "text"` reader is untouched.
   */
  const [tab, setTab] = useState<ComposerTab>("text");
  const mode: "text" | "media" = tab === "text" ? "text" : "media";
  /**
   * Which bottom-bar chip has its panel open — at most ONE, which is why this is a
   * single value rather than a boolean each. Two independent flags would let the
   * audience and group panels stack and push the Post pill off the bottom, and that
   * bar is the whole point of the column layout.
   */
  const [panel, setPanel] = useState<"audience" | "group" | null>(null);
  const [text, setText] = useState("");
  const [caption, setCaption] = useState("");
  const [bgIndex, setBgIndex] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  /* STORY MEDIA GOES THROUGH THE EDITORS NOW (v2.107.39). The chat composer has
     had crop/rotate/draw (photos) and draw-on-video since v2.107.2x; a story is
     MORE public than a message, so it deserves the same pass, not less. This
     holds the file while its editor is open; Cancel posts the ORIGINAL byte for
     byte (the editors' own contract), so the old pick→post flow is still one
     tap away. Camera recordings route through here too — you can draw on a
     just-recorded story clip. */
  const [editing, setEditing] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  // In-app recorder (v2.96.2) — iOS blocks the SYSTEM camera's video
  // recording while on a call; this records in-page instead.
  const [recOpen, setRecOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** The frame's pencil tool puts the caret back in the canvas, not just the tab. */
  const textRef = useRef<HTMLTextAreaElement>(null);
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
        .filter((th) => th.kind === "group")
        .map((th) => ({
          id: th.conversationId,
          title: th.title || groupFallback,
          avatarUrl: th.groupAvatarUrl ?? null,
        })),
    [threads.data, groupFallback],
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

  /**
   * Open the one file input, narrowed to what this tab is for.
   *
   * The `accept` attribute is set IMPERATIVELY rather than from React state because the
   * click has to happen in the SAME user gesture: setting state and clicking on the next
   * render loses the gesture, and a file dialog opened outside one is refused by every
   * browser — a picker that silently never appears.
   *
   * It is RESTORED to the full set afterwards so the element's declared attribute is
   * never left narrowed for whoever opens it next.
   */
  function openPicker(accept: string) {
    const el = fileRef.current;
    if (!el) return;
    el.accept = accept;
    /* Clearing the value first is what makes re-picking THE SAME file fire `change`
       again — without it a second attempt at the same photo does nothing at all. */
    el.value = "";
    el.click();
    el.accept = "image/*,video/*,audio/*";
  }

  function pickFile(f: File | null) {
    if (!f) return;
    const k = mediaKindOf(f);
    if (k === "image" || k === "video") {
      // The editor hands the file over via onUse/onClose; audio has no editor.
      setEditing(f);
    } else {
      setFile(f);
    }
    /* Land on the tab that matches WHAT WAS ACTUALLY PICKED, not the one that was
       open. The accept filters are a hint to the OS picker, not a guarantee — a file
       manager will happily hand a .mp4 to an `image/*` input — so trusting the open
       tab would label a video as a photo on the one screen that says which it is. */
    setTab(mediaKindOf(f) ?? "image");
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
      /* ONE WHOLE SENTENCE PER OUTCOME, never a stem plus an interpolated tail. The
         second arm used to be `Status posted — ${option.posted}.` — a sentence
         assembled from a fragment, which cannot be translated at all: Arabic does not
         put that qualifier where English does, so the two halves can only be glued back
         into nonsense. (It also said STATUS about a STORY, which is the v2.101.0
         vocabulary bug; both English halves are corrected in the dictionary.) */
      toast.success(
        targetGroup
          ? t("status.postedGroup", { group: targetGroup.title })
          : t(audienceKeys(effectiveAudience).posted),
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
      {/* BOARD 4b'S CANVAS.
          A COLUMN, not a scrolling block: the frame puts the swatches and the
          audience/Post row at the BOTTOM, and in a plain scroller they slide away as
          the text grows — v2.106.86 is the same defect on the new-group sheet, where
          the primary action left the screen entirely. Only the body scrolls; the
          chrome is `shrink-0` either side of it.
          `max-h-[92dvh]` is kept because it is the app's own bound for an overlay
          sheet (GroupCallScreen 92dvh, AvatarPicker 88dvh) and the frame is drawn on a
          390×812 phone, which this matches within a few px on a real handset. */}
      <div className="relative flex h-[min(812px,92dvh)] w-[min(96vw,440px)] max-h-[92dvh] flex-col overflow-hidden rounded-3xl border border-border/60 bg-card shadow-2xl">
        {/* The picked gradient is the SURFACE, full-bleed behind every tab — that is
            what makes this read as a story rather than a form with a preview in it. */}
        <div className="absolute inset-0" style={{ background: BG_OPTIONS[bgIndex] }} aria-hidden="true" />
        {/* Media tabs dim it so the photo/video is the subject and the chrome stays
            legible over whichever gradient was picked. */}
        {mode !== "text" && <div className="absolute inset-0 bg-black/45" aria-hidden="true" />}

        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* ── header: close · title · tools ─────────────────────────────── */}
          <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-4 pb-2">
            <button
              type="button"
              onClick={onClose}
              aria-label={t("status.close")}
              className="grid size-11 shrink-0 place-items-center rounded-full text-white/90 hover:bg-white/15"
            >
              <X className="size-5" />
            </button>
            <h2 className="truncate text-sm font-bold text-white">{t("status.newStory")}</h2>
            <div className="flex shrink-0 items-center gap-1">
              {/* The frame's two tools. The pencil returns to the text canvas and puts
                  the caret back in it; the camera is the IN-APP recorder (v2.96.2),
                  which is the honest home for a camera glyph here — iOS blocks the
                  system camera during a call, which is why that recorder exists. It
                  stays gated on support: an unsupported browser must not show a dead
                  control. */}
              <button
                type="button"
                onClick={() => { setTab("text"); textRef.current?.focus(); }}
                aria-label={t("status.text")}
                className="grid size-11 place-items-center rounded-full text-white/90 hover:bg-white/15"
              >
                <Type className="size-[18px]" />
              </button>
              {videoRecorderSupported() && (
                <button
                  type="button"
                  onClick={() => setRecOpen(true)}
                  aria-label={t("status.record")}
                  className="grid size-11 place-items-center rounded-full text-white/90 hover:bg-white/15"
                >
                  <Camera className="size-[18px]" />
                </button>
              )}
            </div>
          </div>

          {/* ── the frame's four tabs ─────────────────────────────────────── */}
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-1.5 px-3 pb-1">
            <TabPill active={tab === "text"} onClick={() => setTab("text")} label={t("status.text")} />
            {MEDIA_TABS.map((m) => (
              <TabPill
                key={m.tab}
                active={tab === m.tab}
                label={t(m.labelKey)}
                onClick={() => {
                  setTab(m.tab);
                  /* Open the picker when this tab has nothing to show — either no file
                     at all, or one of a DIFFERENT kind, because asking for Video while
                     holding a photo is a request for a video. Tapping the tab that
                     already matches the loaded file is a way BACK to it, so that case
                     deliberately does NOT re-open the picker.
                     Whatever happens here, `submit()` sends `mediaKindOf(file)` — the
                     kind is read off the FILE, never off the tab, so the post cannot be
                     mislabelled even if a cancelled picker leaves the tab ahead of the
                     preview for a moment. */
                  if (!file || mediaKindOf(file) !== m.tab) openPicker(m.accept);
                }}
              />
            ))}
          </div>

          {/* ── body ──────────────────────────────────────────────────────── */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-3">
            {mode === "text" ? (
              <div className="grid flex-1 place-items-center">
                {/* 26px centred, per the frame. The caret is the textarea's OWN —
                    the frame draws a blinking `|` because a static mock has no real
                    one, so rendering a decorative pipe here would put TWO carets on
                    screen. `caret-white` is what makes the real one visible on the
                    gradient. */}
                <textarea
                  ref={textRef}
                  value={text}
                  onChange={(e) => setText(e.target.value.slice(0, 700))}
                  autoFocus
                  placeholder={t("status.typeStory")}
                  rows={3}
                  dir="auto"
                  className="w-full resize-none bg-transparent text-center text-[26px] font-bold leading-[1.4] text-white caret-white outline-none placeholder:text-white/60 [text-shadow:0_2px_24px_rgba(0,0,0,.35)]"
                />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col justify-center gap-3">
                {previewUrl && file ? (
                  <div className="relative">
                    <MediaPreview file={file} url={previewUrl} />
                    {/* Re-open the editor on what's already staged (v2.107.39) —
                        same affordance as the chat composer's strip. Hidden for
                        audio, which has no editor. */}
                    {mediaKindOf(file) !== "audio" && (
                      <button
                        type="button"
                        onClick={() => setEditing(file)}
                        aria-label={t("status.editMedia")}
                        className="absolute end-2 top-2 z-10 flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur-sm"
                      >
                        <Pencil className="size-3" /> {t("status.editMedia")}
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => openPicker(acceptForTab(tab))}
                    className="grid min-h-[180px] w-full place-items-center rounded-2xl border-2 border-dashed border-white/35 px-4 text-center text-sm text-white/80"
                  >
                    {t("status.chooseMedia")}
                  </button>
                )}
                {file && (
                  <input
                    value={caption}
                    onChange={(e) => setCaption(e.target.value.slice(0, 700))}
                    placeholder={t("status.caption")}
                    dir="auto"
                    className="w-full rounded-full border border-white/25 bg-black/35 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/50 focus:border-white/45"
                  />
                )}
              </div>
            )}
          </div>

          {/* ONE input, retargeted per tab. A separate element per accept filter is
              three refs to keep in step for no gain. */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*,audio/*"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />

          {/* ── the frame's 5 gradient swatches ───────────────────────────── */}
          {mode === "text" && (
            <div className="flex shrink-0 items-center justify-center gap-2.5 px-3 py-2">
              {BG_OPTIONS.map((bg, i) => (
                <button
                  key={bg}
                  type="button"
                  onClick={() => setBgIndex(i)}
                  aria-pressed={i === bgIndex}
                  aria-label={`${colorLabel} ${i + 1}`}
                  /* 26px is the frame's own dot, but the TAP TARGET is 44px (rule 9)
                     via padding, so the ring stays the drawn size while the button
                     stays reachable with a thumb. */
                  className="grid size-11 shrink-0 place-items-center rounded-full"
                >
                  <span
                    className={`block size-[26px] rounded-full border border-white/40 ${
                      i === bgIndex ? "ring-[2.5px] ring-white" : ""
                    }`}
                    style={{ background: bg }}
                  />
                </button>
              ))}
            </div>
          )}

          {/* ── expandable pickers, above the bar the chips live in ───────── */}
          {/* WHERE IT GOES (v2.105.6, #110) — my own ring, or one of my groups.
              Rendered only when I am actually in a group: a picker with one option
              is a control that cannot do anything, and every existing user with no
              groups sees exactly the composer they saw before. */}
          {myGroups.length > 0 && panel === "group" && (
            <div className="shrink-0 px-3 pb-1">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/70">
                {t("status.postTo")}
              </p>
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
                <button
                  type="button"
                  onClick={() => { setTargetGroupId(null); setPanel(null); }}
                  aria-pressed={targetGroupId == null}
                  className={`shrink-0 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                    targetGroupId == null
                      ? "border-white bg-white/20 text-white"
                      : "border-white/30 bg-black/30 text-white/80 hover:bg-black/45"
                  }`}
                >
                  {/* The SAME key the strip's own tile uses: one fact, one word. */}
                  {t("status.myStory")}
                </button>
                {myGroups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => { setTargetGroupId(g.id); setPanel(null); }}
                    aria-pressed={targetGroupId === g.id}
                    className={`inline-flex max-w-[11rem] shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                      targetGroupId === g.id
                        ? "border-white bg-white/20 text-white"
                        : "border-white/30 bg-black/30 text-white/80 hover:bg-black/45"
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
            panel === "audience" && (
              <div className="shrink-0 px-3 pb-1">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/70">
                  {t("status.whoCanSee")}
                </p>
                <div className="flex gap-1.5">
                  {AUDIENCE_OPTIONS.map((opt) => {
                    const active = effectiveAudience === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => { setAudience(opt.value); setPanel(null); }}
                        aria-pressed={active}
                        className={`min-w-0 flex-1 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                          active
                            ? "border-white bg-white/20 text-white"
                            : "border-white/30 bg-black/30 text-white/80 hover:bg-black/45"
                        }`}
                      >
                        <span className="flex items-center gap-1.5 text-sm font-semibold">
                          <opt.Icon className="size-3.5 shrink-0" />
                          <span className="truncate">{t(AUDIENCE_KEYS[opt.value].label)}</span>
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-snug opacity-80">
                          {t(AUDIENCE_KEYS[opt.value].hint)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )
          ) : (
            <div className="shrink-0 px-3 pb-1">
              {/* `tn`, not `t` + string surgery: the group's name is BOLD in the middle of
                  the sentence, and Arabic does not put it between the same two fragments —
                  a sentence chopped at the English seam can only be re-assembled into
                  nonsense, which is the whole reason `translateNodes` exists. */}
              <p className="rounded-xl border border-white/25 bg-black/40 px-3 py-2 text-[11px] leading-snug text-white/85">
                {tn("status.groupAudienceNote", {
                  group: <span className="font-semibold">{targetGroup?.title}</span>,
                })}
              </p>
            </div>
          )}

          {/* ── the frame's bottom bar: chips · accent Post pill ──────────── */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-4 pt-1">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {/* AUDIENCE CHIP — the frame's "My contacts · 24h ▾".
                  WHITE ON A DARK SCRIM, deliberately NOT `.rchip-accent`: that recipe is
                  measured against the app's `--card`, and this chip floats on an
                  author-chosen gradient that can be the yellow one, where accent text
                  is unreadable. A scrim is legible over any of the five by
                  construction, which is what the frame itself draws. */}
              {audiencePickerApplies && (
                <GlassChip
                  onClick={() => setPanel((p) => (p === "audience" ? null : "audience"))}
                  expanded={panel === "audience"}
                  label={t("status.whoCanSee")}
                >
                  {(() => {
                    const A = audienceOption(effectiveAudience).Icon;
                    return <A className="size-3.5 shrink-0" aria-hidden="true" />;
                  })()}
                  <span className="truncate">
                    {t(AUDIENCE_KEYS[effectiveAudience].label)}
                    {" · "}
                    {/* The story's real life, matching the server's STATUS_TTL_MS. */}
                    <span dir="ltr">24h</span>
                  </span>
                </GlassChip>
              )}
              {myGroups.length > 0 && (
                <GlassChip
                  onClick={() => setPanel((p) => (p === "group" ? null : "group"))}
                  expanded={panel === "group"}
                  label={t("status.postTo")}
                >
                  <Users className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{targetGroup ? targetGroup.title : t("status.myStory")}</span>
                </GlassChip>
              )}
            </div>

            {/* THE ACCENT PILL. `.rcta` IS the frame's own recipe — solid `var(--rb)`
                with `#04211a` on-accent text and the same 10/30 accent shadow — so
                this reads the cycling hue instead of freezing one. */}
            <Button
              type="button"
              onClick={submit}
              disabled={posting || (mode === "text" ? !text.trim() : !file)}
              className="rcta h-11 shrink-0 gap-2 rounded-full px-5 text-sm font-bold hover:opacity-90 disabled:opacity-40"
            >
              {posting ? t("status.posting") : (<>{t("status.shareStory")} <Send className="size-4" /></>)}
            </Button>
          </div>
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
      {/* The same editors the chat composer uses, above this dialog by their own
          z-[130] portals. Cancel = the original, untouched — the editors' contract. */}
      {editing && mediaKindOf(editing) === "image" && (
        <ImageEditSheet
          file={editing}
          onClose={() => { setFile(editing); setEditing(null); }}
          onUse={(f) => { setFile(f); setEditing(null); }}
        />
      )}
      {editing && mediaKindOf(editing) === "video" && (
        <MediaEditSheet
          file={editing}
          onClose={() => { setFile(editing); setEditing(null); }}
          onUse={(f) => { setFile(f); setEditing(null); }}
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
  /* PREV/NEXT MIRROR, and the GLYPH has to mirror with the position or the arrow points
     the wrong way at the side it sits on. In Arabic "next" is to the LEFT — a reel is
     read in the page's own direction, so a fixed ChevronRight-on-the-right would send
     somebody backwards through a story every time they meant to go on. */
  const { rtl, locale } = useLocale();
  const PrevIcon = rtl ? ChevronRight : ChevronLeft;
  const NextIcon = rtl ? ChevronLeft : ChevronRight;
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

  /* PORTALLED TO document.body (v2.107.2, owner: *"my own status if I click on it, if
     you see the top bar doesn't show because it's over lap on the top navigation bar,
     so make it low"*).

     A STACKING CONTEXT TRAPS `z-index`, and this element's `z-[100]` was never
     competing with the app shell at all. AppShell wraps `{children}` in `relative z-10`
     — a deliberate correctness rule, because `RelayBackground`'s canvas is
     `fixed; z-index: 0` and would otherwise paint over unpositioned page content — and
     `position` plus a non-auto `z-index` CREATES a stacking context. So this viewer's
     100 is resolved INSIDE that wrapper, and against the wrapper's own siblings it is
     the wrapper's 10 that competes: it loses to the top bar and the tab bar, both
     `z-30`. The viewer's progress bars and header rendered UNDERNEATH the navigation,
     which is exactly what the owner circled.

     Raising the number cannot fix that; only leaving the context can. The COMPOSER in
     this same file was portalled for the same class of reason in v2.99.49 and this one
     was not — the fixed-in-one-of-N-places pattern this repo keeps paying for. */
  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-black text-white select-none">
      {/* Progress bars, clear of the notch / status bar. `max(12px, …)` so a device
          with no inset keeps exactly the 12px this had before. */}
      <div
        className="flex gap-1 px-3"
        style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}
      >
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
          <div className="truncate text-[11px] text-white/60" title={formatDateTimeIn(locale, item.createdAt)}>
            {/* Board 2c draws "2 of 3 · 18m ago". The progress bars already encode the
                position, but reading it off them means counting hairlines — the
                number answers "how much of this reel is left" directly, which is the
                question somebody holding a finger on the screen actually has.
                WITHHELD FOR A SINGLE-SLIDE REEL: "1 of 1" is noise, and the bar above
                already says there is only one. */}
            {group.items.length > 1 && (
              /* ONE key with both numbers inside it — "{index} of {total}" — rather than
                 two JSX fragments around a bare "of", which is a sentence glued at the
                 English seam. `dir="ltr"` keeps the two Western digits in order whatever
                 the page direction is (v2.106.84). */
              <span className="font-mono" dir="ltr">
                {t("status.slideOf", { index: ii + 1, total: group.items.length })}
                {" · "}
              </span>
            )}
            {group.subject.kind === "group" && item.author
              ? `${item.mine ? t("status.you") : item.author.displayName} · ${timeAgoText(item.createdAt, t)}`
              : timeAgoText(item.createdAt, t)}
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
        <button type="button" aria-label={t("status.previous")} onClick={() => { if (replyOpen) { setReplyOpen(false); return; } if (Date.now() - pressStartRef.current < HOLD_MS) prev(); }} className="absolute inset-y-0 start-0 w-1/3" />
        <button type="button" aria-label={t("status.next")} onClick={() => { if (replyOpen) { setReplyOpen(false); return; } if (Date.now() - pressStartRef.current < HOLD_MS) next(); }} className="absolute inset-y-0 end-0 w-1/3" />
        {/* desktop chevrons — these bypass the HOLD check, so they need the same
            reply guard or a stray click would advance mid-compose. */}
        <button type="button" onClick={() => { if (replyOpen) { setReplyOpen(false); return; } prev(); }} className="absolute start-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 md:block"><PrevIcon className="size-5" /></button>
        <button type="button" onClick={() => { if (replyOpen) { setReplyOpen(false); return; } next(); }} className="absolute end-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 md:block"><NextIcon className="size-5" /></button>
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
            <Eye className="size-4" /> {t("status.viewers")}
          </button>
          {/* Which audience THIS post went to (v2.99.55). The per-post value is
              frozen at insert, so this is the truth for this story even if the
              default has changed since — which is exactly why it's worth showing. */}
          {item.audience && (
            <span
              className="inline-flex min-w-0 items-center gap-1 text-xs text-white/60"
              title={t(audienceKeys(item.audience).hint)}
            >
              {(() => {
                const O = audienceOption(item.audience).Icon;
                return <O className="size-3.5 shrink-0" />;
              })()}
              <span className="truncate">{t(audienceKeys(item.audience).label)}</span>
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
                toast.error(t("status.deleteUnreachable"));
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
                toast.error(t("status.deleteGone"));
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
            <Trash2 className="size-4" /> {remove.isPending ? t("status.deleting") : t("status.delete")}
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
            {t("status.youAreAdmin")}
          </span>
          <button
            type="button"
            disabled={removeAsAdmin.isPending}
            onClick={async () => {
              // Confirmed, because it removes something SOMEBODY ELSE posted and
              // cannot be undone — the copy says whose and where, since "delete
              // this?" does not distinguish it from the author's own Delete.
              const who = item.author?.displayName || t("status.thisMember");
              if (
                !window.confirm(
                  t("status.confirmRemove", {
                    who,
                    group: group?.subject.displayName ?? t("status.thisGroup"),
                  }),
                )
              ) {
                return;
              }
              try {
                await removeAsAdmin.mutateAsync({ id: item.id });
              } catch {
                // The server answers one message for "gone", "personal story" and
                // "not an admin here", so there is nothing more specific to say.
                toast.error(t("status.removeGone"));
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
            {removeAsAdmin.isPending ? t("status.removing") : t("status.removeAsAdmin")}
          </button>
        </div>
      )}

      {showViewers && item && (
        <ViewersSheet statusId={item.id} onClose={() => { setShowViewers(false); setPaused(false); }} />
      )}
    </div>,
    document.body,
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
      toast.success(t("status.sentTo", { name: ownerName }));
    } catch {
      toast.error(t("status.replyFailed"));
    } finally {
      setSending(false);
    }
  }

  if (expired) {
    return (
      <div className="px-5 py-3 text-center text-xs text-white/50">
        {/* STORY, not "status": this is the ephemeral post expiring, and calling it a
            status here is the v2.101.0 vocabulary bug the owner corrected three times. */}
        {t("status.expired")}
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
            aria-label={t("status.reactWith", { emoji: e })}
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
          placeholder={t("status.replyTo", { name: ownerName })}
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
  /* Attribute autoplay was crash_reports #5 (closing a status mid-start) — the
     hook owns the start and pauses before unmount. Two refs because a hook's
     call order is fixed; whichever element this item doesn't render stays null
     and its hook no-ops. */
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useAutoplay(videoRef, item.mediaUrl);
  useAutoplay(audioRef, item.mediaUrl);
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
    return <div className="grid size-full place-items-center"><video ref={videoRef} src={item.mediaUrl ?? ""} playsInline controls={false} className="max-h-full max-w-full" /></div>;
  }
  if (item.kind === "audio") {
    return (
      <div className="grid size-full place-items-center gap-4 p-8">
        <div className="grid size-24 place-items-center rounded-full bg-white/10 text-4xl">🎵</div>
        <audio ref={audioRef} src={item.mediaUrl ?? ""} controls className="w-[min(90vw,420px)]" />
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
        <div className="mb-2 text-sm font-semibold">{t("status.seenBy", { count: viewers.length })}</div>
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

/**
 * Which relative-time wording an age needs — the BAND, as a pure function.
 *
 * A SELECTOR RETURNING A WHOLE KEY, not a stem plus a unit: `${n} + "m ago"` is a
 * sentence assembled from a fragment, and the one thing that makes it translatable is
 * that each band is its own complete string. That is `guestExpiryKey`'s rule, and it is
 * also what keeps "just now" reading as an expression rather than as "0 minutes".
 *
 * Exported as a test seam, because which band a duration selects is exactly the thing a
 * source pin cannot answer.
 */
export function timeAgoKey(
  iso: string | Date,
  now = Date.now(),
): { key: TKey; count: number } {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return { key: "status.justNow", count: 0 };
  if (diff < 3600) return { key: "status.minutesAgo", count: Math.floor(diff / 60) };
  if (diff < 86400) return { key: "status.hoursAgo", count: Math.floor(diff / 3600) };
  return { key: "status.daysAgo", count: Math.floor(diff / 86400) };
}

/** The band, rendered. Takes the translator rather than calling a hook: this is reached
 *  from inside a `.map`, and a module-level function cannot use one anyway. */
function timeAgoText(iso: string | Date, t: (k: TKey, v?: Record<string, string | number>) => string): string {
  const { key, count } = timeAgoKey(iso);
  return t(key, { count });
}
