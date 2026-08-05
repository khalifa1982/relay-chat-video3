/* ──────────────────────────────────────────────────────────────────────────
 * /g/<token> — the group invite-link landing screen (v2.105.9, #114).
 *
 * ── WHY IT IS ITS OWN ROUTE AND NOT `/i/<pin>` ─────────────────────────────
 * `/i/<pin>` is a NUMBER and redirects into the dialer to place a call. This is a
 * signed CAPABILITY and it joins a conversation. Folding them together would mean
 * one screen guessing which of two unrelated things a path segment meant, and the
 * guess would be made on a string an attacker chose.
 *
 * ── IT SHOWS YOU WHAT YOU ARE JOINING BEFORE YOU JOIN ──────────────────────
 * Auto-joining on arrival would make a group membership something a link could give
 * somebody without a gesture — the class of defect v2.99.57/M48 closed for `?to=`,
 * where arriving on a URL placed a call with one click. So the group is previewed
 * and joining takes a deliberate tap.
 *
 * ── EVERY FAILURE READS THE SAME ───────────────────────────────────────────
 * Expired, revoked, mis-signed and no-such-group are one message, deliberately: the
 * preview endpoint answers them identically so it cannot be used to discover which
 * conversation ids exist, and this screen must not undo that by inferring a reason.
 *
 * ── ONE EXCEPTION: THE AUDIENCE (v2.105.23) ────────────────────────────────
 * A link can be restricted to guests or to registered accounts. That refusal IS named,
 * because it is reached only after a signature this fleet minted has verified — so it
 * reveals nothing a legitimate link-holder did not already have — and it is the one
 * refusal with something the person can actually do about it. It is shown BEFORE the
 * tap rather than after a rejected join, and the Join button is replaced rather than
 * disabled, so there is no control that looks live and refuses.
 *
 * A GUEST HITTING A REGISTERED-ONLY LINK IS SENT TO THEIR PROFILE, which carries the
 * "Register with email" button and says the number and contacts carry over. That is one
 * extra tap, and it is deliberate: telling an identity-LESS visitor the requirement
 * before they pick a name would mean making the preview endpoint anonymous, i.e.
 * widening a signed-capability read to callers with no identity at all.
 * ────────────────────────────────────────────────────────────────────────── */
import { useState } from "react";
import { useLocation } from "wouter";
import { Users, ArrowRight, Loader2, Lock } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function GroupInvite({ token }: { token: string }) {
  const [, navigate] = useLocation();
  const [joining, setJoining] = useState(false);
  const preview = trpc.messages.groupInvitePreview.useQuery(
    { token },
    { enabled: token.length > 0, retry: false },
  );
  const accept = trpc.messages.acceptGroupInvite.useMutation();
  const utils = trpc.useUtils();

  async function join() {
    if (joining) return;
    setJoining(true);
    try {
      const res = await accept.mutateAsync({ token });
      // The thread list is the surface that has to show the new group, so it is
      // invalidated before navigating — otherwise the person lands on Messages and
      // does not see the thing they just joined until the next poll.
      await utils.messages.threads.invalidate();
      toast.success(res.joined ? "You've joined the group" : "You're already in this group");
      navigate("/app/messages");
    } catch (e) {
      toast.error((e as Error)?.message || "That invite link is no longer valid.");
    } finally {
      setJoining(false);
    }
  }

  const g = preview.data;

  return (
    <div className="min-h-svh grid place-items-center bg-background px-5 py-10">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-center shadow-lg">
        {preview.isLoading ? (
          <div className="py-10 text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-3 size-5 animate-spin" aria-hidden />
            Checking that link…
          </div>
        ) : !g ? (
          <div className="py-6">
            <div className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-muted">
              <Users className="size-7 text-muted-foreground" aria-hidden />
            </div>
            <h1 className="text-lg font-semibold">That invite link is no longer valid</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              It may have expired, or a group admin may have revoked it. Ask them for a new one.
            </p>
            <button
              type="button"
              onClick={() => navigate("/app/messages")}
              className="mt-5 w-full rounded-xl border border-border px-4 py-3 text-sm font-medium"
            >
              Go to RELAY
            </button>
          </div>
        ) : (
          <div>
            {g.avatarUrl ? (
              <img
                src={g.avatarUrl}
                alt=""
                className="mx-auto mb-4 size-20 rounded-2xl object-cover"
                // A broken group photo falls back to the glyph rather than the browser's
                // broken-image icon — the rule PeerAvatar already follows.
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="mx-auto mb-4 grid size-20 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500">
                <Users className="size-9 text-white" aria-hidden />
              </div>
            )}
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              You've been invited to join
            </p>
            <h1 className="mt-1 text-xl font-semibold">{g.title || "a group"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
              {g.number ? (
                <>
                  {" · "}
                  <span dir="ltr" className="[unicode-bidi:isolate] tabular-nums">
                    {g.number.slice(0, 3)}-{g.number.slice(3)}
                  </span>
                </>
              ) : null}
            </p>
            {g.admitted ? (
              <>
                <p className="mt-4 text-xs text-muted-foreground">
                  You'll see messages sent from now on — not the conversation's history.
                </p>
                <button
                  type="button"
                  onClick={join}
                  disabled={joining}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {joining ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <ArrowRight className="size-4" aria-hidden />
                  )}
                  {g.alreadyMember ? "Open the group" : "Join group"}
                </button>
              </>
            ) : (
              <div className="mt-5 rounded-xl border border-border/60 bg-muted/40 p-4 text-start">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {g.audience === "registered"
                    ? "This link is for registered accounts"
                    : "This link is for guest accounts only"}
                </p>
                {g.audience === "registered" ? (
                  <>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Register with email from your profile — your number and contacts carry
                      over — then open this link again.
                    </p>
                    <button
                      type="button"
                      onClick={() => navigate("/app/profile")}
                      className="mt-3 w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground"
                    >
                      Go to my profile
                    </button>
                  </>
                ) : (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Ask a group admin for a link that includes registered accounts.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
