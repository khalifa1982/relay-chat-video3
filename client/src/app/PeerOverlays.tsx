import { useEffect, useMemo, useState } from "react";
import {
  CONTACT_TAGS,
  TAG_COLOR,
  contactTagsOf,
  toggleContactTag,
  type ContactTag,
} from "@shared/contactTags";
import { useLocation } from "wouter";
import { Phone, Video, MessageSquare, UserPlus, Check, CircleUserRound, ArrowLeft, X, Search, Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { personReelKeyByNumber } from "@shared/reelKey";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useRelayEngine } from "./RelayEngine";
import { useIdentity } from "./useIdentity";
import { RoleBadge, roleFromFlags } from "./VerifiedBadge";
import { StatusViewer, type FeedGroup } from "@/pages/app/Status";
import { profileStatusMeta, type ProfileStatus } from "@shared/profileStatus";
import { presenceLabel } from "./presenceCopy";
import { useT, useLocale, type TKey } from "./i18n";

/**
 * Peer identity surfaces (v2.96, owner spec):
 *
 * - <PeerAvatar/> — THE avatar element used across the app (thread rows, chat
 *   header, contacts, history). Renders the peer's photo (falls back to
 *   initials), and wraps it in a STATUS RING when that peer has an active
 *   status: bright gradient = unseen, subtle = already seen. Clicking an
 *   avatar with an active status opens the status viewer from ANYWHERE;
 *   otherwise it opens the peer profile popup.
 * - openPeerStatus(number) / openPeerProfile(number) — imperative openers any
 *   screen can call (also used for "clicking a name opens the profile").
 * - <PeerOverlaysHost/> — mounted once in the AppShell; hosts the global
 *   status viewer + the peer profile dialog (avatar, name, presence, and
 *   one-tap Message / Voice / Video / Add-to-contacts actions).
 */

// NOTE: "relay:open-status" is also dispatched as a raw literal from
// useRealtime.ts (the status toast's View action) to keep that hook
// dependency-light for Node tests — keep the names in sync.
const OPEN_STATUS = "relay:open-status";
const OPEN_PROFILE = "relay:open-profile";
/** A GROUP's story reel, addressed by conversation id (v2.105.6). */
const OPEN_GROUP_STATUS = "relay:open-group-status";

export function openPeerStatus(number: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_STATUS, { detail: { number } }));
}

/**
 * Open a GROUP's story reel (v2.105.6, #110).
 *
 * A SEPARATE opener from `openPeerStatus`, addressed by conversation id rather
 * than by number, because a group's 6-digit id and a person's live in the same
 * space (v2.102.0 mints them from one allocator) — so a single number-addressed
 * opener could not tell which of the two a caller meant, and would eventually open
 * the wrong reel. There is also no `forNumber` fallback here on purpose: a group
 * story is authorized by MEMBERSHIP, so if it is absent from my feed I am not in
 * the group and there is nothing to pull.
 */
export function openGroupStatus(conversationId: number): void {
  window.dispatchEvent(new CustomEvent(OPEN_GROUP_STATUS, { detail: { conversationId } }));
}

/**
 * Conversation-scoped extras a caller can hang off the profile popup
 * (v2.99.66, owner: "for the search and for the notification, make it inside the
 * profile of the person when you click on his name").
 *
 * The chat header used to carry a bell and a magnifier as permanent icons, which
 * on a phone left the name truncated and the "last seen" line with nothing after
 * it — no room. Both actions belong to ONE conversation, so they live where that
 * conversation's peer lives instead of taxing the header on every screen.
 *
 * Only Messages passes these; Contacts / History / the dialer open the same
 * popup with none, and it renders exactly as before.
 */
export interface PeerProfileChatActions {
  /** Open the in-conversation message search. */
  onSearch?: () => void;
  muted?: boolean;
  onToggleMute?: () => void;
  /** Full "last seen …" line with the clock, which the header had no room for. */
  lastSeenText?: string | null;
}

