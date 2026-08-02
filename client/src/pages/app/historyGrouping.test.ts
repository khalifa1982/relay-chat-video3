/**
 * v2.99.98 — a Received tab, and one row per person.
 *
 * Owner: *"now you have all these tabs, all the dial and received. You should add
 * received, and there is a missed call, and there is something called grouping.
 * Grouping means grouping, if a person who called you several time, it will group his
 * number of notification into one. Like, it will say if a user called me ten times, it
 * will say this user called you ten times, and it will show me the details of these
 * ten times below his ID."*
 *
 * The grouping is tested BEHAVIOURALLY because the count IS the feature — a count that
 * is wrong is worse than no count, and a source pin cannot tell you whether four calls
 * from one person collapse into one row that says four.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { callCountKey, filterItems, groupByPeer, groupTitleOf, historyPeerKey } from "./History";
import { translate } from "../../app/i18n";
import { codeOnly } from "../../../../server/testing/codeOnly";
import { copyOnScreen } from "../../../../server/testing/copyOnScreen";

const HISTORY = readFileSync(new URL("./History.tsx", import.meta.url), "utf8");
const ROUTERS = readFileSync(new URL("../../../../server/v2routers.ts", import.meta.url), "utf8");


const ME = { number: "777777", isSelf: true, identityId: 3, name: "Me" };

/** An answered call with one other person. `dir` is who started it. */
function conf(id: number, at: number, peer: { id?: number | null; num: string; name?: string }, dir: "in" | "out") {
  const other = { identityId: peer.id ?? null, number: peer.num, name: peer.name ?? peer.num, isSelf: false };
  return {
    kind: "conf" as const,
    key: "conf-" + id,
    at,
    direction: dir,
    conf: {
      id,
      roomId: "room-" + id,
      dialedNumber: dir === "out" ? peer.num : ME.number,
      partyCount: 2,
      startedAt: new Date(at),
      endedAt: new Date(at),
      durationSec: 30,
      // The roster is seeded by the CALLER, which is what decides direction.
      participants: dir === "out" ? [ME, other] : [other, ME],
    },
  };
}

/** A never-connected call: incoming ones are the missed ones. */
function solo(id: number, at: number, peer: { id?: number | null; num: string; name?: string }, dir: "in" | "out") {
  return {
    kind: "solo" as const,
    key: "solo-" + id,
    at,
    direction: dir,
    call: {
      id,
      direction: dir,
      status: "missed",
      startedAt: new Date(at),
      other: { identityId: peer.id ?? null, number: peer.num, displayName: peer.name ?? peer.num },
    },
  };
}

describe("the grouping key", () => {
  it("groups a person by IDENTITY, so a renumber cannot split them in two", () => {
    // The number moves and the identity does not. Keying on the number would file the
    // same person's calls under two headings the moment they regenerate their number.
    const before = conf(1, 5000, { id: 42, num: "271638" }, "in");
    const after = conf(2, 6000, { id: 42, num: "805555" }, "in");
    expect(historyPeerKey(before)).toBe(historyPeerKey(after));
    expect(historyPeerKey(before)).toBe("id:42");
  });

  it("falls back to the NUMBER when the identity is unresolvable", () => {
    // An old roster entry for somebody we can no longer look up still has a number,
    // which is the best key available.
    expect(historyPeerKey(conf(3, 1, { id: null, num: "601586" }, "in"))).toBe("num:601586");
  });

  it("keeps a GROUP call as its own row rather than filing it under one member", () => {
    // A five-way call is not "a call with Ahmed", and filing it under him would make
    // the count beside his name wrong.
    const group = {
      ...conf(4, 7000, { id: 9, num: "111111" }, "out"),
    };
    group.conf.partyCount = 4;
    group.conf.participants = [ME, { identityId: 9, number: "111111", name: "A", isSelf: false }, { identityId: 10, number: "222222", name: "B", isSelf: false }];
    expect(historyPeerKey(group)).toBe("room:room-4");
  });

  it("a solo and a conference row with the SAME person share one key", () => {
    // Somebody who called and was missed, then called and was answered, is one person
    // with two calls — not two people.
    expect(historyPeerKey(solo(5, 100, { id: 42, num: "271638" }, "in"))).toBe(
      historyPeerKey(conf(6, 200, { id: 42, num: "271638" }, "in"))
    );
  });
});

