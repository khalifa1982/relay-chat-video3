import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import { Loader2, PhoneOff, UserPlus, Minimize2, Maximize2, Scan, Shrink, GripHorizontal, Users, Phone, ChevronDown } from "lucide-react";
// TYPE-ONLY import — erased at build. The call engine (relayClient + its
// markup/CSS) is DYNAMICALLY imported inside the mount effect below (v2.88):
// it's several hundred KB that only matters once a signed-in user is inside
// /app, so it must not sit in the entry chunk the keypad paints from.
import type { RelayHandle, RelayPhase } from "@/lib/relayClient";
import { useT, type TKey } from "./i18n";
import { isNativeAndroid, nativeEnsureNotifPermission, nativeGetPushToken } from "@/lib/nativeBridge";
import { VoicemailPrompt, type FailedDialInfo } from "./VoicemailPrompt";
import { trpc } from "@/lib/trpc";
import { mountNativeTokenBridge } from "./nativeTokenBridge";
import { adoptRemoteLock, localLockSnapshot } from "./passcode";
import { applyStoredScreenshotBlock } from "./nativeScreenshotBridge";
import { onAlertPrefsChanged, readAlertPrefs } from "./swPrefs";
import type { AlertPrefs } from "@shared/alertPrefs";
import { mountNativeCallBridge, parseNativeCallIntent } from "@/lib/nativeCallBridge";
import { consumeNativeCallSearch } from "@/lib/bootUrl";

