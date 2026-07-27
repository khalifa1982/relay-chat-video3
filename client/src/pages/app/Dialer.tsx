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
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { arrivedWithDialTarget, consumeDialIntent } from "@/lib/bootUrl";
import { RoleBadge, roleFromFlags, roleLabel } from "@/app/VerifiedBadge";
import { openPeerProfile } from "@/app/PeerOverlays";
import { playDtmf, disposeDtmf } from "@/lib/dtmf";
import { useIdentity } from "@/app/useIdentity";
import { demotablePollInterval } from "@/app/useRealtime";
import { useRelayEngine } from "@/app/RelayEngine";
import { GroupCallScreen } from "./GroupCallScreen";
import {
  effectiveStatus,
  formatElapsedSince,
  formatLastSeen,
  type StatusOverride,
} from "@shared/profileFields";

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

/**
 * The dialer preview's presence line, to the owner's order (v2.99.90): *"it shows
 * you his badge. It shows you when was his last login. First, to show you also he
 * is online, then last login, number of hours."*
 *
 * So: **whether they are here NOW**, then **how long since they were**, as an
 * elapsed duration and never a calendar date. `peerStatus` above folds the two
 * together into one string and is left ALONE, because it is what Contacts and the
 * profile popup render — the owner asked for the clock form there in v2.99.66.
 *
 * The elapsed figure is withheld while they are ONLINE or on a call: "last login
 * 3s ago" next to "online now" restates the same fact, and it would need a
 * per-second re-render to stay true. `travelling` and `away` are manual overrides,
 * not presence, so they DO keep the elapsed figure — the person set a label days
 * ago and how long ago they were actually here is still news.
 *
 * Pure and exported so the ordering rule can be tested without a DOM.
 */
export function peerPresenceLines(
  p: {
    isOnline: boolean;
    lastSeenAt: string | Date | null | undefined;
    statusOverride?: string | null;
    inCall?: boolean;
  },
  nowMs: number
): { presence: string; online: boolean; busy: boolean; elapsed: string; chosen: string } {
  const busy = !!p.inCall;
  const eff = effectiveStatus(!!p.isOnline, (p.statusOverride ?? "") as StatusOverride);
  const liveNow = busy || eff === "online" || eff === "away";
  const presence = busy ? "on a call" : eff === "online" || eff === "away" ? "online now" : "offline";
  const ts = p.lastSeenAt ? new Date(p.lastSeenAt).getTime() : 0;
  const elapsed = busy || eff === "online" ? "" : formatElapsedSince(ts, nowMs);
  /* Their CHOSEN status — the Away / Travelling selector in Profile → Status —
     shown on its own line rather than swallowed into the presence text. Owner:
     "his profile, there is two things. Not the bio. If he's travel or he's not
     travel, his status. Not the image and video." So this is deliberately NOT the
     bio and NOT the story media: it is the label the person picked. */
  const chosen = eff === "travel" ? "Travelling ✈️" : eff === "away" ? "Away" : "";
  return { presence, online: liveNow, busy, elapsed, chosen };
}

/** Sentinel for the bottom-left cell, which holds nothing at all. */
export const PAD_GAP = "gap";