describe("groupByPeer", () => {
  const items = [
    conf(10, 9000, { id: 42, num: "805555", name: "A G" }, "in"),
    solo(11, 8000, { id: 42, num: "805555", name: "A G" }, "in"),
    conf(12, 7000, { id: 42, num: "805555", name: "A G" }, "in"),
    conf(13, 6000, { id: 77, num: "909090", name: "Mohamed" }, "out"),
    solo(14, 5000, { id: 42, num: "805555", name: "A G" }, "in"),
  ];

  it("collapses one person's calls into one row with the right count", () => {
    // The owner's own example: "it will say this user called you ten times".
    const g = groupByPeer(items);
    expect(g.length).toBe(2);
    const ag = g.find((x) => x.key === "id:42")!;
    expect(ag.count).toBe(4);
    expect(ag.items.length).toBe(4);
  });

  it("counts the MISSED ones separately", () => {
    const ag = groupByPeer(items).find((x) => x.key === "id:42")!;
    // Two of A G's four are never-connected incoming calls.
    expect(ag.missed).toBe(2);
  });

  it("the NEWEST call heads the group, and orders the groups newest-first", () => {
    // The head supplies the name, the avatar and the actions, so it has to be the
    // most recent — an older row could carry a stale name.
    const g = groupByPeer(items);
    expect(g[0].key).toBe("id:42");
    expect(g[0].head.at).toBe(9000);
    expect(g[0].at).toBe(9000);
    expect(g[1].key).toBe("id:77");
  });

  it("keeps every original call, losing none", () => {
    const g = groupByPeer(items);
    expect(g.reduce((n, x) => n + x.items.length, 0)).toBe(items.length);
    expect(g.reduce((n, x) => n + x.count, 0)).toBe(items.length);
  });

  it("does NOT depend on the caller passing a sorted list", () => {
    // The first cut took the first row it saw as the head, which is only correct for a
    // newest-first input — and the mutation run then showed the final sort could be
    // deleted with nothing noticing. The precondition is gone rather than pinned.
    // The order matters for THIS test: Mohamed (newest 6000) is encountered FIRST, so
    // Map insertion order alone would put him ahead of A G (newest 9000). Only the
    // final sort produces the right answer — an earlier shuffle happened to encounter
    // A G first and so passed with the sort deleted.
    const shuffled = [items[3], items[2], items[4], items[0], items[1]];
    const g = groupByPeer(shuffled);
    expect(g[0].key).toBe("id:42");
    expect(g[0].at).toBe(9000);
    expect(g[0].head.at).toBe(9000);
    expect(g[1].key).toBe("id:77");
    // And each group's own calls come out newest-first too.
    expect(g[0].items.map((x) => x.at)).toEqual([9000, 8000, 7000, 5000]);
  });

  it("an empty log groups to nothing rather than throwing", () => {
    expect(groupByPeer([])).toEqual([]);
  });

  it("a single call still forms a group of one", () => {
    const g = groupByPeer([conf(20, 1, { id: 1, num: "111111" }, "in")]);
    expect(g.length).toBe(1);
    expect(g[0].count).toBe(1);
    expect(g[0].missed).toBe(0);
  });
});

