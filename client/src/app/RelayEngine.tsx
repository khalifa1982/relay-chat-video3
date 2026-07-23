import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import { Loader2, PhoneOff, UserPlus, Minimize2, Maximize2, Scan, GripHorizontal, Users } from "lucide-react";
// TYPE-ONLY import — erased at build. The call engine (relayClient + its
// markup/CSS) is DYNAMICALLY imported inside the mount effect below (v2.88):
// it's several hundred KB that only matters once a signed-in user is inside
// /app, so it must not sit in the entry chunk the keypad paints from.
import type { RelayHandle, RelayPhase } from "@/lib/relayClient";
import { isNativeAndroid, nativeEnsureNotifPermission, nativeGetPushToken } from "@/lib/nativeBridge";
import { VoicemailPrompt, type FailedDialInfo } from "./VoicemailPrompt";
import { trpc } from "@/lib/trpc";

interface RelayEngineValue {
  /** Programmatic dial. Returns true if the engine accepted the request.
   *  `opts.voice` starts a voice call (camera off). */
  dial: (number: string, opts?: { voice?: boolean; displayName?: string }) => boolean;
  /** Start a GROUP call — ring up to `maxParticipants` numbers into one room. */
  dialGroup: (numbers: string[], opts?: { voice?: boolean }) => boolean;
  /** Max participants the active transport supports (SFU 10 / mesh 6). The
   *  group-call picker caps selection to this so it never rings more than can
   *  connect. Defaults to 10 until the engine registers. */
  maxParticipants: number;
  /** End/leave the current call (or cancel an outgoing one). */
  hangup: () => void;
  /** Live-call rejoin (v2.99.9): ask to rejoin the live call `number` is in
   *  (History "Join"). The host is asked to approve. Returns false if the
   *  engine isn't ready. */
  knock: (number: string) => boolean;
  /** idle | dialing | ringing | in-call. */
  phase: RelayPhase;
  /** Authoritative 6-digit signaling number, or null until registered. */
  pin: string | null;
  /** True once the engine has registered (or we gave up waiting). */
  ready: boolean;
}

const RelayEngineContext = createContext<RelayEngineValue>({
  dial: () => false,
  dialGroup: () => false,
  hangup: () => {},
  knock: () => false,
  phase: "idle",
  pin: null,
  ready: false,
  maxParticipants: 10,
});

export const useRelayEngine = () => useContext(RelayEngineContext);

/**
 * Hosts the imperative RELAY call engine ONCE for the whole `/app` session —
 * not per-tab — so a user can be rung (and answer) from any screen, not only the
 * Dialer. Previously the engine only ran on the Dialer page, so a callee sitting
 * on Messages/Contacts was never reachable. This provider lives above the router
 * (so it persists across tab navigation) and renders the engine's fullscreen
 * call/ring overlay above the app chrome. The Dialer drives it via
 * `useRelayEngine()`.
 */
