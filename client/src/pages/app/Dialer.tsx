import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Phone,
  PhoneCall,
  Video,
  Delete,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  UserPlus,
  Users,
  Share2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { VerifiedBadge } from "@/app/VerifiedBadge";
import { useIdentity } from "@/app/useIdentity";
import { demotablePollInterval } from "@/app/useRealtime";
import { useRelayEngine } from "@/app/RelayEngine";
import { GroupCallScreen } from "./GroupCallScreen";
import { effectiveStatus, formatLastSeen, type StatusOverride } from "@shared/profileFields";

/**
 * Compact presence line for a looked-up peer: carrier-style "on a call"
 * (v2.88, amber) / "online now" / "away" / "travelling" / WhatsApp-style
 * "last seen …" when offline. Exported for tests.
 */
export function peerStatus(p: {
  isOnline: boolean;
  lastSeenAt: string | Date | null | undefined;
  statusOverride?: string | null;
  /** Busy line (v2.88): the peer is in a live call right now. */
  inCall?: boolean;
}): { text: string; online: boolean; busy?: boolean } {
  // Busy wins over everything: knowing they'll bounce you matters MORE than
  // knowing they're online.
  if (p.inCall) return { text: "on a call", online: true, busy: true };
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

/**
 * Voice-first auto-dial rule (v2.88): a deep-linked dial is VOICE unless the
 * link explicitly asks for video (`?video=1`). The old rule required an
 * explicit `voice` param, so the bare `/i/<pin>` invite links (which carry
 * neither param) placed VIDEO dials — cameras-on to a stranger from a shared
 * link. Exported for tests.
 */
export function voiceFromDialParams(search: string): boolean {
  try {
    return new URLSearchParams(search || "").get("video") !== "1";
  } catch {
    return true; // fail safe: voice
  }
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
  const [, setLocation] = useLocation();
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
    // Deep-links carry the intent: ?video=1 is the ONLY thing that places a
    // video dial — everything else (including the bare /i/<pin> invite links)
    // is voice-first per the v2.81 protocol.
    const voice = voiceFromDialParams(
      typeof window !== "undefined" ? window.location.search : ""
    );
    const ok = engine.dial(to, { voice });
    if (ok) {
      // Strip the ?to= from the address bar so a reload, Back, or the 30s
      // auto-updater's forced refresh can't silently RE-DIAL this number.
      try {
        window.history.replaceState(null, "", "/app/dialer");
      } catch { /* */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineReady, enginePin]);

  const history = trpc.calls.history.useQuery(undefined, {
    // SSE-gated (v2.88): 10s is the no-SSE safety net; while the stream is up
    // (call_offer events invalidate this query) poll at 30s.
    refetchInterval: demotablePollInterval(10_000, 30_000),
    enabled: !!me,
  });
  // "Missed Call" alert: shown when the user arrives here from the landing
  // missed-call popup (?missed=1). Identifies the most recent missed caller.
  const [showMissed, setShowMissed] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("missed") === "1"; } catch { return false; }
  });
  const missedSummary = trpc.calls.missedSummary.useQuery(undefined, {
    enabled: !!me && showMissed,
  });
  const missedLatest = missedSummary.data?.latest ?? null;
  const missedCount = missedSummary.data?.count ?? 0;
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
        if (dialed.length === 6) {
          e.preventDefault();
          // Voice-first (v2.81 protocol): hardware Enter mirrors the Voice
          // button — video is an explicit choice, never a keyboard default.
          startCallNow({ voice: true });
        }
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
    // Label the engine's dial-progress card with the callee's directory name
    // when the 6-digit preview already resolved it (best-effort — the server's
    // "ringing" ack also carries the name for raw-number dials).
    const displayName = previewQuery.data?.displayName || undefined;
    const ok = engine.dial(dialed, { ...opts, displayName });
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

  // Party line (v2.89): the previewed number is a dialable ROOM — the call
  // button reads "Join" (nothing rings; you just land on the line).
  const previewIsLine = dialed.length === 6 && !!previewIdentity?.partyLine;

  const recent = useMemo(() => (history.data ?? []).slice(0, 8), [history.data]);

  return (
    // flex-1 (not h-full): fills the AppShell scroll column via flex-grow so
    // the keypad genuinely stretches down to the tab bar — height:100% does
    // not resolve against the flex-derived container height.
    <div className="dialer-shell relative flex-1 min-h-0 flex flex-col">
      {/* Missed Call alert — shown when arriving from the landing popup. */}
      {showMissed && missedCount > 0 && missedLatest && phase === "idle" && (
        <div className="absolute inset-x-0 top-0 z-20 px-3 pt-3 md:px-6 md:pt-6">
          <div className="mx-auto max-w-md flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 shadow-lg backdrop-blur-md">
            {/* The alert body is a LINK to the full Missed log (History →
                Missed filter) — it used to be inert text, a dead end. */}
            <button
              type="button"
              onClick={() => setLocation("/app/history?filter=missed")}
              className="flex flex-1 min-w-0 items-center gap-3 text-left outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-lg"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-destructive/20 text-destructive">
                <PhoneMissed className="size-5" />
              </span>
              <span className="flex-1 min-w-0 block">
                <span className="block text-sm font-semibold text-foreground">
                  {missedCount === 1 ? "Missed Call" : `${missedCount} Missed Calls`}
                </span>
                <span className="block text-xs text-muted-foreground truncate">
                  from <span className="font-medium text-foreground/90">{missedLatest.name}</span>
                  {missedLatest.number ? ` · ${formatDialed(missedLatest.number)}` : ""}
                  {" — tap to see all"}
                </span>
              </span>
            </button>
            {missedLatest.number && (
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0 text-destructive hover:text-destructive"
                onClick={() => { engine.dial(missedLatest.number, { voice: true }); setShowMissed(false); }}
              >
                <Phone className="size-4 mr-1" /> Call back
              </Button>
            )}
            <button
              type="button"
              onClick={() => setShowMissed(false)}
              aria-label="Dismiss"
              className="shrink-0 grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}
      {/* ── idle dialer surface (always rendered; hidden visually when phase != idle) */}
      <div
        className="grid md:grid-cols-[1fr_minmax(0,420px)] gap-0 md:gap-6 md:p-6 flex-1 min-h-0"
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
                        aria-label="Call back (voice)"
                        title="Call back (voice)"
                        // Dial immediately as VOICE (v2.88) — matching History's
                        // call-back buttons; it used to only pre-fill the keypad.
                        onClick={() => peerNum && engine.dial(peerNum, { voice: true })}
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
                  ) : previewIdentity?.partyLine ? (
                    // Party line (v2.89): a dialable room — show its title and
                    // the live head-count instead of a person's presence.
                    <span>
                      <span className="font-semibold text-foreground">
                        {previewIdentity.displayName}
                      </span>
                      {" · "}
                      <span className="text-violet-400 font-medium">
                        Party line · {previewIdentity.memberCount} on the line
                      </span>
                    </span>
                  ) : previewIdentity ? (
                    (() => {
                      const st = peerStatus({
                        isOnline: previewIdentity.isOnline,
                        lastSeenAt: previewIdentity.lastSeenAt,
                        statusOverride: previewIdentity.statusOverride,
                        inCall: previewIdentity.inCall,
                      });
                      return (
                        <span>
                          <span className="font-semibold text-foreground">
                            {previewIdentity.displayName}
                          </span>
                          {previewIdentity.verified && <VerifiedBadge size={13} className="ml-1" />}
                          {" · "}
                          <span
                            className={
                              st.busy
                                ? "text-amber-500 font-medium"
                                : st.online
                                  ? "text-[color:var(--relay-online)]"
                                  : "text-muted-foreground"
                            }
                          >
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
                    relay-key relative rounded-[22px]
                    bg-secondary/70 dark:bg-secondary/40
                    backdrop-blur-md
                    text-secondary-foreground
                    border border-border/40
                    flex items-center justify-center
                    select-none
                    transition-[transform,background-color] duration-150
                    active:scale-[0.94]
                    hover:bg-secondary/90 dark:hover:bg-secondary/60
                  "
                  style={{
                    transitionTimingFunction: "var(--ease-out)",
                    // Prototype's raised-glass key: a hairline top-light + soft
                    // drop for depth. Theme-safe (white inset reads on both).
                    boxShadow:
                      "inset 0 1px 0 rgba(255,255,255,.14), 0 4px 12px rgba(0,0,0,.22)",
                  }}
                >
                  {/* RELAY numbers are 6-digit numeric — the prototype drops the
                      T9 letter sublabels for a cleaner, number-first keypad. */}
                  <span
                    className="font-mono font-medium leading-none"
                    style={{ fontSize: "clamp(1.3rem, 5vw, 1.85rem)" }}
                  >
                    {k.d}
                  </span>
                </button>
              ))}
            </div>

            {/* Call actions — THREE equally-prominent circular icon buttons in
                one row, each labelled underneath: Voice (blue, handset+waves),
                Video (green, camera), Group Call (purple, people — opens the
                up-to-10 participant picker; no separate text bar). */}
            <div
              className="relative mx-auto w-full"
              style={{ maxWidth: "min(100%, 380px)" }}
            >
              <div className="flex items-start justify-center gap-7">
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
                      width: "clamp(56px, 14vw, 66px)",
                      height: "clamp(56px, 14vw, 66px)",
                      // Prototype convention: voice/call = green (primary action).
                      background: "linear-gradient(135deg,#22c55e,#15803d)",
                      boxShadow:
                        "0 10px 26px -8px color-mix(in oklab, #22c55e 65%, transparent), inset 0 2px 0 rgba(255,255,255,.3)",
                      transitionTimingFunction: "var(--ease-out)",
                    }}
                    aria-label={previewIsLine ? "Join the party line" : "Voice call"}
                    title={previewIsLine ? "Join the party line (camera off)" : "Voice call (camera off)"}
                  >
                    <PhoneCall className="size-6" strokeWidth={2.2} />
                  </button>
                  <span className="text-xs font-medium text-muted-foreground">
                    {previewIsLine ? "Join" : "Voice Call"}
                  </span>
                </div>
                {/* Video call (green). */}
                <div className="flex flex-col items-center gap-1.5">
                  <button
                    type="button"
                    disabled={!callable}
                    onClick={() => startCallNow()}
                    className="
                      rounded-full text-white grid place-items-center
                      disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
                      active:scale-[0.94] transition-transform duration-150
                    "
                    style={{
                      width: "clamp(56px, 14vw, 66px)",
                      height: "clamp(56px, 14vw, 66px)",
                      // Prototype convention: video = blue/sky.
                      background: "linear-gradient(135deg,#38bdf8,#0369a1)",
                      boxShadow:
                        "0 10px 26px -8px color-mix(in oklab, #38bdf8 60%, transparent), inset 0 2px 0 rgba(255,255,255,.3)",
                      transitionTimingFunction: "var(--ease-out)",
                    }}
                    aria-label="Video call"
                    title="Video call"
                  >
                    <Video className="size-6" strokeWidth={2.2} />
                  </button>
                  <span className="text-xs font-medium text-muted-foreground">Video Call</span>
                </div>
                {/* Group call (purple) — opens the participant picker. */}
                <div className="flex flex-col items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowGroup(true)}
                    className="
                      rounded-full text-white grid place-items-center
                      active:scale-[0.94] transition-transform duration-150
                    "
                    style={{
                      width: "clamp(56px, 14vw, 66px)",
                      height: "clamp(56px, 14vw, 66px)",
                      // Prototype convention: group/contacts = violet.
                      background: "linear-gradient(135deg,#a78bfa,#7c3aed)",
                      boxShadow:
                        "0 10px 26px -8px color-mix(in oklab, #7c3aed 60%, transparent), inset 0 2px 0 rgba(255,255,255,.3)",
                      transitionTimingFunction: "var(--ease-out)",
                    }}
                    aria-label="Group call"
                    title="Group call — ring up to 10 people into one room"
                  >
                    <Users className="size-6" strokeWidth={2.2} />
                  </button>
                  <span className="text-xs font-medium text-muted-foreground">Group Call</span>
                </div>
              </div>
              {/* Backspace — kept out of the way of the centred trio. */}
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