export function openPeerProfile(number: string, chat?: PeerProfileChatActions): void {
  window.dispatchEvent(new CustomEvent(OPEN_PROFILE, { detail: { number, chat } }));
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/**
 * The four label chips reuse `contacts.tag.*` RATHER THAN minting `peer.tag.*`.
 *
 * `dict/contacts.ts` records why in its own header: "Family" the section heading and
 * "Family" the chip are the SAME fact and must never be able to disagree about their
 * Arabic. A parallel key would hold that only until somebody edited one of the two.
 *
 * A module-level constant cannot call a hook, so it carries the KEY and the render site
 * translates — the `CATEGORY_META` pattern from Contacts.
 */
const TAG_LABEL_KEY: Record<ContactTag, TKey> = {
  vip: "contacts.tag.vip",
  family: "contacts.tag.family",
  friend: "contacts.tag.friend",
  team: "contacts.tag.team",
};

/**
 * The PROFILE STATUS label — the other meaning of the word (v2.101.1: a STATUS is the
 * profile label, a STORY is the ephemeral post).
 *
 * `PROFILE_STATUS_META.label` is finished English from a shared module, so it is keyed
 * here on the status's own key rather than looked up by its text: a `text → key` lookup
 * would silently drop the translation the moment the English was edited, which is exactly
 * what this dictionary's keying rule exists to prevent.
 */
const PROFILE_STATUS_LABEL_KEY: Record<ProfileStatus, TKey> = {
  work: "peer.profileStatus.work",
  vacation: "peer.profileStatus.vacation",
  travel: "peer.profileStatus.travel",
  free: "peer.profileStatus.free",
  busy: "peer.profileStatus.busy",
};

/**
 * Which countdown wording a day count needs.
 *
 * ENGLISH NEEDS TWO FORMS AND ARABIC NEEDS FOUR, which is the whole reason this is a
 * function rather than a ternary at the render site: 1 is singular, 2 is the DUAL
 * («يومين»), 3–10 take the plural of paucity («أيام») and 11+ take the singular
 * accusative («يومًا»). Rendering "3 يومًا" is wrong in a way every Arabic reader sees.
 *
 * Exported as a test seam: which form a count selects is exactly the thing a source pin
 * cannot answer.
 */
export function guestExpiryKey(daysLeft: number): TKey {
  if (daysLeft <= 0) return "peer.guestExpiresToday";
  if (daysLeft === 1) return "peer.guestExpiresInDay";
  if (daysLeft === 2) return "peer.guestExpiresInTwoDays";
  return daysLeft <= 10 ? "peer.guestExpiresInDaysFew" : "peer.guestExpiresInDaysMany";
}

/** Per-number status presence, derived from the shared status feed cache. */
export function usePeerStatusMap(): Map<string, { hasUnseen: boolean; hasAny: boolean }> {
  const feed = trpc.status.feed.useQuery(undefined, {
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });
  return useMemo(() => {
    const map = new Map<string, { hasUnseen: boolean; hasAny: boolean }>();
    for (const g of feed.data?.groups ?? []) {
      // PERSON reels only. A group reel's number is the GROUP's own 6-digit id
      // (v2.102.0), and this map is keyed by number for PeerAvatar — feeding a
      // group in would draw a group's story ring on any person who happened to
      // hold that number. The group ring is drawn from the thread row, which
      // knows it is looking at a group.
      if (g.subject.kind !== "person") continue;
      if (g.subject.isMe || !g.subject.number) continue;
      map.set(g.subject.number, { hasUnseen: g.hasUnseen, hasAny: g.items.length > 0 });
    }
    return map;
  }, [feed.data]);
}

/**
 * Per-GROUP story presence, keyed by conversation id (v2.105.6, #110).
 *
 * Keyed by CONVERSATION ID, not by the group's 6-digit number: a group created
 * before v2.102.0 has no number at all, so a number-keyed map would silently
 * exclude exactly those groups, and a group's number lives in the same space as a
 * person's, so the key would not be unique across the two maps either.
 *
 * Reads the same shared feed cache as `usePeerStatusMap`, so a group ring and the
 * strip can never disagree about whether a group has an unseen story.
 */
export function useGroupStatusMap(): Map<number, { hasUnseen: boolean; hasAny: boolean }> {
  const feed = trpc.status.feed.useQuery(undefined, {
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });
  return useMemo(() => {
    const map = new Map<number, { hasUnseen: boolean; hasAny: boolean }>();
    for (const g of feed.data?.groups ?? []) {
      if (g.subject.kind !== "group" || g.subject.conversationId == null) continue;
      map.set(g.subject.conversationId, {
        hasUnseen: g.hasUnseen,
        hasAny: g.items.length > 0,
      });
    }
    return map;
  }, [feed.data]);
}

export function PeerAvatar({
  number,
  name,
  avatarUrl,
  size = 42,
  rounded = "rounded-full",
  className = "",
  /* `.ravatar-fallback`, not `bg-primary/15 text-primary`: measured as rendered, the
     initials were 3.77:1 in light theme because the accent tint darkens the background out
     from under `--primary`. The class carries the measured light colour (5.15:1) and is
     byte-identical in dark. Callers that pass their own tint (History's per-tone discs)
     are untouched. */
  fallbackClassName = "ravatar-fallback",
  /* A RUNTIME tint for the initials disc, for a colour that cannot be a class
     (v2.106.61): the group sender's own hue gradient is composed per person, and a
     runtime-composed Tailwind class is invisible to the JIT and comes out unstyled.
     Merged AFTER the size, so a caller can only add colour and can never break the
     geometry every row's alignment depends on. */
  fallbackStyle,
  clickable = true,
  children,
}: {
  number: string | null | undefined;
  name: string | null | undefined;
  avatarUrl: string | null | undefined;
  /** Pixel size of the avatar disc (ring adds ~5px around it). */
  size?: number;
  rounded?: string;
  className?: string;
  /** Tint classes for the no-photo initials disc (History's tone colors). */
  fallbackClassName?: string;
  /** Inline tint for the initials disc, for a per-person colour a class cannot express. */
  fallbackStyle?: React.CSSProperties;
  /** false ⇒ purely decorative (no status/profile click behavior). */
  clickable?: boolean;
  /** Overlays (presence LEDs, direction badges) positioned by the caller. */
  children?: React.ReactNode;
}) {
  const t = useT();
  const statusMap = usePeerStatusMap();
  const st = number ? statusMap.get(number) : undefined;
  const label = name || number || "?";
  // A photo that 403s/404s (deleted object, legacy URL) must degrade to the
  // initials disc — never the browser's broken-image glyph. Keyed by URL so a
  // NEW photo after a failure gets its chance to load.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = !!avatarUrl && failedUrl !== avatarUrl;

  const disc = showPhoto ? (
    <img
      src={avatarUrl!}
      alt={label}
      style={{ width: size, height: size }}
      className={`${rounded} object-cover border border-border/60 bg-muted/40`}
      onError={() => setFailedUrl(avatarUrl!)}
    />
  ) : (
    <span
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.34), ...fallbackStyle }}
      className={`${rounded} ${fallbackClassName} grid place-items-center font-bold`}
    >
      {initialsFrom(label)}
    </span>
  );

  /* Status ring: bright when there's an UNSEEN status, subtle when seen.
   *
   * Board 1c/1e/1f: "unseen = accent ring, seen = grey". The bright state is now
   * `.rstoryring`, whose DARK form is the cycling accent — one class, so the ring
   * around a thread row, a contact, a History disc, the chat header and the story
   * strip can never disagree, and the theme is handled in CSS rather than by a
   * runtime read here (the light theme keeps the measured three-hue gradient,
   * because the accent palette is built against a near-black background).
   *
   * The board's "flashing" is deliberately NOT taken: this ring is drawn once per
   * ROW, so animating it means one animation per row on the app's densest scrolling
   * list — the cost class v2.99.84 measured and removed. The accent is the part that
   * carries the design; the flash is decoration the board itself shows at rest. */
  const ring = st?.hasAny ? (
    <span
      style={{ padding: 2.5 }}
      className={
        `inline-grid place-items-center ${rounded} ` + (st.hasUnseen ? "rstoryring" : "bg-border")
      }
    >
      <span className={`${rounded} bg-background p-[1.5px] grid place-items-center`}>{disc}</span>
    </span>
  ) : (
    disc
  );

  const open = () => {
    if (!number) return;
    if (st?.hasAny) openPeerStatus(number);
    else openPeerProfile(number);
  };

  if (!clickable) {
    return <span className={"relative inline-grid place-items-center shrink-0 " + className}>{ring}{children}</span>;
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); open(); }}
      aria-label={
        st?.hasAny
          ? t("peer.viewNamedStory", { name: label })
          : t("peer.viewNamedProfile", { name: label })
      }
      title={
        st?.hasUnseen
          ? t("peer.newStoryTap")
          : st?.hasAny
            ? t("peer.viewStory")
            : t("peer.viewProfile")
      }
      className={
        "relative inline-grid place-items-center shrink-0 outline-none rounded-full " +
        "focus-visible:ring-ring/50 focus-visible:ring-[3px] active:scale-95 transition-transform " +
        className
      }
    >
      {ring}
      {children}
    </button>
  );
}

