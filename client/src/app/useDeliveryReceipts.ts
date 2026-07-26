/**
 * useDeliveryReceipts — reports DELIVERY, which is what turns one tick into two.
 *
 * The owner's ask, verbatim: "It shows you what check if it's delivered. I mean the
 * other user is online and he received, but he didn't open it. It should show second
 * check mark beside that."
 *
 * WHY THE RECIPIENT REPORTS IT, rather than the server marking a message delivered
 * when it fans the SSE event: an open stream proves a socket exists, not that the
 * message reached an app that has it. More importantly it would MISS the case the
 * second tick exists for — someone who was offline when the message was sent and
 * opens the app later without opening the thread. Nothing about their SSE connection
 * at send time says anything about that.
 *
 * TWO TRIGGERS, because either alone leaves a real gap:
 *   - a live `message` event (they have the app open; delivery is immediate), and
 *   - the thread list showing unread (they just opened the app, or reconnected).
 * The second is what covers the offline-then-return case. Both funnel through the
 * same dedupe, so the two triggers firing together still costs one call.
 *
 * DEDUPED ON THE THREAD'S NEWEST MESSAGE TIME. The thread list refetches every 15s
 * and `markDelivered` is a write over the conversation's messages — reporting on
 * every tick would be a mutation per unread thread per 15 seconds, forever, for a
 * fact that has not changed. A newer `lastMessageAt` is exactly the signal that
 * there is something new to report.
 */
import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Highest already-reported `lastMessageAt` per conversation, as epoch ms.
 *
 * Module-scoped rather than per-hook so a remount does not re-report everything,
 * and reset on identity change — the next signed-in person's receipts are not ours
 * to suppress.
 */
const reported = new Map<number, number>();
let reportedFor: number | null = null;

/** How many conversations may be reported in one sweep. */
const MAX_PER_SWEEP = 12;

/** Visible for testing. Ordinary identity changes are handled inline below. */
export function resetDeliveryReports() {
  reported.clear();
  reportedFor = null;
}

/** Visible for testing: has this conversation already been reported at this time? */
export function alreadyReported(conversationId: number, at: number): boolean {
  const seen = reported.get(conversationId);
  return seen != null && seen >= at;
}

/**
 * Pure decision: which conversations still owe a delivery report?
 *
 * Exported so the rule is testable without a React tree or a server — the whole
 * point of the hook is WHICH threads it calls for, and asserting that against a
 * rendered component would prove much less.
 */
export function pendingDeliveryReports(
  threads: Array<{ conversationId: number; unreadCount?: number | null; lastMessageAt?: string | Date | null }>,
  selfId: number | null
): number[] {
  if (selfId == null) return [];
  if (reportedFor !== selfId) {
    // Identity changed under us (sign-out/sign-in in the same tab).
    reported.clear();
    reportedFor = selfId;
  }
  const out: number[] = [];
  for (const t of threads) {
    // Nothing unread means nothing to deliver: a message that has been READ was
    // already stamped delivered by markThreadRead's COALESCE.
    if (!t.unreadCount || t.unreadCount <= 0) continue;
    if (!t.lastMessageAt) continue;
    const at = new Date(t.lastMessageAt).getTime();
    if (!Number.isFinite(at)) continue;
    if (alreadyReported(t.conversationId, at)) continue;
    out.push(t.conversationId);
    // Claimed BEFORE the request goes out. The live `message` event and the thread
    // refetch it triggers can both land in the same tick, and without claiming here
    // they would each fire their own write for the same fact. A genuine failure
    // un-claims (see the hook), because a blip must not cost the sender their second
    // tick until the next message happens to arrive.
    reported.set(t.conversationId, at);
    if (out.length >= MAX_PER_SWEEP) break;
  }
  return out;
}

export function useDeliveryReceipts(
  threads: Array<{ conversationId: number; unreadCount?: number | null; lastMessageAt?: string | Date | null }> | undefined,
  selfId: number | null
) {
  const markDelivered = trpc.messages.markDelivered.useMutation();
  // The mutation object is recreated every render; holding it in a ref keeps the
  // effect keyed on the DATA rather than re-running on every parent render.
  const mutRef = useRef(markDelivered);
  mutRef.current = markDelivered;

  useEffect(() => {
    if (!threads || selfId == null) return;
    const ids = pendingDeliveryReports(threads, selfId);
    for (const conversationId of ids) {
      mutRef.current.mutate({ conversationId }, {
        onError: () => {
          // Un-claim so the next sweep can try again — the alternative is a receipt
          // that stays stuck at one tick until the next message arrives.
          reported.delete(conversationId);
        },
      });
    }
  }, [threads, selfId]);
}
