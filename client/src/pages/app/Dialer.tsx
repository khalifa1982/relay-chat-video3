import { useEffect, useMemo, useRef, useState } from "react";
import {
  Phone,
  Video,
  Delete,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  UserPlus,
  Users,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useIdentity } from "@/app/useIdentity";
import { useRelayEngine } from "@/app/RelayEngine";
import { GroupCallScreen } from "./GroupCallScreen";
import { effectiveStatus, formatLastSeen, type StatusOverride } from "@shared/profileFields";

/**
 * Compact presence line for a looked-up peer: "online now" / "away" /
 * "travelling" / WhatsApp-style "last seen …" when offline. Exported for tests.
 */
export function peerStatus(p: {
  isOnline: boolean;
  lastSeenAt: string | Date | null | undefined;
  statusOverride?: string | null;
}): { text: string; online: boolean } {
  const eff = effectiveStatus(!!p.isOnline, (p.statusOverride ?? "") as StatusOverride);
  if (eff === "online") return { text: "online now", online: true };
  if (eff === "away") return { text: "away", online: true };
  if (eff === "travel") return { text: "travelling ✈️", online: false };
  const ts = p.lastSeenAt ? new Date(p.lastSeenAt).getTime() : 0;
  return { text: formatLastSeen(ts, Date.now()) || "offline", online: false };
}

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

/**
 * Format a 6-digit number as `123 456`. Exported for unit tests.
 */
export function formatDialed(n: string): string {
  if (n.length <= 3) return n;
  return `${n.slice(0, 3)} ${n.slice(3, 6)}`;
}

/**
 * Decide what to show in the dialed-number area.
 *  - When the user has typed nothing AND we know their own number:
 *    show their own number as a "ghost" (their own number = the default).
 *  - When the user starts typing, the ghost vanishes and the typed digits
 *    take over.
 * Exported so we can unit-test the rule without a DOM.
 */
export function ghostNumberRule(args: {
  typed: string;
  ownNumber: string | null | undefined;
}): { mode: "ghost" | "typed" | "empty"; display: string } {
  const typed = args.typed.replace(/\D+/g, "");
  if (typed.length > 0) return { mode: "typed", display: formatDialed(typed) };
  if (args.ownNumber && /^\d{6}$/.test(args.ownNumber)) {
    return { mode: "ghost", display: formatDialed(args.ownNumber) };
  }
  return { mode: "empty", display: "" };
}

/**
 * Extract a dialable 6-digit target from a URL search string (the `?to=`
 * carried over from the Messages/Contacts "call" buttons and the legacy
 * /app/call redirect). Returns null when absent or invalid. Exported for tests.
 */