/* The presence line MOVED to `shared/profileFields.ts` as `describePeerPresence`
 * (v2.105.24). It was correct here and is unchanged; it left because the outgoing dial
 * card became a THIRD reader, and the alternative was the engine copying the incoming
 * ring card's older, wrong version of the same rule. */

/**
 * How long before a guest identity is deleted (v2.100.0, owner: *"for the guest,
 * the blue badge, when you enter to their profile, it will show you that they will
 * be deleted after certain days ... beside his profile after the blue badge"*).
 *
 * Renders NOTHING for anybody who is not an expiring guest — the server sends null
 * rather than 0 for them, so there is no state in which a registered account shows
 * a countdown. Coloured to match the guest badge above it so the two read as one
 * fact rather than two, and it says the clock RESETS on every visit, because a bare
 * "deleted in 12 days" implies a countdown nobody can stop; `touchGuestExpiry`
 * pushes it forward every time they open RELAY, which is the part that makes the
 * figure non-frightening.
 */
/**
 * Somebody's profile STATUS, as a chip (v2.101.1).
 *
 * ONE component for both the popup and the full profile, so the two cannot describe
 * the same person differently — and the emoji + label come from the shared
 * `PROFILE_STATUS_META`, so no surface hand-rolls a word for a status.
 *
 * The hue is applied to the tint and the border only; the LABEL stays in the ordinary
 * foreground colour. That is deliberate: colour here is reinforcement for an emoji
 * that already names the status, so nothing depends on reading it, and these five
 * hues need no contrast measurement (unlike the `--relay-*-text` tokens, which carry
 * small coloured text — v2.99.94).
 *
 * Renders NOTHING without a status. The server sends null rather than a placeholder,
 * including when presence is hidden, so there is no state in which this invents one.
 */
export function ProfileStatusChip({
  status,
  note,
  size = "sm",
}: {
  status: string | null | undefined;
  note?: string | null;
  size?: "sm" | "md";
}) {
  const t = useT();
  const meta = profileStatusMeta(status);
  if (!meta) return null;
  const n = (note ?? "").trim();
  return (
    <div
      // Inline style, not a runtime-composed Tailwind class: the JIT cannot see a
      // class name built at render time and it would come out unstyled.
      style={{ borderColor: `${meta.color}59`, background: `${meta.color}1f` }}
      className={
        "mt-2 inline-flex max-w-[18rem] items-center gap-1.5 rounded-full border px-3 py-1 " +
        (size === "md" ? "text-xs" : "text-[11px]")
      }
    >
      <span aria-hidden="true">{meta.emoji}</span>
      {/* The shared constant's `label` is finished English; the KEY is what reaches the
          dictionary. `meta.label` stays the fallback so a status added to the shared
          module before this map still renders words rather than a blank chip. */}
      <span className="font-semibold text-foreground">
        {PROFILE_STATUS_LABEL_KEY[meta.key] ? t(PROFILE_STATUS_LABEL_KEY[meta.key]) : meta.label}
      </span>
      {n && <span className="truncate text-muted-foreground">· {n}</span>}
    </div>
  );
}

