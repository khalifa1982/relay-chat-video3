/**
 * NATIVE-APP CRASH REPORTER (v2.107.x) — the React Native half of RELAY's crash
 * telemetry. Reports land at the SAME https://your-chat.io/api/crash the web
 * app and the Capacitor shells use, tagged platform "ios-native" /
 * "android-native" so the admin crash console tells the surfaces apart.
 *
 * ── THE FATAL PROBLEM, AND WHY PERSIST-THEN-SEND-NEXT-LAUNCH ──────────────────
 * When a JS fatal happens in release RN the app is about to die; a network call
 * started in that moment races process teardown and usually loses. So a fatal is
 * written to AsyncStorage FIRST — a couple of ms, reliably completes — and the
 * queue is flushed on the NEXT app start. Non-fatals and rejections flush
 * immediately (the app is still alive). Same "any HTTP response = delivered"
 * contract as the web reporter: the server answers 204 to everything, so
 * nothing here can retry-loop.
 *
 * ErrorUtils is CHAINED, never replaced: RN's own handler (dev redbox, release
 * teardown) still runs after ours, so the app's crash BEHAVIOUR is unchanged —
 * this only adds the record.
 */
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
// The native app's own version — package.json is the single source (bumped per
// native release), the same "baked at build" idea as the web bundle's
// APP_VERSION, so the console's per-version history works for these builds too.
import { version as NATIVE_VERSION } from "../../package.json";

const ENDPOINT = "https://your-chat.io/api/crash";
const QUEUE_KEY = "relay_crash_queue_v1";
const QUEUE_MAX = 10;

type Rn = { name: string; message: string; stack: string; fatal: boolean; at: number };

const bootAt = Date.now();
const sessionId = `rn-${bootAt.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let installed = false;

function toErr(v: unknown): { name: string; message: string; stack: string } {
  const e = v instanceof Error ? v : new Error(String(v));
  return {
    name: (e.name || "Error").slice(0, 128),
    message: (e.message || "").slice(0, 4000),
    stack: (e.stack || "").slice(0, 30000),
  };
}

async function readQueue(): Promise<Rn[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const q = raw ? (JSON.parse(raw) as Rn[]) : [];
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

async function writeQueue(q: Rn[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX)));
  } catch {
    /* storage full — the in-flight send still happens */
  }
}

function bodyFor(r: Rn): string {
  return JSON.stringify({
    platform: `${Platform.OS}-native`,
    appVersion: String(NATIVE_VERSION),
    errorName: r.name,
    errorMessage: r.message,
    stack: r.stack,
    device: JSON.stringify({ os: Platform.OS, osVersion: String(Platform.Version), fatal: r.fatal }),
    sessionId,
  });
}

async function send(r: Rn): Promise<boolean> {
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyFor(r),
    });
    return true; // any response = delivered (server always answers 204)
  } catch {
    return false; // offline — keep queued for next launch
  }
}

let flushing = false;
async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    let q = await readQueue();
    while (q.length > 0) {
      if (!(await send(q[0]))) break;
      q = q.slice(1);
      await writeQueue(q);
    }
  } catch {
    /* never throw from the reporter */
  } finally {
    flushing = false;
  }
}

async function record(v: unknown, fatal: boolean): Promise<void> {
  try {
    const r: Rn = { ...toErr(v), fatal, at: Date.now() };
    const q = await readQueue();
    q.push(r);
    await writeQueue(q); // persisted FIRST — survives the teardown a fatal races
    if (!fatal) void flush();
  } catch {
    /* never throw */
  }
}

/** Install once, first thing in index.js — before the app registers, so even a
 *  crash in the first render is recorded. */
export function initNativeCrashReporter(): void {
  if (installed) return;
  installed = true;
  try {
    void flush(); // anything a previous (crashed) run persisted but never sent

    type EU = {
      getGlobalHandler?: () => (e: unknown, isFatal?: boolean) => void;
      setGlobalHandler?: (h: (e: unknown, isFatal?: boolean) => void) => void;
    };
    const eu = (globalThis as { ErrorUtils?: EU }).ErrorUtils;
    const prev = eu?.getGlobalHandler?.();
    eu?.setGlobalHandler?.((e, isFatal) => {
      void record(e, !!isFatal);
      prev?.(e, isFatal); // RN's own behaviour (redbox / teardown) is untouched
    });

    // Hermes fires the standard event for unhandled promise rejections.
    const g = globalThis as unknown as {
      addEventListener?: (t: string, cb: (ev: { reason?: unknown }) => void) => void;
    };
    g.addEventListener?.("unhandledrejection", (ev) => {
      void record(ev?.reason ?? "unhandledrejection", false);
    });
  } catch {
    /* a broken reporter must never break the app */
  }
}
