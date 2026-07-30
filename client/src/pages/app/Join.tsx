import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { PhoneCall, Users, Video, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useIdentity } from "@/app/useIdentity";
import { useRelayEngine } from "@/app/RelayEngine";
import { InviteCard, type InvitePartyLine, type InvitePerson } from "@/app/InviteCard";
import { parseDialToParam, voiceFromDialParams } from "./Dialer";

/**
 * #109 — where a shared `/i/<pin>` link lands a SIGNED-IN visitor.
 *
 * THE ASK AND THE ONE DELIBERATE DEVIATION, stated up front. The owner asked for
 * "clicking the link joins the call automatically instead of landing on the dial
 * pad". The pain is real and this screen removes it: an invite no longer dumps you
 * on a keypad with six digits prefilled and no idea whose they are — it names the
 * line or the person, shows the creator, shows who is already inside, and offers
 * one button that connects.
 *
 * What it does NOT do is dial with no gesture at all, and the reason is a HIGH
 * finding this repo has closed twice. Microphone permission is granted per ORIGIN
 * and persists, so a link that dials on arrival hands a live microphone — plus the
 * camera, with `?video=1` — to a number the LINK'S AUTHOR chose, off a single
 * click, with the attacker's side free to auto-answer. That is M48, and M60 found
 * it still open through this exact `/i/<pin>` path because the redirect read as an
 * in-app tap. So the Join button IS the consent: one tap, on a screen that has
 * already told you what you are joining. `bootUrl.ts` carries the full history.
 *
 * The dial pad's own arrival branch (`Dialer.tsx`) is left exactly as it was —
 * belt and braces for anybody who pastes the long `/app/dialer?to=` form.
 */
