import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { X, Users, Camera, Check, Copy, Lock, Link2, Plus } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AvatarPicker } from "@/app/AvatarPicker";
import { ProfileStatusPicker } from "@/app/ProfileStatusPicker";
import { describeProfileStatus, type ProfileStatus } from "@shared/profileStatus";
import { hasPasscode } from "@/app/passcode";
import { isGroupLocked, removeGroupLock, setGroupLock, useGroupLocks } from "@/app/groupLock";
import { GROUP_PALETTE, peerPaletteIndex } from "@/app/peerColors";
import { presenceDot } from "@/app/presenceDot";

/* ══ BOARD 2i / 5g / 4h / 4i — the frame's own values, declared once ══════════════
 *
 * THE ACCENT IS ALWAYS READ FROM `--rb`, so this sheet breathes with the app's one
 * cycling hue rather than picking a fixed teal that would visibly disagree with the
 * tab bar and every other accent surface.
 *
 * EVERY FALLBACK IS A LITERAL. `var(--rb, var(--rb))` is a custom-property CYCLE:
 * it resolves to the guaranteed-invalid value and the browser DROPS the whole
 * declaration, leaving a chip with no colour at all (the v2.106.7 trap).
 *
 * THE BOARD'S GREYS ARE MAPPED ONTO THIS APP'S TOKENS rather than hardcoded
 * (#eafff6 → `text-foreground`, #8ea09b/#8fa39d → `text-muted-foreground`). This
 * sheet forces `dark` ON ITSELF so it renders dark in either theme, and a token can
 * be retuned — a wall of frozen hex could not follow it. Only the families with NO
 * token carry board literals: the cycling accent, the admin/locked gold, and the
 * per-person hues.
 *
 * INTERACTIVE LABELS ARE FLOORED AT 11px AND HIT TARGETS AT 44px. The board draws
 * several controls at 8–9.5px inside 27px chips; those are display sizes on a mock,
 * and a control nobody can read or hit is not the frame working. Board sizes are
 * kept verbatim for text that is read and not tapped (names 12.5, PINs 9.5 mono,
 * hints 9.5–11).
 */
const ACCENT = "var(--rb, #3FE0C5)";
const accent = (a: number) => `rgba(var(--rb-rgb, 63, 224, 197), ${a})`;
/** GOLD is admin / owner / LOCKED and nothing else — the board's one reserved hue. */
const GOLD = "#e8c94a";
const gold = (a: number) => `rgba(232, 201, 74, ${a})`;

/**
 * Board 2i's mono section voice (9.5–10px, .22em, uppercase). The same voice the
 * History day headers and the Contacts A–Z letters use, so one idea of "section
 * label" covers the app instead of this sheet inventing a second.
 */
const LABEL =
  "mb-2 block font-mono text-[10px] font-semibold uppercase tracking-[.22em] text-muted-foreground";

/**
 * A card INSIDE the sheet, at board 5g's radius 20 / padding 16.
 *
 * `.rglass` rather than the 5g card's own recipe, and that is a reading of the two
 * frames rather than a shortcut: 5g draws these cards straight on the canvas, where a
 * near-black gradient reads as RAISED — but 2i puts everything inside a sheet that is
 * already that gradient, so the same recipe there would read as flat. `.rglass` is the
 * board's raised tier and is what actually lifts a card off this surface.
 *
 * A named utility, never a runtime-composed Tailwind class: the JIT cannot see a
 * class assembled at render time and it comes out completely unstyled.
 */
const CARD = "rglass rounded-[20px] p-4";

/** Board 2i/5g's group disc: hue 190 ("group crew"), dark on-accent initials. */
const GROUP_DISC: CSSProperties = {
  background: "linear-gradient(135deg, hsl(190 65% 62%), hsl(235 70% 42%))",
  color: "#04211a",
};

/**
 * Board 5g's role tag — ONE shape shared by Creator and Admin, hoisted rather than
 * written out at each of the two sites: they are the same chip carrying a different
 * word, so two copies of an eleven-token class string is how they come to drift.
 *
 * Gold (`#e8c94a`) is the app's ADMIN / OWNER / LOCKED colour and is spent on nothing
 * else here. The creator's is FILLED and an appointed admin's is an OUTLINE, so the two
 * are distinguishable without reading either word — the creator's adminship is derived
 * from having made the group and cannot be revoked, which is a stronger fact.
 */
const ROLE_TAG =
  "shrink-0 rounded-[10px] px-2 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-[.14em]";
const ROLE_TAG_CREATOR: CSSProperties = {
  background: gold(0.14),
  border: `1px solid ${gold(0.45)}`,
  color: GOLD,
};
const ROLE_TAG_ADMIN: CSSProperties = {
  border: `1px solid ${gold(0.35)}`,
  color: GOLD,
};

/**
 * One member's avatar hue, taken from the SAME palette their chat bubbles use
 * (`peerColors`), so one person is one colour across the group — rather than a
 * second hash here that would hand the same person two identities.
 *
 * White initials, not the board's `#04211a`: that dark-on-accent pairing is measured
 * against BRIGHT hues, and this palette runs through deep violet and crimson where it
 * would be unreadable. `#fff` is the colour these gradients were measured with.
 */
function memberDisc(identityId: number): CSSProperties {
  const c = GROUP_PALETTE[peerPaletteIndex(identityId)];
  return { background: `linear-gradient(135deg,${c.from},${c.to})`, color: "#fff" };
}

/** First letter of whatever we can name somebody by. */
function initialOf(name: string): string {
  const t = name.trim();
  return t ? t.charAt(0).toUpperCase() : "?";
}