export function RelayEngineProvider({ children }: { children: ReactNode }) {
  // Read the identity directly (no heartbeat side effect — that's owned by
  // AppShell's useIdentity); we only need name + number to auto-register.
  const whoami = trpc.identity.whoami.useQuery(undefined, { staleTime: 30_000 });
  const me = whoami.data ?? null;
  // Our country flag (for the in-call name tag), resolved from our IP geo.
  const geo = trpc.directory.geoSelf.useQuery(undefined, {
    enabled: !!me,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  const [location] = useLocation();
  const inApp = location.startsWith("/app");

  const engineRoot = useRef<HTMLDivElement>(null);
  const handleRef = useRef<RelayHandle | null>(null);
  const [phase, setPhase] = useState<RelayPhase>("idle");
  const [pin, setPin] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // The engine's scoped CSS, set once the lazy chunk arrives (rendered below).
  const [engineCss, setEngineCss] = useState("");
  // True while the engine is auto-rejoining an active call after a reload / crash
  // / accidental close. Drives the prominent "Reconnecting… / Exit call" prompt.
  const [rejoining, setRejoining] = useState(false);
  // A 1:1 dial that never connected (no answer / declined / offline) — drives
  // the post-dial voicemail + call-back-alert card (v2.88).
  const [failedDial, setFailedDial] = useState<FailedDialInfo | null>(null);
  // In-page minimize (v2.99.8): the live call shrinks to a small draggable box
  // (NOT a browser PiP window) so the user can use Messages/History behind it.
  // The engine div is never torn down — only its position/size class changes,
  // so media keeps flowing. `minimized` is a display state, orthogonal to the
  // engine's phase machine.
  const [minimized, setMinimized] = useState(false);
  const [fitContain, setFitContain] = useState(false); // "fit screen": letterbox vs cover
  const [miniPos, setMiniPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [peopleCount, setPeopleCount] = useState(1);
  // Live-call rejoin (v2.99.9): host-side "someone wants to rejoin" prompt.
  const [knockReq, setKnockReq] = useState<{ pin: string; name: string; roomId: string } | null>(null);
  // A new call supersedes an undismissed "they didn't answer" card — without
  // this it resurfaces when the LATER call ends (review v2.88).
  useEffect(() => {
    if (phase !== "idle") setFailedDial(null);
    // Returning to idle ends the call → reset the minimize/fit/drag display state.
    if (phase === "idle") { setMinimized(false); setFitContain(false); setMiniPos({ x: 0, y: 0 }); }
  }, [phase]);

  // Tell the engine to force the compact 2-up layout while minimized (the
  // engine's ResizeObserver is the passive fallback).
  useEffect(() => {
    handleRef.current?.setMinimized(minimized);
  }, [minimized]);

  // Poll the live head-count (self + remote peers) so the mini box shows how
  // many are on the call — and grows a touch as more join. Same 3s poll the
  // in-call save-contacts chip uses.
  useEffect(() => {
    if (phase !== "in-call") { setPeopleCount(1); return; }
    const read = () => setPeopleCount((handleRef.current?.getRoster().length ?? 0) + 1);
    read();
    const t = setInterval(read, 3000);
    return () => clearInterval(t);
  }, [phase]);

  // Incoming-ring "quick reply": the engine calls back with (callerPin, text)
  // when the callee picks a canned response; we deliver it as a normal chat
  // message (open/create the 1:1 thread, then send) so it lands in Messages
  // on both sides. Mutations live here (React layer) — the engine is plain JS.
  const openThread = trpc.messages.openThread.useMutation();
  const sendMessage = trpc.messages.send.useMutation();
  const quickReplyRef = useRef<(toPin: string, text: string) => void>(() => {});
  quickReplyRef.current = (toPin, text) => {
    openThread
      .mutateAsync({ number: toPin })
      .then((r) => sendMessage.mutateAsync({ conversationId: r.conversationId, kind: "text", body: text }))
      .catch(() => {/* best-effort — the decline itself already went through */});
  };

  // NATIVE ANDROID APP: register this device's FCM token so the server can
  // WAKE it for incoming calls even when the app is closed (kind:"fcm" —
  // browsers/PWA use Web Push instead). No-op outside the native shell, and
  // resolves to nothing until Firebase is configured (mobile/README.md).
  const pushSubscribe = trpc.push.subscribe.useMutation();
  useEffect(() => {
    if (!me || !isNativeAndroid()) return;
    void (async () => {
      await nativeEnsureNotifPermission();
      const token = await nativeGetPushToken();
      if (token) pushSubscribe.mutate({ endpoint: token, kind: "fcm" });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  // BLOCKED numbers → the engine silently declines their calls. Sourced from
  // the contact list (blocked flag), refreshed with it.
  const contactsList = trpc.contacts.list.useQuery(undefined, {
    enabled: !!me,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    const blocked = (contactsList.data ?? []).filter((c) => c.blocked).map((c) => c.number);
    handleRef.current?.setBlockedPins(blocked);
    // Per-tile "add to contacts" mark (v2.99.8): push the saved numbers so the
    // engine shows the mark only on peers you HAVEN'T saved (and drops it the
    // instant one is added).
    handleRef.current?.setSavedContacts((contactsList.data ?? []).map((c) => c.number));
  }, [contactsList.data]);

  // Bridge the engine's per-tile add-contact tap to the contacts stack (v2.99.8).
  const saveContact = trpc.contacts.upsert.useMutation({
    onSuccess: () => contactsList.refetch(),
  });
  const saveContactRef = useRef<(pin: string, name: string) => void>(() => {});
  saveContactRef.current = (pin, name) => {
    saveContact.mutate({ number: pin, displayName: name || undefined });
  };

  // Latest identity values, read by the (mount-once) auto-register loop.
  const nameRef = useRef<string | null>(null);
  nameRef.current = me?.displayName ?? null;
  const numberRef = useRef<string | null>(null);
  numberRef.current = me?.number ?? null;
  const flagRef = useRef<string>("");
  flagRef.current = geo.data?.flagEmoji ?? "";

  // Push our flag to the engine whenever it resolves/changes (the engine
  // re-affirms registration so remote tiles pick it up).
  useEffect(() => {
    if (geo.data?.flagEmoji) handleRef.current?.setSelfFlag(geo.data.flagEmoji);
  }, [geo.data?.flagEmoji]);

  // Reconcile the relay signaling pin to the AUTHORITATIVE identity number, so the
  // dialer's big number == the header number == the actually-dialable pin. The
  // engine can first register with a stale localStorage pin before whoami's
  // `number` has loaded; setPreferredPin then switches it to the identity number
  // while idle. We re-run when `ready` flips true (engine has registered, so its
  // pin is known and a switch can take effect) AND on any later number change.
  // Without this the user sees TWO different numbers and the displayed one can't
  // be reached. setPreferredPin no-ops once the pins already match, so no loop.
  useEffect(() => {
    if (ready && me?.number) handleRef.current?.setPreferredPin(me.number);
  }, [me?.number, ready]);

  useEffect(() => {
    if (!inApp || !me) return;
    const el = engineRoot.current;
    if (!el) return;
    // Lazily pull in the call engine + its markup/CSS (v2.88): a dynamic
    // import splits them out of the entry chunk. `cancelled` guards the
    // unmount-before-load race (fast tab away / identity change) so we never
    // start an engine we can't destroy.
    let cancelled = false;
    let handle: RelayHandle | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let giveUp: ReturnType<typeof setTimeout> | null = null;
    void (async () => {
      const [{ startRelay }, { RELAY_MARKUP, RELAY_CSS }] = await Promise.all([
        import("@/lib/relayClient"),
        import("@/lib/relayAssets"),
      ]);
      if (cancelled) return;
      setEngineCss(RELAY_CSS);
      el.innerHTML = RELAY_MARKUP;
      handle = startRelay(el);
      handle.setOnStateChange(setPhase);
      handle.setOnPinChange(setPin);
      handle.setOnRejoinChange(setRejoining);
      handle.setOnQuickReply((toPin, text) => quickReplyRef.current(toPin, text));
      handle.setOnSaveContact((pin, name) => saveContactRef.current(pin, name));
      handle.setOnKnock((pin, name, roomId) => setKnockReq({ pin, name, roomId }));
      // Voicemail (v2.88): surface the "Leave a voice message / alert me when
      // online" card after a failed 1:1 dial. The engine's own ~2s reason card
      // shows first; this appears above it and outlives the teardown.
      handle.setOnDialFailed((failInfo) => setFailedDial(failInfo));
      if (flagRef.current) handle.setSelfFlag(flagRef.current);
      handleRef.current = handle;

      // Auto-register against the v2 identity (number + name) so the engine has a
      // pin and is reachable without the user re-entering anything.
      const tryRegister = () => {
        const nameInput = el.querySelector<HTMLInputElement>("#nameInput");
        const name = nameRef.current ?? "";
        if (!nameInput || !name) return false;
        if (!nameInput.value) nameInput.value = name;
        handle?.setPreferredPin(numberRef.current);
        const btn = el.querySelector<HTMLButtonElement>("#joinBtn");
        if (btn && !btn.disabled) {
          btn.click();
          return true;
        }
        return false;
      };
      timer = setInterval(() => {
        if (tryRegister()) {
          if (timer) clearInterval(timer);
          timer = null;
          setTimeout(() => setReady(true), 350);
        }
      }, 200);
      giveUp = setTimeout(() => {
        if (timer) clearInterval(timer);
        setReady(true);
      }, 5_000);
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (giveUp) clearTimeout(giveUp);
      handle?.destroy();
      handleRef.current = null;
      setReady(false);
      setPhase("idle");
      setPin(null);
      setRejoining(false);
      setFailedDial(null);
    };
    // Re-mount only when entering/leaving /app or when the identity id changes;
    // navigating between tabs keeps inApp + me.id stable, so the engine persists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inApp, me?.id]);

  // Hide the phone-app chrome while a call / incoming ring is on screen — but
  // NOT while minimized (v2.99.8): the mini box floats over the app so the user
  // can keep using Messages / History behind it, so the bottom nav / sidebar
  // must stay visible.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("relay-call-active", phase !== "idle" && !minimized);
    return () => document.body.classList.remove("relay-call-active");
  }, [phase, minimized]);

  // ── mini-box dragging (v2.99.8) ──────────────────────────────────────────
  // Pointer drag on the mini box's header, writing a translate offset applied
  // to BOTH the engine root and the control overlay (one source of truth).
  // Clamped so the box can't be dragged fully off-screen.
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const onMiniDragStart = (e: React.PointerEvent) => {
    if (!minimized) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: miniPos.x, baseY: miniPos.y };
  };
  const onMiniDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    // Dragging up/left is negative — the box is anchored bottom-right, so clamp
    // the offset to keep it within the viewport with a small margin.
    const nx = Math.min(0, Math.max(-(window.innerWidth - 120), d.baseX + (e.clientX - d.startX)));
    const ny = Math.min(0, Math.max(-(window.innerHeight - 160), d.baseY + (e.clientY - d.startY)));
    setMiniPos({ x: nx, y: ny });
  };
  const onMiniDragEnd = () => { dragRef.current = null; };

  // The mini box geometry — applied inline (beats the base `.relay-root{inset:0}`
  // rule without needing !important, since inline styles win over class rules).
  const miniBoxStyle: React.CSSProperties = {
    position: "fixed",
    inset: "auto",
    right: 14,
    bottom: 88,
    top: "auto",
    left: "auto",
    width: "min(340px, 86vw)",
    // Grows a little with headcount so a busy call's 2-up isn't cramped.
    height: peopleCount > 1 ? 232 : 196,
    transform: `translate(${miniPos.x}px, ${miniPos.y}px)`,
    borderRadius: 18,
    overflow: "hidden",
    boxShadow: "0 24px 60px -18px rgba(0,0,0,.7)",
    zIndex: 60,
  };

  const value: RelayEngineValue = {
    dial: (n, opts) => handleRef.current?.dial(n, opts) ?? false,
    dialGroup: (nums, opts) => handleRef.current?.dialGroup(nums, opts) ?? false,
    hangup: () => handleRef.current?.hangup(),
    knock: (n) => { if (!handleRef.current) return false; handleRef.current.knock(n); return true; },
    phase,
    pin,
    ready,
    // Re-read on every render; once `ready` flips (a state change → re-render)
    // this reflects the registered transport's real cap (mesh 6 / SFU 10).
    maxParticipants: handleRef.current?.maxParticipants() ?? 10,
  };
  const active = phase !== "idle";

  return (
    <RelayEngineContext.Provider value={value}>
      {children}
      {/* Engine CSS (scoped to .relay-root) + embed/overlay rules — empty
          until the lazily-imported engine chunk lands. */}
      <style>{engineCss}</style>
      <style>{`
        .relay-root.relay-embedded #register,
        .relay-root.relay-embedded #lobby { display: none !important; }
        body.relay-call-active .relay-appshell-chrome { display: none !important; }
        body.relay-call-active .relay-root.relay-embedded { z-index: 60 !important; }
        /* v2.96.1 (owner): the copyright/version footer has no place on the
           call screen — it collided with the chat composer on phones. */
        body.relay-call-active .relay-root .version-tag { display: none !important; }
        /* Minimized mini-box (v2.99.8): only the video grid shows — the call
           header, control bar and chat panel are hidden; a slim React overlay
           provides drag + Maximize + Hang up. Geometry is inline (see
           miniBoxStyle) so it beats the base .relay-root{inset:0}. */
        .relay-root.relay-minimized .call-head,
        .relay-root.relay-minimized .controls,
        .relay-root.relay-minimized #chatPanel,
        .relay-root.relay-minimized #filterDock,
        .relay-root.relay-minimized .diag-btn { display: none !important; }
        .relay-root.relay-minimized .call-main { padding-top: 30px !important; }
        .relay-root.relay-minimized .grid { padding: 6px !important; }
        /* "Fit screen" (v2.99.8): letterbox every tile's video (contain) instead
           of the default crop-to-fill (cover), so nothing is cut off. */
        .relay-root.relay-fit .relay-tile video { object-fit: contain !important; }
      `}</style>
      {/* The engine host: parked off-screen when idle; a fullscreen overlay
          during a live call; or a small draggable mini-box when minimized. The
          div (and its live media) is NEVER torn down — only its class/geometry
          changes. */}
      <div
        ref={engineRoot}
        style={active && minimized ? miniBoxStyle : undefined}
        className={
          "relay-root relay-embedded " +
          (fitContain ? "relay-fit " : "") +
          (!active
            ? "absolute -left-[10000px] top-0 size-px overflow-hidden pointer-events-none opacity-0"
            : minimized
              ? "relay-minimized"
              : "fixed inset-0 z-40")
        }
        data-relay-engine-root="true"
      />
      {/* Fullscreen in-call controls (v2.99.8): a Minimize + Fit cluster
          top-left (the engine owns the rest of the chrome). Hidden while
          minimized (the mini box has its own controls) and pre-connect. */}
      {phase === "in-call" && !minimized ? (
        <div className="fixed top-3 left-1/2 z-[70] flex -translate-x-1/2 gap-2">
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur-md hover:bg-black/75 active:scale-95 transition-transform"
            aria-label="Minimize the call to a floating window"
            title="Minimize — keep the call in a small window while you use the app"
          >
            <Minimize2 className="size-4" /> Minimize
          </button>
          <button
            type="button"
            onClick={() => setFitContain((v) => !v)}
            className={
              "inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur-md active:scale-95 transition-transform " +
              (fitContain ? "bg-[color:var(--relay-online,#06d6a0)] text-black" : "bg-black/60 text-white hover:bg-black/75")
            }
            aria-label="Fit the whole video on screen"
            title={fitContain ? "Fit: showing the whole frame (tap for fill)" : "Fit screen — show the whole video, no cropping"}
          >
            <Scan className="size-4" /> Fit
          </button>
        </div>
      ) : null}
      {/* Minimized mini-box overlay (v2.99.8): a draggable header with the live
          people-count + Maximize + Hang up, laid exactly over the engine box. */}
      {active && minimized ? (
        <div style={{ ...miniBoxStyle, pointerEvents: "none" }} className="flex flex-col">
          <div
            onPointerDown={onMiniDragStart}
            onPointerMove={onMiniDragMove}
            onPointerUp={onMiniDragEnd}
            className="pointer-events-auto flex cursor-grab items-center gap-2 bg-black/70 px-2.5 py-1.5 text-white backdrop-blur-md active:cursor-grabbing"
            style={{ touchAction: "none" }}
          >
            <GripHorizontal className="size-4 shrink-0 opacity-70" />
            <span className="flex items-center gap-1 text-xs font-semibold">
              <Users className="size-3.5" /> {peopleCount}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMinimized(false)}
                className="grid size-7 place-items-center rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 transition-transform"
                aria-label="Maximize the call back to full screen"
                title="Maximize"
              >
                <Maximize2 className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => handleRef.current?.hangup()}
                className="grid size-7 place-items-center rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 active:scale-95 transition-transform"
                aria-label="End the call"
                title="End call"
              >
                <PhoneOff className="size-4" />
              </button>
            </span>
          </div>
          {/* The rest of the box is the engine's video grid, showing through. */}
          <div className="flex-1" />
        </div>
      ) : null}
      {/* In-call one-tap contact conversion (v2.96): a quiet chip for the
          first on-call peer who isn't in your contacts yet. */}
      {phase === "in-call" ? <InCallSaveContacts handleRef={handleRef} /> : null}
      {/* v2.96.3 (owner): the floating top-right "X End" pill is GONE — it
          duplicated the engine's own hang-up (dial screen + in-call control
          bar both have one), showing two End controls at once. */}
      {/* Prominent auto-rejoin prompt: shown while the engine is restoring an
          active call after a reload / accidental close / crash. The call rejoins
          automatically; this gives the user an explicit, unmissable way OUT if
          they don't want to reconnect (request: "a clear and prominent Exit the
          call option"). It auto-dismisses the instant the rejoin resolves. */}
      {/* Post-dial voicemail / call-back-alert card (v2.88): shown once the
          failed dial's reason card has run its course. Hidden while a NEW call
          is active so it can never cover live call UI. */}
      {failedDial && phase === "idle" ? (
        <VoicemailPrompt info={failedDial} onClose={() => setFailedDial(null)} />
      ) : null}
      {rejoining ? (
        <div
          className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-6 bg-black/80 px-6 text-center backdrop-blur-md"
          role="alertdialog"
          aria-label="Reconnecting to your call"
        >
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-10 animate-spin text-[color:var(--relay-online,#06d6a0)]" />
            <div className="text-lg font-semibold text-white">Reconnecting to your call…</div>
            <div className="max-w-xs text-sm text-white/70">
              You were in an active call. We&apos;re rejoining you automatically.
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              handleRef.current?.cancelRejoin();
              setRejoining(false);
            }}
            className="inline-flex items-center gap-2 rounded-full bg-destructive px-5 py-2.5 text-sm font-semibold text-destructive-foreground shadow-lg hover:bg-destructive/90 outline-none focus-visible:ring-destructive/30 dark:focus-visible:ring-destructive/50 focus-visible:ring-[3px]"
          >
            <PhoneOff className="size-4" />
            Exit the call
          </button>
        </div>
      ) : null}
      {/* Live-call rejoin (v2.99.9): the HOST is asked to approve someone who
          was in this call and wants back in (from their History → Join). */}
      {knockReq ? (
        <div
          className="fixed inset-x-0 top-4 z-[85] mx-auto flex w-[min(360px,92vw)] items-center gap-3 rounded-2xl border border-amber-400/40 bg-card/95 p-3 shadow-2xl backdrop-blur-md"
          role="alertdialog"
          aria-label="Someone wants to rejoin the call"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-amber-400/15 text-amber-500 font-bold">
            {(knockReq.name || "?").slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{knockReq.name || "Someone"}</div>
            <div className="text-xs text-muted-foreground">wants to rejoin the call</div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => { handleRef.current?.approveKnock(knockReq.roomId, knockReq.pin); setKnockReq(null); }}
              className="rounded-lg bg-[color:var(--relay-online,#06d6a0)] px-3 py-1.5 text-xs font-semibold text-black active:scale-95 transition-transform"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => { handleRef.current?.denyKnock(knockReq.roomId, knockReq.pin); setKnockReq(null); }}
              className="rounded-lg bg-muted px-3 py-1.5 text-xs font-semibold text-foreground active:scale-95 transition-transform"
            >
              Decline
            </button>
          </div>
        </div>
      ) : null}
    </RelayEngineContext.Provider>
  );
}

/**
 * In-call one-tap contact conversion (v2.96; v2.96.1 owner note: "just show
 * the button, don't show the text") — while a call is live, a single ROUND
 * icon button top-left (the End pill owns top-right) saves the first on-call
 * peer who isn't in your contacts yet. It disappears once everyone on the
 * call is saved. The roster comes from the engine's read-only `getRoster()`
 * snapshot, polled every few seconds (peers can join/leave mid-call).
 */
function InCallSaveContacts({
  handleRef,
}: {
  handleRef: React.RefObject<RelayHandle | null>;
}) {
  const utils = trpc.useUtils();
  const [roster, setRoster] = useState<Array<{ pin: string; name: string }>>([]);
  useEffect(() => {
    const read = () => setRoster(handleRef.current?.getRoster() ?? []);
    read();
    const t = setInterval(read, 3000);
    return () => clearInterval(t);
  }, [handleRef]);
  const contacts = trpc.contacts.list.useQuery(undefined, { staleTime: 30_000 });
  const upsert = trpc.contacts.upsert.useMutation({
    onSuccess: () => utils.contacts.list.invalidate(),
  });
  if (!contacts.data) return null;
  const saved = new Set(contacts.data.map((c) => c.number));
  const candidate = roster.find((r) => !saved.has(r.pin));
  if (!candidate) return null;
  return (
    <button
      type="button"
      disabled={upsert.isPending}
      onClick={() => upsert.mutate({ number: candidate.pin, displayName: candidate.name || undefined })}
      className="fixed top-3 left-3 z-[70] grid size-10 place-items-center rounded-full bg-black/60 text-[color:var(--relay-online,#06d6a0)] shadow-lg backdrop-blur-md hover:bg-black/75 active:scale-95 transition-transform outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
      aria-label={`Save ${candidate.name || candidate.pin} to contacts`}
      title={`Save ${candidate.name || candidate.pin} to contacts`}
    >
      <UserPlus className="size-[18px]" />
    </button>
  );
}
