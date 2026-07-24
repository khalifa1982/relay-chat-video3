/**
 * useRealtime — subscribes to the server's SSE push channel and invalidates
 * the right tRPC queries when events arrive. The SSE channel is a hint, not
 * authoritative; polling (every 2-4s in Messages) is still the safety net.
 */
import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { markDialIntent } from "@/lib/bootUrl";
import { notify, playCallRing, playMessageChime } from "./notifications";
import { isThreadMuted } from "./mutedThreads";
import { setTyping, clearTyping } from "./typingStore";
import { pushMessagePopup, isViewingConversation } from "./messagePopups";

type V2Event =
  | { kind: "message"; conversationId: number; from: number }
  | { kind: "typing"; conversationId: number; from: number }
  | { kind: "read"; conversationId: number; reader: number }
  | { kind: "presence"; number: string; online: boolean; lastSeenAt: string }
  | { kind: "contact"; from: number }
  | {
      kind: "call_offer";
      fromNumber: string;
      fromName: string;
      roomId: string;
    }
  /** Call-back alert (v2.88): a number the user watched is back online. */
  | { kind: "watched_online"; number: string; name: string }
  /** Status realtime (v2.96): someone in your feed posted/removed a status. */
  | { kind: "status"; number: string; name: string; removed?: boolean }
  /** New-device approval (v2.99.7): a new sign-in on this account is waiting. */
  | { kind: "device_pending"; sid: string; label: string }
  | { kind: "ping" };

/* ── SSE-gated poll demotion (v2.88) ─────────────────────────────
 * While the SSE channel is UP, the aggressive 2-4s polling in Messages /
 * Dialer is pure waste — SSE events already invalidate those exact queries.
 * This module-level flag lets any query use a CALLBACK refetchInterval that
 * polls slowly while SSE is healthy and falls back to fast polling the moment
 * the stream drops. Polling stays as the documented safety net either way. */
let sseConnected = false;

/** True while the realtime SSE stream is open (module-level — one stream per app). */
export function isSseConnected(): boolean {
  return sseConnected;
}

/** Internal/test setter — flipped by the hook's onopen/onerror handlers. */
export function _setSseConnected(v: boolean): void {
  sseConnected = v;
}

/**
 * Build a React Query `refetchInterval` callback that polls at `demotedMs`
 * while the SSE channel is connected and at `fastMs` when it isn't.
 * Pure factory — unit-tested without a DOM.
 */
export function demotablePollInterval(fastMs: number, demotedMs: number): () => number {
  return () => (sseConnected ? demotedMs : fastMs);
}

/**
 * Whether an inbound `message` SSE event should raise a chime / notification.
 * The server fans the `message` event out to ALL participants *including the
 * sender* (so the sender's other tabs stay in sync), so we must NOT alert for
 * our own outgoing messages — otherwise every message you send beeps at you
 * (and pops a "New message" notification on a backgrounded tab).
 */
export function shouldAlertForMessage(
  from: number,
  selfId: number | null | undefined,
): boolean {
  if (selfId == null) return true; // identity not known yet — fail open
  return from !== selfId;
}

