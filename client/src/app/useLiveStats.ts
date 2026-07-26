import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

/**
 * The five live network figures, pushed (v2.99.71).
 *
 * Owner: "while I'm seeing the page, if somebody logs in, it will automatically
 * update. No need for me to refresh the page."
 *
 * Both surfaces that show these numbers — the landing page and the sign-in screen —
 * use this one hook, so they can never drift apart in how fresh they are.
 *
 * THE FALLBACK IS THE POINT. `/api/stats/stream` is an SSE endpoint, and SSE is the
 * transport this whole app is built on precisely because the production gateway
 * passes it — but a corporate proxy that buffers `text/event-stream`, an offline tab,
 * or an instance mid-restart will all fail it. So the tRPC query still runs and still
 * polls; it just polls SLOWLY once the stream is proving itself, and quickly when it
 * is not. A visitor therefore always sees moving numbers, and never a blank strip
 * because a stream would not open.
 *
 * `null` means "no numbers yet" and callers render nothing rather than a wall of
 * zeros — `getPublicStats` answers zeros when the database is down, and five zeros on
 * the front page reads as a broken product.
 */
export type LiveStats = {
  registeredUsers: number;
  guestsServed: number;
  totalParties: number;
  messagesSent: number;
  onlineNow: number;
};

/** Poll cadence while the push stream is NOT carrying us. */
const FALLBACK_POLL_MS = 15_000;
/**
 * Poll cadence while it IS. Not zero, deliberately: a stream can go quiet without
 * closing (a proxy holding the response open but buffering it), and that failure is
 * invisible from this side. A slow poll is the safety net that catches it.
 */
const BACKSTOP_POLL_MS = 120_000;

function isStats(v: unknown): v is LiveStats {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.registeredUsers === "number" &&
    typeof o.guestsServed === "number" &&
    typeof o.totalParties === "number" &&
    typeof o.messagesSent === "number" &&
    typeof o.onlineNow === "number"
  );
}

export function useLiveStats(): LiveStats | null {
  const [pushed, setPushed] = useState<LiveStats | null>(null);
  // Whether the stream has ever delivered a frame. Drives the poll cadence, and is a
  // ref as well as state because the query options are read on every render.
  const [streaming, setStreaming] = useState(false);
  const streamingRef = useRef(false);

  // Seeds the first paint and backstops the stream forever after.
  const query = trpc.stats.public.useQuery(undefined, {
    refetchInterval: streaming ? BACKSTOP_POLL_MS : FALLBACK_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    let disposed = false;

    const open = () => {
      if (disposed) return;
      try {
        es = new EventSource("/api/stats/stream");
      } catch {
        return; // no stream available; the poll above carries the page
      }
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as unknown;
          if (!isStats(data)) return;
          if (!streamingRef.current) {
            streamingRef.current = true;
            setStreaming(true);
          }
          setPushed({
            registeredUsers: data.registeredUsers,
            guestsServed: data.guestsServed,
            totalParties: data.totalParties,
            messagesSent: data.messagesSent,
            onlineNow: data.onlineNow,
          });
        } catch {
          /* ignore a malformed frame rather than tearing the stream down */
        }
      };
      // EventSource reconnects by itself, honouring the server's `retry:` directive,
      // so there is deliberately no manual retry loop here — adding one is how you
      // get two overlapping streams per tab.
      es.onerror = () => {
        if (streamingRef.current) {
          // Fall back to the fast poll while it is down, so the numbers keep moving
          // even if the stream never comes back.
          streamingRef.current = false;
          setStreaming(false);
        }
      };
    };

    open();
    return () => {
      disposed = true;
      streamingRef.current = false;
      es?.close();
    };
  }, []);

  // The pushed value wins when present — it is never older than the query's.
  return pushed ?? query.data ?? null;
}