/** Up to two initials for the group's own disc (board 2i draws "DC"). */
function groupInitials(title: string | null): string {
  const words = (title ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

/**
 * A member's presence LED (board 2i: "avatar + presence").
 *
 * `presenceDot` is the ONE rule every dot in the app reads — Contacts, the thread
 * list, the chat header — so this cannot come to disagree with them about the same
 * person, which is exactly the divergence v2.99.95 was about. Nothing is drawn at all
 * without a real answer: a grey dot would positively claim "offline" about somebody
 * whose presence has simply not loaded.
 */
function MemberDot({ p }: { p?: { isOnline: boolean; idle: boolean; inCall: boolean } }) {
  if (!p) return null;
  const d = presenceDot(p);
  return (
    <span
      aria-label={d.label}
      title={d.label}
      className="absolute -bottom-0.5 -end-0.5 size-[11px] rounded-full border-2 border-card"
      style={{ background: d.color, boxShadow: d.glow }}
    />
  );
}

/**
 * The group's invite link (v2.105.9, #114) — ADMIN-ONLY, and its own component so the
 * link state cannot leak into the sheet's save/status state.
 *
 * NOTHING IS MINTED UNTIL ASKED. A link is a bearer capability, so generating one on
 * every sheet open would put a live invite in the clipboard-adjacent DOM of anybody who
 * looked at the group's details. It takes a tap, and the tap is what creates it.
 *
 * REVOKE IS CONFIRMED, because it cannot be undone for the people holding the old link
 * and the copy has to say what actually happens: existing members stay, only the link
 * stops working.
 *
 * THE AUDIENCE IS CHOSEN BEFORE MINTING (v2.105.23) and is baked into the token, so two
 * links with different audiences can be live at once and picking one here never rewrites
 * a link already handed out. The label under a minted link is read back from the server's
 * echo of what it SIGNED, not from the picker — otherwise a failed mint could leave the
 * screen describing a restriction the token does not carry.
 *
 * BOARD 5g draws this as "WHO CAN JOIN WITH THE INVITE LINK": a three-way segmented
 * control, the link, and a red Revoke. Board 2i draws the minted link itself as an
 * accent-tinted row with a COPY action. Both are here — they are the two halves of one
 * control, and 4h (the landing card somebody OPENS the link with) is a different screen.
 */
type InviteAudience = "all" | "guest" | "registered";

/* Ordered as the frame orders the segmented control — narrowest audience first, so the
 * control reads left-to-right as "fewer people … more people". */
const AUDIENCE_OPTIONS: { value: InviteAudience; label: string; hint: string }[] = [
  { value: "guest", label: "Guests only", hint: "only guest accounts can join." },
  {
    value: "registered",
    label: "Registered",
    hint: "only accounts with a verified email can join.",
  },
  { value: "all", label: "Everyone", hint: "guests and registered accounts can join." },
];

function InviteLinkSection({ conversationId }: { conversationId: number }) {
  const [link, setLink] = useState<string | null>(null);
  const [linkAudience, setLinkAudience] = useState<InviteAudience>("all");
  const [audience, setAudience] = useState<InviteAudience>("all");
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const create = trpc.messages.createGroupInvite.useMutation({
    onSuccess: (r) => {
      setLink(`${window.location.origin}${r.path}`);
      setLinkAudience(r.audience);
    },
    onError: (e) => toast.error(e.message || "Couldn't create an invite link."),
  });
  const revoke = trpc.messages.revokeGroupInvites.useMutation({
    onSuccess: () => {
      // The old link is dead, so holding onto it on screen would be a lie.
      setLink(null);
      setConfirmRevoke(false);
      toast.success("Invite links revoked — old links no longer work.");
    },
    onError: (e) => toast.error(e.message || "Couldn't revoke the invite links."),
  });

  return (
    <section className={CARD}>
      <div className={LABEL}>Who can join with the invite link</div>
      {/* WHO THE NEXT LINK IS FOR. Stays visible after minting, because changing it and
          tapping again is how an admin gets a SECOND link for a different audience —
          both remain valid, which is the whole reason the audience lives in the token.

          BOTH HALVES OF THE CONTROL ARE CONVERTED to the frame's values, selected AND
          unselected: a half-converted segmented control puts a raised grey tile beside a
          cycling accent one and the two visibly disagree about what selected means. */}
      <div role="radiogroup" aria-label="Who can join with this link" className="flex gap-1.5">
        {AUDIENCE_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={audience === o.value}
            onClick={() => setAudience(o.value)}
            className="min-h-11 flex-1 rounded-[10px] px-1 text-[11px] leading-tight transition-colors"
            style={
              audience === o.value
                ? {
                    background: accent(0.16),
                    border: `1.5px solid ${accent(0.55)}`,
                    color: "#f0fffa",
                    fontWeight: 700,
                  }
                : {
                    background: "rgba(255,255,255,.04)",
                    border: "1px solid rgba(255,255,255,.12)",
                    color: "var(--muted-foreground)",
                    fontWeight: 600,
                  }
            }
          >
            {o.label}
          </button>
        ))}
      </div>
      {/* NAMED AS "the next link", because this caption and the one under an already-minted
          link below describe DIFFERENT links and sit next to each other: pick Guests after
          minting a registered-only link and the two lines legitimately disagree. Saying
          which is which is the whole point of a per-link audience. */}
      <p className="mt-2.5 text-[11px] text-muted-foreground">
        The next link you create: {AUDIENCE_OPTIONS.find((o) => o.value === audience)?.hint}
      </p>
      {link ? (
        <div className="mt-3 space-y-2">
          {/* Board 2i's invite row: accent-tinted, link glyph, mono link, COPY. */}
          <div
            className="flex items-center gap-2.5 rounded-[13px] px-3 py-1.5"
            style={{ background: accent(0.08), border: `1px solid ${accent(0.3)}` }}
          >
            <Link2 className="size-[13px] shrink-0" style={{ color: ACCENT }} aria-hidden />
            <span
              dir="ltr"
              className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/85 [unicode-bidi:isolate]"
            >
              {link}
            </span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(link).then(
                  () => toast.success("Link copied"),
                  () => toast.error("Couldn't copy — select and copy it by hand."),
                );
              }}
              className="-me-1 grid min-h-11 shrink-0 place-items-center px-2 font-mono text-[11px] font-semibold tracking-[.1em]"
              style={{ color: ACCENT }}
            >
              <Copy className="size-3.5" aria-hidden /> <span className="sr-only">Copy link</span>
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {linkAudience === "registered"
              ? "Only registered accounts can join with this link."
              : linkAudience === "guest"
                ? "Only guest accounts can join with this link."
                : "Anyone with this link can join."}{" "}
            It expires in 7 days, and whoever joins sees only messages sent from then on.
          </p>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => create.mutate({ conversationId, audience })}
        disabled={create.isPending}
        className="rchip-accent mt-3 min-h-11 w-full rounded-[13px] px-4 text-[12px] font-bold disabled:opacity-60"
      >
        {create.isPending ? "Creating…" : link ? "Create another link" : "Create an invite link"}
      </button>
      {confirmRevoke ? (
        <div className="mt-3 rounded-[13px] border border-border/60 bg-muted/40 p-3">
          <p className="text-[11px] leading-relaxed">
            Revoke every invite link for this group? Anyone holding one can no longer join.
            Members who already joined stay in the group.
          </p>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={() => revoke.mutate({ conversationId })}
              disabled={revoke.isPending}
              className="min-h-11 flex-1 rounded-[9px] bg-destructive px-3 text-[12px] font-bold text-destructive-foreground disabled:opacity-60"
            >
              {revoke.isPending ? "Revoking…" : "Revoke"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmRevoke(false)}
              className="min-h-11 flex-1 rounded-[9px] border border-border px-3 text-[12px] font-semibold"
            >
              Keep it
            </button>
          </div>
        </div>
      ) : (
        /* Board 5g's red Revoke chip. Tinted rather than filled: it opens a confirmation
           rather than performing the revoke, so it must not wear the weight of the button
           that actually does it. */
        <button
          type="button"
          onClick={() => setConfirmRevoke(true)}
          className="mt-2 min-h-11 rounded-[9px] border border-destructive/40 bg-destructive/10 px-3 text-[11px] font-bold text-destructive"
        >
          Revoke all invite links
        </button>
      )}
    </section>
  );
}

