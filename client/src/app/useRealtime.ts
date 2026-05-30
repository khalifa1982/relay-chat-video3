/**
 * useRealtime — subscribes to the server's SSE push channel and invalidates
 * the right tRPC queries when events arrive. The SSE channel is a hint, not
 * authoritative; polling (every 2-4s in Messages) is still the safety net.
 */
import { useEffect } from "react";
import { trpc } from "@/lib/trpc";

type V2Event =
  | { kind: "message"; conversationId: number; from: number }
  | { kind: "read"; conversationId: number; reader: number }
  | { kind: "presence"; number: string; online: boolean; lastSeenAt: string }
  | { kind: "contact"; from: number }
  | { kind: "ping" };

export function useRealtime(enabled: boolean): void {
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