export function GuestExpiryNote({
  daysLeft,
  size = "sm",
}: {
  daysLeft: number | null | undefined;
  size?: "sm" | "md";
}) {
  const t = useT();
  if (daysLeft == null) return null;
  // Western digits deliberately, in both languages: the count is interpolated, and an
  // Arabic-Indic numeral beside a substituted Western one reads as a rendering fault.
  const label = t(guestExpiryKey(daysLeft), { count: daysLeft });
  return (
    <div
      className={
        "mt-2 inline-flex max-w-[16rem] flex-col items-center gap-0.5 rounded-full border border-[#38bdf8]/35 bg-[#38bdf8]/10 px-3 py-1 text-center text-[#0284c7] dark:text-[#7dd3fc] " +
        (size === "md" ? "text-xs" : "text-[11px]")
      }
    >
      <span className="font-semibold">{label}</span>
      <span className="opacity-80">{t("peer.guestCountdownResets")}</span>
    </div>
  );
}

export function PeerOverlaysHost() {
  const t = useT();
  const { locale } = useLocale();
  const [, setLocation] = useLocation();
  const engine = useRelayEngine();
  // Who WE are — needed only to answer "is this story mine?" for the synthetic
  // group below. See the note there for why getting that wrong hides the Delete
  // button on your own story.
  const { me } = useIdentity();
  const utils = trpc.useUtils();
  const [statusNumber, setStatusNumber] = useState<string | null>(null);
  /** A GROUP's reel, opened by conversation id (v2.105.6). */
  const [statusGroupId, setStatusGroupId] = useState<number | null>(null);
  const [profileNumber, setProfileNumber] = useState<string | null>(null);
  /** Set only when the popup was opened from inside a conversation. */
  const [chatActions, setChatActions] = useState<PeerProfileChatActions | null>(null);
  // Full-screen "profile page" opened by tapping the avatar in the popup — the
  // owner asked for a fuller view (big photo + details) that opens even when the
  // peer has no active status.
  const [fullProfile, setFullProfile] = useState(false);

  useEffect(() => {
    const onStatus = (e: Event) => setStatusNumber((e as CustomEvent).detail?.number ?? null);
    const onProfile = (e: Event) => {
      const d = (e as CustomEvent).detail ?? {};
      setProfileNumber(d.number ?? null);
      setChatActions((d.chat as PeerProfileChatActions | undefined) ?? null);
    };
    const onGroupStatus = (e: Event) => {
      const cid = (e as CustomEvent).detail?.conversationId;
      setStatusGroupId(typeof cid === "number" ? cid : null);
    };
    window.addEventListener(OPEN_STATUS, onStatus);
    window.addEventListener(OPEN_PROFILE, onProfile);
    window.addEventListener(OPEN_GROUP_STATUS, onGroupStatus);
    return () => {
      window.removeEventListener(OPEN_STATUS, onStatus);
      window.removeEventListener(OPEN_PROFILE, onProfile);
      window.removeEventListener(OPEN_GROUP_STATUS, onGroupStatus);
    };
  }, []);

  /* ── status viewer (global) ── */
  const feed = trpc.status.feed.useQuery(undefined, {
    staleTime: 20_000,
    enabled: statusNumber != null || statusGroupId != null,
  });
  const groups = feed.data?.groups ?? [];
  // Person reels only: this host opens a PERSON's story by number, and a group
  // reel's number is the group's own id, which could otherwise match.
  const statusIdx = statusNumber
    ? groups.findIndex((g) => g.subject.kind === "person" && g.subject.number === statusNumber)
    : -1;

  /* ── the "Everyone" discovery surface (v2.99.66) ──
     The story FEED is bounded to my contacts and the people who saved me — it
     has to be, because its reverse is what realtime status events fan out to,
     and the reverse of "everyone" is every identity in the database. So a
     status posted to "everyone" by someone I haven't saved is authorized but
     absent from `groups`, which would leave the setting technically live and
     practically invisible.

     This is the pull side: while a profile is open I already have that person's
     number, so ask for just their statuses. The server returns only what I'm
     allowed to watch, and returns an empty list — not an error — for a
     contacts-only poster, so it reveals nothing a contacts-only story wouldn't. */
  const peerNumber = statusNumber ?? profileNumber;
  const inFeed =
    !!peerNumber &&
    groups.some((g) => g.subject.kind === "person" && g.subject.number === peerNumber);
  const peerStatus = trpc.status.forNumber.useQuery(
    { number: peerNumber ?? "" },
    { enabled: !!peerNumber && !inFeed, staleTime: 20_000 },
  );

  /* ── profile popup ── */
  const lookup = trpc.directory.lookup.useQuery(
    { number: profileNumber ?? "" },
    { enabled: !!profileNumber, staleTime: 10_000 }
  );
  const contactsQ = trpc.contacts.list.useQuery(undefined, {
    enabled: !!profileNumber,
    staleTime: 15_000,
  });
  const savedContact = profileNumber
    ? (contactsQ.data ?? []).find((c) => c.number === profileNumber) ?? null
    : null;
  const saved = !!savedContact;
  /* BOARD 4a — the category chips, and this is what makes multi-tag ASSIGNABLE at
     all: the row menu and the edit dialog are single-select pickers, so before
     this there was no surface that could put two tags on one person.
     Resolved through the ONE shared reader so a pre-v2.106.14 contact (legacy
     `category` only) shows its chip lit rather than looking untagged. */
  const myTags = contactTagsOf({
    tags: (savedContact as { tags?: string[] } | null)?.tags?.join(",") ?? null,
    category: savedContact?.category ?? null,
  });
  const upsert = trpc.contacts.upsert.useMutation({
    onSuccess: () => {
      utils.contacts.list.invalidate();
      toast.success(t("peer.added"));
    },
    onError: () => toast.error(t("peer.addFailed")),
  });
  /* Its own mutation rather than reusing `upsert` above: that one reports "Added
     to your contacts", which is the wrong sentence for a tag edit — and a toast
     that describes the wrong act is worse than none. Silent on success, because
     the chip itself lighting up IS the feedback; only a failure needs words. */
  const tagWrite = trpc.contacts.upsert.useMutation({
    onSuccess: () => utils.contacts.list.invalidate(),
    onError: () => toast.error(t("peer.labelSaveFailed")),
  });
  const openThread = trpc.messages.openThread.useMutation({
    onSuccess: (res) => {
      setProfileNumber(null);
      setLocation(`/app/messages?c=${res.conversationId}`);
    },
    onError: (err) => toast.error(err.message || t("peer.openFailed")),
  });

  const p = lookup.data;
  /* TRANSLATED (v2.106.98). Derived ONCE and read by both surfaces below — the
     popup and the full profile — so the two can never describe one person
     differently, which is the divergence a per-site call would allow. The state
     itself comes from `peerPresenceState`, which the English renderer also reads.
     Empty for a suppressed presence, which is what makes the `&&` guards below
     still hide the line rather than print "Offline" about somebody the server
     declined to describe (v2.95). */
  const presenceLine = p ? presenceLabel(p, t, { locale }) : "";
  const feedStatusInfo = usePeerStatusMap().get(profileNumber ?? "");
  /* Prefer the feed (it's already cached and covers contacts); fall back to the
     per-number lookup so an "everyone" story from a non-contact still lights the
     avatar and gives the tap somewhere to go. */
  const statusInfo =
    feedStatusInfo ??
    (peerStatus.data && peerStatus.data.items.length > 0
      ? { hasAny: true, hasUnseen: peerStatus.data.hasUnseen }
      : undefined);

  /* A viewer needs a FeedGroup. For a non-contact there is no feed entry, so
     synthesize one from the per-number result + the directory lookup we already
     have open.

     `isMe` IS DERIVED, NOT HARDCODED FALSE (v2.99.95). The comment that used to
     sit here claimed this host only ever opens for another peer's number — which
     stopped being true in v2.99.86, when the top bar's See-my-status item started
     routing through openPeerStatus(me.number). Whenever the feed lookup above
     missed, the viewer rendered MY OWN story with isMe false, which hides the
     Viewers list, the audience chip and — the reported symptom — the DELETE row.
     The feed and whoami are cached separately, so their idea of my number can
     disagree for a few seconds, and a renumber opens exactly that window.
     status.forNumber does return your own stories (getViewableStatusesOfOwner
     short-circuits self), so the content was there and only the ownership verdict
     was wrong. */
  const syntheticGroups: FeedGroup[] =
    statusNumber && !inFeed && peerStatus.data && peerStatus.data.items.length > 0
      ? [
          {
            subject: {
              // Its OWN prefix: this reel is known by NUMBER, not identity id, and a
              // 6-digit number can legitimately equal some other identity's id.
              key: personReelKeyByNumber(statusNumber),
              kind: "person",
              // Not known from `forNumber`, which answers by number. Null rather
              // than 0: a placeholder id is a lie that something downstream will
              // eventually compare against a real one.
              identityId: null,
              conversationId: null,
              number: statusNumber,
              displayName: p?.displayName || t("peer.someone"),
              avatarUrl: p?.avatarUrl ?? null,
              isMe: !!me?.number && me.number === statusNumber,
            },
            items: peerStatus.data.items,
            hasUnseen: peerStatus.data.hasUnseen,
            latestAt: peerStatus.data.items[peerStatus.data.items.length - 1].createdAt,
          },
        ]
      : [];
  const viewerGroups = statusIdx >= 0 ? groups : syntheticGroups;
  const viewerIndex = statusIdx >= 0 ? statusIdx : 0;

  /* A GROUP's reel is located in the feed by conversation id (v2.105.6). No
     synthetic fallback: a group story is authorized by membership, so a reel
     absent from my feed is one I am not entitled to — nothing to pull, and
     inventing an empty reel would render a black screen rather than say so. */
  const groupIdx =
    statusGroupId != null
      ? groups.findIndex(
          (g) => g.subject.kind === "group" && g.subject.conversationId === statusGroupId,
        )
      : -1;

  return (
    <>
      {statusNumber != null && viewerGroups.length > 0 && (
        <StatusViewer
          groups={viewerGroups}
          startIndex={viewerIndex}
          onClose={() => {
            setStatusNumber(null);
            utils.status.feed.invalidate();
            // The synthesized group came from forNumber, so refresh THAT too or a
            // just-watched story keeps its unseen ring until the cache expires.
            utils.status.forNumber.invalidate();
          }}
        />
      )}

      {statusGroupId != null && groupIdx >= 0 && (
        <StatusViewer
          groups={groups}
          startIndex={groupIdx}
          /* NO CHAINING (the default). Opening a group's story from its thread row
             is a targeted act, and walking on to whatever reel happens to sit next
             in the feed — a different group, or a friend — is the behaviour the
             owner ruled out for everywhere except the Messages strip (v2.99.90). */
          onClose={() => {
            setStatusGroupId(null);
            utils.status.feed.invalidate();
          }}
        />
      )}

      <Dialog open={profileNumber != null} onOpenChange={(o) => { if (!o) { setProfileNumber(null); setFullProfile(false); } }}>
        <DialogContent className="max-w-sm rounded-3xl p-6">
          {p ? (
            <div className="flex flex-col items-center text-center">
              {/* Tapping the avatar always does something: a STORY if there is
                  one, otherwise the full-screen profile view (owner request —
                  the image must be clickable with or without a story). */}
              <button
                type="button"
                onClick={() => {
                  if (statusInfo?.hasAny && profileNumber) openPeerStatus(profileNumber);
                  else setFullProfile(true);
                }}
                /* SAYS "STORY", NOT "STATUS" (v2.101.0). This aria-label used to read
                   "View X's status" about the ephemeral post while the `title` on the
                   same element already said "View story" — one control, two words for
                   one thing. The story-vs-status sweep in `storyVsStatus.test.ts` could
                   not see it: its extractor matches `aria-label={\`…`, and the ternary
                   put an expression between the brace and the backtick. */
                aria-label={
                  statusInfo?.hasAny
                    ? t("peer.viewNamedStory", { name: p.displayName || t("peer.profile") })
                    : t("peer.viewFullProfile")
                }
                title={statusInfo?.hasAny ? t("peer.viewStory") : t("peer.viewFullProfile")}
                className="rounded-full outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] active:scale-95 transition-transform"
              >
                <PeerAvatar
                  number={p.number}
                  name={p.displayName}
                  avatarUrl={p.avatarUrl}
                  size={72}
                  clickable={false}
                />
              </button>
              <DialogTitle className="mt-3 flex items-center gap-1.5 text-lg font-bold">
                <span className="truncate max-w-[14rem]">{p.displayName || t("peer.guest")}</span>
                <RoleBadge role={roleFromFlags(p.role, p.verified)} size={16} />
              </DialogTitle>
              {/* `dir="ltr"` + an explicit isolate: beside Arabic the bidi algorithm
                  otherwise reorders the two digit groups around the dash. */}
              <div
                className="mt-0.5 font-mono text-sm text-muted-foreground [unicode-bidi:isolate]"
                dir="ltr"
              >
                {p.number.length === 6 ? `${p.number.slice(0, 3)}-${p.number.slice(3)}` : p.number}
              </div>
              {/* Prefer the caller's full last-seen line when it has one: the
                  chat header can only fit a short "8h" style stamp, and the owner
                  asked for the date AND time to be readable somewhere. */}
              {(chatActions?.lastSeenText || presenceLine) && (
                <div className={"mt-1.5 text-xs " + (p.isOnline && !p.idle ? "text-[color:var(--relay-online,#06d6a0)]" : "text-muted-foreground")}>
                  {p.isOnline ? presenceLine : (chatActions?.lastSeenText || presenceLine)}
                </div>
              )}
              <ProfileStatusChip status={p.profileStatus} note={p.statusNote} />
              <GuestExpiryNote daysLeft={p.guestDaysLeft} />

              <div className="mt-5 grid w-full grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => { if (profileNumber) openThread.mutate({ number: profileNumber }); }}
                  className="flex flex-col items-center gap-1.5 rounded-2xl bg-[#fb923c]/12 px-2 py-3 text-xs font-semibold text-[#fb923c] active:scale-95 transition-transform"
                >
                  <MessageSquare className="size-5" /> {t("peer.message")}
                </button>
                <button
                  type="button"
                  onClick={() => { if (profileNumber && engine.dial(profileNumber, { voice: true, displayName: p.displayName })) setProfileNumber(null); }}
                  className="flex flex-col items-center gap-1.5 rounded-2xl bg-[#22c55e]/12 px-2 py-3 text-xs font-semibold text-[#22c55e] active:scale-95 transition-transform"
                >
                  <Phone className="size-5" /> {t("peer.voice")}
                </button>
                <button
                  type="button"
                  onClick={() => { if (profileNumber && engine.dial(profileNumber, { voice: false, displayName: p.displayName })) setProfileNumber(null); }}
                  className="flex flex-col items-center gap-1.5 rounded-2xl bg-[#38bdf8]/12 px-2 py-3 text-xs font-semibold text-[#38bdf8] active:scale-95 transition-transform"
                >
                  <Video className="size-5" /> {t("peer.video")}
                </button>
              </div>

              <div className="mt-2 grid w-full gap-2" style={{ gridTemplateColumns: statusInfo?.hasAny ? "1fr 1fr" : "1fr" }}>
                {/* One-tap contact conversion (guest↔user↔guest all work — a
                    contact is just a saved number). */}
                <button
                  type="button"
                  disabled={saved || upsert.isPending}
                  onClick={() => {
                    if (profileNumber) upsert.mutate({ number: profileNumber, displayName: p.displayName || undefined });
                  }}
                  className={
                    "flex items-center justify-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-semibold active:scale-95 transition-transform " +
                    (saved ? "bg-muted/50 text-muted-foreground" : "bg-primary/12 text-primary")
                  }
                >
                  {saved ? (<><Check className="size-4" /> {t("peer.inYourContacts")}</>) : (<><UserPlus className="size-4" /> {t("peer.addToContacts")}</>)}
                </button>
                {statusInfo?.hasAny && (
                  <button
                    type="button"
                    onClick={() => {
                      const n = profileNumber;
                      setProfileNumber(null);
                      if (n) openPeerStatus(n);
                    }}
                    className="flex items-center justify-center gap-2 rounded-2xl bg-[#8b5cf6]/12 px-3 py-2.5 text-sm font-semibold text-[#8b5cf6] active:scale-95 transition-transform"
                  >
                    {/* "View STORY". This button opens the story viewer, and calling the
                        ephemeral post a "status" here was the v2.101.0 vocabulary bug
                        the sibling `title` above had already got right. */}
                    <CircleUserRound className="size-4" /> {t("peer.viewStory")}
                  </button>
                )}
              </div>

              {/* BOARD 4a — the category chips, EDITABLE.
                  This is the only surface in the app that can assign more than one
                  tag: the Contacts row menu and the edit dialog are single-select
                  pickers, so without this the multi-tag store could never hold two.

                  OFFERED ONLY FOR A SAVED CONTACT, and that is a property of the
                  data rather than a UI choice: tags live on the OWNER's contact
                  row, so there is nowhere to put them for somebody you have not
                  saved. Showing the chips anyway would be a control that silently
                  does nothing — the class this repo keeps removing.

                  THEY ARE **MY** LABELS, NEVER THEIRS. The contract is explicit
                  that tags are not synced to the peer, and the copy says so, so
                  nobody assigns "VIP" believing the other person is told. */}
              {saved && (
                <div className="mt-3 w-full">
                  <div
                    className="mb-1.5 font-mono text-[9.5px] font-bold uppercase text-muted-foreground"
                    style={{ letterSpacing: ".22em" }}
                  >
                    {t("peer.yourLabels")}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {/* THE LOOP VARIABLE IS `tag`, NOT `t`. It used to be `t`, which now
                        shadows the translator — and a shadowed `t` here would silently be
                        a ContactTag rather than a function. Removing the shadow beats
                        aliasing around it (v2.106.85). */}
                    {CONTACT_TAGS.map((tag) => {
                      const on = myTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          disabled={tagWrite.isPending}
                          aria-pressed={on}
                          onClick={() => {
                            if (!profileNumber) return;
                            /* Toggle, so tapping an assigned chip REMOVES it —
                               otherwise there is no way to unassign without a
                               second control the frame does not draw. */
                            tagWrite.mutate({
                              number: profileNumber,
                              tags: toggleContactTag(myTags, tag),
                            });
                          }}
                          style={
                            on
                              ? {
                                  background: TAG_COLOR[tag] + "21",
                                  border: "1px solid " + TAG_COLOR[tag] + "73",
                                  color: TAG_COLOR[tag],
                                }
                              : undefined
                          }
                          className={
                            "rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 " +
                            (on ? "" : "border border-border bg-muted/40 text-muted-foreground hover:text-foreground")
                          }
                        >
                          {/* `me-1`, not `mr-1`: the tick precedes the label in READING
                              order, so the gap has to swap sides in Arabic. */}
                          {on && <Check className="me-1 inline size-3" />}
                          {t(TAG_LABEL_KEY[tag])}
                        </button>
                      );
                    })}
                  </div>
                  {/* ONE key with the name INSIDE it. This used to be the sentence split
                      around `{p.displayName}`, which cannot be translated: Arabic does not
                      put the person between the same two fragments, so the halves could
                      only be re-assembled into nonsense. */}
                  <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                    {t("peer.labelsPrivate", { name: p.displayName || t("peer.them") })}
                  </p>
                </div>
              )}

              {/* The two actions that used to sit permanently in the chat header.
                  Present ONLY when opened from inside a conversation. */}
              {(chatActions?.onSearch || chatActions?.onToggleMute) && (
                <div className="mt-2 grid w-full gap-2" style={{ gridTemplateColumns: chatActions.onSearch && chatActions.onToggleMute ? "1fr 1fr" : "1fr" }}>
                  {chatActions.onSearch && (
                    <button
                      type="button"
                      onClick={() => { const f = chatActions.onSearch; setProfileNumber(null); f?.(); }}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-muted/60 px-3 py-2.5 text-sm font-semibold text-foreground active:scale-95 transition-transform"
                    >
                      <Search className="size-4 shrink-0" /> <span className="truncate">{t("peer.searchChat")}</span>
                    </button>
                  )}
                  {chatActions.onToggleMute && (
                    <button
                      type="button"
                      onClick={() => chatActions.onToggleMute?.()}
                      className={
                        "flex items-center justify-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-semibold active:scale-95 transition-transform " +
                        (chatActions.muted ? "bg-muted/50 text-muted-foreground" : "bg-primary/12 text-primary")
                      }
                    >
                      {chatActions.muted ? (
                        <><BellOff className="size-4 shrink-0" /> <span className="truncate">{t("peer.muted")}</span></>
                      ) : (
                        <><Bell className="size-4 shrink-0" /> <span className="truncate">{t("peer.notifications")}</span></>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <DialogTitle className="sr-only">{t("peer.profile")}</DialogTitle>
              {lookup.isLoading ? t("peer.loadingProfile") : t("peer.notOnRelay")}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Full-screen profile view (owner request) — opened by tapping the popup
          avatar; a bigger, calmer "profile page" that works with or without a
          status. Sits above the popup Dialog. */}
      {fullProfile && p && (
        <div
          className="dark fixed inset-0 z-[140] flex flex-col text-foreground"
          role="dialog"
          aria-modal="true"
          aria-label={t("peer.fullProfileOf", { name: p.displayName || t("peer.profile") })}
        >
          <div aria-hidden className="absolute inset-0 bg-background/95 backdrop-blur-xl" onClick={() => setFullProfile(false)} />
          <div className="relative flex items-center justify-between px-5 pt-[max(1rem,env(safe-area-inset-top))]">
            <button
              type="button"
              onClick={() => setFullProfile(false)}
              aria-label={t("peer.back")}
              className="rounded-full p-2 text-muted-foreground hover:bg-muted"
            >
              <ArrowLeft className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => { setFullProfile(false); setProfileNumber(null); }}
              aria-label={t("peer.close")}
              className="rounded-full p-2 text-muted-foreground hover:bg-muted"
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="relative flex flex-1 flex-col items-center overflow-y-auto px-6 pb-10 text-center">
            {/* Big avatar — tap opens the STORY when there is one. */}
            <button
              type="button"
              disabled={!statusInfo?.hasAny}
              onClick={() => { if (statusInfo?.hasAny && profileNumber) { setFullProfile(false); openPeerStatus(profileNumber); } }}
              className="mt-4 rounded-full outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-default"
            >
              <PeerAvatar number={p.number} name={p.displayName} avatarUrl={p.avatarUrl} size={148} clickable={false} />
            </button>
            <div className="mt-4 flex items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight">{p.displayName || t("peer.guest")}</h1>
              <RoleBadge role={roleFromFlags(p.role, p.verified)} size={20} />
            </div>
            {/* As in the popup: isolated, or the digit groups reorder beside Arabic. */}
            <div
              className="mt-1 font-mono text-base text-muted-foreground [unicode-bidi:isolate]"
              dir="ltr"
            >
              {p.number.length === 6 ? `${p.number.slice(0, 3)}-${p.number.slice(3)}` : p.number}
            </div>
            {presenceLine && (
              <div className={"mt-2 text-sm " + (p.isOnline && !p.idle ? "text-[color:var(--relay-online,#06d6a0)]" : "text-muted-foreground")}>
                {presenceLine}
              </div>
            )}
            <ProfileStatusChip status={p.profileStatus} note={p.statusNote} size="md" />
            <GuestExpiryNote daysLeft={p.guestDaysLeft} size="md" />

            <div className="mt-7 grid w-full max-w-sm grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => { if (profileNumber) openThread.mutate({ number: profileNumber }); }}
                className="flex flex-col items-center gap-1.5 rounded-2xl bg-[#fb923c]/12 px-2 py-4 text-sm font-semibold text-[#fb923c] active:scale-95 transition-transform"
              >
                <MessageSquare className="size-6" /> {t("peer.message")}
              </button>
              <button
                type="button"
                onClick={() => { if (profileNumber && engine.dial(profileNumber, { voice: true, displayName: p.displayName })) { setFullProfile(false); setProfileNumber(null); } }}
                className="flex flex-col items-center gap-1.5 rounded-2xl bg-[#22c55e]/12 px-2 py-4 text-sm font-semibold text-[#22c55e] active:scale-95 transition-transform"
              >
                <Phone className="size-6" /> {t("peer.voice")}
              </button>
              <button
                type="button"
                onClick={() => { if (profileNumber && engine.dial(profileNumber, { voice: false, displayName: p.displayName })) { setFullProfile(false); setProfileNumber(null); } }}
                className="flex flex-col items-center gap-1.5 rounded-2xl bg-[#38bdf8]/12 px-2 py-4 text-sm font-semibold text-[#38bdf8] active:scale-95 transition-transform"
              >
                <Video className="size-6" /> {t("peer.video")}
              </button>
            </div>

            <div className="mt-2.5 w-full max-w-sm">
              <button
                type="button"
                disabled={saved || upsert.isPending}
                onClick={() => { if (profileNumber) upsert.mutate({ number: profileNumber, displayName: p.displayName || undefined }); }}
                className={
                  "flex w-full items-center justify-center gap-2 rounded-2xl px-3 py-3 text-sm font-semibold active:scale-95 transition-transform " +
                  (saved ? "bg-muted/50 text-muted-foreground" : "bg-primary/12 text-primary")
                }
              >
                {saved ? (<><Check className="size-4" /> {t("peer.inYourContacts")}</>) : (<><UserPlus className="size-4" /> {t("peer.addToContacts")}</>)}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
