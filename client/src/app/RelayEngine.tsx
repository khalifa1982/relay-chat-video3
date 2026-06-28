import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import { X } from "lucide-react";
import { startRelay, type RelayHandle, type RelayPhase } from "@/lib/relayClient";
import { RELAY_MARKUP, RELAY_CSS } from "@/lib/relayAssets";
import { trpc } from "@/lib/trpc";

interface RelayEngineValue {
  /** Programmatic dial. Returns true if the engine accepted the request.
   *  `opts.voice` starts a voice call (camera off). */
  dial: (number: string, opts?: { voice?: boolean }) => boolean;
  /** Start a GROUP call — ring up to 10 numbers into one room. */
  dialGroup: (numbers: string[], opts?: { voice?: boolean }) => boolean;
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
    el.innerHTML = RELAY_MARKUP;
    const handle = startRelay(el);
    handle.setOnStateChange(setPhase);
    handle.setOnPinChange(setPin);
    if (flagRef.current) handle.setSelfFlag(flagRef.current);
    handleRef.current = handle;

    // Auto-register against the v2 identity (number + name) so the engine has a
    // pin and is reachable without the user re-entering anything.
    const tryRegister = () => {
      const nameInput = el.querySelector<HTMLInputElement>("#nameInput");
      const name = nameRef.current ?? "";
      if (!nameInput || !name) return false;
      if (!nameInput.value) nameInput.value = name;
      handle.setPreferredPin(numberRef.current);
      const btn = el.querySelector<HTMLButtonElement>("#joinBtn");
      if (btn && !btn.disabled) {
        btn.click();
        return true;
      }
      return false;
    };
    let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
      if (tryRegister()) {
        if (timer) clearInterval(timer);
        timer = null;
        setTimeout(() => setReady(true), 350);
      }
    }, 200);
    const giveUp = setTimeout(() => {
      if (timer) clearInterval(timer);
      setReady(true);
    }, 5_000);

    return () => {
      if (timer) clearInterval(timer);
      clearTimeout(giveUp);
      handle.destroy();
      handleRef.current = null;
      setReady(false);
      setPhase("idle");
      setPin(null);
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
  };

  return (
    <RelayEngineContext.Provider value={value}>
      {children}
      {/* Engine CSS (scoped to .relay-root) + embed/overlay rules. */}
      <style>{RELAY_CSS}</style>
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
          className="fixed top-3 right-3 z-[70] inline-flex items-center gap-1.5 rounded-full bg-destructive/90 hover:bg-destructive text-destructive-foreground px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur-md"
          aria-label="End call"
        >
          <X className="size-3.5" />
          End
        </button>
      ) : null}
    </RelayEngineContext.Provider>
  );
}
