import { useEffect, useState } from "react";
import { X, Users, Camera, Check, Copy, Lock } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AvatarPicker } from "@/app/AvatarPicker";
import { ProfileStatusPicker } from "@/app/ProfileStatusPicker";
import { describeProfileStatus, type ProfileStatus } from "@shared/profileStatus";
import { hasPasscode } from "@/app/passcode";
import { isGroupLocked, removeGroupLock, setGroupLock, useGroupLocks } from "@/app/groupLock";

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
 */
function InviteLinkSection({ conversationId }: { conversationId: number }) {
  const [link, setLink] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const create = trpc.messages.createGroupInvite.useMutation({
    onSuccess: (r) => setLink(`${window.location.origin}${r.path}`),
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
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Invite link</Label>
      {link ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-3 py-2.5">
            <span dir="ltr" className="min-w-0 flex-1 truncate text-xs [unicode-bidi:isolate]">
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
              className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs font-medium"
            >
              <Copy className="size-3.5" aria-hidden /> <span className="sr-only">Copy link</span>
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Anyone with this link can join. It expires in 7 days, and whoever joins sees only
            messages sent from then on.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => create.mutate({ conversationId })}
          disabled={create.isPending}
          className="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-medium disabled:opacity-60"
        >
          {create.isPending ? "Creating…" : "Create an invite link"}
        </button>
      )}
      {confirmRevoke ? (
        <div className="rounded-xl border border-border/60 bg-muted/40 p-3">
          <p className="text-xs">
            Revoke every invite link for this group? Anyone holding one can no longer join.
            Members who already joined stay in the group.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => revoke.mutate({ conversationId })}
              disabled={revoke.isPending}
              className="flex-1 rounded-lg bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground disabled:opacity-60"
            >
              {revoke.isPending ? "Revoking…" : "Revoke"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmRevoke(false)}
              className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-medium"
            >
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmRevoke(true)}
          className="text-[11px] text-muted-foreground underline underline-offset-2"
        >
          Revoke all invite links
        </button>
      )}
    </div>
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
    <div className="space-y-2 rounded-2xl border border-border/70 bg-card/40 p-3">
      <div className="flex items-center gap-2">
        <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Label className="text-xs font-semibold">Lock this chat on this device</Label>
      </div>
      {/* WHAT IT IS, before what it does. Without this the control reads as a
          permission, which it is not: every member still has these messages and this
          account on another device still shows them. */}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Hides the chat and its preview behind a 4-digit code on this device. It is not a
        permission — everyone in the group still has these messages, and your other
        devices still show them.
      </p>

      {!canLock ? (
        <p className="text-[11px] font-medium text-muted-foreground">
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
          className="text-[11px] text-muted-foreground underline underline-offset-2"
        >
          {locked ? "Remove the lock" : "Set a 4-digit code"}
        </button>
      ) : (
        <div className="flex items-center gap-2">
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
            className="h-9 w-24 text-center font-mono tracking-[0.3em] tabular-nums"
          />
          <button
            type="button"
            disabled={code.length !== 4}
            onClick={() => void apply()}
            className="rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground disabled:opacity-40"
          >
            {mode === "set" ? "Lock" : "Remove"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("idle");
              setCode("");
            }}
            className="text-[11px] text-muted-foreground underline underline-offset-2"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
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

  // The early return TOLERATES an open avatar picker, and that is the whole reason it
  // is written this way: a bare `if (!open) return null` unmounts the picker along with
  // the sheet, so a close arriving while somebody is mid-upload would tear the upload's
  // own component out from under it. The sheet's body is gated on `open` below instead.
  if (!open && !pickingAvatar) return null;

  const statusText = describeProfileStatus(status, statusNote);
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
        <div className="relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-border/60 bg-card/95 shadow-2xl backdrop-blur-2xl sm:w-[min(94vw,440px)] sm:rounded-3xl">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <h2 className="text-base font-bold">Group info</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {/* Photo + id */}
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => setPickingAvatar(true)}
                aria-label="Change the group photo"
                className="group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    className="size-24 rounded-full border border-border/60 bg-muted/40 object-cover"
                    onError={(e) => {
                      // A broken photo degrades to the glyph, never the browser's
                      // broken-image icon — the rule PeerAvatar already follows.
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <span
                    className="grid size-24 place-items-center rounded-full"
                    style={{ background: "rgba(167,139,250,.16)", color: "#a78bfa" }}
                  >
                    <Users className="size-10" />
                  </span>
                )}
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 right-0 grid size-8 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground"
                >
                  <Camera className="size-4" />
                </span>
              </button>

              {/* The group's own 6-digit id, grouped the way every number in RELAY is,
                  dir="ltr" so an RTL locale cannot reorder the digits. */}
              {number && /^\d{6}$/.test(number) ? (
                <button
                  type="button"
                  onClick={copyNumber}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/50 px-3 py-1 font-mono text-sm text-muted-foreground transition hover:bg-muted/60"
                  dir="ltr"
                >
                  {number.slice(0, 3)}-{number.slice(3)}
                  <Copy aria-hidden="true" className="size-3.5" />
                  <span className="sr-only">Copy this group's ID</span>
                </button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  This group has no ID — it was created before group IDs existed.
                </p>
              )}
              {statusText && <p className="text-sm text-muted-foreground">{statusText}</p>}
            </div>

            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="group-name" className="text-xs uppercase tracking-wider text-muted-foreground">
                Group name
              </Label>
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
              />
              <p className="text-[11px] text-muted-foreground">
                Leave it blank to fall back to the members' names.
              </p>
            </div>

            {/* Status — the SAME picker a person's profile uses. */}
            <div className="space-y-3">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Status</Label>
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

            {/* Members. v2.104.0 adds the Creator label, an Admin badge and — for an
                admin — the appoint/revoke control. ADDING and REMOVING people is still
                not here: that is its own release, because changing WHO is in a group has
                a larger blast radius than changing what it is called and deserves its
                own review (the block check and the member cap are the focus there). */}
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Members{info.data ? ` · ${info.data.members.length}` : ""}
              </Label>
              <ul className="divide-y divide-border/50 rounded-xl border border-border/60">
                {(info.data?.members ?? []).map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                    {m.avatarUrl ? (
                      <img
                        src={m.avatarUrl}
                        alt=""
                        className="size-8 shrink-0 rounded-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
                        {(m.displayName || "?").slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {m.displayName || "Someone"}
                      {m.isMe && <span className="text-muted-foreground"> · you</span>}
                      {/* CREATOR is a fact, not a power — a creator and an admin can do
                          exactly the same things, so it is labelled separately and only
                          one of the two labels is ever shown. */}
                      {m.isCreator ? (
                        <span className="ms-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                          Creator
                        </span>
                      ) : m.isAdmin ? (
                        <span className="ms-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          Admin
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground" dir="ltr">
                      {m.number}
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
                        className="shrink-0 rounded-lg border border-border/60 px-2 py-1 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted/60 disabled:opacity-50"
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
                        className="shrink-0 rounded-lg border border-destructive/40 px-2 py-1 text-[11px] font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
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
                <div className="rounded-xl border border-border/60 bg-muted/40 p-3">
                  <p className="text-xs">
                    Remove {removing.name} from this group? They lose access to it. Messages
                    they already sent stay — those are part of everybody's history here.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        removeMember.mutate({ conversationId, identityId: removing.id })
                      }
                      disabled={removeMember.isPending}
                      className="flex-1 rounded-lg bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground disabled:opacity-60"
                    >
                      {removeMember.isPending ? "Removing…" : "Remove"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoving(null)}
                      className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold"
                    >
                      Keep them
                    </button>
                  </div>
                </div>
              )}

              {/* ADD SOMEBODY BY NUMBER (v2.105.16, #108).
                  Offered to an admin, and to an ORDINARY MEMBER only when the group's own
                  "all users can add" is on — read from the SERVER's answer rather than
                  inferred, so the control and the rule that governs it cannot disagree. */}
              {(iAmAdmin || info.data?.membersCanAdd) && (
                <div className="space-y-1.5">
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
                      className="w-32 rounded-lg border border-border bg-background px-3 py-2 text-center font-mono text-sm tracking-[0.12em] outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      disabled={!/^\d{6}$/.test(addNumber.replace(/[\s\-.]/g, "")) || addMember.isPending}
                      onClick={() => addMember.mutate({ conversationId, number: addNumber })}
                      className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition disabled:opacity-50"
                    >
                      {addMember.isPending ? "Adding…" : "Add"}
                    </button>
                  </div>
                  {/* The server's own message: "not a RELAY user" and "already a member"
                      need different things from the reader. */}
                  {addError && <p className="text-[11px] text-destructive">{addError}</p>}
                  <p className="text-[11px] text-muted-foreground">
                    They'll see messages from when they join, not the history before it.
                  </p>
                </div>
              )}

              {/* WHO MAY ADD (v2.105.16) — admin-only, and absent rather than disabled for
                  everyone else (the v2.103.3 rule). */}
              {iAmAdmin && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!info.data?.membersCanAdd}
                  disabled={setCanAdd.isPending}
                  onClick={() =>
                    setCanAdd.mutate({ conversationId, allowed: !info.data?.membersCanAdd })
                  }
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-start transition hover:bg-muted/40 disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold">Any member can add people</span>
                    <span className="block text-[11px] text-muted-foreground">
                      Removing people stays admin-only either way.
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={`h-5 w-9 shrink-0 rounded-full p-0.5 transition ${
                      info.data?.membersCanAdd ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`block size-4 rounded-full bg-background transition ${
                        info.data?.membersCanAdd ? "translate-x-4" : ""
                      }`}
                    />
                  </span>
                </button>
              )}
              <p className="text-[11px] text-muted-foreground">
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
            </div>

            {/* INVITE LINK (v2.105.9, #114) — ADMINS ONLY, and the section is absent
                rather than disabled for everyone else: a control that always refuses is
                worse than one that is not there (the v2.103.3 rule). */}
            {iAmAdmin && <InviteLinkSection conversationId={conversationId} />}
            {/* Any member, admin or not — it changes only this device (see the
                component's own note on why admin-gating it would be wrong). */}
            <GroupLockSection conversationId={conversationId} />

          </div>

          {save.isPending && (
            <div className="border-t border-border/60 px-5 py-2.5 text-xs text-muted-foreground">
              Saving…
            </div>
          )}
          {!save.isPending && save.isSuccess && (
            <div className="flex items-center gap-1.5 border-t border-border/60 px-5 py-2.5 text-xs text-[color:var(--relay-green-text)]">
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
