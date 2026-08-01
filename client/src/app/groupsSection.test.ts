/**
 * v2.106.64 — MESSAGES AND GROUPS PARTITION THE THREAD LIST, AND GROUPS HOLDS THE CALLS.
 *
 * Owner, in one message:
 *   *"Also from the messages section, remove the group message and just keep it in the
 *    group section"*
 *   *"in the group section, add group calls where whenever you create any group calls or
 *    conference call, it will be there so in the group section you will have a group call
 *    and group message"*
 *   *"it will list all groups messages and if there is any new message inside the group,
 *    it will appear the first unless if you put it as a pin"*
 *
 * The third of those was ALREADY TRUE and is pinned here rather than rebuilt — the server
 * sorts pinned-first-then-newest (v2.103.0), so a group that receives a message rises to
 * the top of the Groups list by the same rule the Messages list has always used.
 *
 * The load-bearing assertions are the two things a restructure like this breaks SILENTLY:
 * a thread that ends up in neither tab, and a badge that counts threads its tab no longer
 * holds.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const read = (p: string) => codeOnly(fs.readFileSync(path.join(ROOT, p), "utf8"));

const MESSAGES = read("client/src/pages/app/Messages.tsx");
const SHELL = read("client/src/app/AppShell.tsx");
const PICKER = read("client/src/pages/app/GroupCallScreen.tsx");
const DB = read("server/v2db.ts");

describe("the two tabs partition the threads — no thread in both, none in neither", () => {
  it("the scope is a COMPLEMENT, so every thread lands in exactly one tab", () => {
    /* The failure this prevents is not a wrong list, it is a DISAPPEARED conversation:
       if the Messages arm narrowed to `kind === "direct"` while `kind` also takes a third
       value, a thread of that kind would be in neither tab and simply cease to exist for
       its owner, with nothing anywhere saying so. `!== "group"` is the complement of
       `=== "group"` for every possible value, which is what makes the pair exhaustive by
       construction rather than by enumerating the kinds. */
    const memo = MESSAGES.slice(
      MESSAGES.indexOf("const scopedThreads = useMemo("),
      MESSAGES.indexOf("const threadCategories = useMemo("),
    );
    expect(memo.length).toBeGreaterThan(60);
    expect(memo).toMatch(/t\.kind === "group"/);
    expect(memo).toMatch(/t\.kind !== "group"/);
    // Never an allow-list of the other kinds, which is the shape that can drop one.
    expect(memo).not.toMatch(/kind === "direct"/);
    expect(memo).not.toMatch(/kind === "dm"/);
  });

  it("the scope is taken on the INPUT, so a kind-agnostic section cannot leak", () => {
    // `archived` is `t.archived` regardless of kind, so narrowing by picking categories
    // would leave an archived GROUP sitting in a tab that holds no groups. This is the
    // same reason the memo exists at all (v2.106.2) and it now has to hold both ways.
    const cats = MESSAGES.slice(
      MESSAGES.indexOf("const threadCategories = useMemo("),
      MESSAGES.indexOf("const utils = trpc.useUtils()"),
    );
    expect(cats.length).toBeGreaterThan(200);
    expect(cats).toMatch(/const scoped = scopedThreads;/);
    expect(cats).not.toMatch(/threads\.data/);
  });

  it("the SECTION LIST is built per scope, not defined for both and left to filter empty", () => {
    /* A "Groups" heading declared on the Messages tab is dead code that reads as live: it
       renders nothing today only because the rows filter to zero, so it would silently
       come back the moment anything upstream stopped excluding groups — which is exactly
       the regression the split has to survive. */
    const cats = MESSAGES.slice(
      MESSAGES.indexOf("const threadCategories = useMemo("),
      MESSAGES.indexOf("const utils = trpc.useUtils()"),
    );
    expect(cats).toMatch(/only === "groups"/);
    // Direct and Notes exist only in the non-groups arm; the group rows only in the other.
    const groupsArm = cats.slice(cats.indexOf('only === "groups"'), cats.indexOf('key: "direct"'));
    expect(groupsArm).toMatch(/t\.kind === "group" && !t\.archived/);
    expect(groupsArm).not.toMatch(/key: "notes"/);
    // `only` is an explicit dep: the section LIST depends on it now, not just the rows.
    expect(cats).toMatch(/\[scopedThreads, me, threadSearch, only\]/);
  });
});

