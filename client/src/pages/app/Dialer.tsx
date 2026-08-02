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
import { MyNumberCard } from "@/app/ShareNumber";
import { shareInviteMessage } from "@/app/inviteMessage";
import { useT, useLocale, translate, type TKey } from "@/app/i18n";
import { DialerMarquee } from "@/app/DialerMarquee";
import { demotablePollInterval } from "@/app/useRealtime";
import { useRelayEngine } from "@/app/RelayEngine";
import { GroupCallScreen } from "./GroupCallScreen";
import {
  effectiveStatus,
  formatElapsedSince,
  type StatusOverride,
} from "@shared/profileFields";

/* NO `peerStatus` HERE ANY MORE (v2.106.97), and the reason is worth recording
   because its own comment claimed the opposite.
 *
 * It described itself as "shared by the Dialer, the profile popup, Contacts and
 * History" and was imported by NONE of them — nor by any test. What each of those
 * screens actually renders is `peerPresenceLines` below, `describePeerPresence` in
 * `shared/profileFields.ts`, or its own formatter.
 *
 * It is deleted rather than left, on v2.106.91's rule: an exported value nothing
 * consumes reads as a contract, and this one carried a false statement about which
 * screens depend on it — so the next person needing a presence line would have
 * wired a fifth surface to a function no other surface uses. It also carried the
 * last standing claim that "translating `formatLastSeen` is its own piece of work",
 * which stopped being true in this release: `client/src/app/presenceCopy.ts` renders it
 * from the shared `lastSeenBand`. */

