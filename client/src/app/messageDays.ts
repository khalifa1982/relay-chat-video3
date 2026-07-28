/**
 * Grouping a conversation into calendar days, so the day header can be STICKY.
 *
 * WHY THIS NEEDED A STRUCTURAL CHANGE RATHER THAN ONE CSS CLASS
 * ------------------------------------------------------------
 * The day pill has existed since v2.71, rendered inside the wrapper of the FIRST
 * message of each day. Adding `position: sticky` there does almost nothing:
 * sticky is bounded by its own containing block, and that wrapper is ONE message
 * tall — so the header would unstick the moment that single bubble scrolled by,
 * which looks like a bug rather than a feature. For it to stay pinned while you
 * scroll through a day, the day itself has to be a box: one `<section>` per day,
 * with the header inside it.
 *
 * WHAT THIS DELIBERATELY DOES NOT CHANGE
 * --------------------------------------
 * The ORIGINAL FLAT INDEX of every message is carried through, and that is
 * load-bearing rather than tidy. Message grouping (the WhatsApp-style stacked
 * runs, the tail on the last bubble, the suppressed sender label) is computed
 * from each message's neighbours in the flat list, and two of those decisions
 * legitimately reach ACROSS a day boundary — a message at 23:59 and one at 00:01
 * are two minutes apart, so a naive per-day recomputation would stack them
 * together, straddling the header that has just been inserted between them.
 * Keeping the flat index means the existing neighbour logic is untouched and the
 * day comparison it already does keeps doing its job.
 */

/** Local Y-M-D key. Local, not UTC: a person's "today" is their own midnight,
 *  and a UTC key would move the divider by hours for most of the world. */
export function dayKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** WhatsApp-style date pill: "Today" / "Yesterday" / "June 28, 2026". */
export function dayLabel(iso: string | Date, now: Date = new Date()): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(now)) return "Today";
  if (dayKey(d) === dayKey(yest)) return "Yesterday";
  return d.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

export type DayGroup<T> = {
  /** The calendar day itself. Kept SEPARATE from `key`, because the two answer
   *  different questions and conflating them was a real bug: comparing the
   *  React key (which folds in an index for uniqueness) against a bare day key
   *  never matched, so every single message became its own group. */
  day: string;
  /** Stable across renders for the same day, so React keeps the DOM node — and
   *  therefore the sticky header's scroll position — instead of remounting it. */
  key: string;
  label: string;
  /** Each entry keeps the message's index in the ORIGINAL flat array. */
  items: Array<{ item: T; index: number }>;
};

/**
 * Split a chronological message list into one group per calendar day.
 *
 * Runs of the same day are collapsed even if the input is not perfectly sorted:
 * a day already seen and then seen again starts a NEW group rather than
 * reopening the old one. That is the honest rendering of out-of-order data —
 * merging them would move a message to a different place in the conversation
 * than the one the server put it in, and a chat list where a bubble silently
 * jumps is worse than one with a repeated header.
 */
export function groupMessagesByDay<T extends { createdAt: string | Date }>(
  messages: readonly T[],
  now?: Date,
): Array<DayGroup<T>> {
  const out: Array<DayGroup<T>> = [];
  messages.forEach((item, index) => {
    const day = dayKey(item.createdAt);
    const last = out[out.length - 1];
    if (last && last.day === day) {
      last.items.push({ item, index });
      return;
    }
    out.push({
      day,
      // The key must be unique among SIBLINGS, and a non-monotonic list can
      // legitimately produce the same day twice — so the first index is folded
      // in. Without it React would see two children with one key and reuse the
      // wrong subtree.
      key: `${day}#${index}`,
      label: dayLabel(item.createdAt, now),
      items: [{ item, index }],
    });
  });
  return out;
}
