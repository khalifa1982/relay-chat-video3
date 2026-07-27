import { useEffect, useState } from "react";
import { X, Users, Camera, Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AvatarPicker } from "@/app/AvatarPicker";
import { ProfileStatusPicker } from "@/app/ProfileStatusPicker";
import { describeProfileStatus, type ProfileStatus } from "@shared/profileStatus";

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
                  </li>
                ))}
              </ul>
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
