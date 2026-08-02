import { useEffect, useRef, useState, type FormEvent } from "react";
import { Phone, Video, MessageSquare, ArrowRight, User2, PhoneCall, Users, Lock } from "lucide-react";
import { InviteCard, type InvitePartyLine, type InvitePerson } from "./InviteCard";
import { GroupAvatar } from "./GroupAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { useIdentity } from "./useIdentity";
import { AuthPanel } from "./AuthPanel";
import { GuestRestore } from "./GuestRestore";
import { LiveStats } from "./LiveStats";
import { PinReveal } from "./PinReveal";
import { LoginScreen } from "./LoginScreen";
import { useLocale } from "./i18n";

interface OnboardingGateProps {
  children: React.ReactNode;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A shared call/invite link (`/i/<pin>` → `/app/dialer?to=<pin>`) carries the
 * number to dial in the URL. Pull it out so a not-yet-identified clicker can be
 * shown a FOCUSED "join this call" screen instead of the generic login. Returns
 * the 6-digit target or null. Pure + exported for tests.
 */
export function inviteTargetFromSearch(search: string): string | null {
  try {
    const to = (new URLSearchParams(search || "").get("to") || "").replace(/\D+/g, "").slice(0, 6);
    return /^\d{6}$/.test(to) ? to : null;
  } catch {
    return null;
  }
}

/**
 * A GROUP invite link is `/g/<token>` — a signed capability, not a number. Pull the
 * token out of the PATH so an identity-less visitor gets the group-invite landing
 * (board 4h) instead of the generic sign-in screen. Returns the raw token or null.
 * Pure + exported for tests.
 *
 * IT DECIDES WHICH SCREEN TO DRAW AND NOTHING ELSE. The token is never parsed,
 * trusted or acted on here — the server verifies its signature, its epoch and its
 * audience on both the preview and the join. The 256 cap mirrors the server's own
 * input bound purely so a pathological URL cannot be rendered; it is not a gate,
 * and a token this refuses simply falls through to the ordinary sign-in screen.
 */
export function groupInviteTokenFromPath(pathname: string): string | null {
  try {
    const m = /^\/g\/([^/?#]+)\/?$/.exec(pathname || "");
    if (!m) return null;
    // A token can arrive percent-encoded; a malformed escape throws and is caught.
    const raw = decodeURIComponent(m[1]);
    return raw.length > 0 && raw.length <= 256 ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Entry / login screen. Shows the app once an identity exists; otherwise a
 * fast, glassy screen whose PRIMARY path is GUEST entry: type a display name →
 * straight in (a SESSION-only guest — wiped when the browser closes). Registered sign-in
 * (passwordless email code — login and registration are the same flow, so
 * there's no password to forget) is the secondary path behind a "Login /
 * Register" button. No third-party sign-in. Forced dark for a consistent
 * striking look; the animated backdrop is pure CSS, reduced-motion gated.
 *
 * CALL-LINK DIRECT-JOIN (owner: "paramount"): when the URL carries a call
 * target (a shared `/i/<pin>` invite → `/app/dialer?to=<pin>`) and the visitor
 * has NO identity, the gate does NOT show the marketing/login clutter — it
 * shows a single "you're calling <name> · enter your name to connect" card so
 * the clicker types one field and lands straight in the dial (the Dialer's
 * existing `?to=` auto-dial handles the rest). Registered users / active guests
 * skip this entirely (identity present ⇒ children render ⇒ auto-dial).
 */
export function OnboardingGate({ children }: OnboardingGateProps) {
  const { me, loading, startGuest, startGuestPending, startGuestError, refresh } = useIdentity();
  const { t, locale, setLocale } = useLocale();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailMode, setEmailMode] = useState(false); // guest-first: email is the secondary path
  const [authEmail, setAuthEmail] = useState<string | null>(null);

  // A call/invite link puts the callee's number in the URL. Resolve it (public
  // query, no identity needed) so the join card can name who you're calling.
  const [callTarget] = useState<string | null>(() =>
    inviteTargetFromSearch(typeof window !== "undefined" ? window.location.search : "")
  );
  /* A GROUP invite link (`/g/<token>`, v2.105.9). Read from the PATH, so it cannot be
     confused with the `?to=` call target above — one screen guessing which of two
     unrelated things a URL meant would be guessing on a string somebody else chose. */
  const [groupToken] = useState<string | null>(() =>
    groupInviteTokenFromPath(typeof window !== "undefined" ? window.location.pathname : "")
  );
  const invite = trpc.directory.lookup.useQuery(
    { number: callTarget ?? "" },
    { enabled: !!callTarget && !me && !loading, retry: false, staleTime: 60_000 }
  );
  // #109 — the party-line half of the card (title, creator, who's on it, created
  // date). Same public endpoint the signed-in join screen reads, so the two
  // screens describe one line identically. Null for an ordinary number.
  const inviteLine = trpc.directory.inviteCard.useQuery(
    { number: callTarget ?? "" },
    { enabled: !!callTarget && !me && !loading, retry: false, refetchInterval: 10_000 }
  );

  /* THE PIN REVEAL (#162). Owner: *"there is a login area (as a guest or member). Once
     you pass this, before you go to the dashboard screen, there is a PIN number page."*
     — so it must fire for BOTH kinds of entry, and for the call-link join card too.

     IT IS ARMED BY THE SIGNED-OUT → SIGNED-IN TRANSITION, not by a callback from each
     entry surface, and that is the load-bearing decision: there are three ways in today
     (guest name, email sign-in, the `/i/<pin>` join card) across two components, and a
     fourth added later would have to remember to call it. The transition is one funnel
     every one of them passes through by construction.

     IT CANNOT FIRE ON AN ORDINARY RELOAD, which is the thing that would make it
     maddening: `loading` is react-query's `isLoading`, true only on a FIRST fetch with
     no data, so a reload of the dashboard goes loading → identity and never passes
     through the `!loading && !me` state this arms on. Reaching that state means the
     login screen was actually rendered. */
  const sawSignedOut = useRef(false);
  const [revealing, setRevealing] = useState(false);

  useEffect(() => {
    if (!loading && !me) {
      sawSignedOut.current = true;
      return;
    }
    if (me && sawSignedOut.current) {
      sawSignedOut.current = false;
      /* A CALL-LINK JOIN IS DELIBERATELY EXEMPT. The owner's rule for that path is
         older and narrower — *"land directly in the call"* (v2.94.5) — and it is
         still right: somebody who tapped a link to reach a person is not on their way
         to the dashboard, so a screen between them and the ring would be in the way. */
      if (!callTarget) setRevealing(true);
    }
  }, [loading, me, callTarget]);

  if (loading) {
    return (
      <div className="dark min-h-svh grid place-items-center bg-[#08090C] text-foreground">
        <div className="size-9 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
      </div>
    );
  }

  /* Checked BEFORE the identity gate, so it outlasts the moment `me` flips truthy and
     the dashboard never flashes underneath it. A number we cannot show falls STRAIGHT
     through to the app rather than holding anybody on a screen with nothing on it —
     this sits between a person and their inbox and must never be why they cannot get in. */
  if (revealing && me?.number) {
    return <PinReveal pin={me.number} onDone={() => setRevealing(false)} />;
  }

  if (me) return <>{children}</>;

  async function onGuestSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    /* The reveal is NOT armed here. `startGuest` mints the identity and invalidates
       whoami, so the signed-out → signed-in effect above arms it from the one funnel
       every entry path shares — and a failure needs no undoing, because a failed
       startGuest never produces an identity for that transition to fire on. */
    await startGuest(trimmed).catch(() => {
      // Surfaces via startGuestError; the form stays up.
    });
  }

  function onEmailSubmit(e: FormEvent) {
    e.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) return;
    setAuthEmail(clean); // opens the passwordless panel, prefilled + auto-send
  }

  // ── Call-link direct-join: a focused "enter your name to connect" card. ──
  // Shown when a call target is in the URL and we're not in the email path.
  const showJoin = !!callTarget && !emailMode;
  /* Board 4h. Deliberately NOT folded into `showJoin`: that card dials a person and
     this one joins a conversation, and they are told apart by which part of the URL
     carried them (`?to=` vs the `/g/` path) rather than by a shared flag. */
  const showGroupJoin = !!groupToken && !callTarget && !emailMode;
  const invitee = invite.data;
  const line = (inviteLine.data ?? null) as InvitePartyLine | null;
  const isPartyLine = !!invitee?.partyLine;
  const inviteeName = invitee?.displayName?.trim() || "";
  const invitePerson: InvitePerson | null =
    invitee && !invitee.partyLine
      ? {
          displayName: invitee.displayName,
          avatarUrl: invitee.avatarUrl,
          role: invitee.role ?? null,
          isOnline: invitee.isOnline,
          inCall: invitee.inCall,
        }
      : null;
  // v2.99.15, AS AMENDED: a guest may only call a callee we can actually REACH from
  // a call link. The original rule said ONLINE, and its reason was sound at the time —
  // a guest has no persistent thread to leave a message on (unlike a signed-in
  // caller's post-dial voicemail card), so ringing into the void would strand them.
  // What changed is that "offline" stopped meaning "cannot be rung": v2.105.12
  // restored the VoIP push path, so a locked or backgrounded phone rings. The guard
  // therefore moved to REACHABILITY and now fires only for somebody with no device at
  // all. Party lines are always joinable (they never ring anyone). We wait for the
  // lookup to resolve and FAIL OPEN on a lookup error (isError ⇒ not "resolved"), so a
  // transient hiccup never strands a legitimate caller.
  const inviteResolved = invite.isFetched && !invite.isError;
  const numberNotFound = inviteResolved && !isPartyLine && !invitee;
  /* GATED ON REACHABILITY, NOT ON PRESENCE — and that distinction is the whole fix.
     Presence is bound to a live socket session, so backgrounding the app or locking
     the phone drops it; a backgrounded phone is exactly what a VoIP push wakes, and
     that is verified in production (APNs 200, full-screen CallKit while the app was
     not in the foreground). Keying the gate on `isOnline` therefore refused calls to
     most of the user base most of the time, for a limitation that no longer exists.

     `reachable` is `a live socket OR a device we can push a ring to`. The comment
     above still holds for the case it was written for — a guest genuinely has no
     thread to leave a message on — so the block SURVIVES for somebody with nothing
     to ring, which is the one honest guard here: a call that can wake nothing must
     not be offered. It just no longer fires for the far larger group whose phone is
     merely asleep.

     `?? true` keeps the fail-open rule: a server that predates this field emits no
     `reachable`, and the old behaviour for such a client was to offer the call and
     let the dial report the truth. Refusing on a missing field would turn a rolling
     deploy into a calling outage. */
  const calleeUnreachable =
    inviteResolved && !isPartyLine && !!invitee && !(invitee.reachable ?? true);
  const joinBlocked = numberNotFound || calleeUnreachable;

  /* The redesigned entry page (RELAY_LOGIN_HANDOFF.md) owns the ORDINARY login.
     The `/i/<pin>` call-link join screen below is deliberately untouched: the
     spec does not cover it, and it has been one focused field since v2.94.5
     precisely so a shared link connects in a single tap — a second decision
     there costs the caller the call.

     A GROUP INVITE (`/g/<token>`, board 4h) is the second exception, for the same
     reason: somebody who tapped an invite has already chosen where they are going,
     and answering that with the generic sign-in screen loses the one thing they
     were told — that there is a group at the end of it. */
  if (!showJoin && !showGroupJoin) return <LoginScreen />;

  return (
    <div className="dark relay-login relative min-h-svh overflow-hidden grid place-items-center bg-[#08090C] text-foreground p-5">
      {/* Lightweight animated backdrop (CSS only, reduced-motion gated) */}
      <div aria-hidden className="login-fx pointer-events-none absolute inset-0" />
      <div aria-hidden className="login-grid pointer-events-none absolute inset-0" />

      {/* THE LANGUAGE SWITCH HAS TO BE ON THIS SCREEN, and that is the one thing
          about it that is load-bearing rather than convenient: the Appearance pane
          lives in Profile, which is BEHIND this gate, so somebody who lands here in
          a language they cannot read would have no way through. It is deliberately
          `absolute` chrome rather than a row in the card — this screen's whole
          shape is "one field, one action", and a second decision in the card is
          what costs somebody the call on the `/i/<pin>` path.

          Each language is labelled in ITS OWN language, never translated: "العربية"
          is exactly what a stranded Arabic reader is looking for, and "Arabic"
          written in English is the label that fails them. */}
      <div className="absolute end-4 top-4 z-10 flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1 backdrop-blur-md">
        {(["en", "ar"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLocale(l)}
            aria-pressed={locale === l}
            className={`min-h-8 rounded-full px-3 text-xs font-semibold transition-colors ${
              locale === l
                ? "bg-white/15 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {l === "en" ? "English" : "العربية"}
          </button>
        ))}
      </div>

      <div className="login-card relative w-full max-w-[400px]">
        {showJoin ? (
          <>
            {/* ── CALL-LINK JOIN (#109) ──
                The card itself is the SHARED `InviteCard`, so this screen and the
                signed-in `/app/join` screen describe one line or one person in
                exactly the same words. Only the action below it differs: here a
                visitor with no identity needs a name first. */}
            <InviteCard
              number={callTarget!}
              line={line}
              person={invitePerson}
              personResolved={inviteResolved}
            >
              {/* One field: your name, then join. */}
              <form onSubmit={onGuestSubmit}>
                <label
                  htmlFor="relay-join-name"
                  className="mb-2 block text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground"
                >
                  {t("gate.joinNameLabel")}
                </label>
                <Input
                  id="relay-join-name"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("gate.yourName")}
                  maxLength={64}
                  className="h-12 rounded-xl text-base"
                />
                {startGuestError && (
                  <p className="mt-2.5 text-sm text-destructive">{startGuestError.message}</p>
                )}
                <Button
                  type="submit"
                  disabled={!name.trim() || startGuestPending || joinBlocked}
                  className="mt-4 h-12 w-full gap-2 rounded-xl text-base font-semibold text-primary-foreground bg-[color:var(--relay-online,theme(colors.primary.DEFAULT))] shadow-[0_10px_28px_-10px_color-mix(in_oklab,var(--relay-online,#06d6a0)_70%,transparent)] active:scale-[0.99] transition-transform"
                >
                  {startGuestPending ? (
                    t("gate.connecting")
                  ) : numberNotFound ? (
                    t("gate.numberNotFound")
                  ) : calleeUnreachable ? (
                    <>
                      <PhoneCall className="size-4" />
                      {t("gate.cannotReach")}
                    </>
                  ) : (
                    <>
                      {isPartyLine ? <Users className="size-4" /> : <PhoneCall className="size-4" />}
                      {isPartyLine ? t("gate.joinLine") : t("gate.joinCall")}
                    </>
                  )}
                </Button>
                {/* The copy no longer says "offline", because that is not what this
                    state means any more and saying it would be wrong twice over: an
                    offline-but-installed phone IS callable now, and what is left here
                    is somebody with no device to ring at all — for whom "once they're
                    back online" would be a promise nothing can keep. */}
                {calleeUnreachable && (
                  <p className="mt-2.5 text-center text-xs text-muted-foreground">
                    {t("gate.noDeviceToRing", { name: inviteeName || t("gate.them") })}
                  </p>
                )}
              </form>

              <button
                type="button"
                onClick={() => setEmailMode(true)}
                className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground"
              >
                {t("gate.haveAccount")}
              </button>
            </InviteCard>
            <p className="mx-auto mt-4 max-w-[19rem] text-center text-[0.72rem] leading-relaxed text-muted-foreground/80">
              {t("gate.joinFoot")}
            </p>
          </>
        ) : showGroupJoin ? (
          /* ── GROUP-INVITE LANDING (board 4h) ──────────────────────────────────
             What an identity-less visitor sees on `/g/<token>`. Before this they
             got the ORDINARY sign-in screen with nothing saying they had been
             invited to a group at all — they typed a name for reasons the screen
             never gave them, and the group appeared afterwards.

             JOINING STILL TAKES A REAL TAP, twice over: this card only mints an
             identity, and `GroupInvite` then previews the group and asks again.
             Nothing here joins on arrival — v2.99.57/M48 closed exactly that for
             `?to=`, where landing on a URL placed a call.

             WHAT THIS CARD DELIBERATELY DOES NOT SAY. The frame draws the group's
             name, photo and member row here, and none of the three can be shown to
             a caller with no identity: `groupInvitePreview` opens with
             `requireIdentity(ctx)`, and that is a deliberate decision (v2.105.9)
             — telling an anonymous caller which groups exist would widen a
             signed-capability read to everybody who can guess a URL. So the card
             says what is TRUE at this point and the group identifies itself one
             screen later, which is what the frame's own display-name note
             describes. Inventing a name to fill the space would be the class of
             confident-but-wrong claim this codebase keeps removing. */
          <div className="rglass rounded-[22px] px-5 py-6 text-center">
            <div className="flex flex-col items-center">
              {/* The frame's 74px puck. `GroupAvatar` rather than a fourth private
                  copy of the group-photo fallback — with no url it renders the
                  glyph, which is exactly this state. */}
              <GroupAvatar url={null} name={null} size={74} className="rounded-[26px]" />

              <p className="mt-3.5 font-mono text-[9px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                You are invited to join
              </p>
              <h1 className="mt-1.5 text-[23px] font-bold leading-tight">a group on RELAY</h1>
              <p className="mt-2 max-w-[17rem] text-xs leading-relaxed text-muted-foreground">
                You'll see which group, who is in it and how many members on the next
                screen — joining is still your tap.
              </p>

              {/* THE FRAME'S "END-TO-END ENCRYPTED GROUP" CHIP IS DECLINED, and the
                  wording below is the one this app can keep. `messages.body` is
                  `text` in `drizzle/schema.ts` and `server/v2db.ts` searches it with
                  `like(messages.body, …)` — a substring match only possible on
                  plaintext the server reads, so there is no end-to-end encryption
                  here to claim. v2.106.40 declined the identical chip on board 1d
                  and this reuses the key it established, so the two screens cannot
                  drift into promising different things. */}
              <span className="mt-3 inline-flex items-center gap-1.5 font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <Lock className="size-2.5 shrink-0" aria-hidden />
                {t("msg.encryptedInTransit")}
              </span>
            </div>

            <form onSubmit={onGuestSubmit} className="mt-5 text-start">
              <label
                htmlFor="relay-group-name"
                className="mb-2 block text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground"
              >
                {t("gate.joinNameLabel")}
              </label>
              <Input
                id="relay-group-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("gate.yourName")}
                maxLength={64}
                className="h-12 rounded-xl text-base"
              />
              {startGuestError && (
                <p className="mt-2.5 text-sm text-destructive">{startGuestError.message}</p>
              )}
              {/* `.rcta` is the board's own CTA recipe — solid accent with the
                  `#04211a` on-accent text that stays legible across all twelve
                  hues. Never `var(--rb)` as TEXT, which measures ~1.7:1. */}
              <Button
                type="submit"
                disabled={!name.trim() || startGuestPending}
                className="rcta mt-4 h-12 w-full gap-2 rounded-xl text-base font-semibold disabled:opacity-60"
              >
                {startGuestPending ? (
                  t("gate.settingUp")
                ) : (
                  <>
                    <Users className="size-4" aria-hidden />
                    Continue to the group
                  </>
                )}
              </Button>
            </form>

            {/* The frame's own note, and it is the one line on that frame written
                for THIS visitor rather than for the screen after it. */}
            <p className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground/80">
              Joining needs an identity — you'll pick a display name first, exactly
              like the rest of RELAY.
            </p>

            {/* THE REGISTERED DOOR, AND IT IS THE ACTIONABLE HALF OF THE FRAME'S
                REFUSED BAND. A link can be restricted to registered accounts
                (v2.105.23), and a guest who meets one is refused — so offering the
                account door HERE is the only point at which that dead end can be
                avoided rather than merely explained, because after this tap a guest
                identity already exists. It never claims THIS link is restricted:
                the audience is decided by the server from the token's signature,
                and guessing it client-side would be a confident wrong answer. */}
            <button
              type="button"
              onClick={() => setEmailMode(true)}
              className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              {t("gate.haveAccount")}
            </button>
          </div>
        ) : (
          <>
            {/* ── RESTORE A PREVIOUS NUMBER (v2.99.68) ──
                Renders itself only when this browser holds a recovery record AND
                the server confirms the key still names an unclaimed identity, so a
                first-time visitor never sees it. Above the sign-in card because for
                a returning guest this IS the primary action — typing a name would
                mint a second identity and leave the first one stranded, which is
                the loss this exists to prevent.
                Deliberately NOT on the call-link join screen: that path is a single
                focused field by design, and a second decision there costs the
                caller the call. */}
            {!emailMode && (
              <GuestRestore className="mb-5" onRestored={refresh} />
            )}

            {/* Brand */}
            <div className="mb-7 text-center">
              <div className="inline-flex items-center gap-2.5">
                <span className="login-dot inline-block size-3 rounded-full" />
                <span className="text-[1.6rem] font-bold tracking-tight">RELAY</span>
              </div>
              <p className="mx-auto mt-2.5 max-w-[19rem] text-sm leading-relaxed text-muted-foreground">
                {emailMode ? t("gate.taglineEmail") : t("gate.tagline")}
              </p>
            </div>

            {/* Card */}
            <div className="rounded-3xl border border-border/60 bg-card/60 p-6 shadow-2xl shadow-black/40 backdrop-blur-2xl backdrop-saturate-150">
              {!emailMode ? (
                <>
                  {/* PRIMARY: guest entry */}
                  <form onSubmit={onGuestSubmit}>
                    <label
                      htmlFor="relay-name"
                      className="mb-2 block text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground"
                    >
                      {t("gate.displayName")}
                    </label>
                    <Input
                      id="relay-name"
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t("gate.namePlaceholder")}
                      maxLength={64}
                      className="h-12 rounded-xl text-base"
                    />
                    {startGuestError && (
                      <p className="mt-2.5 text-sm text-destructive">{startGuestError.message}</p>
                    )}
                    <Button
                      type="submit"
                      disabled={!name.trim() || startGuestPending}
                      className="mt-4 h-12 w-full gap-2 rounded-xl text-base font-semibold text-primary-foreground bg-[color:var(--relay-online,theme(colors.primary.DEFAULT))] shadow-[0_10px_28px_-10px_color-mix(in_oklab,var(--relay-online,#06d6a0)_70%,transparent)] active:scale-[0.99] transition-transform"
                    >
                      {startGuestPending ? t("gate.settingUp") : (<><User2 className="size-4" /> {t("gate.enterAsGuest")}</>)}
                    </Button>
                  </form>

                  <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground/70">
                    <span className="h-px flex-1 bg-border/60" /> {t("gate.or")}{" "}
                    <span className="h-px flex-1 bg-border/60" />
                  </div>

                  {/* SECONDARY: registered account (passwordless email code) */}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEmailMode(true)}
                    className="h-12 w-full gap-2 rounded-xl border-border/60 text-base"
                  >
                    {t("gate.loginRegister")} <ArrowRight className="size-4" />
                  </Button>
                  <p className="mt-3 text-center text-[0.72rem] leading-relaxed text-muted-foreground/80">
                    {t("gate.guestFoot")}
                  </p>
                </>
              ) : (
                <>
                  {/* Registered sign-in / registration — passwordless email code */}
                  <form onSubmit={onEmailSubmit}>
                    <label
                      htmlFor="relay-email"
                      className="mb-2 block text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground"
                    >
                      {t("gate.yourEmail")}
                    </label>
                    <Input
                      id="relay-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoFocus
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="h-12 rounded-xl text-base"
                    />
                    <Button
                      type="submit"
                      disabled={!EMAIL_RE.test(email.trim().toLowerCase())}
                      className="mt-4 h-12 w-full gap-2 rounded-xl text-base font-semibold text-primary-foreground bg-[color:var(--relay-online,theme(colors.primary.DEFAULT))] shadow-[0_10px_28px_-10px_color-mix(in_oklab,var(--relay-online,#06d6a0)_70%,transparent)] active:scale-[0.99] transition-transform"
                    >
                      {t("gate.continueWithEmail")} <ArrowRight className="size-4" />
                    </Button>
                  </form>
                  <p className="mt-3 text-center text-[0.72rem] leading-relaxed text-muted-foreground/80">
                    {t("gate.emailFoot")}
                  </p>
                  <button
                    type="button"
                    onClick={() => setEmailMode(false)}
                    className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground"
                  >
                    {callTarget ? t("gate.backToCall") : t("gate.backToGuest")}
                  </button>
                </>
              )}
            </div>

            {/* Live counters — below the sign-in card, above the Voice/Video/Chat
                chips, exactly where the owner asked for them. Same public
                aggregate endpoint the landing page reads, polled so the figures
                move while the screen is open. */}
            <LiveStats className="mt-6" />

            {/* Feature chips */}
            <div className="mt-5 flex items-center justify-center gap-2">
              {[
                { icon: Phone, key: "gate.voice" as const },
                { icon: Video, key: "gate.video" as const },
                { icon: MessageSquare, key: "gate.chat" as const },
              ].map(({ icon: Icon, key }) => (
                <span
                  key={key}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-card/50 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-md"
                >
                  <Icon className="size-3.5" /> {t(key)}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {authEmail !== null && (
        <AuthPanel
          initialEmail={authEmail}
          onClose={() => setAuthEmail(null)}
          onVerified={() => {
            // Session cookie is set; re-resolve whoami so the gate lets us in.
            setAuthEmail(null);
            refresh();
          }}
        />
      )}

      <style>{`
        .relay-login { --c1: 63,224,197; --c2: 110,231,255; }
        .relay-login .login-dot {
          background: linear-gradient(135deg, #3FE0C5, #6EE7FF);
          box-shadow: 0 0 16px rgba(63,224,197,.7);
        }
        .relay-login .login-grid {
          background-image:
            linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px);
          background-size: 44px 44px;
          -webkit-mask-image: radial-gradient(circle at 50% 42%, black, transparent 72%);
          mask-image: radial-gradient(circle at 50% 42%, black, transparent 72%);
        }
        .relay-login .login-fx::before, .relay-login .login-fx::after {
          content: ""; position: absolute; border-radius: 9999px; filter: blur(60px); opacity: .5;
        }
        .relay-login .login-fx::before {
          width: 46vmax; height: 46vmax; left: -10vmax; top: -14vmax;
          background: radial-gradient(circle, rgba(var(--c1),.20), transparent 60%);
        }
        .relay-login .login-fx::after {
          width: 40vmax; height: 40vmax; right: -12vmax; bottom: -14vmax;
          background: radial-gradient(circle, rgba(var(--c2),.16), transparent 60%);
        }
        @media (prefers-reduced-motion: no-preference) {
          .relay-login .login-fx::before { animation: loginDrift1 14s ease-in-out infinite alternate; }
          .relay-login .login-fx::after  { animation: loginDrift2 18s ease-in-out infinite alternate; }
          .relay-login .login-card { animation: loginIn .5s cubic-bezier(0.23,1,0.32,1) both; }
        }
        @keyframes loginDrift1 { from { transform: translate(-3%,-2%) scale(1); } to { transform: translate(4%,3%) scale(1.08); } }
        @keyframes loginDrift2 { from { transform: translate(3%,2%) scale(1); } to { transform: translate(-4%,-3%) scale(1.1); } }
        @keyframes loginIn { from { opacity: 0; transform: translateY(14px) scale(.985); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
}