/**
 * The 4-digit lock on this group, ON THIS DEVICE (v2.105.20, the last piece of #108).
 *
 * NOT ADMIN-GATED, and that is a decision rather than an omission. `invite-link` above
 * is admin-only because it admits strangers to a group everybody shares; a lock changes
 * what appears on the ACTOR'S OWN SCREEN and grants them nothing over anybody else, so
 * requiring adminship would be a category error — it would stop an ordinary member
 * hiding a chat on their own phone.
 *
 * IT REFUSES WITHOUT AN APP PASSCODE rather than warning, because the app passcode is
 * the only route back from a forgotten code (see `groupLock.ts`). Offering a control
 * that strands you is worse than not offering it, so the refusal says where to go.
 *
 * BOARD 4i IS WHERE THE COLOUR COMES FROM: it draws the locked group with a GOLD lock
 * puck and gold PIN dots, and gives the ACCENT to exactly one thing — the app-passcode
 * escape. Gold means admin / owner / locked in this app, so the lock affordances wear it
 * and the accent is left for the escape, which is what 4i does. The gate screen itself
 * (the dots and the keypad) lives in the conversation view, not here; this is where the
 * lock is SET, so what 4i contributes here is its vocabulary and its footer note.
 */
function GroupLockSection({ conversationId }: { conversationId: number }) {
  useGroupLocks();
  const locked = isGroupLocked(conversationId);
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"idle" | "set" | "remove">("idle");
  const canLock = hasPasscode();

  async function apply() {
    if (mode === "set") {
      const r = await setGroupLock(conversationId, code);
      if (r === "ok") {
        toast.success("Locked. It hides on this device when you reload or leave the chat.");
        setMode("idle");
        setCode("");
        return;
      }
      toast.error(
        r === "bad-code"
          ? "Use exactly four digits."
          : r === "needs-app-passcode"
            ? "Set an app passcode first — Profile → App lock."
            : "This browser won't let RELAY store the lock."
      );
      return;
    }
    if (await removeGroupLock(conversationId, code)) {
      toast.success("Lock removed on this device.");
      setMode("idle");
      setCode("");
    } else {
      toast.error("That's not the group code or your app passcode.");
    }
  }

  return (
    <section className={CARD}>
      <div className="flex items-center gap-2.5">
        {/* Board 4i's gold lock puck. */}
        <span
          className="grid size-[26px] shrink-0 place-items-center rounded-full"
          style={{ background: "#0d1316", border: `1px solid ${gold(0.5)}` }}
        >
          <Lock className="size-3" style={{ color: GOLD }} aria-hidden="true" />
        </span>
        <Label className="text-[12.5px] font-semibold">Lock this chat on this device</Label>
        {locked && (
          <span
            className="ms-auto shrink-0 rounded-[10px] px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[.14em]"
            style={{ background: gold(0.14), border: `1px solid ${gold(0.45)}`, color: GOLD }}
          >
            Locked
          </span>
        )}
      </div>
      {/* WHAT IT IS, before what it does. Without this the control reads as a
          permission, which it is not: every member still has these messages and this
          account on another device still shows them. */}
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Hides the chat and its preview behind a 4-digit code on this device. It is not a
        permission — everyone in the group still has these messages, and your other
        devices still show them.
      </p>

      {!canLock ? (
        <p className="mt-2.5 text-[11px] font-medium text-muted-foreground">
          Set an app passcode first (Profile → App lock). It is the only way back if you
          forget the group code.
        </p>
      ) : mode === "idle" ? (
        <button
          type="button"
          onClick={() => {
            setCode("");
            setMode(locked ? "remove" : "set");
          }}
          className="mt-2.5 min-h-11 rounded-[9px] px-3 text-[11px] font-bold"
          style={{ background: gold(0.12), border: `1px solid ${gold(0.4)}`, color: GOLD }}
        >
          {locked ? "Remove the lock" : "Set a 4-digit code"}
        </button>
      ) : (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Input
            autoFocus
            type="password"
            inputMode="numeric"
            maxLength={4}
            dir="ltr"
            value={code}
            aria-label={mode === "set" ? "New group lock code" : "Group lock code or app passcode"}
            placeholder="••••"
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
            className="h-11 w-24 text-center font-mono tracking-[0.3em] tabular-nums"
          />
          <button
            type="button"
            disabled={code.length !== 4}
            onClick={() => void apply()}
            className="min-h-11 rounded-[9px] px-3 text-[11px] font-bold disabled:opacity-40"
            style={{ background: gold(0.16), border: `1px solid ${gold(0.5)}`, color: GOLD }}
          >
            {mode === "set" ? "Lock" : "Remove"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("idle");
              setCode("");
            }}
            className="min-h-11 rounded-[9px] border border-border px-3 text-[11px] font-semibold"
          >
            Cancel
          </button>
        </div>
      )}
      {/* Board 4i's own footer note, and it is TRUE here rather than aspirational: the
          thread row redacts a locked group's preview (v2.105.20). */}
      <p className="mt-2.5 text-[9.5px] text-muted-foreground">
        Locked groups never show previews in the thread list.
      </p>
    </section>
  );
}