export function parseDialToParam(search: string): string | null {
  const params = new URLSearchParams(search || "");
  const to = (params.get("to") || "").replace(/\D+/g, "").slice(0, 6);
  return /^\d{6}$/.test(to) ? to : null;
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
  // The call engine is hosted app-wide by RelayEngineProvider so a user can be
  // rung from any tab; the Dialer just drives it (dial / read phase + the
  // authoritative signaling pin).
  const engine = useRelayEngine();
  const { phase, ready: engineReady, pin: enginePin } = engine;
  const [dialed, setDialed] = useState("");
  const [showGroup, setShowGroup] = useState(false);

  // Honor ?to=<6 digits> — carried over when the user taps "call" from
  // Messages/Contacts (and from the legacy /app/call redirect). Auto-dial once,
  // as soon as the engine is registered (enginePin known).
  const autoDialedRef = useRef(false);
  useEffect(() => {
    if (autoDialedRef.current) return;
    if (!engineReady || !enginePin) return;
    const to = parseDialToParam(
      typeof window !== "undefined" ? window.location.search : ""
    );
    if (!to || to === enginePin) return;
    autoDialedRef.current = true;
    engine.dial(to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineReady, enginePin]);

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

  // Hardware-keyboard support: digits, *, # type into the pad; Backspace removes
  useEffect(() => {
    if (phase !== "idle") return; // engine owns keyboard during a call
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^[0-9]$/.test(e.key)) {
        setDialed((s) => (s.length < 6 ? s + e.key : s));
      } else if (e.key === "Backspace") {
        setDialed((s) => s.slice(0, -1));
      } else if (e.key === "Enter") {
        if (dialed.length === 6) startCallNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialed, phase]);

  function tap(d: string) {
    if (dialed.length >= 6 && /[0-9]/.test(d)) return;
    setDialed((s) => s + d);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try { navigator.vibrate(8); } catch { /* ignore */ }
    }
  }

  function backspace() {
    setDialed((s) => s.slice(0, -1));
  }

  function startCallNow(opts?: { voice?: boolean }) {
    if (dialed.length !== 6) return;
    const ok = engine.dial(dialed, opts);
    if (ok) {
      // Phase is driven by the engine (via the provider), so we just clear the
      // dialed buffer; the ghost number reappears once the call ends.
      setDialed("");
    }
  }

  // Share a "call me" invite link. Uses a SHORT, clean path (/i/<pin>) that
  // redirects straight into the dialer (auto-dials this number) — no long query
  // string, and we control where it lands so it never opens an unexpected page.
  // The shared message is structured: a header line, then the link on its own
  // line (not one illegible blob).
  function shareInvite() {
    const num = enginePin ?? me?.number ?? null;
    if (!num) return;
    const url = `${window.location.origin}/i/${num}`;
    const title = "Call me on RELAY";
    if (typeof navigator !== "undefined" && navigator.share) {
      // Pass title + url separately so the OS share sheet lays them out cleanly
      // (header on top, link below) instead of concatenating into one block.
      navigator.share({ title, text: title, url }).catch(() => {});
    } else {
      // Clipboard fallback: header line + link line.
      navigator.clipboard
        ?.writeText(`${title}\n${url}`)
        .then(() => toast.success("Invite link copied"))
        .catch(() => toast.error("Couldn't copy the link"));
    }
  }

  const previewIdentity = previewQuery.data ?? null;
  // Self-call guard and the displayed "your number" must both use the
  // signaling pin (enginePin), NOT the v2 identity number, otherwise the
  // shown number can never actually be dialed.
  const myNumber = enginePin ?? me?.number ?? null;
  const callable =
    /^\d{6}$/.test(dialed) && dialed !== myNumber && engineReady;

  const ghost = useMemo(
    () => ghostNumberRule({ typed: dialed, ownNumber: myNumber }),
    [dialed, myNumber]
  );

  const recent = useMemo(() => (history.data ?? []).slice(0, 8), [history.data]);

  return (
    <div className="dialer-shell relative h-full">
      {/* ── idle dialer surface (always rendered; hidden visually when phase != idle) */}
      <div
        className="grid md:grid-cols-[1fr_minmax(0,420px)] gap-0 md:gap-6 md:p-6 h-full"
        style={{
          // The whole dialer must fit inside the viewport with no scroll.
          // 100dvh accounts for mobile browser chrome correctly.
          maxHeight: "calc(100dvh - var(--relay-shell-chrome, 0px))",
          visibility: phase === "idle" ? "visible" : "hidden",
        }}
      >
        {/* Recent calls — desktop only */}
        <section className="hidden md:flex md:flex-col rounded-2xl bg-card/60 backdrop-blur-xl backdrop-saturate-150 border border-border/60 min-h-0 shadow-xl shadow-black/10">
          <div className="px-5 py-4 border-b border-border/60">
            <h2 className="font-semibold tracking-tight">Recent</h2>
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
                      className="flex items-center gap-3 px-5 py-3 border-b border-border/60 last:border-b-0 hover:bg-muted/40 transition-colors"
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

        {/* Keypad card — fills the right column on desktop, the whole screen on mobile */}
        <section className="flex flex-col items-stretch justify-stretch min-h-0 p-3 md:p-4">
          <div
            className="
              dialer-card mx-auto w-full max-w-[420px] flex-1 min-h-0
              rounded-3xl
              bg-card/60 dark:bg-card/40
              backdrop-blur-2xl backdrop-saturate-150
              border border-border/50
              shadow-2xl shadow-black/20
              flex flex-col
            "
            style={{
              // Internal rows: number area / keypad / call row, with no scroll.
              // The keypad takes the available middle space.
              padding: "clamp(12px, 3vw, 22px)",
              gap: "clamp(8px, 2.2vw, 18px)",
            }}
          >
            {/* Number area: ghost or typed */}
            <div className="text-center select-none">
              <div
                className="font-mono leading-none tracking-wider transition-all duration-200"
                style={{
                  fontSize: "clamp(1.75rem, 6.5vw, 2.75rem)",
                  minHeight: "clamp(2rem, 7vw, 3rem)",
                  transitionTimingFunction: "var(--ease-out)",
                }}
              >
                {ghost.mode === "typed" ? (
                  <span
                    className="text-foreground font-semibold animate-[ghost-flash_220ms_var(--ease-out)]"
                    aria-live="polite"
                  >
                    {ghost.display}
                  </span>
                ) : ghost.mode === "ghost" ? (
                  <span
                    className="
                      text-[color:var(--relay-online,theme(colors.primary.DEFAULT))]/70
                      drop-shadow-[0_0_18px_color-mix(in_oklab,var(--relay-online,#06d6a0)_40%,transparent)]
                    "
                    aria-label={`Your number: ${ghost.display}`}
                  >
                    {ghost.display}
                  </span>
                ) : (
                  <span className="text-muted-foreground/60">— — —</span>
                )}
              </div>

              {/* Sub-line: hint or live preview */}
              <div
                className="mt-1.5 text-[0.78rem] h-4 text-muted-foreground"
                aria-live="polite"
              >
                {ghost.mode === "ghost" ? (
                  <button
                    type="button"
                    onClick={shareInvite}
                    className="inline-flex items-center gap-1.5 font-medium tracking-wide text-muted-foreground hover:text-foreground transition-colors active:scale-95"
                  >
                    <Share2 className="size-3.5" /> Share invite link
                  </button>
                ) : ghost.mode === "typed" && dialed.length === 6 ? (
                  previewQuery.isLoading ? (
                    "Looking up…"
                  ) : previewIdentity ? (
                    (() => {
                      const st = peerStatus({
                        isOnline: previewIdentity.isOnline,
                        lastSeenAt: previewIdentity.lastSeenAt,
                        statusOverride: previewIdentity.statusOverride,
                      });
                      return (
                        <span>
                          <span className="font-semibold text-foreground">
                            {previewIdentity.displayName}
                          </span>
                          {" · "}
                          <span className={st.online ? "text-[color:var(--relay-online)]" : "text-muted-foreground"}>
                            {st.text}
                          </span>
                        </span>
                      );
                    })()
                  ) : (
                    "No RELAY user with this number"
                  )
                ) : ghost.mode === "typed" ? (
                  `${6 - dialed.length} more digits`
                ) : (
                  "Enter a 6-digit RELAY number"
                )}
              </div>
            </div>

            {/* Keypad: a square 3×4 that scales to fill remaining vertical space */}
            <div
              className="grid grid-cols-3 mx-auto w-full"
              style={{
                // Cap so we never look comically large on desktop.
                maxWidth: "min(100%, 360px)",
                gap: "clamp(6px, 1.8vw, 12px)",
                // Keep each row a sensible size relative to the available height.
                gridAutoRows: "clamp(48px, 9.5vh, 72px)",
              }}
            >
              {KEYS.map((k) => (
                <button
                  key={k.d}
                  type="button"
                  onClick={() => tap(k.d)}
                  className="
                    relative rounded-[22px]
                    bg-secondary/70 dark:bg-secondary/40
                    backdrop-blur-md
                    text-secondary-foreground
                    border border-border/40
                    flex flex-col items-center justify-center
                    select-none
                    transition-[transform,background-color] duration-150
                    active:scale-[0.94]
                    hover:bg-secondary/90 dark:hover:bg-secondary/60
                  "
                  style={{ transitionTimingFunction: "var(--ease-out)" }}
                >
                  <span
                    className="font-mono font-semibold leading-none"
                    style={{ fontSize: "clamp(1.15rem, 4.2vw, 1.6rem)" }}
                  >
                    {k.d}
                  </span>
                  {k.sub ? (
                    <span
                      className="text-muted-foreground tracking-[0.18em] mt-0.5 uppercase"
                      style={{ fontSize: "clamp(0.5rem, 1.3vw, 0.62rem)" }}
                    >
                      {k.sub}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            {/* Call actions — two equally-prominent circular buttons, each
                labelled underneath. Voice = blue, Video = green. */}
            <div
              className="relative mx-auto w-full"
              style={{ maxWidth: "min(100%, 360px)" }}
            >
              <div className="flex items-start justify-center gap-10">
                {/* Voice call (blue) — starts with the camera off (audio-only). */}
                <div className="flex flex-col items-center gap-1.5">
                  <button
                    type="button"
                    disabled={!callable}
                    onClick={() => startCallNow({ voice: true })}
                    className="
                      rounded-full text-white grid place-items-center
                      disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
                      active:scale-[0.94] transition-transform duration-150
                    "
                    style={{
                      width: "clamp(54px, 13vw, 64px)",
                      height: "clamp(54px, 13vw, 64px)",
                      background: "#2563eb",
                      boxShadow: "0 10px 28px -8px color-mix(in oklab, #2563eb 70%, transparent)",
                      transitionTimingFunction: "var(--ease-out)",
                    }}
                    aria-label="Voice call"
                    title="Voice call (camera off)"
                  >
                    <Phone className="size-5" />
                  </button>
                  <span className="text-xs font-medium text-muted-foreground">Voice Call</span>
                </div>
                {/* Video call (green). */}
                <div className="flex flex-col items-center gap-1.5">
                  <button
                    type="button"
                    disabled={!callable}
                    onClick={() => startCallNow()}
                    className="
                      rounded-full text-primary-foreground grid place-items-center
                      disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
                      active:scale-[0.94] transition-transform duration-150
                    "
                    style={{
                      width: "clamp(54px, 13vw, 64px)",
                      height: "clamp(54px, 13vw, 64px)",
                      background: "var(--relay-online, #06d6a0)",
                      boxShadow: "0 10px 28px -8px color-mix(in oklab, var(--relay-online,#06d6a0) 70%, transparent)",
                      transitionTimingFunction: "var(--ease-out)",
                    }}
                    aria-label="Video call"
                    title="Video call"
                  >
                    <Video className="size-5" />
                  </button>
                  <span className="text-xs font-medium text-muted-foreground">Video Call</span>
                </div>
              </div>
              {/* Backspace — kept out of the way of the centred pair. */}
              {dialed.length > 0 ? (
                <button
                  type="button"
                  onClick={backspace}
                  className="absolute right-0 top-1.5 size-10 grid place-items-center rounded-full text-muted-foreground hover:text-foreground active:scale-95 transition"
                  aria-label="Backspace"
                >
                  <Delete className="size-[18px]" />
                </button>
              ) : null}
            </div>

            {/* Create Group Call — opens a picker for up to 10 participants. */}
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setShowGroup(true)}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-4 py-2 text-sm font-medium text-foreground hover:bg-card active:scale-[0.97] transition"
              >
                <Users className="size-4" /> Create Group Call
              </button>
            </div>

            {/* Quick-add */}
            {dialed.length === 6 && previewIdentity && previewIdentity.number !== myNumber ? (
              <QuickAddContact
                number={previewIdentity.number}
                displayName={previewIdentity.displayName}
              />
            ) : null}
          </div>
        </section>
      </div>

      {/* The call engine, its scoped CSS, the fullscreen call/ring overlay, and
          the End button now live app-wide in RelayEngineProvider, so an incoming
          call surfaces on ANY tab — not just here. The Dialer only renders the
          keypad and drives the engine via useRelayEngine(). */}

      {showGroup && <GroupCallScreen onClose={() => setShowGroup(false)} />}

      <style>{`
        @keyframes ghost-flash {
          0%   { transform: scale(0.92); opacity: 0; filter: blur(6px); }
          60%  { transform: scale(1.04); opacity: 1; filter: blur(0); }
          100% { transform: scale(1); opacity: 1; filter: blur(0); }
        }
      `}</style>
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
      className="mx-auto inline-flex items-center gap-1.5 text-[0.7rem] text-muted-foreground hover:text-primary transition-colors"
    >
      <UserPlus className="size-3" />
      {upsert.isPending ? "Adding…" : `Save ${displayName} to contacts`}
    </button>
  );
}