export default function JoinPage() {
  const { me } = useIdentity();
  const engine = useRelayEngine();
  const [, setLocation] = useLocation();
  const { phase, ready: engineReady, pin: enginePin } = engine;

  // The target is read ONCE at mount with the same parser the Dialer uses, so the
  // two can never disagree about what the URL says.
  const [target] = useState<string | null>(() =>
    parseDialToParam(typeof window !== "undefined" ? window.location.search : ""),
  );
  const [wantsVideo] = useState<boolean>(() =>
    typeof window !== "undefined" ? !voiceFromDialParams(window.location.search) : false,
  );

  const enabled = !!target && !!me;
  const person = trpc.directory.lookup.useQuery(
    { number: target ?? "" },
    { enabled, retry: false, staleTime: 15_000 },
  );
  const card = trpc.directory.inviteCard.useQuery(
    { number: target ?? "" },
    {
      enabled,
      retry: false,
      // The roster moves while somebody reads the screen, so keep it current —
      // but only while this screen is mounted, which is what makes that cheap.
      refetchInterval: 8_000,
    },
  );

  const line: InvitePartyLine | null = useMemo(() => {
    const d = card.data;
    return d ? ({ ...d } as InvitePartyLine) : null;
  }, [card.data]);

  const p = person.data;
  const invitePerson: InvitePerson | null = useMemo(
    () =>
      p && !p.partyLine
        ? {
            displayName: p.displayName,
            avatarUrl: p.avatarUrl,
            role: p.role ?? null,
            isOnline: p.isOnline,
            inCall: p.inCall,
          }
        : null,
    [p],
  );

  // FAIL OPEN on a lookup error (a shared-NAT rate limit, a transient 500): the
  // number is then NOT reported as missing and the button stays live, because the
  // dial itself re-resolves and will give the real reason. v2.99.25 shipped this
  // exact fix for the landing page, where a thrown lookup was rendering "no RELAY
  // user" over a perfectly reachable person.
  const personResolved = person.isFetched && !person.isError;
  const isLine = !!line;
  const notFound = personResolved && !isLine && !p;
  /* REACHABILITY, NOT PRESENCE. Same change and same reason as the guest half of this
     card in `OnboardingGate.tsx` — one card, two screens (v2.105.25), so a fix applied
     to one and not the other is exactly how they come to disagree about the same call.
     Presence is bound to a live socket, so a backgrounded or locked phone reads offline
     while being the very thing a VoIP push wakes. `?? true` keeps the fail-open rule for
     a server that predates the field. */
  const unreachable = personResolved && !isLine && !!p && !(p.reachable ?? true);
  const blocked = notFound || unreachable;

  // A dial is one tap and one tap only: the guard is a ref, so a double-tap or a
  // re-render cannot place two calls.
  const dialedRef = useRef(false);
  function join(video: boolean) {
    if (!target || dialedRef.current || blocked || !engineReady || !enginePin) return;
    if (target === enginePin) return; // your own number
    dialedRef.current = true;
    const ok = engine.dial(target, { voice: !video });
    if (!ok) {
      dialedRef.current = false;
      return;
    }
    // Drop the target from the address bar so a reload, Back, or the 30s
    // auto-updater's forced refresh cannot silently re-dial.
    try {
      window.history.replaceState(null, "", "/app/join");
    } catch {
      /* history unavailable — the ref already stops a second dial */
    }
  }

  // Once a call is up the engine owns the screen; leaving this route behind would
  // strand the visitor on a dead invite card after they hang up.
  useEffect(() => {
    if (phase !== "idle") return;
    if (dialedRef.current) setLocation("/app/dialer");
  }, [phase, setLocation]);

  // No target in the URL: this route only exists to serve an invite.
  if (!target) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">This invite link is incomplete.</p>
        <Button variant="outline" onClick={() => setLocation("/app/dialer")} className="gap-2">
          <ArrowLeft className="size-4" /> Go to the dialer
        </Button>
      </div>
    );
  }

  const own = target === (enginePin || me?.number);

  return (
    <div className="flex flex-1 flex-col items-center px-4 py-6">
      <div className="w-full max-w-[420px]">
        <InviteCard
          number={target}
          line={line}
          person={invitePerson}
          personResolved={personResolved}
        >
          {own ? (
            <p className="text-center text-sm text-muted-foreground">
              That's your own number — share the link with somebody else.
            </p>
          ) : (
            <>
              <Button
                onClick={() => join(wantsVideo)}
                disabled={blocked || !engineReady || phase !== "idle"}
                className="h-12 w-full gap-2 rounded-xl text-base font-semibold text-primary-foreground bg-[color:var(--relay-online,theme(colors.primary.DEFAULT))] active:scale-[0.99] transition-transform"
              >
                {notFound ? (
                  "Number not found"
                ) : unreachable ? (
                  <>
                    <PhoneCall className="size-4" /> Can't be reached
                  </>
                ) : !engineReady ? (
                  "Connecting…"
                ) : (
                  <>
                    {isLine ? (
                      <Users className="size-4" />
                    ) : wantsVideo ? (
                      <Video className="size-4" />
                    ) : (
                      <PhoneCall className="size-4" />
                    )}
                    {isLine ? "Join the line" : wantsVideo ? "Join with video" : "Join call"}
                  </>
                )}
              </Button>
              {/* A person can also be reached with video, which the invite link
                  itself never asks for (a bare /i/<pin> is voice-first by the
                  v2.81 protocol — a shared link must not turn a camera on). */}
              {!isLine && !blocked && !wantsVideo && (
                <Button
                  variant="outline"
                  onClick={() => join(true)}
                  disabled={!engineReady || phase !== "idle"}
                  className="mt-2 h-11 w-full gap-2 rounded-xl"
                >
                  <Video className="size-4" /> Join with video instead
                </Button>
              )}
              {/* Not "offline" any more: an offline-but-installed phone rings now, so
                  what is left in this branch is somebody with no device at all — and
                  "once they're back online" would promise something nothing can keep. */}
              {unreachable && (
                <p className="mt-2.5 text-center text-xs text-muted-foreground">
                  There's no device we can ring for {invitePerson?.displayName || "them"} yet.
                  Once they open RELAY on a phone, calls will reach them.
                </p>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => setLocation("/app/dialer")}
            className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            Not now — open the dialer
          </button>
        </InviteCard>
      </div>
    </div>
  );
}