/**
 * The pad is 3×4 and the bottom row is **blank · 0 · erase** (v2.99.90).
 *
 * Owner, with a screenshot: *"This star no need for this bottom. Remove it from
 * here and also remove it from the … dial pad, the main page … The star and the
 * hash key. So just keep in the center below zero, and on the right is the delete
 * of the numbers."*
 *
 * Both were pure decoration and had been for the life of this pad: a RELAY number
 * is six DIGITS, so `*` and `#` could never be part of one — `tap()` refused them
 * for the field and only played a tone. `#` gave up its cell to erase in v2.99.86;
 * `*` gives up its cell to nothing, because keeping `0` in the middle column is
 * what the owner asked for and a 3-column grid has no other way to centre it. The
 * blank is a real grid cell rather than a shortened list, or `0` would slide left
 * and the erase key would move out from under the thumb that was just typing.
 */
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
  { d: PAD_GAP, sub: "" },
  { d: "0", sub: "+" },
  // The 12th cell is the ERASE key, rendered explicitly after this list — see the
  // grid below.
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
    // SECURITY (M48): only auto-dial when the intent came from INSIDE the app.
    // If the document was LOADED with ?to=, the user arrived on this URL — a
    // clicked or pasted link, or a reload — and mic permission is already
    // granted for this origin, so dialing here would hand a live microphone
    // (plus the camera, with ?video=1) to an attacker-chosen number off a single
    // click. Prefill the pad instead so placing the call is one deliberate tap.
    // In-app taps from Messages/Contacts and the /i/<pin> invite flow route here
    // client-side, so `to` was NOT in the boot URL for them and they still
    // connect immediately, unchanged.
    // A matching one-time intent means WE navigated here (the back-online
    // notification the user armed and tapped), so it stays a single tap.
    //
    // v2.99.49: the question is whether THIS number is the one the document was
    // opened with — not whether the document ever opened with any. `BOOT_SEARCH`
    // is captured per document, so the old "did we boot with a target?" test
    // meant that after one arrival (tapping Call on a back-online alert is a full
    // page load) every later in-app call tap in that tab hit this branch, and
    // one-tap calling from Contacts/Messages stayed broken for the whole session.
    const intended = consumeDialIntent() === to;
    if (arrivedWithDialTarget(to) && !intended) {
      setDialed(to);
      try {
        window.history.replaceState(null, "", "/app/dialer");
      } catch { /* */ }
      return;
    }
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

  // Hardware-keyboard support: digits type into the pad; Backspace removes.
  useEffect(() => {
    if (phase !== "idle") return; // engine owns keyboard during a call
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^[0-9]$/.test(e.key)) {
        setDialed((s) => (s.length < 6 ? s + e.key : s));
        if (dialed.length < 6) playDtmf(e.key); // same tone as tapping the pad
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

  // Close the keypad-tone AudioContext when the dial pad goes away (it is
  // output-only, so it never held the mic — this just frees the context).
  useEffect(() => () => disposeDtmf(), []);

  function tap(d: string) {
    // Digits only, and now there is nothing else on the pad to guard against —
    // `*` and `#` are both gone (v2.99.90). The check stays because it is the
    // thing that made their removal safe rather than merely tidy: the length
    // guard used to apply ONLY to digits, so `*` appended without limit and could
    // push non-numeric junk into a field that can only hold six digits.
    if (!/^[0-9]$/.test(d)) return;
    if (dialed.length >= 6) return;
    setDialed((s) => s + d);
    // Owner spec: a real dial-pad TONE per key (standard DTMF dual tone), so
    // dialling sounds like a phone. Output-only WebAudio — never touches the mic.
    playDtmf(d);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try { navigator.vibrate(8); } catch { /* ignore */ }
    }
  }

  function backspace() {
    setDialed((s) => s.slice(0, -1));
  }

  function startCallNow(opts?: { voice?: boolean }) {
    if (dialed.length !== 6) return;
    // Defensive: the buttons are disabled for a nonexistent number, but never
    // dial one even if a click slips through (v2.99.17).
    if (nonexistent) return;
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
  // v2.99.17 (owner: dialing a number that doesn't exist should offer NO
  // actions — no call, no message, no save). A number is NONEXISTENT only when
  // the public lookup RESOLVED SUCCESSFULLY to nothing (isSuccess + null data —
  // not a user, not a party line). We key on isSuccess so a lookup ERROR or a
  // still-loading query FAILS OPEN (actions stay enabled; the dial itself then
  // surfaces the real error) — a transient hiccup never blocks a real number.
  const nonexistent =
    /^\d{6}$/.test(dialed) && dialed !== myNumber && previewQuery.isSuccess && !previewIdentity;
  const callable =
    /^\d{6}$/.test(dialed) && dialed !== myNumber && engineReady && !nonexistent;

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
              flex flex-col overflow-y-auto
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

              {/* Sub-line: hint or live preview.
                  v2.99.36 (owner screenshot): this was a FIXED h-4 (16px) row,
                  but the resolved-user preview puts name + tier badge + presence
                  in it — and RoleBadge stacks its caption under the mark (~22px),
                  so the badge overflowed the row and collided with the keypad
                  below ("it's overlap"). Now a min-height that can grow to two
                  lines, so nothing is ever clipped or overlapping. */}
              {/* v2.99.90 (owner): "make little space" — the dialed number, this
                  information block and the keypad below were reading as one
                  attached mass. `mt-1.5` became `mt-3`, and the block's own bottom
                  margin separates it from the pad. The card's `gap` already spaces
                  its rows; this is the space INSIDE the number area, which the gap
                  could not reach. */}
              <div
                className="mt-3 mb-1.5 text-[0.78rem] min-h-4 text-muted-foreground"
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
                      /* THE OWNER'S ORDER (v2.99.90): name + badge · online-or-not ·
                         how long since their last login · the status THEY chose.
                         Each on its own line with real breathing room between them —
                         owner: "currently, it's showing you the dialed number, then
                         the information, then the pad is all together attached. Make
                         space between the little bit." */
                      const st = peerPresenceLines(
                        {
                          isOnline: previewIdentity.isOnline,
                          lastSeenAt: previewIdentity.lastSeenAt,
                          statusOverride: previewIdentity.statusOverride,
                          inCall: previewIdentity.inCall,
                        },
                        Date.now()
                      );
                      // Line 1 = name + tier mark with the tier word INLINE
                      // (caption={false}, so the badge no longer stacks text under
                      // the mark and spills into the keypad — v2.99.36).
                      const tier = roleFromFlags(previewIdentity.role, previewIdentity.verified);
                      const tierWord = roleLabel(tier);
                      return (
                        <span className="flex flex-col items-center gap-1 leading-tight">
                          <span className="flex items-center justify-center gap-1 max-w-full">
                            {/* Name → profile popup (v2.96): see who it is BEFORE
                                dialing — avatar, status, one-tap add-to-contacts. */}
                            <button
                              type="button"
                              onClick={() => openPeerProfile(previewIdentity.number)}
                              className="font-semibold text-foreground underline-offset-2 hover:underline truncate"
                              aria-label={`View ${previewIdentity.displayName}'s profile`}
                            >
                              {previewIdentity.displayName}
                            </button>
                            {tier && (
                              <span className="inline-flex items-center gap-0.5 shrink-0">
                                <RoleBadge role={tier} size={13} caption={false} />
                                {tierWord && (
                                  <span className="text-[0.66rem] font-semibold text-muted-foreground">
                                    {tierWord}
                                  </span>
                                )}
                              </span>
                            )}
                          </span>
                          {/* Presence first, then how long ago — the elapsed figure
                              rides the SAME line as a dot separator so the block
                              stays short on a card with no spare height. */}
                          <span className="flex items-center justify-center gap-1.5">
                            <span
                              className={
                                st.busy
                                  ? "text-amber-500 font-medium"
                                  : st.online
                                    ? "text-[color:var(--relay-online)] font-medium"
                                    : "text-muted-foreground font-medium"
                              }
                            >
                              {st.presence}
                            </span>
                            {st.elapsed && (
                              <>
                                <span className="text-muted-foreground/50">·</span>
                                {/* Elapsed, never a date (owner: "not date as a
                                    date. No. As a number of days and number of
                                    hours"). LTR + bidi-isolated so an RTL locale
                                    cannot reorder "2d 4h". */}
                                <span
                                  dir="ltr"
                                  className="font-mono tabular-nums [unicode-bidi:isolate] text-muted-foreground"
                                >
                                  {st.elapsed} ago
                                </span>
                              </>
                            )}
                          </span>
                          {/* The status they PICKED — not their bio, not their story
                              media. Its own chip so it reads as a label they chose
                              rather than as live presence. */}
                          {st.chosen && (
                            <span className="inline-flex items-center rounded-full border border-border bg-card/60 px-2 py-0.5 text-[0.7rem] font-medium text-foreground">
                              {st.chosen}
                            </span>
                          )}
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
              {KEYS.map((k) =>
                k.d === PAD_GAP ? (
                  // The bottom-left cell holds nothing. It is a real, inert grid
                  // cell rather than a shortened key list, because that is what
                  // keeps `0` in the middle column and the erase key bottom-right
                  // (owner: "just keep in the center below zero, and on the right
                  // is the delete"). Not a button, so it cannot be tapped or
                  // focused, and aria-hidden so a screen reader does not announce
                  // an empty control between 9 and 0.
                  <span key={k.d} aria-hidden="true" />
                ) : (
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
                )
              )}
              {/* ERASE — the 12th cell (v2.99.86, owner with a screenshot of the
                  pale ghost icon): "This delete, I couldn't make it little large and
                  red colour, flashy glossy to delete the numbers in case you want to
                  delete it."
                  It sits IN the pad rather than floating beside the call buttons, and
                  that is a MEASUREMENT rather than a preference: the old floating
                  button already overlapped the Group Call button by 9px at 320px
                  BEFORE this change, and enlarging it to the size the owner asked for
                  took the overlap to 17px. In the pad it cannot collide, it is under
                  the thumb that is typing, and there is exactly ONE erase affordance
                  (the "just put it one place" rule from v2.99.82).
                  Dimmed and inert with nothing to erase — never hidden, because a key
                  that appears and disappears makes the grid jump. */}
              <button
                type="button"
                onClick={backspace}
                disabled={dialed.length === 0}
                className="
                  relay-key relative rounded-[22px] overflow-hidden
                  flex items-center justify-center select-none text-white
                  transition-[transform,opacity] duration-150
                  active:scale-[0.94] disabled:opacity-30 disabled:active:scale-100
                "
                style={{
                  transitionTimingFunction: "var(--ease-out)",
                  background: "linear-gradient(160deg,#f87171,#dc2626 55%,#991b1b)",
                  border: "1px solid rgba(255,255,255,.22)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,.22), 0 6px 16px rgba(153,27,27,.45)",
                }}
                aria-label="Erase last digit"
                title="Erase"
              >
                {/* The halo: a STATIC box-shadow on a stacked overlay, only its
                    OPACITY animated. Animating the key's own box-shadow would
                    repaint it every frame (the v2.99.84 rule). Runs only when there
                    is something to erase, so an idle pad is completely still. */}
                {dialed.length > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-[22px] pointer-events-none relay-gloss-pulse"
                    style={{ boxShadow: "0 0 16px 3px rgba(220,38,38,.6)" }}
                  />
                )}
                {/* The gloss: a fixed specular highlight across the top. Static on
                    purpose — a moving shine on a key you are aiming at is a
                    distraction rather than "flashy". */}
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-1/2 pointer-events-none"
                  style={{ background: "linear-gradient(180deg,rgba(255,255,255,.32),rgba(255,255,255,0))" }}
                />
                <Delete className="relative" style={{ width: "clamp(22px,6.5vw,28px)", height: "clamp(22px,6.5vw,28px)" }} strokeWidth={2.4} />
              </button>
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
                    disabled={nonexistent}
                    onClick={() => setShowGroup(true)}
                    className="
                      rounded-full text-white grid place-items-center
                      disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
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
                    title={nonexistent ? "That number isn't on RELAY" : "Group call — ring up to 10 people into one room"}
                  >
                    <Users className="size-6" strokeWidth={2.2} />
                  </button>
                  <span className="text-xs font-medium text-muted-foreground">Group Call</span>
                </div>
              </div>
            </div>

            {/* Quick-add (v2.99.8): offer Save for a complete 6-digit number
                that isn't yours, isn't a party line, and isn't already saved.
                v2.99.17 (owner): NOT for a NONEXISTENT number — you can't save
                a contact that isn't a real RELAY user. (During the lookup, and
                on a lookup error, nonexistent is false, so Save still shows for
                a real user the moment it resolves — or optimistically.) */}
            {/* v2.99.36 (owner: "save to contact is not showing"): the card is a
                no-scroll flex column sized to its rows, so this EXTRA row was
                clipped by the bottom of the card / tab bar. It is now a
                shrink-0 centred row (and the card can scroll as a safety valve),
                so the pill is always fully visible and tappable. */}
            {/^\d{6}$/.test(dialed) && dialed !== myNumber && !previewIdentity?.partyLine && !nonexistent ? (
              <div className="shrink-0 flex justify-center pt-1 pb-0.5">
                <QuickAddContact
                  number={dialed}
                  displayName={previewIdentity?.displayName || dialed}
                />
              </div>
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
      toast.success("Saved to your contacts.");
    },
    onError: (e) => toast.error((e as { message?: string })?.message ?? "Couldn't save the contact."),
  });
  const existing = trpc.contacts.list.useQuery();
  const isAlready = (existing.data ?? []).some((c) => c.number === number);
  /* ALREADY SAVED → NOTHING AT ALL (v2.99.90, owner: "If the number is already on
     contact, you don't need to show this message"). The confirmation chip that used
     to sit here answered a question nobody asked: there was no action to take, and
     the row it occupied is directly under three call buttons on a card that has no
     spare vertical space. */
  if (isAlready) return null;
  /* NOT SAVED → ONE GLOSSY ICON (owner: "just show an icon added to contact but a
     different color, make it nice color … glossy, glossy, and flashy").
     Pink→fuchsia because every other colour on this screen already means something:
     green is Voice, sky is Video, violet is Group Call, red is erase, amber is Do
     Not Disturb. A fourth reuse would make the colour stop carrying information.
     The halo is a STATIC box-shadow on a stacked overlay with only its OPACITY
     animated — animating the button's own box-shadow repaints it every frame, the
     class of animation v2.99.84 measured and removed. */
  return (
    <button
      type="button"
      onClick={() => upsert.mutate({ number, displayName: displayName === number ? undefined : displayName })}
      disabled={upsert.isPending}
      aria-label={`Add ${number} to your contacts`}
      title="Add to contacts"
      className="
        relative grid place-items-center rounded-full overflow-hidden text-white
        size-12 shrink-0
        active:scale-[0.94] transition-transform duration-150 disabled:opacity-60
      "
      style={{
        transitionTimingFunction: "var(--ease-out)",
        background: "linear-gradient(150deg,#f9a8d4,#ec4899 52%,#c026d3)",
        border: "1px solid rgba(255,255,255,.24)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.28), 0 6px 18px rgba(192,38,211,.42)",
      }}
    >
      {!upsert.isPending && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full pointer-events-none relay-gloss-pulse"
          style={{ boxShadow: "0 0 18px 4px rgba(236,72,153,.6)" }}
        />
      )}
      {/* A fixed specular highlight across the top — static on purpose: a moving
          shine on a button you are aiming at is a distraction, not "flashy". */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1/2 pointer-events-none"
        style={{ background: "linear-gradient(180deg,rgba(255,255,255,.34),rgba(255,255,255,0))" }}
      />
      {upsert.isPending ? (
        <span className="relative size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        <UserPlus className="relative size-5" strokeWidth={2.3} />
      )}
    </button>
  );
}
