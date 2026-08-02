import { PhoneCall, Users, Crown, Shield } from "lucide-react";
import { RoleBadge, type IdentityRole } from "./VerifiedBadge";
import { formatElapsedSince } from "@shared/profileFields";
import { useT, useLocale, type TKey } from "./i18n";
import { formatDateIn } from "./dateLocale";

/**
 * #109 — the invite screen's card: WHAT you are about to join and WHO is already
 * in it.
 *
 * ONE COMPONENT, TWO SCREENS, and that is the point rather than tidiness. A
 * shared link is opened by two different kinds of visitor — somebody with no
 * identity (who lands on `OnboardingGate` and types a name) and somebody already
 * signed in (who lands on `/app/join`) — and the owner asked for both screens to
 * be redesigned. Two copies of this card is how the two come to describe the same
 * call differently, and nothing fails when they do: the tests would pass and the
 * screens would simply disagree. Each caller supplies only its own ACTION area as
 * children; every word about the call lives here.
 *
 * PRESENTATIONAL ONLY: it fetches nothing and mutates nothing (asserted), so it
 * renders identically inside the app shell and outside it.
 *
 * EVERY AVATAR HERE IS AN INERT DISC, never `PeerAvatar`. That component opens a
 * story or a profile on tap, which needs `PeerOverlaysHost` — mounted inside
 * `AppShell`, i.e. absent on the guest screen — and needs the person's number,
 * which the server deliberately does not send for occupants. A control that looks
 * live and does nothing is worse than one that is not there (the v2.103.3 rule).
 */

export interface InviteOccupant {
  name: string;
  avatarUrl: string | null;
  role: IdentityRole | null;
  /** Host / co-host in the live room ("" for neither) — not an account tier. */
  callRole: string;
  joinedAt: number | null;
  isOwner: boolean;
}

export interface InvitePartyLine {
  kind: "party-line";
  number: string;
  title: string;
  createdAt: string | Date;
  liveSince: number | null;
  liveCount: number;
  /** False when the API tier could not reach the signaling node — the roster is
   *  UNKNOWN, which must not be rendered as "nobody is here". */
  rosterKnown: boolean;
  owner: {
    firstName: string;
    displayName: string;
    avatarUrl: string | null;
    role: IdentityRole | null;
  } | null;
  members: InviteOccupant[];
}

export interface InvitePerson {
  displayName: string;
  avatarUrl: string | null;
  role: IdentityRole | null;
  isOnline: boolean;
  inCall: boolean;
}

/** Format a 6-digit RELAY number as `NNN-NNN`; pass anything else through. */
export function fmtInviteNumber(n: string): string {
  return /^\d{6}$/.test(n) ? `${n.slice(0, 3)}-${n.slice(3)}` : n;
}

/**
 * A stable visual identity for a line, from its own number.
 *
 * The owner asked for "a logo/thumbnail for the call or party line". A party line
 * has no image column and no upload surface, so rather than ship an empty frame
 * this derives a deterministic gradient from the number itself: the same line
 * always looks the same, on every device and for every visitor, with nothing to
 * upload and nothing to moderate. An uploadable logo is a schema column plus an
 * editor — worth doing on its own, not as a side effect of this screen.
 */