/**
 * The dialer preview's presence line, to the owner's order (v2.99.90): *"it shows
 * you his badge. It shows you when was his last login. First, to show you also he
 * is online, then last login, number of hours."*
 *
 * So: **whether they are here NOW**, then **how long since they were**, as an
 * elapsed duration and never a calendar date. The clock form the owner asked for
 * in v2.99.66 is a DIFFERENT line and lives in `lastSeenBand` +
 * `client/src/app/presenceCopy.ts`, which the conversation header renders.
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
    /** Signed in but backgrounded (v2.99.92). */
    idle?: boolean;
    lastSeenAt: string | Date | null | undefined;
    statusOverride?: string | null;
    inCall?: boolean;
  },
  nowMs: number
): {
  presence: string;
  /** The dictionary key for `presence`. It rides ALONGSIDE the text rather than
   *  replacing it (v2.106.84) so a surface the Arabic sweep has not reached still
   *  renders something; a `text -> key` lookup at each render site is what this
   *  dictionary's rule forbids, since a copy edit would silently drop the
   *  translation. Never null here: this line is always one of four fixed
   *  phrases. */
  presenceKey: TKey;
  online: boolean;
  busy: boolean;
  elapsed: string;
  chosen: string;
  /** The dictionary key for `chosen`, riding alongside the text for the same
   *  reason `presenceKey` does. Null when they have chosen nothing. */
  chosenKey: TKey | null;
} {
  const busy = !!p.inCall;
  const eff = effectiveStatus(!!p.isOnline, (p.statusOverride ?? "") as StatusOverride, !!p.idle);
  const liveNow = busy || eff === "online" || eff === "away";
  const presenceKey: TKey = busy
    ? "presence.onCall"
    : eff === "online"
      ? "presence.online"
      : // "away" covers both a deliberate Away and an automatic idle (v2.99.92);
        // either way the honest word for the presence line is the same.
        eff === "away"
        ? "presence.away"
        : "presence.offline";
  // The English is DERIVED from the key rather than written twice, so the two can
  // never come to disagree about what a state is called.
  const presence = translate("en", presenceKey);
  const ts = p.lastSeenAt ? new Date(p.lastSeenAt).getTime() : 0;
  const elapsed = busy || eff === "online" ? "" : formatElapsedSince(ts, nowMs);
  /* Their CHOSEN status — the Away / Travelling selector in Profile → Status —
     shown on its own line rather than swallowed into the presence text. Owner:
     "his profile, there is two things. Not the bio. If he's travel or he's not
     travel, his status. Not the image and video." So this is deliberately NOT the
     bio and NOT the story media: it is the label the person picked. */
  // The chip is for a status the person CHOSE. An automatic idle also resolves to
  // `away`, but nobody selected it, so labelling it the same would put words in
  // their mouth — the presence line above already says "away" for that case.
  const override = (p.statusOverride ?? "") as StatusOverride;
  const chosenKey: TKey | null =
    override === "travel" ? "dialer.chosenTravelling" : override === "away" ? "dialer.chosenAway" : null;
  // DERIVED from the key rather than written twice, so the two can never disagree.
  const chosen = chosenKey ? translate("en", chosenKey) : "";
  return { presence, presenceKey, online: liveNow, busy, elapsed, chosen, chosenKey };
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
 * Which "N more digits" wording a remaining-digit count needs.
 *
 * A FUNCTION RATHER THAN AN INTERPOLATED `s`, AND THAT IS THE WHOLE POINT.
 * `` `${n} more digit${n === 1 ? "" : "s"}` `` is a sentence assembled from a
 * fragment, so it cannot be translated at all — only re-assembled into nonsense.
 * English needs one/other; Arabic counts in four bands, and getting it wrong is
 * visible to every reader: 1 is singular, 2 is the DUAL («رقمان»), 3–10 take the
 * plural of paucity («أرقام») and 11+ take the singular accusative («رقمًا»). So a
 * WHOLE key is chosen per band, the same shape as `guestExpiryKey`.
 *
 * THE BAND ABOVE TEN CANNOT ARISE TODAY and is here anyway: this is only ever
 * called with `6 - dialed.length` where the typed length is 1–5, so the domain is
 * 1–5. The 11+ form exists because the rule belongs to the LANGUAGE rather than to
 * today's caller — a later change to the number length would otherwise silently
 * start rendering "11 أرقام", which is wrong Arabic, with nothing failing.
 *
 * Exported as a test seam: which form a count selects is exactly the thing a source
 * assertion cannot answer.
 */
export function moreDigitsKey(remaining: number): TKey {
  if (remaining <= 1) return "dialer.moreDigitsOne";
  if (remaining === 2) return "dialer.moreDigitsTwo";
  return remaining <= 10 ? "dialer.moreDigitsFew" : "dialer.moreDigitsMany";
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
  /* `tn` as well as `t`: the missed-call banner interpolates a BOLDED name into the
     middle of its sentence, which is exactly the case `translateNodes` exists for. */
  const { t, tn } = useLocale();
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
    /* THE WORDING AND THE LAYOUT LIVE IN `inviteMessage.ts` (v2.106.92), not here.
       This site's own previous comment claimed that passing `title` + `url` separately
       makes the share sheet "lay them out cleanly (header on top, link below) instead of
       concatenating into one block" — the owner's screenshot disproves it: WhatsApp joins
       them with a SPACE and the sentence wraps into the URL. The layout is only ours to
       control if we hand over ONE field. */
    shareInviteMessage(t, {
      who: { name: me?.displayName, pin: num },
      url: `${window.location.origin}/i/${num}`,
      onCopied: () => toast.success(t("dialer.inviteCopied")),
      onCopyFailed: () => toast.error(t("dialer.copyFailed")),
    });
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

  /* Who the inline add-to-contacts button is for, or null for "no button".
     EXTRACTED rather than left inline (v2.106.78) because the button MOVED — it
     used to sit in its own centred row below the keypad and now sits beside the
     digits — and the condition is exactly what it always was: a complete 6-digit
     number that is not yours, is not a party line, and is not a number the
     lookup proved does not exist. Whether it is ALREADY SAVED is decided one
     layer down inside QuickAddContact, which returns null in that case — the
     owner's *"if the number is in your contact, no need to show the button"*,
     and a rule that has lived there since v2.99.90. */
  const quickAddTarget =
    /^\d{6}$/.test(dialed) && dialed !== myNumber && !previewIdentity?.partyLine && !nonexistent
      ? dialed
      : null;

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
                  {missedCount === 1 ? t("dialer.missedCall") : t("dialer.missedCalls", { count: missedCount })}
                </span>
                {/* ONE SENTENCE, ONE KEY. This used to be `from ` + a bolded name +
                    an optional ` · 777 777` + ` — tap to see all`, i.e. a sentence
                    chopped at its English seams — which cannot be translated, only
                    re-assembled into nonsense, because Arabic does not put those
                    words in that order. `tn` keeps the placeholders INSIDE the
                    string so the translator decides where the name and the number
                    go. `num` is always passed (empty when there is none), because an
                    absent var leaves the raw `{num}` on screen. */}
                <span className="block text-xs text-muted-foreground truncate">
                  {tn("dialer.missedFromTap", {
                    name: (
                      <span className="font-medium text-foreground/90">{missedLatest.name}</span>
                    ),
                    num: missedLatest.number ? ` · ${formatDialed(missedLatest.number)}` : "",
                  })}
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
                <Phone className="size-4 me-1" /> {t("dialer.callBack")}
              </Button>
            )}
            <button
              type="button"
              onClick={() => setShowMissed(false)}
              aria-label={t("dialer.dismiss")}
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
            <h2 className="font-semibold tracking-tight">{t("dialer.recent")}</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {history.isLoading ? (
              <div className="p-6 text-sm text-muted-foreground">{t("dialer.loading")}</div>
            ) : recent.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                {t("dialer.noCalls")}
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
                        aria-label={t("dialer.callBackVoice")}
                        title={t("dialer.callBackVoice")}
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
            {/* Board 1a: the "MY NUMBER" glass card with copy / QR / share, above the
                readout. It renders nothing without a number (a guest mid-mint has none, and
                a card headed MY NUMBER over an em-dash asserts something false), and it
                mounts the SHARED sheet extracted out of Profile rather than a second QR
                renderer — see client/src/app/ShareNumber.tsx.

                It is `shrink-0` because the card is a no-scroll flex column: an auto-height
                row here would be the first thing squeezed on a short phone, which is how
                v2.99.36's save-pill came to be clipped. */}
            <MyNumberCard number={me?.number} className="rmynum-dialer shrink-0" />

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
                  /* TYPED: the digits, and — when the number is complete, real and
                     not already saved — the add-to-contacts button INLINE to their
                     right (owner: *"in place of showing below, show on the right
                     after the numbers you enter it, make little space after the last
                     number … if the number is in your contact, no need to show"*).
                     The button is absolutely positioned so it cannot push the digits
                     off centre: the readout stays exactly where it has always been,
                     and the affordance appears beside it rather than moving it. */
                  <span className="relative inline-flex items-center justify-center">
                    <span
                      className="text-foreground font-semibold animate-[ghost-flash_220ms_var(--ease-out)]"
                      aria-live="polite"
                    >
                      {ghost.display}
                    </span>
                    {quickAddTarget ? (
                      <span className="absolute start-full top-1/2 -translate-y-1/2 ps-[34px]">
                        <QuickAddContact
                          number={quickAddTarget}
                          displayName={previewIdentity?.displayName || quickAddTarget}
                        />
                      </span>
                    ) : null}
                  </span>
                ) : (
                  /* IDLE: the marquee.
                     THE GREEN GHOST OF THE VIEWER'S OWN NUMBER IS GONE FROM HERE,
                     which is the owner's actual complaint — they circled this slot
                     and said their number *"is mentioned down, not here"*. It was
                     the third copy on one screenshot (top bar, MY NUMBER card, this).
                     v2.106.77 removed the first; this removes the third; the MY
                     NUMBER card directly above keeps the one you can act on.
                     Below 660px, where index.css hides that card, the marquee's own
                     rotation carries the number instead — see buildRotations. */
                  <DialerMarquee ownNumber={me?.number ?? null} onPick={setDialed} />
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
              {/* v2.106.80 (owner, with a screenshot of the live Dialer and one
                  word — "You see the over lap"): `mt-3` was 12px, and that is
                  LESS THAN THE ADD-TO-CONTACTS LABEL NEEDS, so the label landed
                  on top of this block's first line. Their screenshot shows "Add
                  to contacts" written across "Registered".

                  THE ARITHMETIC IS WHY IT WAS ALWAYS GOING TO COLLIDE: the add
                  button is 48px centred on a 28px digit run, so it already hangs
                  ~10px below the digits before the label starts; the label then
                  needs its own 4px offset plus 9.5px of text. 12px could never
                  hold ~13.5px of content, and because the label is absolutely
                  positioned it takes no space and nothing failed — it simply
                  drew over whatever was there.

                  MEASURED AGAINST THE REAL BUILT STYLESHEET at 320/360/375/390/430
                  (the owner's screenshot is 1125px at DPR 3, i.e. 375): at 12px
                  the label's bottom sits 5px BELOW the name line's top at every
                  width; at 16px it is still 1px short; at 20px there is a 3px
                  gap and every width comes back clean. So this is 20px, and the
                  bottom margin absorbs part of the cost — the card's own `gap`
                  already separates this block from the row beneath it, which is
                  what v2.99.90's "make space" ask was really about. */}
              <div
                className="mt-5 mb-1 text-[0.78rem] min-h-4 text-muted-foreground"
                aria-live="polite"
              >
                {ghost.mode === "ghost" ? (
                  <button
                    type="button"
                    onClick={shareInvite}
                    className="inline-flex items-center gap-1.5 font-medium tracking-wide text-muted-foreground hover:text-foreground transition-colors active:scale-95"
                  >
                    <Share2 className="size-3.5" /> {t("dialer.shareInvite")}
                  </button>
                ) : ghost.mode === "typed" && dialed.length === 6 ? (
                  previewQuery.isLoading ? (
                    t("dialer.lookingUp")
                  ) : previewIdentity?.partyLine ? (
                    // Party line (v2.89): a dialable room — show its title and
                    // the live head-count instead of a person's presence.
                    <span>
                      <span className="font-semibold text-foreground">
                        {previewIdentity.displayName}
                      </span>
                      {" · "}
                      <span className="text-violet-400 font-medium">
                        {t("dialer.partyLine", { count: previewIdentity.memberCount })}
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
                          idle: previewIdentity.idle,
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
                              /* REUSES `peer.viewNamedProfile` rather than minting a
                                 Dialer copy: this opens the very same popup the
                                 avatar ring does, so a second key would guarantee the
                                 two labels agree only until somebody edited one. The
                                 possessive has no Arabic equivalent, so the name
                                 MOVES inside the sentence — safe because `translate`
                                 substitutes by NAME rather than by position. */
                              aria-label={t("peer.viewNamedProfile", {
                                name: previewIdentity.displayName,
                              })}
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
                              {t(st.presenceKey)}
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
                                  {t("dialer.ago", { elapsed: st.elapsed })}
                                </span>
                              </>
                            )}
                          </span>
                          {/* The status they PICKED — not their bio, not their story
                              media. Its own chip so it reads as a label they chose
                              rather than as live presence. */}
                          {st.chosenKey && (
                            <span className="inline-flex items-center rounded-full border border-border bg-card/60 px-2 py-0.5 text-[0.7rem] font-medium text-foreground">
                              {t(st.chosenKey)}
                            </span>
                          )}
                        </span>
                      );
                    })()
                  ) : (
                    t("dialer.noSuchUser")
                  )
                ) : ghost.mode === "typed" ? (
                  /* A WHOLE KEY PER PLURAL BAND — see `moreDigitsKey`. This is the
                     app's default tab and this line renders on every keystroke
                     between the first digit and the sixth, so it is the single most
                     seen sentence on the screen. */
                  t(moreDigitsKey(6 - dialed.length), { count: 6 - dialed.length })
                ) : (
                  t("dialer.enterNumber")
                )}
              </div>
            </div>

            {/* Keypad: a square 3×4 that scales to fill remaining vertical space */}
            <div
              className="grid grid-cols-3 mx-auto w-full"
              style={{
                // Cap so we never look comically large on desktop.
                /* Board 1a: "3x4 circular glass keypad (aspect 1) ... max-width 310px
                   centered". MEASURED, and the first cut got both halves wrong:

                   1. `gridAutoRows` set the row height INDEPENDENTLY of the column width,
                      so at 390px the cells came out 99x80 and every "circle" was an oval
                      by 18px. Rows are `auto` now and each KEY is `aspect-square`, which
                      makes the cell square by construction at any width — that is what
                      the board's "aspect 1" actually requires.

                   2. A 310px pad is ~413px tall, and with the new MY NUMBER row above it
                      the card overflowed a 667px phone by 121px. So the cap is also a
                      function of the viewport HEIGHT — the third `min()` term — with a
                      210px FLOOR so a very short phone gets a scroll (the card's existing
                      `overflow-y-auto` safety valve) rather than 29px keys nobody can hit.
                      The 422px subtrahend is the card's other rows measured at 390px:
                      top bar 48 + tab bar 47 + card padding 44 + MY NUMBER 69 + readout
                      and preview ~80 + action row ~80 + inter-row gaps ~54. */
                maxWidth: "min(100%, 310px, max(190px, calc((100dvh - 422px) * 0.75)))",
                gap: "clamp(6px, 1.8vw, 12px)",
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
                    relay-key rkey relative rounded-full aspect-square
                    text-secondary-foreground
                    flex flex-col items-center justify-center
                    select-none
                    transition-[transform,background-color] duration-150
                    active:scale-[0.94]
                  "
                  style={{ transitionTimingFunction: "var(--ease-out)" }}
                >
                  {/* CIRCULAR, per the design board (1a: "3x4 circular glass keypad,
                      aspect 1, letters under digits"). The squircle it replaces and the
                      missing sublabels both came from the OLD prototype — `KEYS` has
                      carried `sub` unused ever since. The letters are decoration on a
                      numeric-only field, so they are aria-hidden: a screen reader
                      announcing "two A B C" for a digit key is noise. */}
                  <span
                    className="font-mono font-medium leading-none"
                    style={{ fontSize: "clamp(1.25rem, 4.8vw, 1.75rem)" }}
                  >
                    {k.d}
                  </span>
                  {k.sub.trim() && (
                    <span
                      aria-hidden="true"
                      className="rkey-sub font-mono leading-none text-muted-foreground"
                      style={{ fontSize: "clamp(7px, 1.7vw, 9px)", letterSpacing: ".14em", marginTop: 2 }}
                    >
                      {k.sub}
                    </span>
                  )}
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
                  relay-key relative rounded-full aspect-square overflow-hidden
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
                aria-label={t("dialer.eraseLast")}
                title={t("dialer.erase")}
              >
                {/* The halo: a STATIC box-shadow on a stacked overlay, only its
                    OPACITY animated. Animating the key's own box-shadow would
                    repaint it every frame (the v2.99.84 rule). Runs only when there
                    is something to erase, so an idle pad is completely still. */}
                {dialed.length > 0 && (
                  <span
                    aria-hidden="true"
                    /* Follows the button's own radius: the key became a CIRCLE this
                       release and a squircle overlay inside it shows its corners through
                       the fill. Caught by this release's own test. */
                    className="absolute inset-0 rounded-full pointer-events-none relay-gloss-pulse"
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
              {/* OWNER REPORT: "under the dial up pad the b[u]ttons is not on one line".
                  MEASURED and confirmed at 320/360/375/390/430: it was `items-start`
                  with buttons of DIFFERENT heights — Call is the board's 66px primary,
                  Video and Group are 50px secondaries — so aligning their TOPS pushed
                  Call's label 9.7-14.5px below the other two and left the three button
                  centres 4.9-7.3px apart. The row read as stepped rather than as a row.

                  FIXED BY CONSTRUCTION rather than by nudging a margin: every column
                  gets a button SLOT of the same height (the tallest button's own clamp)
                  with the button centred inside it, so the centres AND the label tops
                  line up at any width without either value being restated. A
                  `items-center` on the flex row would have centred the whole COLUMNS,
                  which lines the buttons up and then offsets the labels the other way,
                  because the columns have different total heights.

                  A 3-column grid with `justify-items-center` also stops the columns
                  being sized by their own labels, which is what made the gaps look
                  uneven ("Group Call" is 4.6px wider than "Voice Call"). */}
              <div className="grid grid-cols-3 justify-items-center gap-2">
                {/* Voice call (blue) — starts with the camera off (audio-only). */}
                <div className="flex flex-col items-center gap-1.5">
                  <span
                    className="grid place-items-center"
                    /* The slot, matching the PRIMARY button's clamp exactly so the
                       tallest control defines the row's button band. */
                    style={{ height: "clamp(58px, 15vw, 66px)" }}
                  >
                  <button
                    type="button"
                    disabled={!callable}
                    onClick={() => startCallNow({ voice: true })}
                    className="
                      rcta rounded-full grid place-items-center
                      disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
                      active:scale-[0.94] transition-transform duration-150
                    "
                    /* Board 1a: "Video 50px / Call 66px solid accent / Group 50px" — Call
                       is the PRIMARY and wears the cycling accent, which is what makes the
                       hierarchy read at a glance. `.rcta` carries the board's on-accent
                       `#04211a` text, not white: white fails on the palette's yellow and
                       lime entries. */
                    style={{
                      width: "clamp(58px, 15vw, 66px)",
                      height: "clamp(58px, 15vw, 66px)",
                      transitionTimingFunction: "var(--ease-out)",
                    }}
                    aria-label={previewIsLine ? t("dialer.joinPartyLine") : t("dialer.voiceCall")}
                    title={previewIsLine ? t("dialer.joinPartyLineHint") : t("dialer.voiceCallHint")}
                  >
                    <PhoneCall className="size-6" strokeWidth={2.2} />
                  </button>
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">
                    {previewIsLine ? t("dialer.join") : t("dialer.voiceCall")}
                  </span>
                </div>
                {/* Video call (green). */}
                <div className="flex flex-col items-center gap-1.5">
                  <span className="grid place-items-center" style={{ height: "clamp(58px, 15vw, 66px)" }}>
                  <button
                    type="button"
                    disabled={!callable}
                    onClick={() => startCallNow()}
                    className="
                      rkey rounded-full grid place-items-center
                      disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
                      active:scale-[0.94] transition-transform duration-150
                    "
                    /* SECONDARY at the board's 50px: a glass circle whose GLYPH keeps the
                       app's own sky-for-video convention, so the colour language the owner
                       established survives while Call takes the accent. */
                    style={{
                      width: "clamp(46px, 12.5vw, 50px)",
                      height: "clamp(46px, 12.5vw, 50px)",
                      color: "#7dd3fc",
                      transitionTimingFunction: "var(--ease-out)",
                    }}
                    aria-label={t("dialer.videoCall")}
                    title={t("dialer.videoCall")}
                  >
                    <Video className="size-5" strokeWidth={2.2} />
                  </button>
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">{t("dialer.videoCall")}</span>
                </div>
                {/* Group call (purple) — opens the participant picker. */}
                <div className="flex flex-col items-center gap-1.5">
                  <span className="grid place-items-center" style={{ height: "clamp(58px, 15vw, 66px)" }}>
                  <button
                    type="button"
                    disabled={nonexistent}
                    onClick={() => setShowGroup(true)}
                    className="
                      rkey rounded-full grid place-items-center
                      disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
                      active:scale-[0.94] transition-transform duration-150
                    "
                    /* SECONDARY, 50px, violet glyph — same reasoning as Video. */
                    style={{
                      width: "clamp(46px, 12.5vw, 50px)",
                      height: "clamp(46px, 12.5vw, 50px)",
                      color: "#c4b5fd",
                      transitionTimingFunction: "var(--ease-out)",
                    }}
                    aria-label={t("dialer.groupCall")}
                    title={nonexistent ? t("dialer.notOnRelay") : t("dialer.groupCallHint")}
                  >
                    <Users className="size-5" strokeWidth={2.2} />
                  </button>
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">{t("dialer.groupCall")}</span>
                </div>
              </div>
            </div>

            {/* THE QUICK-ADD BUTTON USED TO BE A ROW OF ITS OWN HERE (v2.99.8,
                moved to its own row in v2.99.36 after it was clipped). The owner
                asked for it beside the digits instead — *"in place of showing
                below, show on the right after the numbers you enter it"* — so it
                now renders inside the readout above, and this row is gone rather
                than left as an empty flex child.
                That also removes a real cost: the row was `shrink-0` in a
                no-scroll flex column, so it consumed height on every phone the
                moment six digits were entered, on a card whose budget the keypad
                subtracts from by a hardcoded constant. */}
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
  const t = useT();
  const utils = trpc.useUtils();
  const upsert = trpc.contacts.upsert.useMutation({
    onSuccess: () => {
      utils.contacts.list.invalidate();
      toast.success(t("dialer.savedToContacts"));
    },
    onError: (e) => toast.error((e as { message?: string })?.message ?? t("dialer.saveFailed")),
  });
  const existing = trpc.contacts.list.useQuery();
  const isAlready = (existing.data ?? []).some((c) => c.number === number);
  /* ALREADY SAVED → NOTHING AT ALL (v2.99.90, owner: "If the number is already on
     contact, you don't need to show this message"). The confirmation chip that used
     to sit here answered a question nobody asked: there was no action to take, and
     the row it occupied is directly under three call buttons on a card that has no
     spare vertical space. */
  if (isAlready) return null;
  /* NOT SAVED → ONE GLOSSY ICON, WITH THE WORDS UNDER IT (owner, after the move:
     *"put the bottom, appear the bottom, and below it right at to contact if this
     number is not in your contact"* — i.e. write "Add to contacts" beneath it).
     THIS DELIBERATELY REVERSES v2.99.90's icon-only instruction, which is recorded
     rather than glossed: that release removed the text at the owner's request when
     the control sat in its own row below the pad, where a label was one more line
     on a card with no spare height. The control has since MOVED beside the digits
     and is absolutely positioned, so the label costs the layout nothing it did not
     already spend — and the icon alone carried its meaning only in `title`, which a
     phone never shows. A later instruction wins over an earlier one.
     THE LABEL HANGS FROM `top-full` RATHER THAN JOINING A FLEX COLUMN: stacking
     both in one centred column would shift the ICON up by half the label's height,
     visibly breaking its alignment with the digits it sits beside — the icon must
     stay exactly where it is, and only the words are new.
     (owner, earlier: "just show an icon added to contact but a
     different color, make it nice color … glossy, glossy, and flashy").
     Pink→fuchsia because every other colour on this screen already means something:
     green is Voice, sky is Video, violet is Group Call, red is erase, amber is Do
     Not Disturb. A fourth reuse would make the colour stop carrying information.
     The halo is a STATIC box-shadow on a stacked overlay with only its OPACITY
     animated — animating the button's own box-shadow repaints it every frame, the
     class of animation v2.99.84 measured and removed. */
  return (
    <span className="relative inline-grid place-items-center">
    <button
      type="button"
      onClick={() => upsert.mutate({ number, displayName: displayName === number ? undefined : displayName })}
      disabled={upsert.isPending}
      aria-label={t("dialer.addNumberToContacts", { number })}
      title={t("dialer.addToContacts")}
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
      {/* THE WORDS, HANGING BELOW THE ICON. `absolute top-full` keeps the icon
          exactly where it was so its alignment with the digits is untouched, and
          `whitespace-nowrap` lets the label be wider than the 48px button without
          ever widening the grid cell it sits in. It is aria-hidden because the
          button's own aria-label already names the action — a screen reader must
          not hear it twice.

          IT IS ANCHORED BY ITS END EDGE, NOT CENTRED, AND THAT REVERSES v2.106.79
          ON A MEASUREMENT RATHER THAN A PREFERENCE. That release centred it
          physically (`left-1/2 -translate-x-1/2`) so the centring would not mirror
          in RTL, and said plainly that nobody had measured it. Measured now, at
          320px the centred label's right edge lands 6.6px PAST the card and the
          whole page scrolls sideways — the button already sits near the right
          edge, so a label wider than the button has nowhere to be but off-screen.
          `end-0` pins the label's trailing edge to the button's own, which cannot
          overflow by construction at any width, and being LOGICAL it mirrors in
          Arabic instead of needing an exemption from the RTL sweep. */}
      <span
        aria-hidden="true"
        className="
          absolute top-full end-0 mt-1
          whitespace-nowrap leading-none text-[9.5px] font-medium tracking-wide
          text-muted-foreground pointer-events-none
        "
      >
        {/* THE SAME KEY THE `title` ABOVE ALREADY USED. This label shipped as a bare
            English literal while `dialer.addToContacts` — Arabic half and all — sat
            one line up on the very same element: the release that added the visible
            words added them in English with the translation already in hand. */}
        {t("dialer.addToContacts")}
      </span>
    </span>
  );
}