/**
 * A group's own name, photo and status (v2.102.1) — the editor for the data v2.102.0
 * added. Opened by tapping a group's conversation header, which until now did nothing
 * at all for a group (it only ever opened a peer's profile for a DM), so a dead tap
 * becomes the way in.
 *
 * ANY MEMBER MAY EDIT, and the check is the SERVER's (`setGroupProfile` re-derives
 * membership itself). This component does not gate anything — it cannot, because a
 * client-side check on a row several people share is a suggestion, not a rule.
 *
 * NOTHING HERE IS OPTIMISTIC. It writes a row other people are looking at, so a
 * failure that had already been painted as success would leave this member believing
 * they renamed a group that everybody else still sees under the old name. The field
 * follows the server and only the SAVE reports.
 *
 * ── BOARD 2i + 5g, AND WHAT THIS APP HAS THAT THE FRAMES DO NOT ────────────────────
 * 2i gives the sheet its material, hero and member rows; 5g gives the controls their
 * cards. Everything this app has beyond the mock is KEPT and restyled rather than
 * dropped to match a frame: add/remove member, the "all members can add" toggle, the
 * group's 6-digit ID, the group status, the invite-link AUDIENCE picker with its
 * revoke, and the 4-digit group lock.
 *
 * THREE FRAME ITEMS ARE DELIBERATELY DECLINED, each because taking it would ship a
 * control that cannot work (the v2.103.3 rule):
 *  - 2i's Call / Video / Mute hero chips. This sheet holds no call engine and no mute
 *    writer, and the conversation header DIRECTLY BEHIND it already carries Voice and
 *    Video for a group (v2.105.7). Drawing them here would be either dead buttons or a
 *    second home for an action that already has one.
 *  - 2i's red "Leave group" footer. Leaving does not exist in this app —
 *    `removeGroupMember` refuses removing YOURSELF precisely because that is leaving
 *    and it has not been built (v2.105.16). A Leave row would always refuse.
 *  - the starburst TIER badge beside each member's name. `conversationInfo` returns no
 *    tier for a member, so it cannot be rendered here without a server field. The ROLE
 *    tag the frame shows next to it (Creator gold / Admin) is rendered.
 */