export function lineThumbGradient(number: string): string {
  let h = 0;
  for (let i = 0; i < number.length; i++) h = (h * 31 + number.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 72% 52%), hsl(${(h + 48) % 360} 78% 42%))`;
}

/** Initials for the inert disc — first letters of up to two words. */
export function inviteInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (!parts.length) return "?";
  return parts.map((p) => p[0]!.toUpperCase()).join("");
}

function Disc({
  name,
  avatarUrl,
  size,
  background,
  children,
}: {
  name: string;
  avatarUrl?: string | null;
  size: number;
  background?: string;
  children?: React.ReactNode;
}) {
  return (
    <span
      className="relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-bold text-white/95"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, Math.round(size * 0.36)),
        background: background ?? "linear-gradient(135deg,#3FE0C5,#6EE7FF)",
      }}
    >
      {avatarUrl ? (
        // A broken photo falls back to the initials underneath rather than the
        // browser's broken-image glyph — the rule PeerAvatar already follows.
        <>
          <span aria-hidden className="absolute inset-0 grid place-items-center">
            {inviteInitials(name)}
          </span>
          <img
            src={avatarUrl}
            alt=""
            className="absolute inset-0 size-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </>
      ) : (
        <span aria-hidden>{inviteInitials(name)}</span>
      )}
      {children}
    </span>
  );
}

/**
 * "joined 4m ago", or NOTHING when the join time is unknown.
 *
 * Rendering nothing is a requirement rather than a fallback: a mid-rollout
 * hydration and a 1:1 room's creator legitimately carry no stamp, and "joined
 * just now" about somebody who has been there an hour is a false statement about
 * the viewer's own data.
 */
export function joinedLine(
  joinedAt: number | null,
  now: number,
  t: (k: TKey, v?: Record<string, string | number>) => string,
): string {
  if (!joinedAt || !Number.isFinite(joinedAt) || joinedAt > now) return "";
  const ago = formatElapsedSince(joinedAt, now);
  /* ONE key carrying the whole sentence with `{ago}` substituted by name — "joined"
     + a duration + "ago" is a sentence assembled from fragments, and Arabic leads
     with the verb so it cannot be reassembled from the English seams. */
  return ago ? t("invite.joined", { ago }) : "";
}

/** Occupancy is banded, because Arabic's dual is a word rather than "2 " + a noun. */
export function inviteLineCountKey(n: number): TKey {
  if (n <= 0) return "invite.lineCountNobody";
  if (n === 1) return "invite.lineCountOne";
  if (n === 2) return "invite.lineCountTwo";
  return n <= 10 ? "invite.lineCountFew" : "invite.lineCountMany";
}

export function InviteCard({
  number,
  line,
  person,
  personResolved,
  now = Date.now(),
  children,
}: {
  number: string;
  /** The party line behind this number, when it is one. */
  line: InvitePartyLine | null;
  /** The person behind this number, when it is not a line. */
  person: InvitePerson | null;
  /** True once the person lookup has settled WITHOUT error. While false the card
   *  says nothing about whether the number exists — a lookup that is still in
   *  flight, or that a rate limiter refused, is not evidence of absence. */
  personResolved: boolean;
  /** Injected clock, so the join times are deterministic under test. */
  now?: number;
  /** The action area — a name field + Join for a guest, Join alone once signed in. */
  children?: React.ReactNode;
}) {
  const t = useT();
  /* The created-on date is a REGIONAL format rather than a translation, so it
     follows the app's language and not the browser's. */
  const { locale } = useLocale();
  const isLine = !!line;
  const title = isLine ? line.title : person?.displayName || "";
  const notFound = personResolved && !isLine && !person;

  return (
    <div className="rounded-3xl border border-border/60 bg-card/60 p-6 shadow-2xl shadow-black/40 backdrop-blur-2xl backdrop-saturate-150">
      <div className="mb-1 flex justify-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--relay-online,#06d6a0)]/30 bg-[color:var(--relay-online,#06d6a0)]/10 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--relay-online,#06d6a0)]">
          {isLine ? <Users className="size-3.5" /> : <PhoneCall className="size-3.5" />}
          {isLine ? t("invite.kindLine") : t("invite.kindCall")}
        </span>
      </div>

      {/* ── What you're joining ─────────────────────────────────────────── */}
      <div className="mb-4 mt-4 flex flex-col items-center text-center">
        <div className="relative mb-3">
          <Disc
            name={title || "?"}
            avatarUrl={isLine ? null : person?.avatarUrl}
            size={72}
            background={isLine ? lineThumbGradient(line.number) : undefined}
          />
          {!isLine && person?.isOnline && (
            <span className="absolute bottom-0.5 end-0.5 size-3.5 rounded-full border-2 border-[#0b0f14] bg-[color:var(--relay-online,#06d6a0)]" />
          )}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-lg font-semibold leading-tight">
          <span className="truncate" dir="auto">
            {title || (notFound ? t("invite.notFoundTitle") : "—")}
          </span>
          {!isLine && <RoleBadge role={person?.role} size={15} />}
        </div>
        {/* The link's OWN number — the one the visitor is already holding. LTR and
            bidi-isolated so an RTL title beside it cannot reorder the digits. */}
        <div
          dir="ltr"
          className="mt-1 font-mono text-sm text-muted-foreground [unicode-bidi:isolate]"
        >
          {fmtInviteNumber(number)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {isLine ? (
            t("invite.lineCreated", {
              who: line.rosterKnown
                ? t(inviteLineCountKey(line.liveCount), { count: line.liveCount })
                : t("invite.lineRosterUnknown"),
              when: formatDateIn(locale, line.createdAt),
            })
          ) : notFound ? (
            t("invite.notFoundBody")
          ) : person ? (
            person.inCall
              ? t("invite.peerInCall")
              : person.isOnline
                ? t("invite.peerOnline")
                : t("invite.peerOffline")
          ) : (
            ""
          )}
        </div>
      </div>

      {/* ── Creator ─────────────────────────────────────────────────────── */}
      {isLine && line.owner && (
        <div className="mb-4 flex items-center gap-2.5 rounded-2xl border border-border/50 bg-background/40 px-3 py-2.5">
          <Disc name={line.owner.displayName} avatarUrl={line.owner.avatarUrl} size={34} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
              <span className="truncate" dir="auto">
                {line.owner.firstName}
              </span>
              <RoleBadge role={line.owner.role} size={13} />
            </div>
            <div className="text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground">
              {t("invite.creator")}
            </div>
          </div>
        </div>
      )}

      {/* ── Who's inside ────────────────────────────────────────────────── */}
      {isLine && line.members.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
            {t("invite.onTheLine")}
          </div>
          <ul className="flex flex-col gap-2">
            {line.members.map((m, i) => (
              <li key={`${m.name}-${i}`} className="flex items-center gap-2.5">
                <Disc name={m.name} avatarUrl={m.avatarUrl} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5 text-sm">
                    <span className="truncate font-medium" dir="auto">
                      {m.name}
                    </span>
                    <RoleBadge role={m.role} size={12} />
                    {m.callRole === "host" && (
                      <span
                        title={t("invite.hostTitle")}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-amber-400"
                      >
                        <Crown className="size-3" aria-hidden /> {t("invite.host")}
                      </span>
                    )}
                    {m.callRole === "cohost" && (
                      <span
                        title={t("invite.cohostTitle")}
                        className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-violet-300"
                      >
                        <Shield className="size-3" aria-hidden /> {t("invite.cohost")}
                      </span>
                    )}
                    {m.isOwner && m.callRole !== "host" && (
                      <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("invite.creator")}
                      </span>
                    )}
                  </div>
                  {joinedLine(m.joinedAt, now, t) && (
                    <div className="text-[0.7rem] text-muted-foreground">
                      {joinedLine(m.joinedAt, now, t)}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {children}
    </div>
  );
}
