/**
 * Browser/desktop notifications layer for incoming SMS and calls.
 *
 * Why this is its own module instead of inline in useRealtime:
 *   - The Profile page also needs read/write access to permission state
 *     so the user can grant access from a clear UI.
 *   - Both `useRealtime` and `Relay` (existing call screen) want to fire
 *     notifications.
 *   - We want a single guard for "tab is currently focused on this
 *     conversation" so we don't spam a notification while the user is
 *     literally typing in the thread.
 *
 * Design notes:
 *   - We never *ask* for Notification permission on page load. That
 *     triggers a browser permission prompt which is universally hated
 *     and ignored. We only call `Notification.requestPermission()` from
 *     a click handler in Profile (a positive user gesture).
 *   - Sound is best-effort. Browsers block autoplay until the user has
 *     interacted with the page; a freshly-loaded inactive tab will play
 *     silently. The visual notification still fires.
 */

export type NotifPermission = "granted" | "denied" | "default" | "unsupported";

export function getNotifPermission(): NotifPermission {
  if (typeof window === "undefined") return "unsupported";
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/**
 * Request notification permission. Must be called from a user gesture
 * (e.g. an onClick handler). Returns the resulting permission state.
 */
export async function requestNotifPermission(): Promise<NotifPermission> {
  if (typeof window === "undefined") return "unsupported";
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return Notification.permission;
  }
}

/* --------------------------------------------------------------- *
 * Audio cues. Generated at runtime via the WebAudio API so we don't
 * need to ship binary asset files. Two distinct timbres so the user
 * can tell a call from a text without looking.
 * --------------------------------------------------------------- */

let audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    (window as unknown as { AudioContext?: typeof AudioContext })
      .AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) {
    try {
      audioCtx = new Ctor();
    } catch {
      audioCtx = null;
    }
  }
  return audioCtx;
}

function tone(freq: number, durationMs: number, gain = 0.08): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  // Browsers suspend the context until a user gesture. Resume is a
  // no-op if the context is already running, and silently fails if
  // there hasn't been a gesture yet — that's fine.
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});

  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  // small attack/release so it doesn't click
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + durationMs / 1000 + 0.02);
}

/** Two-note rising chime, ~250ms total. Used for incoming SMS. */
export function playMessageChime(): void {
  tone(660, 90);
  setTimeout(() => tone(880, 140), 100);
}

/** Three-note urgent ring pattern, ~700ms. Used for incoming call. */
export function playCallRing(): void {
  tone(523, 140, 0.1); // C5
  setTimeout(() => tone(659, 140, 0.1), 170); // E5
  setTimeout(() => tone(523, 220, 0.1), 340); // C5 again
}

/* --------------------------------------------------------------- *
 * System notifications.
 * --------------------------------------------------------------- */

interface NotifyOpts {
  title: string;
  body?: string;
  /** A stable tag — repeat calls with the same tag stack rather than spam. */
  tag?: string;
  /** Optional URL to fetch as the notification icon. */
  icon?: string;
  /** Called when the user clicks the notification. */
  onClick?: () => void;
  /** Auto-close after this many ms. Default 6000. Pass 0 to keep open. */
  autoCloseMs?: number;
}

/**
 * Show a system notification. Returns true if the notification was
 * actually shown (permission granted, supported, document hidden or
 * configured to always show). Returns false if it was suppressed.
 *
 * We deliberately suppress notifications when the page is currently
 * visible — that's an Apple-style behavior and prevents double-feedback
 * (the in-app UI already updates).
 */
export function notify(opts: NotifyOpts): boolean {
  if (typeof window === "undefined") return false;
  if (typeof Notification === "undefined") return false;
  if (Notification.permission !== "granted") return false;
  // Only fire if the page is actually backgrounded — otherwise the
  // in-app UI is enough.
  if (typeof document !== "undefined" && document.visibilityState === "visible") {
    return false;
  }
  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      tag: opts.tag,
      icon: opts.icon,
      // mobile Chrome supports vibrate; harmless on desktop
      // @ts-expect-error — vibrate not in lib.dom.d.ts NotificationOptions
      vibrate: [80, 40, 80],
    });
    if (opts.onClick) {
      n.onclick = (event) => {
        event.preventDefault();
        try {
          window.focus();
        } catch {
          /* ignore */
        }
        opts.onClick!();
        try {
          n.close();
        } catch {
          /* ignore */
        }
      };
    }
    const ttl = opts.autoCloseMs ?? 6000;
    if (ttl > 0) {
      setTimeout(() => {
        try {
          n.close();
        } catch {
          /* ignore */
        }
      }, ttl);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * "Wake" the audio context with a one-shot silent tone so subsequent
 * call/message sounds can play without the autoplay policy blocking
 * them. Should be called from a user-gesture handler (e.g. when the
 * user grants notification permission, or starts a call).
 */
export function unlockAudio(): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  // 10ms silent tone — counts as the gesture-driven first play.
  tone(440, 10, 0.0001);
}