describe("the group's title matches the rows beneath it", () => {
  /* #156 — `groupTitleOf` returns `{ text, key }` rather than a finished string. It is a
     module-level function, so it cannot call a hook; returning English would leave the row
     untranslatable, and mapping that English back to a key at the render site is the
     `text → key` lookup the dictionary's own rule forbids. `text` is DERIVED from `key`
     (see the function), so asserting on it is still asserting the words, and `key` being
     null for a person's NAME is itself the property: a name is data, not copy. */
  it("uses the peer's name for a 1:1", () => {
    for (const it_ of [
      conf(30, 1, { id: 1, num: "111111", name: "Ahmed Ali" }, "in"),
      solo(31, 1, { id: 1, num: "111111", name: "Ahmed Ali" }, "in"),
    ]) {
      expect(groupTitleOf(it_).text).toBe("Ahmed Ali");
      expect(groupTitleOf(it_).key, "a NAME is data, never a translatable phrase").toBeNull();
    }
  });

  it("names a GROUP as a group, with its size", () => {
    const g = conf(32, 1, { id: 9, num: "111111" }, "out");
    g.conf.partyCount = 4;
    g.conf.participants = [ME, { identityId: 9, number: "111111", name: "A", isSelf: false }, { identityId: 10, number: "222222", name: "B", isSelf: false }];
    expect(groupTitleOf(g).text).toBe("Group · 3");
    // …and it is a PHRASE, so it reaches the dictionary rather than the screen raw.
    expect(groupTitleOf(g).key).toBe("history.groupOf");
    expect(translate("ar", "history.groupOf", { count: 3 })).toContain("3");
  });

  it("falls back to the number when there is no name", () => {
    expect(groupTitleOf(conf(33, 1, { id: null, num: "601586" }, "in")).text).toBe("601586");
    expect(groupTitleOf(conf(33, 1, { id: null, num: "601586" }, "in")).key).toBeNull();
  });
});

