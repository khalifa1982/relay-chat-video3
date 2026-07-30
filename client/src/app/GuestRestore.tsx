import { useState } from "react";
import { RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { getDeviceId } from "@/lib/deviceId";
import { forgetGuestRecovery, readGuestRecovery } from "@/lib/guestRecovery";
import { RoleBadge } from "./VerifiedBadge";
import { formatElapsedSince } from "@shared/profileFields";

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

  /* Board 4g's "2 DAYS AGO". `formatElapsedSince` is the app's one duration
     formatter (v2.99.90) — reused rather than re-rolled, so this card and the
     dialer's preview cannot come to describe the same span differently. A record
     written before `savedAt` existed carries 0, and a clock that has gone backwards
     would give a negative span, so both render nothing rather than an absurdity. */
  const savedAgo =
    record.savedAt > 0 && record.savedAt <= Date.now()
      ? formatElapsedSince(record.savedAt, Date.now())
      : "";

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
      {/* Board 4g. THE COLOUR IS THE CHANGE: this card was green end to end, and
          green in this app means ONLINE — it is what every presence LED is painted
          with. "Welcome back" is not a presence claim, so it takes the accent, the
          same vocabulary fix the push banner needed. The fallbacks are literals, not
          `var(--rb)` again: an unset custom property is an INVALID declaration the
          browser drops, so a self-referencing fallback would render no border at
          all (the cycle that bit v2.106.7). */}
      <div
        className="rglass rounded-3xl p-5"
        style={{
          borderColor: "rgba(var(--rb-rgb, 63, 224, 197), 0.32)",
          background: "rgba(var(--rb-rgb, 63, 224, 197), 0.07)",
        }}
      >
      <div
        className="flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.16em]"
        style={{ color: "var(--rb, #3FE0C5)" }}
      >
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
          {/* The board draws the blue GUEST badge here, and it is the useful part:
              it says what kind of thing is being restored, which is exactly the
              question somebody has on this screen. A stranded recovery record can
              only ever name an UNCLAIMED identity — the server refuses anything a
              user row has taken — so "guest" is a fact rather than a guess. */}
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[0.95rem] font-semibold leading-tight" dir="auto">
              {p.displayName || "Your RELAY number"}
            </span>
            <RoleBadge role="guest" />
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="font-mono [unicode-bidi:isolate]" dir="ltr">
              {pretty}
            </span>
            <span aria-hidden="true">·</span>
            <span>guest</span>
          </div>
          {/* "2 DAYS AGO" on the board. Read from THIS BROWSER's own note rather
              than the server, which returns no timestamp — and said as "saved",
              because that is what the number actually measures: when this browser
              wrote the key down, not when the identity was last used. A record
              predating the field has savedAt 0, which renders nothing. */}
          {savedAgo && (
            <div
              className="mt-1 font-mono text-[0.62rem] font-semibold uppercase text-muted-foreground"
              style={{ letterSpacing: ".2em" }}
            >
              Saved {savedAgo}
            </div>
          )}
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
        // The CTA goes with the card: it was the same presence green, which is the
        // colour that has to keep meaning "online" and nothing else. `.rcta` carries
        // the board's on-accent text, so it stays legible across all twelve hues.
        className="rcta mt-4 h-11 w-full gap-2 rounded-xl text-[0.95rem] font-semibold"
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
