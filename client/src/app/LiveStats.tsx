import { trpc } from "@/lib/trpc";

/**
 * Live network counters (v2.99.66).
 *
 * Owner: "this is the live reads on the main website where I want also this one
 * to be also on the login page… put this reads, and I needed it both on the main
 * page and on this login page, that users when they turn off or on, it shows
 * live. It's not just showing you who's now online — it's live reads."
 *
 * The landing page renders its own raw-DOM copy of these numbers (that page is
 * one imperative document, see Home.tsx); this is the React component the app
 * shell uses, currently on the sign-in screen. Both read the same public,
 * aggregate-only `stats.public` endpoint — counts, never a name or a number —
 * and both poll, so a visitor watching the screen sees the figures move as
 * people come online and messages are sent.
 *
 * Degrades to nothing rather than to zeros: `getPublicStats` already answers
 * zeros when the database is down, and a wall of "0" on the sign-in screen reads
 * as a broken product, so an errored or still-loading query renders nothing.
 */
export function LiveStats({ className = "" }: { className?: string }) {
  const stats = trpc.stats.public.useQuery(undefined, {
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });

  const d = stats.data;
  if (!d) return null;

  const items: { label: string; value: number; live?: boolean }[] = [
    { label: "Registered", value: d.registeredUsers },
    { label: "Guests served", value: d.guestsServed },
    { label: "Call parties", value: d.totalParties },
    { label: "Messages", value: d.messagesSent },
    { label: "Online now", value: d.onlineNow, live: true },
  ];

  return (
    <div className={"w-full " + className}>
      <div className="mb-2 flex items-center justify-center gap-2 text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground/70">
        <span className="h-px w-6 bg-border/60" />
        Live network
        <span className="h-px w-6 bg-border/60" />
      </div>
      {/* Wraps rather than scrolls: five short cells fit two rows on the
          narrowest phone, and a horizontal scroller would hide figures the
          owner specifically wants visible at a glance. */}
      <dl className="flex flex-wrap items-stretch justify-center gap-1.5">
        {items.map((it) => (
          <div
            key={it.label}
            className="min-w-[5.2rem] flex-1 rounded-xl border border-border/50 bg-card/50 px-2 py-2 text-center backdrop-blur-md"
          >
            <dd className="flex items-center justify-center gap-1.5 text-[1.05rem] font-bold leading-none tabular-nums">
              {it.value.toLocaleString("en-US")}
              {it.live && (
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-[color:var(--relay-online,#06d6a0)] shadow-[0_0_8px_var(--relay-online,#06d6a0)] motion-safe:animate-pulse"
                />
              )}
            </dd>
            <dt className="mt-1 text-[0.6rem] uppercase tracking-[0.1em] text-muted-foreground/80">
              {it.label}
            </dt>
          </div>
        ))}
      </dl>
    </div>
  );
}