describe("each tab's badge counts what that tab HOLDS", () => {
  it("the unread total is split into two disjoint buckets by ONE derivation", () => {
    /* Two independent reduces is how the two counts come to disagree with each other and
       with the list; one pass that adds a thread to exactly one bucket cannot. */
    const memo = SHELL.slice(
      SHELL.indexOf("const { unreadTotal, unreadDirect, unreadGroups }"),
      SHELL.indexOf("const latestUnread = useMemo("),
    );
    expect(memo.length).toBeGreaterThan(150);
    expect(memo).toMatch(/if \(t\.kind === "group"\) groups \+= n;\s*\n\s*else direct \+= n;/);
    expect(memo).toMatch(/unreadTotal: direct \+ groups/);
  });

  it("neither nav renders the whole-account total on a single tab", () => {
    // THE DEFECT this closes: a group message lighting the MESSAGES badge for a thread
    // that tab no longer contains — you tap it and find nothing.
    expect(SHELL).not.toMatch(/tab\.key === "messages" && unreadTotal > 0/);
    const perTab = SHELL.match(/tab\.key === "messages" \? unreadDirect : unreadGroups/g) ?? [];
    expect(perTab.length).toBe(4); // mobile + sidebar, each gating and rendering
  });

  it("the away card routes to the tab that actually holds the named thread", () => {
    // It names ONE conversation ("Amira Said"), so opening a list that thread is not in
    // is worse than not offering the row.
    expect(SHELL).toMatch(/top\.kind === "group" \? "\/app\/groups" : "\/app\/messages"/);
    expect(SHELL).not.toMatch(/onOpenMessages=\{\(\) => navigate\("\/app\/messages"\)\}/);
    expect(SHELL).toMatch(/navigate\(latestUnread\?\.href \?\? "\/app\/messages"\)/);
  });

  it("the whole-account total still exists, because the away card is about the ACCOUNT", () => {
    // Splitting the badge must not lose the summary: "while you were away" covers
    // everything unread, not everything unread on one tab.
    expect(SHELL).toMatch(/showUnreadAlert = unreadTotal > 0/);
  });
});

describe("group calls live in the group section", () => {
  it("the Groups tab renders a group-calls section and the Messages tab does not", () => {
    expect(MESSAGES).toMatch(/only === "groups" && \(\s*\n?\s*<GroupCallsSection/);
    expect(MESSAGES).toMatch(/function GroupCallsSection\(/);
  });

  it("it offers BOTH halves — start a call now, and the lines you can return to", () => {
    const sec = MESSAGES.slice(
      MESSAGES.indexOf("function GroupCallsSection("),
      MESSAGES.indexOf("function ConversationView("),
    );
    expect(sec.length).toBeGreaterThan(200);
    expect(sec).toMatch(/Start a group call/);
    expect(sec).toMatch(/<PartyLinesSection onJoined=\{\(\) => \{\}\} defaultOpen \/>/);
  });

  it("the party-line list is ONE component with two mounts, never a second copy", () => {
    /* Two lists of the same lines is how the two come to disagree about which exist —
       the class this repo keeps removing (the sender label, the emoji catalogue, the
       TURN endpoint list). Messages IMPORTS it; it does not re-implement it. */
    expect(MESSAGES).toMatch(
      /import \{ GroupCallScreen, PartyLinesSection \} from "\.\/GroupCallScreen"/,
    );
    expect(PICKER).toMatch(/export function PartyLinesSection\(/);
    // No rival query for the same rows.
    expect(MESSAGES).not.toMatch(/trpc\.partyLines\./);
  });

  it("the ad-hoc picker is mounted at the ROOT, not inside the scrolling list", () => {
    // A full-screen modal nested in a scroll container that unmounts under it is how a
    // picker ends up half on screen.
    const tail = MESSAGES.slice(MESSAGES.indexOf("{showGroupCall && <GroupCallScreen"));
    expect(tail).toMatch(/^\{showGroupCall && <GroupCallScreen onClose=\{[^}]*\} \/>\}\s*\n\s*<\/div>/);
  });
});

describe("a new group message rises to the top — already true, pinned", () => {
  it("the server sorts pinned first, then newest, for every thread", () => {
    /* Owner: *"any message comes in any groups, it will appear the first group based on
       the last message happening inside the group … unless if you put it as a pin"*. That
       is exactly v2.103.0's rule and it needed no change — the Groups tab is the same
       list narrowed, so it inherits the order rather than sorting again. Pinned here
       because a second sort added client-side is how the two come to disagree. */
    const sort = DB.slice(DB.indexOf("result.sort((a, b) => {"), DB.indexOf("return result;"));
    expect(sort.length).toBeGreaterThan(40);
    expect(sort).toMatch(/a\.pinned !== b\.pinned/);
    expect(sort).toMatch(/b\.lastMessageAt\.getTime\(\) - a\.lastMessageAt\.getTime\(\)/);
    // The client re-sorts nothing.
    expect(MESSAGES).not.toMatch(/scopedThreads[\s\S]{0,200}\.sort\(/);
  });
});