interface RelayEngineValue {
  /** Programmatic dial. Returns true if the engine accepted the request.
   *  `opts.voice` starts a voice call (camera off). */
  dial: (number: string, opts?: { voice?: boolean; displayName?: string }) => boolean;
  /** Start a GROUP call — ring up to `maxParticipants` numbers into one room. */
  dialGroup: (numbers: string[], opts?: { voice?: boolean; seed?: string | null; name?: string | null }) => boolean;
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
  /** Shrink an active call to the draggable mini-box (so a chat opened behind it
   *  is usable). No-op when idle. Used by the notification nav bridge when a
   *  message is tapped mid-call. */
  minimizeCall: () => void;
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
  minimizeCall: () => {},
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
 *
 * ── LANGUAGE: THIS FILE IS TRANSLATED, THE ENGINE BELOW IT IS NOT ────────────────
 * Everything React renders here goes through `useT()` (`dict/engine.ts`). The engine
 * ITSELF — `lib/relayClient.ts` driving `lib/relayAssets.ts`'s markup — writes raw DOM
 * from plain functions, so it can call no hook and reaches no dictionary: the in-call
 * control bar's labels, the ring card, the dial-status line and the in-call chat are
 * still English in Arabic. That is stated rather than implied, because the seam is
 * invisible from the screen — the user sees one call surface with two owners.
 *
 * ── DIRECTION: WHAT IS LOGICAL HERE AND WHAT IS DELIBERATELY PHYSICAL ────────────
 * Reading-order spacing is logical (`ms-`, `-start-`). Three things stay physical on
 * purpose and each says so in place: the two CENTRING pairs (`left-1/2` +
 * `-translate-x-1/2`, and `inset-x-0` + `mx-auto`), which are direction-independent
 * and would push the wrong way if "corrected"; and the mini window's `right`/`bottom`
 * anchor, whose drag clamp is arithmetic in physical pixels.
 */
export function RelayEngineProvider({ children }: { children: ReactNode }) {
  const t = useT();
  /* `t` is memoized on the locale, so its IDENTITY changing is exactly the signal
     that the language changed — which is what the re-apply effect below keys on.
     It is also mirrored into a ref, because the mount effect must not re-run (and
     tear down a live call) merely because somebody switched language. */
  const tAnyRef = useRef<(k: string, vars?: Record<string, string | number>) => string>(
    () => "",
  );
  const applyLabelsRef = useRef<((root: ParentNode, t: (k: string) => string) => void) | null>(null);
  /* Same ref treatment as the applier, and for the same reason: the language effect
     must not re-import the engine module (nor re-run the mount effect, which would
     tear down a live call). */
  const setEngineTranslatorRef = useRef<
    ((t: ((k: string, vars?: Record<string, string | number>) => string) | null) => void) | null
  >(null);
  /* QW-11: the engine's setContactRingtoneResolver, captured from the dynamic
     import so the unmount cleanup can clear it. */
  const setContactRingtoneResolverRef = useRef<((r: ((from: string) => string | null) | null) => void) | null>(null);
  /* THE CAST IS DELIBERATE AND IS CHECKED SOMEWHERE STRONGER THAN THE TYPE SYSTEM.
     `t` accepts a `TKey` union; `applyEngineLabels` accepts a plain string, because
     the keys it reads come out of `data-i18n` attributes inside a template literal —
     text TypeScript cannot see into, so no type could ever check them. Widening the
     applier's parameter to `TKey` would only move the cast, AND would couple the
     engine's asset module to the React i18n tree, which is exactly the dependency
     the engine must not have.
     `engineLabels.test.ts` sweeps every `data-i18n*` value in the markup and asserts
     it is a real key — a check the compiler could not perform, and one that also
     catches a typo in an attribute the type system would have waved through. */
  const tAny = useCallback(
    (k: string, vars?: Record<string, string | number>) => t(k as TKey, vars),
    [t],
  );
  tAnyRef.current = tAny;
  // Read the identity directly (no heartbeat side effect — that's owned by
  // AppShell's useIdentity); we only need name + number to auto-register.
  const whoami = trpc.identity.whoami.useQuery(undefined, { staleTime: 30_000 });
  /* PER-CONTACT RINGTONES (v2.107.64, QW-11). A tiny `{number, ringtone}` list —
     only contacts with a custom ringtone — kept warm so the engine can resolve a
     caller's ringtone the instant a ring arrives. Long staleTime: reassignments are
     rare and a wrong tone for one ring (until the next refetch) is cosmetic. */
  const contactRingtonesQ = trpc.contacts.ringtones.useQuery(undefined, { staleTime: 300_000 });
  const ringtoneMapRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const m = new Map<string, string>();
    for (const r of contactRingtonesQ.data?.ringtones ?? []) m.set(r.number, r.ringtone);
    // The engine's registered resolver reads this ref lazily at ring time, so
    // swapping its contents is enough — no need to re-register.
    ringtoneMapRef.current = m;
  }, [contactRingtonesQ.data]);
  // QW-12: re-tell the mobile shell whether to block screen capture on every
  // load. FLAG_SECURE is per-Activity and is dropped on relaunch, so this must
  // run each mount — and BEFORE auth, because the preference is a property of
  // this device, not of whoever is signed in. A no-op outside a shell build
  // that advertises the capability, so it's safe to run unconditionally.
  useEffect(() => {
    applyStoredScreenshotBlock();
  }, []);
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
  // v2.107.47 (owner): a THIRD, tiniest display state on top of `minimized` — a
  // small draggable BUBBLE that frees the whole screen. The call stays fully
  // live (the engine div is never torn down, same as minimize); only a ~60px
  // "call is live" dot shows, parked at a screen edge. Tap it to restore. Works
  // for 1:1, group and video alike, since it is purely a display collapse.
  const [bubbled, setBubbled] = useState(false);
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
    if (phase === "idle") { setMinimized(false); setBubbled(false); setFitContain(false); setMiniPos({ x: 0, y: 0 }); }
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
    // Named `poll`, not `t`: `t` is the translator in this component's scope, and a
    // timer handle shadowing it is how a later edit here gets a `Timeout` where it
    // expected a function. Removing the shadow beats aliasing around it (v2.106.85).
    const poll = setInterval(read, 3000);
    return () => clearInterval(poll);
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

  /* ACCOUNT-WIDE APP LOCK sync (v2.107.77). One policy, one place:
   *   - the ACCOUNT's lock wins: if it differs from this device's cached pair (or
   *     this device has none), adopt it — locking immediately only when this
   *     device had no lock at all, i.e. the just-opened case where gating is what
   *     the person expects. A device already past its gate is not yanked mid-use;
   *     it simply starts verifying against the account's code.
   *   - a device that has a lock the account does not (set before this feature
   *     shipped) pushes it UP once, so the first device to sync defines the
   *     account code instead of losing it.
   * Cleared server-side (Settings or the gate's forgot path) → `get` returns null
   * and the local cache is dropped too, or a removed lock would keep gating the
   * other devices forever. */
  const appLockQ = trpc.appLock.get.useQuery(undefined, {
    enabled: !!me,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const appLockSet = trpc.appLock.set.useMutation();
  const appLockPushedRef = useRef(false);
  useEffect(() => {
    if (!me || appLockQ.data === undefined) return;
    const remote = appLockQ.data; // {hash,salt} | null
    const local = localLockSnapshot();
    if (remote) {
      if (!local || local.hash !== remote.hash) {
        adoptRemoteLock(remote.hash, remote.salt, { lockNow: !local });
      }
    } else if (local && !appLockPushedRef.current) {
      appLockPushedRef.current = true; // once per mount — a failed push retries next load
      appLockSet.mutate(local);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, appLockQ.data]);

  // NATIVE ANDROID APP: register this device's FCM token so the server can
  // WAKE it for incoming calls even when the app is closed (kind:"fcm" —
  // browsers/PWA use Web Push instead). No-op outside the native shell, and
  // resolves to nothing until Firebase is configured (mobile/README.md).
  const pushSubscribe = trpc.push.subscribe.useMutation();
  /**
   * The OS-RENDERED push endpoints this device has registered (v2.107.11).
   *
   * Kept so the device's Do Not Disturb / mute / lock switches can be mirrored to
   * the rows the sender reads. Only the native transports need it: a Web Push still
   * passes through the service worker, which already has the Cache Storage copy.
   *
   * A Set rather than one value because a shell can legitimately register more than
   * once in a session (a token rotation, a re-mount) and the OLD row is still live
   * until the server evicts it — leaving it unsynced is what would let a muted chat
   * keep buzzing.
   */
  const nativeEndpoints = useRef<Set<string>>(new Set());
  const setAlertPrefs = trpc.push.setAlertPrefs.useMutation();
  const pushAlertPrefs = useRef<(p: AlertPrefs) => void>(() => {});
  pushAlertPrefs.current = (p) => {
    nativeEndpoints.current.forEach((endpoint) => {
      // Best-effort by design: a failed mirror leaves the device exactly as
      // unsuppressed as it was, and the next change tries again.
      setAlertPrefs.mutate({ endpoint, dnd: p.dnd, muted: p.muted, locked: p.locked });
    });
  };
  const rememberNativeEndpoint = (endpoint: string) => {
    if (nativeEndpoints.current.has(endpoint)) return;
    nativeEndpoints.current.add(endpoint);
    // Sync IMMEDIATELY on registration, not only on the next change: a device whose
    // switches were set before the token arrived would otherwise stay unsuppressed
    // until the user happened to toggle something.
    pushAlertPrefs.current(readAlertPrefs());
  };

  useEffect(() => {
    if (!me || !isNativeAndroid()) return;
    void (async () => {
      await nativeEnsureNotifPermission();
      const token = await nativeGetPushToken();
      if (token) {
        pushSubscribe.mutate({ endpoint: token, kind: "fcm" });
        rememberNativeEndpoint(token);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  // Keep those rows current. The settings live on this device and change here, so
  // the mirror is driven by the same notification that updates the worker's copy —
  // one subscription rather than a duty each writer has to remember.
  useEffect(() => {
    if (!me) return;
    return onAlertPrefsChanged((p) => pushAlertPrefs.current(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  // WEBVIEW SHELL (v2.99.79): the owner's shipping app is a React Native + Expo
  // shell wrapping this site, so the token lives in the NATIVE layer and arrives
  // by postMessage. Mounted for every signed-in session because a WebView is
  // indistinguishable from a browser from in here — an ordinary browser simply
  // never receives such a message, so this costs one idle listener.
  //
  // The gates live in `acceptTokenMessage`, not here: a bare message listener that
  // registers whatever token it is handed is a notification-hijack primitive for
  // any frame that can post into this page.
  useEffect(() => {
    if (!me) return;
    return mountNativeTokenBridge((endpoint, kind) => {
      pushSubscribe.mutate({ endpoint, kind });
      // An `apns-voip` row is ring-only and carries no banner, so it has nothing to
      // suppress; every other native kind is rendered by the OS and does.
      if (kind !== "apns-voip") rememberNativeEndpoint(endpoint);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  // NATIVE CALL EVENTS (2026-08-01) — the other half of the push spec. The shells
  // own the OS ring (CallKit / a full-screen intent); this app owns the call. So
  // Answer/Decline taps on a screen the OS drew have to reach the engine.
  //
  // Two arrivals, one handler:
  //   • IN-PAGE — a `relay:native` CustomEvent while the WebView was already alive.
  //   • COLD START — the app was killed, the push woke it, and the shell opened us
  //     at `?nativeCall=…&action=answer`. Read from the BOOT capture and consumed
  //     once, so a stale query param can never re-answer a finished call on a later
  //     navigation (the M48 lesson, in `bootUrl.ts`).
  //
  // Mounted for every signed-in session: a WebView is indistinguishable from a
  // browser in here, and an ordinary browser simply never dispatches these.
  useEffect(() => {
    if (!me) return;
    const apply = (e: { type: string; callId: string; mode?: "voice" | "video" }) => {
      const h = handleRef.current;
      if (!h) return;
      if (e.type === "callAnswered") h.answerNativeCall(e.callId, { voice: e.mode !== "video" });
      else h.endNativeCall(e.callId);
    };
    const intent = parseNativeCallIntent(consumeNativeCallSearch() ?? "");
    if (intent) {
      apply(
        intent.action === "answer"
          ? { type: "callAnswered", callId: intent.callId, mode: intent.mode }
          : { type: "callDeclined", callId: intent.callId },
      );
    }
    return mountNativeCallBridge(apply);
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

  /* A MID-CALL LANGUAGE SWITCH RE-LABELS THE ENGINE IN PLACE.
     The markup is injected ONCE (`innerHTML = RELAY_MARKUP`) and must stay injected
     — re-rendering it would destroy the live call's DOM, its listeners and its media
     elements. So the language is re-APPLIED over the existing nodes instead, which
     works because `applyEngineLabels` reads the `data-i18n` KEY rather than the
     current text: applying Arabic over English and English back over Arabic both
     land on the same result, and applying twice is a no-op.
     A no-op before the engine has mounted (the ref is null), which is the ordinary
     first run — the mount does its own first application. */
  useEffect(() => {
    const el = engineRoot.current;
    if (!el || !applyLabelsRef.current) return;
    applyLabelsRef.current(el, tAny);
    /* The declarative half above covers every `data-i18n` element. The engine ALSO
       writes copy with a name interpolated (the on-hold sentence), which carries no
       key in the DOM and so cannot be re-applied from markup — handing it the new
       translator makes it re-render that itself. */
    setEngineTranslatorRef.current?.(tAny);
  }, [t]);

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
      const [{ startRelay, setEngineTranslator, setContactRingtoneResolver }, { RELAY_MARKUP, RELAY_CSS, applyEngineLabels }] =
        await Promise.all([
          import("@/lib/relayClient"),
          import("@/lib/relayAssets"),
        ]);
      if (cancelled) return;
      setEngineCss(RELAY_CSS);
      el.innerHTML = RELAY_MARKUP;
      /* THE ONE BOUNDARY WHERE THE TRANSLATOR CROSSES INTO THE IMPERATIVE ENGINE.
         `dict/engine.ts` recorded the engine's copy as unreachable because raw-DOM
         functions cannot call a hook — true, and they do not have to: this component
         already holds `t`, so it hands it over. The applier is kept on a ref so the
         language-change effect below can re-run it without a second import and
         without racing this one. See `applyEngineLabels` in lib/relayAssets.ts. */
      applyLabelsRef.current = applyEngineLabels;
      applyEngineLabels(el, tAnyRef.current);
      handle = startRelay(el);
      /* AFTER startRelay, deliberately: the engine wires its own relabel hook
         inside that call, and setEngineTranslator invokes it. Handing the
         translator over earlier would relabel nothing. */
      setEngineTranslatorRef.current = setEngineTranslator;
      setEngineTranslator(tAnyRef.current);
      /* QW-11: register the per-contact ringtone resolver. It reads `ringtoneMapRef`
         lazily, so the map effect above can keep it current without re-registering. */
      setContactRingtoneResolverRef.current = setContactRingtoneResolver;
      setContactRingtoneResolver((from: string) => ringtoneMapRef.current.get(from) ?? null);
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
      // QW-11: drop the ringtone resolver so a torn-down engine leaves no dangling ref.
      setContactRingtoneResolverRef.current?.(null);
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
    //
    // MEASURED IN THE SAME UNIT AS THE POINTER (v2.106.86). `e.clientX/Y` are layout
    // pixels, which the text-size `zoom` has already scaled; `window.innerWidth/Height`
    // are NOT — they stay in unzoomed device-independent px whatever the scale. Mixing
    // them let the mini call window be dragged ~15% past the edge at the Large text
    // size, which on that surface can carry the hang-up button off screen.
    // `documentElement.clientWidth/Height` are in the pointer's own unit, so the clamp
    // needs no knowledge of the zoom at all — correct by construction rather than by a
    // conversion somebody has to remember.
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const nx = Math.min(0, Math.max(-(vw - 120), d.baseX + (e.clientX - d.startX)));
    const ny = Math.min(0, Math.max(-(vh - 160), d.baseY + (e.clientY - d.startY)));
    setMiniPos({ x: nx, y: ny });
  };
  const onMiniDragEnd = () => { dragRef.current = null; };

  // The mini box geometry — applied inline (beats the base `.relay-root{inset:0}`
  // rule without needing !important, since inline styles win over class rules).
  //
  // DELIBERATELY PHYSICAL (`right`/`left`), not `insetInlineEnd`. This is a floating
  // window the user drags anywhere, so its resting corner is a physical screen
  // position rather than a reading-order statement — and the clamp above is
  // arithmetic written FOR a right anchor: `x` runs from 0 (at the right edge)
  // down to `-(vw - 120)`. Flip the anchor without flipping that arithmetic and the
  // box can be dragged straight off the screen in Arabic and never dragged back.
  // When bubbled, the engine host collapses to a 1x1 invisible sliver pinned at the
  // bubble's resting corner — media keeps flowing (a strictly-0 size can pause video
  // decoding on some engines) but nothing is seen; the bubble below is what shows.
  const bubbleEngineStyle: React.CSSProperties = {
    position: "fixed",
    inset: "auto",
    right: 20,
    bottom: 150,
    top: "auto",
    left: "auto",
    width: 1,
    height: 1,
    transform: `translate(${miniPos.x}px, ${miniPos.y}px)`,
    opacity: 0,
    pointerEvents: "none",
    overflow: "hidden",
    zIndex: 1,
  };

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
    minimizeCall: () => { if (phase !== "idle") setMinimized(true); },
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
        style={active && bubbled ? bubbleEngineStyle : active && minimized ? miniBoxStyle : undefined}
        className={
          "relay-root relay-embedded " +
          (fitContain ? "relay-fit " : "") +
          (!active
            /* `-start-`, NOT `-left-`, and this one is a correctness fix rather than
               tidiness. The scrollable overflow region never extends past a scroll
               container's INLINE-START edge, so parking the idle host off that edge
               costs nothing — but `left` is the inline-START edge only in LTR. In
               Arabic `left` is the inline-END side, where 10,000px of an off-screen
               box IS reachable, i.e. a horizontal scrollbar on every screen the
               provider renders on. The logical form is byte-identical in English and
               parks off the correct edge in Arabic. */
            ? "absolute -start-[10000px] top-0 size-px overflow-hidden pointer-events-none opacity-0"
            : minimized
              ? "relay-minimized"
              : "fixed inset-0 z-40")
        }
        data-relay-engine-root="true"
      />
      {/* Fullscreen in-call controls: the three size states, parked at the TOP-RIGHT
          of the frame after the timer (v2.107.67, owner). Order is Fit → Minimize →
          Bubble, matching the engine's own state ladder: FIT toggles letterbox↔cover,
          MINIMIZE drops to the draggable mini-box, BUBBLE clips to the tiniest bubble.
          v2.107.51 had parked the cluster BELOW the header because a CENTRED cluster
          collided with the timer/lock; right-aligned (`end-3`) it sits clear of the
          `.ct` chip, which is on the opposite (start) edge. Hidden while minimized
          (the mini box has its own controls) and pre-connect. */}
      {phase === "in-call" && !minimized ? (
        <div className="fixed top-3 end-3 z-[70] flex gap-2">
          <button
            type="button"
            onClick={() => setFitContain((v) => !v)}
            className={
              "inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur-md active:scale-95 transition-transform " +
              /* `.rcta`, not the presence green. Fit-to-frame being ON is a STATE of a
                 control, and green in this app means ONLINE — it is what every presence
                 LED is drawn with, which is why v2.99.86 moved DND off it, v2.106.9 the
                 speaking tile and v2.106.11 the push banner. The recipe carries only
                 colour and shadow, so the pill's own geometry is untouched. */
              (fitContain ? "rcta" : "bg-black/60 text-white hover:bg-black/75")
            }
            aria-label={t("engine.fitLabel")}
            title={fitContain ? t("engine.fitOnHint") : t("engine.fitOffHint")}
          >
            <Scan className="size-4" /> {t("engine.fit")}
          </button>
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur-md hover:bg-black/75 active:scale-95 transition-transform"
            aria-label={t("engine.minimizeLabel")}
            title={t("engine.minimizeHint")}
          >
            <Minimize2 className="size-4" /> {t("engine.minimize")}
          </button>
          <button
            type="button"
            onClick={() => setBubbled(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur-md hover:bg-black/75 active:scale-95 transition-transform"
            aria-label={t("engine.bubbleLabel")}
            title={t("engine.bubbleHint")}
          >
            <Shrink className="size-4" /> {t("engine.bubble")}
          </button>
        </div>
      ) : null}
      {/* Minimized mini-box overlay (v2.99.8): a draggable header with the live
          people-count + Maximize + Hang up, laid exactly over the engine box.
          Hidden while bubbled — the bubble replaces it. */}
      {active && minimized && !bubbled ? (
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
            {/* `ms-auto`: this pins the two controls to the row's TRAILING edge, which
                is reading-order and must swap sides in Arabic. */}
            <span className="ms-auto flex items-center gap-1">
              {/* v2.107.47 (owner): collapse the mini-box further, down to a tiny
                  floating bubble that frees the whole screen. */}
              <button
                type="button"
                onClick={() => setBubbled(true)}
                className="grid size-7 place-items-center rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 transition-transform"
                aria-label={t("engine.bubbleLabel")}
                title={t("engine.bubble")}
              >
                <ChevronDown className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setMinimized(false)}
                className="grid size-7 place-items-center rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 transition-transform"
                aria-label={t("engine.maximizeLabel")}
                title={t("engine.maximize")}
              >
                <Maximize2 className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => handleRef.current?.hangup()}
                className="grid size-7 place-items-center rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 active:scale-95 transition-transform"
                aria-label={t("engine.endCall")}
                title={t("engine.endCall")}
              >
                <PhoneOff className="size-4" />
              </button>
            </span>
          </div>
          {/* The rest of the box is the engine's video grid, showing through. */}
          <div className="flex-1" />
        </div>
      ) : null}
      {/* Floating call BUBBLE (v2.107.47, owner) — the tiniest live-call state: a
          ~60px draggable dot that frees the whole screen while the call stays fully
          live. Drag to reposition (same handlers/clamp as the mini-box); tap the
          body to restore the mini-box; a small hang-up sits at its corner. The
          engine host is a 1px invisible sliver behind this, so media keeps flowing. */}
      {active && bubbled ? (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 150,
            top: "auto",
            left: "auto",
            transform: `translate(${miniPos.x}px, ${miniPos.y}px)`,
            zIndex: 60,
            touchAction: "none",
          }}
          className="pointer-events-auto"
        >
          <button
            type="button"
            onPointerDown={onMiniDragStart}
            onPointerMove={onMiniDragMove}
            onPointerUp={onMiniDragEnd}
            onClick={() => { if (!dragRef.current) setBubbled(false); }}
            aria-label={t("engine.restoreCall")}
            title={t("engine.restoreCall")}
            className="relative grid size-14 cursor-grab place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_16px_40px_-10px_rgba(0,0,0,.7)] ring-2 ring-primary/40 active:cursor-grabbing active:scale-95 transition-transform"
          >
            {/* a soft live pulse */}
            <span className="absolute inset-0 rounded-full bg-primary/40 motion-safe:animate-ping" />
            <span className="relative flex items-center gap-1 text-sm font-bold">
              <Phone className="size-4" />
              {peopleCount > 1 ? peopleCount : ""}
            </span>
          </button>
          {/* corner hang-up */}
          <button
            type="button"
            onClick={() => handleRef.current?.hangup()}
            aria-label={t("engine.endCall")}
            title={t("engine.endCall")}
            className="absolute -top-1 -end-1 grid size-6 place-items-center rounded-full bg-destructive text-destructive-foreground shadow-md ring-2 ring-card active:scale-95 transition-transform"
          >
            <PhoneOff className="size-3" />
          </button>
        </div>
      ) : null}
      {/* v2.99.82 (owner): the top-left in-call "add contacts" chip is UNMOUNTED.
          Owner: "add contact ... currently you're putting on the profile, on the
          video, and also you put it on the top left. Just put it one place. Under
          the name of each user."

          The per-tile pill under each name is that one place, and NOTHING is lost
          — three things improve. The chip only ever offered the FIRST unsaved peer
          (a `roster.find`), while the pill is per-peer. It polled every 3s. And it
          derived a SECOND saved-set from contacts.list that could disagree with the
          engine's own — two copies of one fact, the class of bug this repo keeps
          re-learning. It also sat at top-3 left-3, overlapping the "connecting…"
          and on-hold badges, which live at the same corner. */}
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
          aria-label={t("engine.reconnectingLabel")}
        >
          <div className="flex flex-col items-center gap-3">
            {/* Accent, not the presence green: a spinner reports that WE are working, not
                that anybody is online — and this one spins precisely while the connection
                is in doubt, which is when a green would be at its most misleading. */}
            <Loader2 className="size-10 animate-spin text-primary" />
            <div className="text-lg font-semibold text-white">{t("engine.reconnecting")}</div>
            <div className="max-w-xs text-sm text-white/70">{t("engine.reconnectingBody")}</div>
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
            {t("engine.exitCall")}
          </button>
        </div>
      ) : null}
      {/* Live-call rejoin (v2.99.9): the HOST is asked to approve someone who
          was in this call and wants back in (from their History → Join). */}
      {knockReq ? (
        <div
          /* `inset-x-0` + `mx-auto` is SYMMETRIC centring — both physical insets are 0,
             so it reads identically in either direction and needs no logical form. */
          className="fixed inset-x-0 top-4 z-[85] mx-auto flex w-[min(360px,92vw)] items-center gap-3 rounded-2xl border border-amber-400/40 bg-card/95 p-3 shadow-2xl backdrop-blur-md"
          role="alertdialog"
          aria-label={t("engine.knockLabel")}
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-amber-400/15 text-amber-500 font-bold">
            {(knockReq.name || "?").slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">
              {knockReq.name || t("engine.knockSomeone")}
            </div>
            <div className="text-xs text-muted-foreground">{t("engine.knockWants")}</div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => { handleRef.current?.approveKnock(knockReq.roomId, knockReq.pin); setKnockReq(null); }}
              /* BOARD 5b, and its two halves used to disagree about green: History's own
                 LiveRejoinCard carries a comment citing rule 3 as the reason IT moved off
                 the presence green, and this — the other end of the same knock — kept it
                 on a CTA. `.rcta` is the shared primary recipe, so the two ends now read
                 as one feature. */
              className="rcta rounded-lg px-3 py-1.5 text-xs font-semibold active:scale-95 transition-transform"
            >
              {t("engine.approve")}
            </button>
            <button
              type="button"
              onClick={() => { handleRef.current?.denyKnock(knockReq.roomId, knockReq.pin); setKnockReq(null); }}
              className="rounded-lg bg-muted px-3 py-1.5 text-xs font-semibold text-foreground active:scale-95 transition-transform"
            >
              {t("engine.decline")}
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
 *
 * IT IS NOT MOUNTED — v2.99.82 removed the mount at the owner's request ("just put it
 * one place. Under the name of each user"), and two existing tests assert the element
 * is absent (`callTileIdentity`, `peerIdentityBatch`). Its `aria-label`/`title` are
 * therefore the ONE place in this file still holding English literals, and that is a
 * decision rather than an oversight: the strings reach no screen, so translating them
 * would publish dictionary keys whose only reader is dead code — while breaking a pin
 * that freezes the exact template literal. `engineLocale.test.ts` exempts this function
 * BY NAME and asserts the exemption is EARNED by re-checking that it is still unmounted,
 * so if it is ever mounted again the sweep goes red and the strings get translated then.
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
      /* Accent, not the presence green: saving somebody to your contacts is an ACTION,
         and this button sits on a call screen that draws real presence elsewhere. */
      className="fixed top-3 start-3 z-[70] grid size-10 place-items-center rounded-full bg-black/60 text-primary shadow-lg backdrop-blur-md hover:bg-black/75 active:scale-95 transition-transform outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
      aria-label={`Save ${candidate.name || candidate.pin} to contacts`}
      title={`Save ${candidate.name || candidate.pin} to contacts`}
    >
      <UserPlus className="size-[18px]" />
    </button>
  );
}