export function GroupInfoSheet({
  open,
  onClose,
  conversationId,
  title,
  number,
  avatarUrl,
  status,
  statusNote,
}: {
  open: boolean;
  onClose: () => void;
  conversationId: number;
  title: string | null;
  number: string | null;
  avatarUrl: string | null;
  status: string | null;
  statusNote: string | null;
}) {
  const utils = trpc.useUtils();
  const [pickingAvatar, setPickingAvatar] = useState(false);
  const [name, setName] = useState(title ?? "");
  // Same rule as the status note: follow the server when it changes underneath us,
  // but never while this field is being edited, or a refetch erases what somebody is
  // halfway through typing.
  const [editingName, setEditingName] = useState(false);
  useEffect(() => {
    if (!editingName) setName(title ?? "");
  }, [title, editingName]);

  const info = trpc.messages.conversationInfo.useQuery(
    { conversationId },
    { enabled: open, staleTime: 60_000 },
  );

  const save = trpc.messages.setGroupProfile.useMutation({
    onSuccess: async () => {
      // Both reads, because the thread LIST renders the group's photo, id and status
      // as well as this sheet — invalidating one would leave the other advertising
      // what was just changed.
      await utils.messages.threads.invalidate();
      await utils.messages.conversationInfo.invalidate({ conversationId });
    },
    onError: (e) => toast.error(e.message || "Couldn't save that — nothing changed."),
  });

  /**
   * Appoint or revoke an admin (v2.104.0). NOT optimistic: it changes what other people
   * are allowed to do, so a failure already painted as success would leave this admin
   * believing they promoted somebody the server refused — the same reasoning that keeps
   * the profile writes above non-optimistic.
   *
   * Only `conversationInfo` is invalidated, because a role appears nowhere in the thread
   * list. The profile writes invalidate both because they change what the list renders.
   */
  const role = trpc.messages.setGroupRole.useMutation({
    onSuccess: async () => {
      await utils.messages.conversationInfo.invalidate({ conversationId });
    },
    onError: (e) => toast.error(e.message || "Couldn't change that — nothing changed."),
  });
  // Read from the SERVER's own answer, never inferred client-side: this sheet gates
  // nothing (the server is the gate), so this only decides what to OFFER.
  const iAmAdmin = !!info.data?.members.find((m) => m.isMe)?.isAdmin;

  /* ROSTER MANAGEMENT (v2.105.16, #108). None of these is optimistic: each writes a row
     several people are looking at, so a failure painted as success would leave this
     member believing they changed a roster everybody else still sees unchanged (the
     v2.102.1 reasoning). Only `conversationInfo` is invalidated by the add/remove pair —
     the thread list renders a group's name and photo, not who is in it. */
  const [addNumber, setAddNumber] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const addMember = trpc.messages.addGroupMember.useMutation({
    onSuccess: async (res) => {
      setAddNumber("");
      setAddError(null);
      toast.success(
        res.added
          ? `Added ${res.displayName || "them"} to the group.`
          : `${res.displayName || "They"} were already in this group.`,
      );
      await utils.messages.conversationInfo.invalidate({ conversationId });
    },
    // The server's own wording: "not a RELAY user yet" and "already in this group" need
    // different things from the reader, which is why they are named separately.
    onError: (e) => setAddError(e.message || "Couldn't add them."),
  });
  /** Which member a Remove has been requested for, held until it is confirmed. */
  const [removing, setRemoving] = useState<{ id: number; name: string } | null>(null);
  const removeMember = trpc.messages.removeGroupMember.useMutation({
    onSuccess: async () => {
      setRemoving(null);
      await utils.messages.conversationInfo.invalidate({ conversationId });
    },
    onError: (e) => {
      setRemoving(null);
      toast.error(e.message || "Couldn't remove them.");
    },
  });
  const setCanAdd = trpc.messages.setGroupMembersCanAdd.useMutation({
    onSuccess: async () => {
      await utils.messages.conversationInfo.invalidate({ conversationId });
    },
    onError: (e) => toast.error(e.message || "Couldn't change that — nothing changed."),
  });

  /**
   * Board 2i's "5 members · 3 online", and the presence LED on each member's disc.
   *
   * READ THROUGH `directory.presenceMany`, the ONE reader every other surface uses,
   * rather than a second presence rule here: that funnel already applies the
   * guest-privacy suppression (v2.95) and the idle/online distinction (v2.99.92), and
   * re-deriving is how a sheet comes to disagree with the LEDs on the very same people
   * (the v2.99.95 divergence).
   *
   * MYSELF EXCLUDED from the count and the dots, because "3 online" is about who ELSE
   * is here — you are reading the screen, so counting yourself makes an empty group
   * read as "1 online".
   */
  const memberNumbers = useMemo(
    () =>
      (info.data?.members ?? [])
        .filter((m) => !m.isMe && /^\d{6}$/.test(m.number))
        .map((m) => m.number),
    [info.data],
  );
  const presence = trpc.directory.presenceMany.useQuery(
    { numbers: memberNumbers },
    { enabled: open && memberNumbers.length > 0, staleTime: 20_000, refetchInterval: 30_000 },
  );
  const presenceByNumber = useMemo(() => {
    const map = new Map<string, { isOnline: boolean; idle: boolean; inCall: boolean }>();
    for (const r of presence.data ?? []) map.set(r.number, r);
    return map;
  }, [presence.data]);
  /* WITHHELD at zero and while the query is in flight: "0 online" is a claim about a
     group, and a wrong one before an answer has landed. Undefined renders nothing,
     which is the honest degraded state. */
  const onlineCount = presence.data
    ? presence.data.filter((r) => r.isOnline).length
    : undefined;

  // The early return TOLERATES an open avatar picker, and that is the whole reason it
  // is written this way: a bare `if (!open) return null` unmounts the picker along with
  // the sheet, so a close arriving while somebody is mid-upload would tear the upload's
  // own component out from under it. The sheet's body is gated on `open` below instead.
  if (!open && !pickingAvatar) return null;

  const statusText = describeProfileStatus(status, statusNote);
  const memberCount = info.data?.members.length ?? 0;
  const commitName = () => {
    setEditingName(false);
    const next = name.trim().slice(0, 128);
    if (next === (title ?? "")) return;
    save.mutate({ conversationId, title: next });
  };

  const copyNumber = async () => {
    if (!number) return;
    try {
      await navigator.clipboard.writeText(number);
      toast.success("Group ID copied.");
    } catch {
      // A denied clipboard is not an error worth a red toast — the digits are on
      // screen and can be read.
    }
  };

  return (
    <>
      {open && (
      <div
        className="dark fixed inset-0 z-[120] grid place-items-end sm:place-items-center p-0 sm:p-4 text-foreground"
        role="dialog"
        aria-modal="true"
        aria-label="Group info"
      >
        <div aria-hidden className="glass-overlay absolute inset-0" onClick={onClose} />
        {/* Board 2i's sheet: near-black gradient, hairline, deep drop shadow, radius 24.
            Written inline rather than through the `.rsheet` utility, because that one is
            scoped `.dark.relay-v2` — BOTH classes on ONE ancestor — while this sheet
            forces `dark` on ITSELF so it renders dark in either theme. The utility would
            simply not match in light mode, and the sheet would lose its material in
            exactly the theme where it still needs one. */}
        <div
          className="relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-[24px] shadow-2xl sm:w-[min(94vw,440px)] sm:rounded-[24px]"
          style={{
            background: "linear-gradient(180deg, rgba(15,21,25,.94), rgba(8,12,15,.96))",
            border: "1px solid rgba(255,255,255,.13)",
            boxShadow: "0 30px 80px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.14)",
          }}
        >
          <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-[15px]">
            <h2 className="text-[15px] font-bold">Group info</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-me-2 grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <X className="size-[17px]" />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {/* Photo + id — board 2i's hero, with 5g's group-number row under it. */}
            <div className="flex flex-col items-center gap-0">
              <button
                type="button"
                onClick={() => setPickingAvatar(true)}
                aria-label="Change the group photo"
                className="group relative rounded-[26px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {/* The disc is UNDERNEATH the photo rather than its else-branch, which is
                    what finally makes the "degrades to the glyph" promise true: hiding a
                    broken <img> used to leave a 76px hole, since nothing was behind it. */}
                <span
                  className="relative grid size-[76px] place-items-center overflow-hidden rounded-[26px] text-2xl font-bold"
                  style={GROUP_DISC}
                >
                  {groupInitials(title) || <Users className="size-10" />}
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt=""
                      className="absolute inset-0 size-full object-cover"
                      onError={(e) => {
                        // A broken photo degrades to the glyph, never the browser's
                        // broken-image icon — the rule PeerAvatar already follows.
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : null}
                </span>
                <span
                  aria-hidden="true"
                  className="absolute -bottom-1 -right-1 grid size-8 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground"
                >
                  <Camera className="size-4" />
                </span>
              </button>

              <div className="mt-[11px] text-center text-lg font-bold">
                {title?.trim() || "Untitled group"}
              </div>
              {/* "N members · N online" — the count is the frame's, and the online half
                  is withheld until a real answer lands (see the query above). */}
              {info.data && (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {memberCount} {memberCount === 1 ? "member" : "members"}
                  {onlineCount != null && onlineCount > 0 && (
                    <>
                      {" · "}
                      <span style={{ color: "var(--relay-green-text, #06d6a0)" }}>
                        {onlineCount} online
                      </span>
                    </>
                  )}
                </div>
              )}

              {/* The group's own 6-digit id, grouped the way every number in RELAY is,
                  dir="ltr" so an RTL locale cannot reorder the digits. Board 5g renders
                  it in the ACCENT, mono, with a copy affordance and a line saying what it
                  is — a group id is dialable, which is most of the reason to have one. */}
              {number && /^\d{6}$/.test(number) ? (
                <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2">
                  <button
                    type="button"
                    onClick={copyNumber}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-mono text-[11px] font-semibold transition-colors hover:bg-white/[0.06]"
                    style={{ color: ACCENT, border: `1px solid ${accent(0.32)}` }}
                    dir="ltr"
                  >
                    {number.slice(0, 3)}-{number.slice(3)}
                    <Copy aria-hidden="true" className="size-[11px]" />
                    <span className="sr-only">Copy this group's ID</span>
                  </button>
                  <span className="text-[10px] text-muted-foreground">
                    · group number — dialable
                  </span>
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  This group has no ID — it was created before group IDs existed.
                </p>
              )}
              {/* Board 5g's status chip. Not a control: the picker below is where it is
                  set, so a tappable-looking chip here would be a second one. */}
              {statusText && (
                <span
                  className="mt-2 rounded-2xl px-3 py-1 text-[10px] font-semibold text-foreground/85"
                  style={{
                    background: "rgba(255,255,255,.05)",
                    border: "1px solid rgba(255,255,255,.12)",
                  }}
                >
                  {statusText}
                </span>
              )}
            </div>

            {/* Name */}
            <div>
              <Label htmlFor="group-name" className={LABEL}>
                Group name
              </Label>
              {/* The accent focus ring board 3d gives the group-name field, on
                  `focus-within` rather than permanently: an always-lit field stops
                  meaning "you are typing here". */}
              <div className="rounded-[13px] transition-shadow focus-within:shadow-[0_0_0_3px_rgba(var(--rb-rgb,63,224,197),0.12)]">
                <Input
                  id="group-name"
                  value={name}
                  maxLength={128}
                  placeholder="Untitled group"
                  disabled={save.isPending}
                  onFocus={() => setEditingName(true)}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="rounded-[13px]"
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Leave it blank to fall back to the members' names.
              </p>
            </div>

            {/* Status — the SAME picker a person's profile uses. */}
            <div>
              <div className={LABEL}>Status</div>
              <ProfileStatusPicker
                idPrefix="group-status"
                value={status}
                note={statusNote}
                pending={save.isPending}
                // A group has no presence, so there is nothing for "presence decides"
                // to mean here — hence its own empty hint rather than the person one.
                emptyHint="No status — nothing extra is shown beside the group's name."
                onPick={(k: ProfileStatus | null) =>
                  save.mutate({ conversationId, profileStatus: k ?? "" })
                }
                onSaveNote={(next) => save.mutate({ conversationId, statusNote: next })}
              />
            </div>

            {/* Members — board 5g's "MEMBERS · 5" card. Each row is avatar (+presence) ·
                name · role tag · PIN, with the admin/remove controls on the same flex row
                so they WRAP under the name on a narrow phone rather than squeezing it. */}
            <section className={CARD}>
              <div className={LABEL}>Members{info.data ? ` · ${memberCount}` : ""}</div>
              <ul>
                {(info.data?.members ?? []).map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] py-2 last:border-0">
                    <span
                      className="relative grid size-[34px] shrink-0 place-items-center overflow-visible rounded-full text-[11px] font-bold"
                      style={memberDisc(m.id)}
                    >
                      <span className="grid size-[34px] place-items-center overflow-hidden rounded-full">
                        {initialOf(m.displayName || m.number)}
                        {m.avatarUrl ? (
                          <img
                            src={m.avatarUrl}
                            alt=""
                            className="absolute inset-0 size-full object-cover"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : null}
                      </span>
                      {m.isMe ? null : <MemberDot p={presenceByNumber.get(m.number)} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate text-[12.5px] font-semibold">
                          {m.displayName || "Someone"}
                          {m.isMe && <span className="text-muted-foreground"> · you</span>}
                        </span>
                        {/* CREATOR is a fact, not a power — a creator and an admin can do
                            exactly the same things, so it is labelled separately and only
                            one of the two labels is ever shown.
                            BOTH WEAR GOLD, which is the board's reserved admin/owner hue:
                            the creator's tag is FILLED and an appointed admin's is an
                            outline, so rank is legible without spending a second colour on
                            a meaning gold already carries. The word stays "Creator"
                            rather than the frame's "OWNER" — v2.104.0 chose it
                            deliberately, and an explicit earlier decision is not something
                            a later visual spec overrules. */}
                        {m.isCreator ? (
                          <span className={ROLE_TAG} style={ROLE_TAG_CREATOR}>
                            Creator
                          </span>
                        ) : m.isAdmin ? (
                          <span className={ROLE_TAG} style={ROLE_TAG_ADMIN}>
                            Admin
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block font-mono text-[9.5px] text-muted-foreground" dir="ltr">
                        {m.number}
                      </span>
                    </span>
                    {/* The control renders only for an admin, and never against the
                        creator — their adminship is derived from who made the group, so
                        no stored value could remove it and a button that appears to work
                        and changes nothing is worse than none. The SERVER refuses both
                        cases regardless; this only avoids offering them. */}
                    {iAmAdmin && !m.isCreator && (
                      <button
                        type="button"
                        disabled={role.isPending}
                        onClick={() =>
                          role.mutate({
                            conversationId,
                            targetIdentityId: m.id,
                            role: m.isAdmin ? null : "admin",
                          })
                        }
                        className="min-h-11 shrink-0 rounded-[9px] border px-2.5 text-[11px] font-semibold transition-colors disabled:opacity-50"
                        style={{ borderColor: gold(0.35), color: GOLD }}
                      >
                        {m.isAdmin ? "Remove admin" : "Make admin"}
                      </button>
                    )}
                    {/* REMOVE FROM GROUP (v2.105.16). Admin-only with NO toggle — "all
                        users can add" says add, and one member ejecting another is a
                        different, larger power. Withheld against the CREATOR (removing
                        them would strip the group of its own admin with no route back)
                        and against YOURSELF (that is leaving, which does not exist yet,
                        so the button would wear the wrong label). The server refuses all
                        three regardless; this only avoids offering them. */}
                    {iAmAdmin && !m.isCreator && !m.isMe && (
                      <button
                        type="button"
                        disabled={removeMember.isPending}
                        onClick={() => setRemoving({ id: m.id, name: m.displayName || "Someone" })}
                        aria-label={`Remove ${m.displayName || "this member"} from the group`}
                        className="min-h-11 shrink-0 rounded-[9px] border border-destructive/40 bg-destructive/10 px-2.5 text-[11px] font-bold text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {/* REMOVAL IS CONFIRMED, and the copy names what actually happens — that
                  their messages STAY is the part somebody would otherwise assume the
                  opposite of. Matches this file's own inline-confirm shape (the invite
                  revoke) rather than importing a dialog, so the sheet keeps one
                  confirmation idiom. */}
              {removing && (
                <div className="mt-3 rounded-[13px] border border-border/60 bg-muted/40 p-3">
                  <p className="text-[11px] leading-relaxed">
                    Remove {removing.name} from this group? They lose access to it. Messages
                    they already sent stay — those are part of everybody's history here.
                  </p>
                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        removeMember.mutate({ conversationId, identityId: removing.id })
                      }
                      disabled={removeMember.isPending}
                      className="min-h-11 flex-1 rounded-[9px] bg-destructive px-3 text-[12px] font-bold text-destructive-foreground disabled:opacity-60"
                    >
                      {removeMember.isPending ? "Removing…" : "Remove"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoving(null)}
                      className="min-h-11 flex-1 rounded-[9px] border border-border px-3 text-[12px] font-semibold"
                    >
                      Keep them
                    </button>
                  </div>
                </div>
              )}

              {/* ADD SOMEBODY BY NUMBER (v2.105.16, #108), drawn as board 5g's accent
                  "Add by 6-digit number" row with the field it needs beneath it.
                  Offered to an admin, and to an ORDINARY MEMBER only when the group's own
                  "all users can add" is on — read from the SERVER's answer rather than
                  inferred, so the control and the rule that governs it cannot disagree. */}
              {(iAmAdmin || info.data?.membersCanAdd) && (
                <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
                  <div className="flex items-center gap-1.5" style={{ color: ACCENT }}>
                    <Plus className="size-3" aria-hidden="true" />
                    <span className="text-[11.5px] font-bold">Add by 6-digit number</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      // Text with a numeric keypad: type="number" brings spinners,
                      // accepts "1e5" and drops a leading zero.
                      type="text"
                      inputMode="numeric"
                      dir="ltr"
                      autoComplete="off"
                      maxLength={9}
                      placeholder="777777"
                      value={addNumber}
                      onChange={(e) => {
                        setAddNumber(e.target.value);
                        setAddError(null);
                      }}
                      aria-label="Add someone to this group by their 6-digit number"
                      className="h-11 w-32 rounded-[9px] border border-border bg-background px-3 text-center font-mono text-sm tracking-[0.12em] outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      disabled={!/^\d{6}$/.test(addNumber.replace(/[\s\-.]/g, "")) || addMember.isPending}
                      onClick={() => addMember.mutate({ conversationId, number: addNumber })}
                      className="rchip-accent min-h-11 rounded-[9px] px-4 text-[12px] font-bold transition disabled:opacity-50"
                    >
                      {addMember.isPending ? "Adding…" : "Add"}
                    </button>
                  </div>
                  {/* The server's own message: "not a RELAY user" and "already a member"
                      need different things from the reader. */}
                  {addError && <p className="text-[11px] text-destructive">{addError}</p>}
                  <p className="text-[9.5px] text-muted-foreground">
                    They'll see messages from when they join, not the history before it.
                  </p>
                </div>
              )}

              <p className="mt-3 text-[9.5px] leading-relaxed text-muted-foreground">
                Any member can change the name, photo and status.{" "}
                {info.data
                  ? info.data.hasAdmin
                    ? "Admins can also remove anyone's message."
                    : // SAID PLAINLY rather than hidden: a group created before group IDs
                      // existed has no creator recorded, so it has no admin and no way to
                      // appoint one. Nothing about it regresses — every member keeps what
                      // they have today — but the feature does not reach it.
                      "This group was created before admins existed, so it has none. Start a new group to use admin controls."
                  : ""}
              </p>
            </section>

            {/* WHO MAY ADD (v2.105.16) — admin-only, and absent rather than disabled for
                everyone else (the v2.103.3 rule). Board 5g gives it a card of its own with
                the switch on the right, so the whole card IS the switch: one 44px-plus hit
                target instead of a 20px toggle beside inert copy. */}
            {iAmAdmin && (
              <button
                type="button"
                role="switch"
                aria-checked={!!info.data?.membersCanAdd}
                disabled={setCanAdd.isPending}
                onClick={() =>
                  setCanAdd.mutate({ conversationId, allowed: !info.data?.membersCanAdd })
                }
                className={`${CARD} flex w-full items-center gap-3 text-start transition-colors disabled:opacity-60`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-semibold">
                    All members can add people
                  </span>
                  <span className="mt-0.5 block text-[9.5px] text-muted-foreground">
                    Off = only the creator and admins can add. Removing people stays
                    admin-only either way.
                  </span>
                </span>
                {/* Board 5g's 34×20 switch with a 16px knob. The ON fill is the cycling
                    accent — NOT the presence green, which in this app means online and
                    nothing else. */}
                <span
                  aria-hidden
                  className="relative h-5 w-[34px] shrink-0 rounded-xl transition-colors"
                  style={{
                    background: info.data?.membersCanAdd
                      ? accent(0.85)
                      : "rgba(255,255,255,.12)",
                  }}
                >
                  <span
                    className={`absolute top-0.5 block size-4 rounded-full bg-[#eafff6] transition-all ${
                      info.data?.membersCanAdd ? "left-[16px]" : "left-0.5"
                    }`}
                  />
                </span>
              </button>
            )}

            {/* INVITE LINK (v2.105.9, #114) — ADMINS ONLY, and the section is absent
                rather than disabled for everyone else: a control that always refuses is
                worse than one that is not there (the v2.103.3 rule). */}
            {iAmAdmin && <InviteLinkSection conversationId={conversationId} />}
            {/* Any member, admin or not — it changes only this device (see the
                component's own note on why admin-gating it would be wrong). */}
            <GroupLockSection conversationId={conversationId} />

          </div>

          {save.isPending && (
            <div className="border-t border-white/[0.07] px-4 py-2.5 text-[11px] text-muted-foreground">
              Saving…
            </div>
          )}
          {!save.isPending && save.isSuccess && (
            <div className="flex items-center gap-1.5 border-t border-white/[0.07] px-4 py-2.5 text-[11px] text-[color:var(--relay-green-text)]">
              <Check className="size-3.5" /> Saved
            </div>
          )}
        </div>
      </div>
      )}

      {/* The picker writes through the GROUP's endpoint instead of the caller's own
          identity. Rendered outside the sheet's scroll area so closing a pane cannot
          unmount an open picker from under the user (the v2.99.89 rule). */}
      <AvatarPicker
        open={pickingAvatar}
        onClose={() => setPickingAvatar(false)}
        title="Choose a group photo"
        removeLabel="the group photo"
        displayName={title ?? "Group"}
        onSave={async (url) => {
          await save.mutateAsync({ conversationId, avatarUrl: url });
        }}
      />
    </>
  );
}
