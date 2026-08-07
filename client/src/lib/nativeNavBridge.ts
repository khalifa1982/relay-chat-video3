/**
 * NATIVE → WEB deep-link navigation (v2.107.69, owner).
 *
 * A notification tap must land on the RIGHT screen — the call's history, or the
 * exact conversation — not the app's default tab. The Expo shell reads the push
 * `data.url` and used to do `window.location.href = url`, which HARD-RELOADS the
 * WebView: on a cold start the app re-boots, re-auths, and settles on the default
 * tab before (or instead of) honouring the deep path, so every tap read as "it
 * opened the main screen". Client-side routing has none of that — the router is
 * already live, so the move is instant and keeps the session, including an active
 * call.
 *
 * The shell now calls `window.__relayNavigate__(url)`. If the app has registered
 * its navigator the move happens immediately; if the app is still booting the
 * request is QUEUED and flushed the moment the navigator registers — which
 * removes the cold-start race entirely (there is no fixed timer to lose to). The
 * shell keeps a `location.href` fallback for a web app too old to define the hook.
 *
 * This mirrors `nativeCallBridge`'s two-channel shape (a global the shell can call
 * plus a `relay:navigate` CustomEvent), so a shell that dispatches events instead
 * of calling globals also works.
 */

type NavHandler = (path: string) => void;

let handler: NavHandler | null = null;
let queued: string | null = null;

/**
 * Turn whatever the shell passes into an in-app path, or null if it is not one.
 *
 * Accepts a full URL or a bare path and keeps only path+query+hash. It refuses
 * anything that is not a RELAY app route: a push must never be able to send the
 * router to another origin, and a `javascript:`/`data:` URL must never reach it.
 */
export function toAppPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let path = raw.trim();
  if (path === "") return null;
  if (/^https?:\/\//i.test(path)) {
    try {
      const u = new URL(path);
      path = u.pathname + u.search + u.hash;
    } catch {
      return null;
    }
  }
  // A scheme other than http(s) — javascript:, data:, app:// — is not a path.
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  if (!path.startsWith("/")) path = "/" + path;
  // Only ever route WITHIN the app's own surfaces.
  if (!/^\/(app|i\/|g\/)/.test(path)) return null;
  return path;
}

function dispatch(raw: unknown): void {
  const path = toAppPath(raw);
  if (!path) return;
  if (handler) {
    try {
      handler(path);
    } catch {
      /* a bad deep link must never crash the app */
    }
  } else {
    // App still booting — remember the LAST intent and flush it on register.
    queued = path;
  }
}

/**
 * Register the app's navigator (routing + any call-minimize). Called by the shell
 * once the router is live; flushes a nav that arrived while the app was booting.
 * Returns an unregister function for React cleanup.
 */
export function registerNavHandler(fn: NavHandler): () => void {
  handler = fn;
  if (queued != null) {
    const path = queued;
    queued = null;
    try {
      fn(path);
    } catch {
      /* never crash on a queued deep link */
    }
  }
  return () => {
    if (handler === fn) handler = null;
  };
}

/**
 * Install `window.__relayNavigate__` and the `relay:navigate` listener. Idempotent
 * and safe to call at module load; a second call just re-points the global at the
 * same dispatcher.
 */
export function installNativeNavBridge(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    __relayNavigate__?: (url: string) => void;
    __relayNavBridgeInstalled__?: boolean;
  };
  w.__relayNavigate__ = (url: string) => dispatch(url);
  if (w.__relayNavBridgeInstalled__) return; // add the listener exactly once
  w.__relayNavBridgeInstalled__ = true;
  window.addEventListener("relay:navigate", (e) => {
    dispatch((e as CustomEvent<{ url?: string }>).detail?.url);
  });
}

/** Test seam — reset module state between cases. Not used by the app. */
export function __resetNavBridgeForTest(): void {
  handler = null;
  queued = null;
}