describe("the Received tab", () => {
  it("means an incoming call that was ANSWERED", () => {
    // And that is the only definition available: call_history.status is never written
    // as "answered" by anything, so EVERY answered call — 1:1 included — exists only
    // as a conference row. An incoming conference row is therefore exactly a call the
    // user picked up.
    expect(HISTORY).toMatch(/function isReceivedItem\(it: Item\): boolean \{\s*\n\s*return it\.kind === "conf" && it\.direction === "in";/);
  });

  it("that claim about the server is TRUE — nothing ever marks a call answered", () => {
    // If this ever changes, the Received definition above has to change with it, so
    // the claim is checked rather than trusted.
    const code = codeOnly(readFileSync(new URL("../../../../server/v2db.ts", import.meta.url), "utf8"));
    expect(code).not.toMatch(/\.update\(callHistory\)/);
    expect(code).not.toMatch(/status: "answered"/);
  });

  it("is a real tab with its own count and its own empty state", () => {
    expect(HISTORY).toMatch(/\{ key: "received", labelKey: "history\.received", icon: PhoneIncoming \}/);
    expect(HISTORY).toMatch(/received: items\.filter\(isReceivedItem\)\.length/);
    expect(HISTORY).toMatch(/filter === "received"/);
    expect(copyOnScreen(HISTORY, "No answered incoming calls yet.")).toBe(true);
  });

  it("is deep-linkable like the others", () => {
    expect(HISTORY).toMatch(/f === "received"/);
  });
});

describe("what each tab actually shows", () => {
  const log = [
    conf(40, 900, { id: 1, num: "111111" }, "in"), // answered incoming  -> received
    conf(41, 800, { id: 2, num: "222222" }, "out"), // answered outgoing -> dialed
    solo(42, 700, { id: 3, num: "333333" }, "in"), // never connected in -> missed
    solo(43, 600, { id: 4, num: "444444" }, "out"), // never connected out -> dialed
  ];

  it("All shows everything", () => {
    expect(filterItems(log, "all").length).toBe(4);
  });

  it("Received holds ONLY answered incoming calls", () => {
    const r = filterItems(log, "received");
    expect(r.map((x) => x.key)).toEqual(["conf-40"]);
  });

  it("Received NEVER contains a missed call", () => {
    // The distinction the owner cares about: Missed and Received are different tabs,
    // and an unanswered incoming call belongs to exactly one of them.
    const r = filterItems(log, "received");
    expect(r.some((x) => x.kind === "solo")).toBe(false);
    expect(r.some((x) => x.key === "solo-42")).toBe(false);
  });

  it("Received NEVER contains an outgoing call", () => {
    expect(filterItems(log, "received").some((x) => x.direction === "out")).toBe(false);
  });

  it("Dialed holds every outgoing call, answered or not", () => {
    expect(filterItems(log, "dialed").map((x) => x.key).sort()).toEqual(["conf-41", "solo-43"]);
  });

  it("Missed holds unanswered incoming calls only", () => {
    expect(filterItems(log, "missed").map((x) => x.key)).toEqual(["solo-42"]);
  });

  it("Missed and Received are DISJOINT, and together they are every incoming call", () => {
    const inbound = log.filter((x) => x.direction === "in");
    const m = filterItems(log, "missed");
    const r = filterItems(log, "received");
    expect(m.filter((x) => r.includes(x))).toEqual([]);
    expect(m.length + r.length).toBe(inbound.length);
  });
});

describe("grouping is a TOGGLE, not a fifth exclusive tab", () => {
  it("composes with the filters instead of replacing them", () => {
    // Grouping is orthogonal to filtering, so as a toggle it works inside Missed and
    // Received too — which an exclusive tab could not do. A "Grouping tab" would also
    // have shown the same rows as All, only stacked.
    expect(HISTORY).toMatch(/aria-pressed=\{grouped\}/);
    expect(HISTORY).toMatch(/const \[grouped, setGrouped\] = useState\(false\)/);
    // It groups whatever the active filter left, not the whole log.
    expect(HISTORY).toMatch(/grouped \? groupByPeer\(visible\) : \[\]/);
  });

  it("defaults to OFF, so the log looks unchanged until asked", () => {
    expect(HISTORY).toMatch(/useState\(false\)/);
  });

  it("each group expands to show the individual calls", () => {
    expect(HISTORY).toMatch(/aria-expanded=\{isOpen\}/);
    expect(HISTORY).toMatch(/const \[openGroups, setOpenGroups\]/);
    // "it will show me the details of these ten times below his ID" — the expanded
    // body must render the group's OWN calls. Pinned because it is JSX that cannot be
    // executed here, and an expanded group that renders nothing would look like the
    // toggle is broken. The mutation run found this unguarded.
    expect(HISTORY).toMatch(/\{isOpen && \(/);
    expect(HISTORY).toMatch(/\{g\.items\.map\(\(it\) =>/);
  });
});

describe("the count says what it can actually know", () => {
  it("says 'in this log', never a lifetime total", () => {
    // Both call payloads are hard-capped at 100 rows server-side, so a lifetime
    // figure is a number we cannot know. Claiming one would be worse than being
    // specific about what was counted.
    /* PINNED AT THE SELECTOR, NOT THROUGH `copyOnScreen`, and the limit is worth naming:
       that helper resolves LITERAL `t("key")` call sites, and this is `t(callCountKey(n))`
       — a key chosen at RUNTIME, which no static reader can follow. So the screen is
       pinned to the selector and the WORDS are driven through every band, which is
       strictly more than the two literals this replaces proved. */
    expect(HISTORY).toMatch(/t\(callCountKey\(g\.count\)/);
    expect(translate("en", callCountKey(1), { count: 1 })).toBe("1 call in this log");
    for (const n of [2, 6, 25]) {
      expect(translate("en", callCountKey(n), { count: n })).toBe(`${n} calls in this log`);
    }
  });

  it("and the cap it is being honest about is real", () => {
    expect(ROUTERS).toMatch(/limit: z\.number\(\)\.int\(\)\.min\(1\)\.max\(100\)/);
  });

  it("pluralises rather than printing '1 calls'", () => {
    /* The ternary this froze is gone, replaced by something stronger: English one/other is
       only TWO forms, and Arabic needs four (the dual at 2 swallows the numeral entirely),
       so the count picks a whole key per band. Asserted behaviourally in both languages —
       a source pin cannot tell you whether "1 calls" ever renders. */
    expect(HISTORY).toMatch(/t\(callCountKey\(g\.count\), \{ count: g\.count \}\)/);
    expect(translate("en", callCountKey(1), { count: 1 })).not.toContain("1 calls");
    const ar = [1, 2, 5, 20].map((n) => translate("ar", callCountKey(n), { count: n }));
    expect(new Set(ar).size, "four distinct Arabic forms, not one form four times").toBe(4);
    expect(ar[1], "the dual carries no numeral at all").not.toContain("2");
  });
});

describe("the server carries what the grouping needs", () => {
  it("the conference roster now sends identityId", () => {
    expect(ROUTERS).toMatch(/identityId: typeof p\.identityId === "number" \? p\.identityId : null,/);
  });

  it("and the solo payload already did", () => {
    expect(ROUTERS).toMatch(/identityId: other\.id,/);
  });
});
