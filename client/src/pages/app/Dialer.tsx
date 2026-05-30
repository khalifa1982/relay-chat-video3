import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Phone, Delete, PhoneIncoming, PhoneMissed, PhoneOutgoing, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useIdentity } from "@/app/useIdentity";

const KEYS: { d: string; sub: string }[] = [
  { d: "1", sub: " " },
  { d: "2", sub: "ABC" },
  { d: "3", sub: "DEF" },
  { d: "4", sub: "GHI" },
  { d: "5", sub: "JKL" },
  { d: "6", sub: "MNO" },
  { d: "7", sub: "PQRS" },
  { d: "8", sub: "TUV" },
  { d: "9", sub: "WXYZ" },
  { d: "*", sub: "" },
  { d: "0", sub: "+" },
  { d: "#", sub: "" },
];

function formatDialed(n: string): string {
  if (n.length <= 3) return n;
  return `${n.slice(0, 3)} ${n.slice(3, 6)}`;
}

function timeAgo(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function DialerPage() {
  const { me } = useIdentity();
  const [, setLocation] = useLocation();
  const [dialed, setDialed] = useState("");

  const history = trpc.calls.history.useQuery(undefined, {
    refetchInterval: 20_000,
    enabled: !!me,
  });
  const previewQuery = trpc.directory.lookup.useQuery(
    { number: dialed },
    {
      enabled: dialed.length === 6,
      staleTime: 5_000,
    }
  );

  // Hardware-keyboard support: digits, *, # type into the pad; Backspace/Delete remove
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^[0-9]$/.test(e.key)) {
        setDialed((s) => (s.length < 6 ? s + e.key : s));
      } else if (e.key === "Backspace") {
        setDialed((s) => s.slice(0, -1));
      } else if (e.key === "Enter") {
        if (dialed.length === 6) startCall();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialed]);

  function tap(d: string) {
    if (dialed.length >= 6 && /[0-9]/.test(d)) return;
    setDialed((s) => s + d);
    // light haptic on supporting devices
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(8);
      } catch {
        /* ignore */
      }
    }
  }

  function backspace() {
    setDialed((s) => s.slice(0, -1));
  }

  function startCall() {
    if (dialed.length !== 6) return;
    // Hand off to the legacy /app Relay screen with the number prefilled
    setLocation(`/app/call?to=${encodeURIComponent(dialed)}`);
  }

  const previewIdentity = previewQuery.data ?? null;
  const callable = /^\d{6}$/.test(dialed) && dialed !== me?.number;

  const recent = useMemo(() => (history.data ?? []).slice(0, 8), [history.data]);

  return (
    <div className="h-full grid md:grid-cols-[1fr_minmax(0,420px)] gap-0 md:gap-6 md:p-6">
      {/* ── recent calls ─────────────────────────────────────── */}
      <section className="hidden md:flex md:flex-col rounded-2xl bg-card border border-border min-h-0">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold">Recent</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {history.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : recent.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No calls yet. Dial a number to start your first call.
            </div>
          ) : (
            <ul>
              {recent.map((c) => {
                const Icon =
                  c.direction === "in"
                    ? c.status === "missed"
                      ? PhoneMissed
                      : PhoneIncoming
                    : PhoneOutgoing;
                const tone =
                  c.status === "missed" ? "text-destructive" : "text-muted-foreground";
                const peerNum = c.other?.number ?? "";
                const peerName = c.other?.displayName ?? peerNum;
                return (
                  <li
                    key={c.id}
                    className="flex items-center gap-3 px-5 py-3 border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
                  >
                    <Icon className={`size-4 shrink-0 ${tone}`} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{peerName}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {peerNum} · {timeAgo(c.startedAt)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!peerNum}
                      onClick={() => peerNum && setDialed(peerNum)}
                    >
                      <Phone className="size-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* ── keypad ──────────────────────────────────────────── */}
      <section className="flex flex-col items-center justify-start p-4 md:p-6">
        <div className="w-full max-w-md flex flex-col gap-4">
          {/* dialed number echo */}
          <div className="text-center">
            <div className="font-mono text-[clamp(2rem,8vw,3.5rem)] leading-none tracking-wider min-h-[3.5rem]">
              {dialed.length ? formatDialed(dialed) : <span className="text-muted-foreground/60">812 345</span>}
            </div>
            <div className="mt-2 text-sm h-5 text-muted-foreground">
              {dialed.length === 6 ? (
                previewQuery.isLoading ? (
                  "Looking up…"
                ) : previewIdentity ? (
                  <span>
                    <span className="font-semibold text-foreground">
                      {previewIdentity.displayName}
                    </span>
                    {" · "}
                    <span
                      className={
                        previewIdentity.isOnline
                          ? "text-[color:var(--relay-online)]"
                          : "text-muted-foreground"
                      }
                    >
                      {previewIdentity.isOnline ? "online now" : "offline"}
                    </span>
                  </span>
                ) : (
                  "No RELAY user with this number"
                )
              ) : dialed.length > 0 ? (
                `${6 - dialed.length} more digits`
              ) : (
                "Enter a 6-digit RELAY number"
              )}
            </div>
          </div>

          {/* keypad grid — fluid clamp sizing so it never overflows */}
          <div
            className="grid grid-cols-3 mx-auto"
            style={{
              gap: "clamp(8px, 2vw, 16px)",
              width: "min(100%, 360px)",
            }}
          >
            {KEYS.map((k) => (
              <button
                key={k.d}
                type="button"
                onClick={() => tap(k.d)}
                className="aspect-square rounded-full bg-secondary text-secondary-foreground border border-border flex flex-col items-center justify-center select-none active:scale-95 transition-[transform,background-color] duration-150"
                style={{
                  transitionTimingFunction: "var(--ease-out)",
                }}
              >
                <span
                  className="font-mono font-semibold leading-none"
                  style={{ fontSize: "clamp(1.5rem, 5vw, 2rem)" }}
                >
                  {k.d}
                </span>
                {k.sub && (
                  <span
                    className="text-muted-foreground tracking-widest mt-0.5"
                    style={{ fontSize: "clamp(0.55rem, 1.5vw, 0.7rem)" }}
                  >
                    {k.sub}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* call row */}
          <div
            className="grid grid-cols-[1fr_auto_1fr] items-center mx-auto mt-2"
            style={{ width: "min(100%, 360px)" }}
          >
            {/* placeholder left button (keeps the call button centered) */}
            <div />
            <button
              type="button"
              disabled={!callable}
              onClick={startCall}
              className="rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 grid place-items-center disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-transform duration-150"
              style={{
                width: "clamp(64px, 18vw, 78px)",
                height: "clamp(64px, 18vw, 78px)",
                transitionTimingFunction: "var(--ease-out)",
              }}
              aria-label="Call"
            >
              <Phone className="size-7" />
            </button>
            <div className="flex justify-end">
              {dialed.length > 0 && (
                <button
                  type="button"
                  onClick={backspace}
                  className="size-12 grid place-items-center rounded-full text-muted-foreground hover:text-foreground active:scale-95 transition"
                  aria-label="Backspace"
                >
                  <Delete className="size-6" />
                </button>
              )}
            </div>
          </div>

          {/* quick-add-contact when previewed identity isn't already a contact */}
          {dialed.length === 6 && previewIdentity && previewIdentity.number !== me?.number && (
            <QuickAddContact
              number={previewIdentity.number}
              displayName={previewIdentity.displayName}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function QuickAddContact({ number, displayName }: { number: string; displayName: string }) {
  const utils = trpc.useUtils();
  const upsert = trpc.contacts.upsert.useMutation({
    onSuccess: () => {
      utils.contacts.list.invalidate();
    },
  });
  const existing = trpc.contacts.list.useQuery();
  const isAlready = (existing.data ?? []).some((c) => c.number === number);
  if (isAlready) return null;
  return (
    <button
      type="button"
      onClick={() => upsert.mutate({ number, displayName })}
      disabled={upsert.isPending}
      className="mx-auto mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
    >
      <UserPlus className="size-3.5" />
      {upsert.isPending ? "Adding…" : `Save ${displayName} to contacts`}
    </button>
  );
}
