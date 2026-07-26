import { useState } from "react";
import { RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { getDeviceId } from "@/lib/deviceId";
import { forgetGuestRecovery, readGuestRecovery } from "@/lib/guestRecovery";

/**
 * ADOPT-AND-RETIRE, the affordance (v2.99.68).
 *
 * "You can regenerate the number, but you will not lose your data… it will move
 * with you whenever you are moving." A guest identity holds a real number,
 * contacts, threads and call history, and until now closing the browser stranded
 * every bit of it — both things that resolve a guest are session-scoped by design.
 *
 * This is the deliberate way back. It shows up only when this browser is holding a
 * recovery record AND the server confirms the key still names an unclaimed
 * identity, so it is invisible to a first-time visitor and vanishes by itself once
 * the identity has been registered (at which point signing in is the way in).
 *
 * WHY IT NEVER DELETES THE RECORD ON A FAILURE
 * The stored key is the ONLY copy in existence. A lookup can come back empty for
 * reasons that have nothing to do with the key — a database blip, a rate-limit, a
 * network drop — so discarding it on an empty answer would turn a recoverable
 * identity into a permanently lost one, which is the exact failure this feature
 * was built to end. Forgetting is therefore always an explicit choice.
 */
export function GuestRestore({
  onRestored,
  className = "",
  heading,
}: {
  /** Called after a successful adoption so the caller can re-resolve whoami. */
  onRestored: () => void;
  className?: string;
  /**
   * Optional section label, rendered INSIDE this component's own visibility
   * checks. It has to live here rather than in the caller: this component renders
   * null most of the time, and a caller that drew its own heading would leave a
   * bare "Restore a previous number" title with nothing underneath it.
   */
  heading?: string;
}) {
  // Read once per mount: a record that appears mid-session would be this same
  // browser writing its own key, which is not something to react to.
  const [record] = useState(() => readGuestRecovery());
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = trpc.identity.guestRecoveryPreview.useQuery(
    { key: record?.key ?? "" },
    { enabled: !!record && !dismissed, retry: false, staleTime: 60_000 }
  );
  const adopt = trpc.identity.adoptGuestRecovery.useMutation();

  if (!record || dismissed) return null;
  // Still checking, or the key no longer names anything we can hand back. Render
  // nothing rather than an error: on the entry screen a dead record must not turn
  // "pick a name and go" into a wall of explanation.
  if (!preview.data) return null;

  const p = preview.data;
  const pretty = /^\d{6}$/.test(p.number)
    ? `${p.number.slice(0, 3)}-${p.number.slice(3)}`
    : p.number;

  // Only mention counts we actually have. A restore prompt that overstates what it
  // is returning is worse than one that stays vague.
  const bits: string[] = [];
  if (p.footprint) {
    const f = p.footprint;
    if (f.contacts > 0) bits.push(`${f.contacts} contact${f.contacts === 1 ? "" : "s"}`);
    if (f.messages > 0) bits.push(`${f.messages} message${f.messages === 1 ? "" : "s"}`);
    if (f.calls > 0) bits.push(`${f.calls} call${f.calls === 1 ? "" : "s"}`);
  }

  async function run() {
    setError(null);
    try {
      const res = await adopt.mutateAsync({
        key: record!.key,
        deviceId: getDeviceId(),
      });
      if (res.ok) {
        onRestored();
        return;
      }
      setError(refusalCopy(res.reason));
    } catch {
      setError("Couldn't restore that number just now. Try again in a moment.");
    }
  }

  return (
    <div className={className}>
      {heading && (
        <div className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
          {heading}
        </div>
      )}
      <div className="rounded-3xl border border-[color:var(--relay-online,#06d6a0)]/35 bg-[color:var(--relay-online,#06d6a0)]/[0.07] p-5">
      <div className="flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--relay-online,#06d6a0)]">
        <ShieldCheck className="size-3.5" />
        Welcome back
      </div>

      <div className="mt-3 flex items-center gap-3">
        {p.avatarUrl ? (
          <img
            src={p.avatarUrl}
            alt=""
            className="size-11 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#3FE0C5] to-[#6EE7FF] text-lg font-bold text-[#04201b]">
            {(p.displayName || "?").slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-[0.95rem] font-semibold leading-tight" dir="auto">
            {p.displayName || "Your RELAY number"}
          </div>
          <div
            className="mt-0.5 font-mono text-sm text-muted-foreground [unicode-bidi:isolate]"
            dir="ltr"
          >
            {pretty}
          </div>
        </div>
      </div>

      <p className="mt-3 text-[0.78rem] leading-relaxed text-muted-foreground">
        {bits.length > 0
          ? `This number is still yours, with ${bits.join(", ")} on it. Restore it and everyone who saved you can reach you again.`
          : "This number is still yours. Restore it and everyone who saved you can reach you again."}
      </p>

      {error && <p className="mt-2.5 text-sm text-destructive">{error}</p>}

      <Button
        type="button"
        onClick={() => void run()}
        disabled={adopt.isPending}
        className="mt-4 h-11 w-full gap-2 rounded-xl text-[0.95rem] font-semibold text-primary-foreground bg-[color:var(--relay-online,theme(colors.primary.DEFAULT))]"
      >
        {adopt.isPending ? (
          "Restoring…"
        ) : (
          <>
            <RotateCcw className="size-4" /> Restore {pretty}
          </>
        )}
      </Button>

      <button
        type="button"
        onClick={() => {
          // Explicit, and only here. This is the single place the key is thrown
          // away, because the user said this identity is not theirs.
          forgetGuestRecovery();
          setDismissed(true);
        }}
        className="mt-2.5 w-full text-center text-xs text-muted-foreground hover:text-foreground"
      >
        Not me — forget this number
      </button>
      </div>
    </div>
  );
}

/**
 * Turn a server refusal into something the reader can act on. Each reason has a
 * different correct next step, which is why the server names them instead of
 * returning one generic failure — and `current-has-data` in particular must never
 * be "resolved" by quietly discarding one of the two identities.
 */
function refusalCopy(reason: string): string {
  switch (reason) {
    case "not-found":
      return "That number isn't available to restore anymore — it may now belong to a registered account. Sign in with the email on that account to reach it.";
    case "current-has-data":
      return "The identity you're using right now has its own contacts and messages, so restoring would mean losing them. Sign out first, then restore.";
    case "footprint-unknown":
    case "unavailable":
      return "Couldn't check your data just now, so nothing was changed. Try again in a moment.";
    case "race-lost":
      return "That number was claimed while you were restoring it. Nothing was changed.";
    default:
      return "Couldn't restore that number just now. Try again in a moment.";
  }
}
