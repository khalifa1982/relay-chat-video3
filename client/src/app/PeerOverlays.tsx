import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Phone, Video, MessageSquare, UserPlus, Check, CircleUserRound } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useRelayEngine } from "./RelayEngine";
import { VerifiedBadge } from "./VerifiedBadge";
import { StatusViewer } from "@/pages/app/Status";

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

export function openPeerStatus(number: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_STATUS, { detail: { number } }));
}
export function openPeerProfile(number: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_PROFILE, { detail: { number } }));
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
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
      if (g.owner.isMe || !g.owner.number) continue;
      map.set(g.owner.number, { hasUnseen: g.hasUnseen, hasAny: g.items.length > 0 });
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
  fallbackClassName = "bg-primary/15 text-primary",
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
  /** false ⇒ purely decorative (no status/profile click behavior). */
  clickable?: boolean;
  /** Overlays (presence LEDs, direction badges) positioned by the caller. */
  children?: React.ReactNode;
}) {
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
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.34) }}
      className={`${rounded} ${fallbackClassName} grid place-items-center font-bold`}
    >
      {initialsFrom(label)}
    </span>
  );

  // Status ring: gradient when there's an UNSEEN status, subtle when seen.
  const ring = st?.hasAny ? (
    <span
      style={{ padding: 2.5 }}
      className={
        `inline-grid place-items-center ${rounded} ` +
        (st.hasUnseen
          ? "bg-gradient-to-tr from-[#06d6a0] via-[#0ea5e9] to-[#8b5cf6]"
          : "bg-border")
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
      aria-label={st?.hasAny ? `View ${label}'s status` : `View ${label}'s profile`}
      title={st?.hasUnseen ? "New status — tap to view" : st?.hasAny ? "View status" : "View profile"}
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

/** Presence line for the profile popup. */
function presenceLine(d: {
  isOnline: boolean;
  inCall: boolean;
  lastSeenAt: string | Date | null;
  presenceHidden: boolean;
  partyLine: boolean;
  memberCount: number;
}): string {
  if (d.partyLine) return `Party line · ${d.memberCount} on the line`;
  if (d.presenceHidden) return "";
  if (d.inCall) return "On a call right now";
  if (d.isOnline) return "Online now";
  if (d.lastSeenAt) return `Last seen ${new Date(d.lastSeenAt).toLocaleString()}`;
  return "Offline";
}

export function PeerOverlaysHost() {
  const [, setLocation] = useLocation();
  const engine = useRelayEngine();
  const utils = trpc.useUtils();
  const [statusNumber, setStatusNumber] = useState<string | null>(null);
  const [profileNumber, setProfileNumber] = useState<string | null>(null);

  useEffect(() => {
    const onStatus = (e: Event) => setStatusNumber((e as CustomEvent).detail?.number ?? null);
    const onProfile = (e: Event) => setProfileNumber((e as CustomEvent).detail?.number ?? null);
    window.addEventListener(OPEN_STATUS, onStatus);
    window.addEventListener(OPEN_PROFILE, onProfile);
    return () => {
      window.removeEventListener(OPEN_STATUS, onStatus);
      window.removeEventListener(OPEN_PROFILE, onProfile);
    };
  }, []);

  /* ── status viewer (global) ── */
  const feed = trpc.status.feed.useQuery(undefined, {
    staleTime: 20_000,
    enabled: statusNumber != null,
  });
  const groups = feed.data?.groups ?? [];
  const statusIdx = statusNumber ? groups.findIndex((g) => g.owner.number === statusNumber) : -1;

  /* ── profile popup ── */
  const lookup = trpc.directory.lookup.useQuery(
    { number: profileNumber ?? "" },
    { enabled: !!profileNumber, staleTime: 10_000 }
  );
  const contactsQ = trpc.contacts.list.useQuery(undefined, {
    enabled: !!profileNumber,
    staleTime: 15_000,
  });
  const saved = !!profileNumber && (contactsQ.data ?? []).some((c) => c.number === profileNumber);
  const upsert = trpc.contacts.upsert.useMutation({
    onSuccess: () => {
      utils.contacts.list.invalidate();
      toast.success("Added to your contacts.");
    },
    onError: () => toast.error("Couldn't add the contact — try again."),
  });
  const openThread = trpc.messages.openThread.useMutation({
    onSuccess: (res) => {
      setProfileNumber(null);
      setLocation(`/app/messages?c=${res.conversationId}`);
    },
    onError: (err) => toast.error(err.message || "Couldn't open that conversation."),
  });

  const p = lookup.data;
  const statusInfo = usePeerStatusMap().get(profileNumber ?? "");

  return (
    <>
      {statusNumber != null && statusIdx >= 0 && (
        <StatusViewer
          groups={groups}
          startIndex={statusIdx}
          onClose={() => {
            setStatusNumber(null);
            utils.status.feed.invalidate();
          }}
        />
      )}

      <Dialog open={profileNumber != null} onOpenChange={(o) => !o && setProfileNumber(null)}>
        <DialogContent className="max-w-sm rounded-3xl p-6">
          {p ? (
            <div className="flex flex-col items-center text-center">
              <PeerAvatar
                number={p.number}
                name={p.displayName}
                avatarUrl={p.avatarUrl}
                size={72}
                clickable={p.number !== profileNumber || !!statusInfo?.hasAny}
              />
              <DialogTitle className="mt-3 flex items-center gap-1.5 text-lg font-bold">
                <span className="truncate max-w-[14rem]">{p.displayName || "Guest"}</span>
                {p.verified && <VerifiedBadge size={16} />}
              </DialogTitle>
              <div className="mt-0.5 font-mono text-sm text-muted-foreground" dir="ltr">
                {p.number.length === 6 ? `${p.number.slice(0, 3)}-${p.number.slice(3)}` : p.number}
              </div>
              {presenceLine(p) && (
                <div className={"mt-1.5 text-xs " + (p.isOnline ? "text-[color:var(--relay-online,#06d6a0)]" : "text-muted-foreground")}>
                  {presenceLine(p)}
                </div>
              )}

              <div className="mt-5 grid w-full grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => { if (profileNumber) openThread.mutate({ number: profileNumber }); }}
                  className="flex flex-col items-center gap-1.5 rounded-2xl bg-[#fb923c]/12 px-2 py-3 text-xs font-semibold text-[#fb923c] active:scale-95 transition-transform"
                >
                  <MessageSquare className="size-5" /> Message
                </button>
                <button
                  type="button"
                  onClick={() => { if (profileNumber && engine.dial(profileNumber, { voice: true, displayName: p.displayName })) setProfileNumber(null); }}
                  className="flex flex-col items-center gap-1.5 rounded-2xl bg-[#22c55e]/12 px-2 py-3 text-xs font-semibold text-[#22c55e] active:scale-95 transition-transform"
                >
                  <Phone className="size-5" /> Voice
                </button>
                <button
                  type="button"
                  onClick={() => { if (profileNumber && engine.dial(profileNumber, { voice: false, displayName: p.displayName })) setProfileNumber(null); }}
                  className="flex flex-col items-center gap-1.5 rounded-2xl bg-[#38bdf8]/12 px-2 py-3 text-xs font-semibold text-[#38bdf8] active:scale-95 transition-transform"
                >
                  <Video className="size-5" /> Video
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
                  {saved ? (<><Check className="size-4" /> In your contacts</>) : (<><UserPlus className="size-4" /> Add to contacts</>)}
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
                    <CircleUserRound className="size-4" /> View status
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <DialogTitle className="sr-only">Profile</DialogTitle>
              {lookup.isLoading ? "Loading profile…" : "This number isn't on RELAY."}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
