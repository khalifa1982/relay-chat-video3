import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import { X, Loader2, PhoneOff } from "lucide-react";
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
  // A new call supersedes an undismissed "they didn't answer" card — without
  // this it resurfaces when the LATER call ends (review v2.88).
  useEffect(() => {
    if (phase !== "idle") setFailedDial(null);
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
  }, [contactsList.data]);

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

  // Hide the phone-app chrome while a call / incoming ring is on screen.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("relay-call-active", phase !== "idle");
    return () => document.body.classList.remove("relay-call-active");
  }, [phase]);

  const value: RelayEngineValue = {
    dial: (n, opts) => handleRef.current?.dial(n, opts) ?? false,
    dialGroup: (nums, opts) => handleRef.current?.dialGroup(nums, opts) ?? false,
    hangup: () => handleRef.current?.hangup(),
    phase,
    pin,
    ready,
    // Re-read on every render; once `ready` flips (a state change → re-render)
    // this reflects the registered transport's real cap (mesh 6 / SFU 10).
    maxParticipants: handleRef.current?.maxParticipants() ?? 10,
  };

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
      `}</style>
      {/* The engine host: parked off-screen when idle, promoted to a fullscreen
          overlay (above all app chrome) during a call or incoming ring. */}
      <div
        ref={engineRoot}
        className={
          "relay-root relay-embedded " +
          (phase === "idle"
            ? "absolute -left-[10000px] top-0 size-px overflow-hidden pointer-events-none opacity-0"
            : "fixed inset-0 z-40")
        }
        data-relay-engine-root="true"
      />
      {phase === "dialing" || phase === "in-call" ? (
        <button
          type="button"
          onClick={() => handleRef.current?.hangup()}
          className="fixed top-3 right-3 z-[70] inline-flex items-center gap-1.5 rounded-full bg-destructive/90 hover:bg-destructive text-destructive-foreground px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur-md outline-none focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 focus-visible:ring-[3px]"
          aria-label="End call"
        >
          <X className="size-3.5" />
          End
        </button>
      ) : null}
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
    </RelayEngineContext.Provider>
  );
}