export function useRealtime(enabled: boolean, selfId?: number | null): void {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    let closed = false;
    let es: EventSource | null = null;
    let backoff = 1000;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    // Tracks whether this is a RECONNECT (vs the initial connect): while the SSE
    // channel was down, a missed call could have happened and arrived with no
    // event to react to (there's no SSE channel to deliver it on). Refresh the
    // missed-call/history state on reconnect so it doesn't go stale.
    let wasConnected = false;

    const connect = () => {
      if (closed) return;
      try {
        es = new EventSource("/api/v2/events", { withCredentials: true });
      } catch {
        return;
      }

      es.onopen = () => {
        backoff = 1000; // reset
        _setSseConnected(true); // demote the fast polls — SSE now carries hints
        if (wasConnected) {
          // Anything could have changed while the stream was down (the demoted
          // polls are slow) — refetch the hint-driven queries immediately.
          utils.calls.missedSummary.invalidate().catch(() => {});
          utils.calls.history.invalidate().catch(() => {});
          utils.messages.threads.invalidate().catch(() => {});
          utils.messages.list.invalidate().catch(() => {});
        }
        wasConnected = true;
      };

      es.onmessage = (ev) => {
        let payload: V2Event | null = null;
        try {
          payload = JSON.parse(ev.data) as V2Event;
        } catch {
          return;
        }
        if (!payload || payload.kind === "ping") return;
        switch (payload.kind) {
          case "typing":
            // Someone is typing — surface it; their actual message will clear it.
            setTyping(payload.conversationId, payload.from);
            break;
          case "message":
            // A real message arrived → they've stopped typing.
            clearTyping(payload.conversationId, payload.from);
            // refresh threads list + the affected conversation
            utils.messages.threads.invalidate().catch(() => {});
            utils.messages.list
              .invalidate({ conversationId: payload.conversationId })
              .catch(() => {});
            // Skip the chime/notification for our OWN messages (the event is
            // fanned to the sender too). notify() already suppresses when the
            // tab is visible; gate the chime the same way so we don't beep
            // while the user is reading the thread.
            if (
              shouldAlertForMessage(payload.from, selfId) &&
              !isThreadMuted(payload.conversationId)
            ) {
              if (typeof document === "undefined" || document.visibilityState !== "visible") {
                playMessageChime();
              }
              // In-app popup with the message content + inline reply — unless the
              // user is already looking at that conversation.
              if (!isViewingConversation(payload.conversationId)) {
                pushMessagePopup(payload.conversationId, payload.from);
              }
              notify({
                title: "New message",
                body: "You have a new RELAY message.",
                tag: `relay-msg-${payload.conversationId}`,
                url: `/app/messages?c=${payload.conversationId}`,
                onClick: () => {
                  if (typeof window !== "undefined") {
                    // Route via the ?c= query the app actually reads — the old
                    // /app/messages/<id> path 404'd, making the notification dead.
                    window.location.href = `/app/messages?c=${payload.conversationId}`;
                  }
                },
              });
            }
            break;
          case "call_offer":
            // Best-effort — if the user is on the call screen the
            // existing relay socket already handles the ring; this
            // covers all other tabs.
            playCallRing();
            notify({
              title: `Incoming call from ${payload.fromName || payload.fromNumber}`,
              body: `RELAY · ${payload.fromNumber}`,
              tag: `relay-call-${payload.roomId}`,
              url: `/app/dialer?incoming=${payload.fromNumber}`,
              autoCloseMs: 25_000,
              onClick: () => {
                if (typeof window !== "undefined") {
                  window.location.href = `/app/dialer?incoming=${payload.fromNumber}`;
                }
              },
            });
            // Also poke the call history list + missed-call badge so they stay
            // fresh (the badge otherwise only refreshes on its own 20s poll).
            utils.calls.history.invalidate().catch(() => {});
            utils.calls.missedSummary.invalidate().catch(() => {});
            break;
          case "read":
            utils.messages.list
              .invalidate({ conversationId: payload.conversationId })
              .catch(() => {});
            utils.messages.threads.invalidate().catch(() => {});
            break;
          case "presence":
            // contacts / threads both render presence dots
            utils.contacts.list.invalidate().catch(() => {});
            utils.messages.threads.invalidate().catch(() => {});
            // Scope to the number that changed — invalidating the whole
            // directory.lookup namespace defeated the Add-Contact preview's
            // staleTime and refetched on every stranger's heartbeat.
            utils.directory.lookup.invalidate({ number: payload.number }).catch(() => {});
            // History LEDs read directory.presenceMany and the profile popup /
            // batch reads use directory.presence — BOTH were previously left out
            // of the SSE presence handler, so those surfaces only updated on
            // their own 30s poll (and History pauses polling in the background).
            // That made the SAME user show online here and offline there. Fan
            // the presence event out to them too so every surface agrees (v2.99.3).
            utils.directory.presenceMany.invalidate().catch(() => {});
            utils.directory.presence.invalidate().catch(() => {});
            break;
          case "contact":
            utils.contacts.list.invalidate().catch(() => {});
            break;
          case "device_pending": {
            // New-device approval (v2.99.7): a new sign-in on this account is
            // waiting — refresh the notification center's pending list and
            // raise a toast with a jump to the Devices approval UI.
            utils.otpAuth.pendingSessions.invalidate().catch(() => {});
            void import("sonner")
              .then(({ toast }) =>
                toast(`New device wants to sign in`, {
                  description: `${payload.label} is waiting for your approval.`,
                  action: {
                    label: "Review",
                    onClick: () => {
                      if (typeof window !== "undefined") window.location.href = "/app/profile#devices";
                    },
                  },
                })
              )
              .catch(() => {});
            break;
          }
          case "watched_online": {
            // Call-back alert (v2.88): the user explicitly asked to be told.
            const who = payload.name || payload.number;
            const dialUrl = `/app/dialer?to=${payload.number}&voice=1`;
            notify({
              title: `${who} is back online`,
              body: "You asked to be told — tap to call them now.",
              tag: `relay-online-${payload.number}`,
              url: dialUrl,
              onClick: () => {
                if (typeof window !== "undefined") {
                  // M48: this is a full document load, so mark it as OUR
                  // navigation — the user armed this alert and tapped it, so it
                  // should still connect in one tap. An attacker's link cannot
                  // set this (sessionStorage is same-origin and per-tab).
                  markDialIntent(payload.number);
                  window.location.href = dialUrl;
                }
              },
            });
            // In-app toast with a one-tap call action (lazy import keeps this
            // hook dependency-light for tests).
            void import("sonner").then(({ toast }) =>
              toast.success(`${who} is back online`, {
                action: {
                  label: "Call",
                  onClick: () => {
                    // v2.99.48: mark the intent here too. This is the SAME armed
                    // one-tap call as the notification branch above, but only
                    // that one marked it — so tapping Call on the toast landed on
                    // a prefilled pad and needed a second tap, silently losing
                    // the promise of the feature.
                    markDialIntent(payload.number);
                    if (typeof window !== "undefined") window.location.href = dialUrl;
                  },
                },
              })
            ).catch(() => {});
            // Their presence LEDs are stale by definition — refresh them.
            utils.contacts.list.invalidate().catch(() => {});
            utils.directory.lookup.invalidate({ number: payload.number }).catch(() => {});
            break;
          }
          case "status": {
            // Status realtime (v2.96): refresh the feed so rings/strip update
            // instantly everywhere; a QUIET toast (no sound, no notification)
            // announces a new post — removal just refreshes.
            utils.status.feed.invalidate().catch(() => {});
            if (!payload.removed) {
              const who = payload.name || payload.number;
              void import("sonner")
                .then(({ toast }) =>
                  toast(`${who} posted a status`, {
                    description: "Tap to view it now.",
                    action: {
                      label: "View",
                      onClick: () => {
                        // Deep-open the global status viewer from anywhere.
                        window.dispatchEvent(
                          new CustomEvent("relay:open-status", {
                            detail: { number: payload.number },
                          })
                        );
                      },
                    },
                  })
                )
                .catch(() => {});
            }
            break;
          }
        }
      };

      es.onerror = () => {
        es?.close();
        es = null;
        _setSseConnected(false); // re-promote fast polling until we reconnect
        // NOTE: `wasConnected` is intentionally NOT reset here. It tracks "has
        // this hook EVER connected before" — staying true once set lets the
        // NEXT onopen (the actual reconnect) recognize itself as a recovery
        // and invalidate. Resetting it here would clear it right before every
        // reconnect's onopen checks it, making the invalidation never fire.
        if (closed) return;
        // capped exponential backoff
        const wait = Math.min(backoff, 15_000);
        backoff = Math.min(backoff * 2, 15_000);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, wait);
      };
    };

    connect();

    return () => {
      closed = true;
      _setSseConnected(false);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      es?.close();
      es = null;
    };
    // utils is stable from trpc; enabled toggles re-subscribe.
    // Bug fix: `onmessage` closes over `selfId` (used by shouldAlertForMessage
    // below) but this effect used to depend on [enabled] only — if the
    // resolved identity ever changed without `enabled` flipping, every
    // subsequent SSE message kept comparing against the STALE selfId. Adding
    // it here re-subscribes (a cheap, rare reconnect) so the closure is never
    // stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, selfId]);
}
