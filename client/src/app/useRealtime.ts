/**
 * useRealtime — subscribes to the server's SSE push channel and invalidates
 * the right tRPC queries when events arrive. The SSE channel is a hint, not
 * authoritative; polling (every 2-4s in Messages) is still the safety net.
 */
import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { notify, playCallRing, playMessageChime } from "./notifications";

type V2Event =
  | { kind: "message"; conversationId: number; from: number }
  | { kind: "read"; conversationId: number; reader: number }
  | { kind: "presence"; number: string; online: boolean; lastSeenAt: string }
  | { kind: "contact"; from: number }
  | {
      kind: "call_offer";
      fromNumber: string;
      fromName: string;
      roomId: string;
    }
  | { kind: "ping" };

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

    const connect = () => {
      if (closed) return;
      try {
        es = new EventSource("/api/v2/events", { withCredentials: true });
      } catch {
        return;
      }

      es.onopen = () => {
        backoff = 1000; // reset
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
          case "message":
            // refresh threads list + the affected conversation
            utils.messages.threads.invalidate().catch(() => {});
            utils.messages.list
              .invalidate({ conversationId: payload.conversationId })
              .catch(() => {});
            // Skip the chime/notification for our OWN messages (the event is
            // fanned to the sender too). notify() already suppresses when the
            // tab is visible; gate the chime the same way so we don't beep
            // while the user is reading the thread.
            if (shouldAlertForMessage(payload.from, selfId)) {
              if (typeof document === "undefined" || document.hidden) {
                playMessageChime();
              }
              notify({
                title: "New message",
                body: "You have a new RELAY message.",
                tag: `relay-msg-${payload.conversationId}`,
                onClick: () => {
                  if (typeof window !== "undefined") {
                    window.location.href = `/app/messages/${payload.conversationId}`;
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
              autoCloseMs: 25_000,
              onClick: () => {
                if (typeof window !== "undefined") {
                  window.location.href = `/app/dialer?incoming=${payload.fromNumber}`;
                }
              },
            });
            // Also poke the call history list so it appears.
            utils.calls.history.invalidate().catch(() => {});
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
            utils.directory.lookup.invalidate().catch(() => {});
            break;
          case "contact":
            utils.contacts.list.invalidate().catch(() => {});
            break;
        }
      };

      es.onerror = () => {
        es?.close();
        es = null;
        if (closed) return;
        // capped exponential backoff
        const wait = Math.min(backoff, 15_000);
        backoff = Math.min(backoff * 2, 15_000);
        setTimeout(connect, wait);
      };
    };

    connect();

    return () => {
      closed = true;
      es?.close();
      es = null;
    };
    // utils is stable from trpc; enabled toggles re-subscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
