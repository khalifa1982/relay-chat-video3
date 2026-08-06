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
    /* 2026-08-01: was the exact dep list, so it broke when the memo legitimately gained
       a fifth dep. The property is that the memo is derived from the SCOPED list and
       re-runs when the search changes (QA H3) — the deps it must contain, not the ones
       it must not. */
    expect(cats).toMatch(/\}, \[[^\]]*scopedThreads[^\]]*\]\)/);
    expect(cats).toMatch(/\}, \[[^\]]*threadSearch[^\]]*\]\)/);
    expect(cats).toMatch(/\}, \[[^\]]*\bonly\b[^\]]*\]\)/);
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

describe("group calls are reachable from the Groups tab — via a top-bar icon, not a section", () => {
  it("the Groups tab's top bar has a group-call button that opens the picker; the section is gone", () => {
    /* v2.107.51 (owner): *"I didn't tell you to remove the group feature, only to make it
       up as icons rather than a section."* The in-list GROUP CALLS block was condensed to a
       single top-bar icon so the group CHATS sit directly under the header. The icon is
       gated on the groups scope and opens the SAME ad-hoc picker the section's button did. */
    expect(MESSAGES).toMatch(/only === "groups" && \(/);
    expect(MESSAGES).toMatch(/onClick=\{\(\) => setShowGroupCall\(true\)\}/);
    // The bulky section function is gone — the icon replaces it, nothing is deleted.
    expect(MESSAGES).not.toMatch(/function GroupCallsSection\(/);
  });

  it("both halves still reach the user — start a call, and the returnable lines — through the picker", () => {
    // The picker (GroupCallScreen) is where BOTH now live: it mounts PartyLinesSection
    // itself, so condensing the Messages-side section to an icon loses neither half.
    expect(PICKER).toMatch(/export function PartyLinesSection\(/);
    expect(PICKER).toMatch(/<PartyLinesSection /);
  });

  it("the party-line list is ONE component, mounted only in the picker now — never a second copy in Messages", () => {
    // Messages no longer imports or renders PartyLinesSection; it reaches those lines only
    // by opening the picker. Two lists of the same lines is the class this repo keeps out.
    expect(MESSAGES).toMatch(/import \{ GroupCallScreen \} from "\.\/GroupCallScreen"/);
    expect(MESSAGES).not.toMatch(/PartyLinesSection/);
    expect(MESSAGES).not.toMatch(/trpc\.partyLines\./);
  });

  it("the ad-hoc picker is still mounted at the ROOT, not inside the scrolling list", () => {
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

describe("v2.106.66 — the strip is chrome, and the tray does not reuse the badge's green", () => {
  it("the stories strip sits ABOVE the search and OUTSIDE the scroller", () => {
    /* Board 1c's own order is header → strip → search → threads. v2.107.51 moved the
       search TOGGLE up into the header (an icon), but the strip still sits above the search
       FIELD that unfolds below it, and — the load-bearing part — stays OUT of the scroller.
       The app once had the strip BELOW the search and INSIDE the scroller, so it scrolled
       away with the threads.

       Out of the scroller matters more than the order: a story lives 24h and the ring is
       the only signal it exists, so scrolling two threads down hid every one of them.
       Anchored on the field's `placeholder` (unique to the input) rather than its
       `aria-label`, which the header toggle now shares and which sits above the strip. */
    const strip = MESSAGES.indexOf("<StatusStrip");
    const search = MESSAGES.indexOf('placeholder={tr("msg.search")}');
    const scroller = MESSAGES.indexOf('<div className="flex-1 overflow-y-auto">');
    expect(strip, "the strip is gone").toBeGreaterThan(-1);
    expect(search, "the search field is gone").toBeGreaterThan(-1);
    expect(scroller, "the thread scroller is gone").toBeGreaterThan(-1);
    expect(strip, "the strip must precede the search field").toBeLessThan(search);
    expect(strip, "…and must not be inside the scroller").toBeLessThan(scroller);
    // Exactly one mount: a second would put two strips on one screen. (v2.107.51 the
    // Groups tab passes `compact`, so match the tag with or without props.)
    expect((MESSAGES.match(/<StatusStrip[\s/]/g) || []).length).toBe(1);
  });

  it("the Pin chip does not wear the registered tier's own hex", () => {
    /* `#22c55e` is `VerifiedBadge`'s `registered` colour VERBATIM, and these rows render
       that badge — so swiping put a green Pin chip beside a green tier seal. v2.106.40
       retired exactly this pairing in the 1:1 header; the tray was never swept.

       PINNED AS THE COLLISION, NOT AS A LITERAL: the board draws 1c at rest and specifies
       no Pin colour, so freezing whichever hue replaced it would be inventing a spec. What
       must hold is that the tray never reuses a hue this screen has already spent. */
    const left = MESSAGES.slice(
      MESSAGES.indexOf("const swipeLeftActions"),
      MESSAGES.indexOf("const swipeRightActions"),
    );
    expect(left.length).toBeGreaterThan(200);
    expect(left, "the Pin action is gone").toMatch(/key: "pin"/);
    // The row really does render the badge that owns the hex — without this the rule
    // above is a claim about a collision that may not exist.
    expect(MESSAGES).toMatch(/<RoleBadge role=\{tier\}/);
    expect(read("client/src/app/VerifiedBadge.tsx")).toMatch(
      /registered: \{ color: "#22c55e"/,
    );
    // …so no swipe chip may use it.
    const right = MESSAGES.slice(
      MESSAGES.indexOf("const swipeRightActions"),
      MESSAGES.indexOf("useEffect(() => {", MESSAGES.indexOf("const swipeRightActions")),
    );
    for (const [name, tray] of [["left", left], ["right", right]] as const) {
      const colours = Array.from(tray.matchAll(/color: "(#[0-9a-f]{6})"/gi)).map((m) => m[1]);
      expect(colours.length, `${name} tray has no colours`).toBeGreaterThan(0);
      expect(colours, `${name} tray reuses the registered badge's hex`).not.toContain("#22c55e");
    }
    // And the accent is likewise not it: the accent means UNREAD in this same row
    // (v2.106.42), which is why the pinned MARKER is muted rather than accent.
    expect(left).not.toMatch(/color: "var\(--rb\)"/);
  });
});

describe("v2.106.67 — the row carries a read receipt, and the count is the board's pill", () => {
  const DB = read("server/v2db.ts");
  const ROUTERS = read("server/v2routers.ts");

  it("the receipt is MINE-ONLY, and that is enforced server-side", () => {
    /* A ✓✓ is a statement about MY message. Rendering one for a peer's inverts what it
       means, and deciding that in the component would leave the field on the wire for any
       other reader to get wrong — so the projection nulls it unless `mine`. */
    expect(DB).toMatch(
      /lastMessageStatus: latest\?\.mine === true \? \(latest\?\.status \?\? null\) : null,/,
    );
    expect(ROUTERS).toMatch(/lastMessageStatus: b\.lastMessageStatus,/);
    // Threaded explicitly, like every other field in that projection — a new column must
    // not reach the browser without a decision.
    expect(ROUTERS).not.toMatch(/\.\.\.b,/);
  });

  it("it costs no extra query — the row it reads is already loaded", () => {
    /* #115's deferral note claimed adding a field here "touches the groupwise-max query
       every client polls" and was wrong; the correction is recorded in v2db. The aggregate
       selects two integer columns and is a separate query; this row comes from a bare
       `.select()` over a few dozen primary keys, so `status` arrives with the `meta` and
       `senderIdentityId` the adjacent lines already read. */
    /* BOUNDED BY THE ENTRY'S OWN END, not a character count — a fixed 1600 ran past the
       builder into code that legitimately awaits, and the "no extra query" assertion
       failed on correct source. The fixed-slice fragility, again. */
    const bStart = DB.indexOf("latestMessageByConvo: new Map(");
    expect(bStart).toBeGreaterThan(-1);
    const builder = DB.slice(bStart, DB.indexOf("\n    ),", bStart));
    expect(builder.length, "the builder slice collapsed").toBeGreaterThan(400);
    expect(builder).toMatch(/status: m\.status \?\? null,/);
    expect(builder).toMatch(/mine: m\.senderIdentityId === identityId,/);
    // No second query was introduced for it.
    expect(builder).not.toMatch(/await /);
  });

  it("every status renders a distinct thing, and `failed` renders none", () => {
    /* A failed send has reached nobody, so a single ✓ would say it had — the one status
       that must produce no tick at all. */
    const at = MESSAGES.indexOf('t.lastMessageStatus === "read"');
    expect(at, "the receipt is gone").toBeGreaterThan(-1);
    const block = MESSAGES.slice(at, at + 1200);
    expect(block).toMatch(/CheckCheck[\s\S]{0,240}text-primary/); // read
    expect(block).toMatch(/t\.lastMessageStatus === "delivered"/);
    expect(block).toMatch(/t\.lastMessageStatus === "sent"/);
    expect(block, "failed must not render a tick").not.toMatch(/"failed"/);
    // It ends in an explicit null rather than falling through to a default tick.
    expect(block).toMatch(/\) : null\}/);
  });

  it("read and delivered are told apart, so ✓✓ is not one state twice", () => {
    // v2.99.74's whole point: `delivered` existed in the schema and nothing wrote it, so
    // sent and delivered rendered identically. Two ✓✓ that look the same is that again.
    const at = MESSAGES.indexOf('t.lastMessageStatus === "read"');
    const block = MESSAGES.slice(at, at + 1200);
    const readArm = block.slice(0, block.indexOf('"delivered"'));
    const delArm = block.slice(block.indexOf('"delivered"'), block.indexOf('"sent"'));
    expect(readArm).toMatch(/text-primary/);
    expect(delArm).toMatch(/text-muted-foreground/);
    expect(delArm, "delivered must not wear the read colour").not.toMatch(/text-primary(?!-)/);
  });
});

describe("v2.106.67 — the preview says WHO said it", () => {
  const DB = read("server/v2db.ts");
  const ROUTERS = read("server/v2routers.ts");

  it("a GROUP row resolves the sender's FIRST name; a DM row resolves none", () => {
    /* Board 1c's own sample rows: `'Amira: The final board is up'` for a group,
       `'You: Voice note · 0:42'` for my own. A DM needs no prefix — the row's title IS
       the other person, so prefixing their words with their own name says nothing. */
    expect(DB).toMatch(/lastMessageSender: null as string \| null,/); // the DM default
    /* SEARCHED FROM THE START OFFSET: `kind: "group",` also occurs ~950 lines EARLIER in
       `createGroupConversation`, so a bare `indexOf` put the end before the start and the
       slice collapsed to "" — every assertion in it would have passed vacuously the moment
       one was a `not.toMatch`. The non-empty guard is what caught it. */
    const gStart = DB.indexOf('if (kind === "group") {');
    expect(gStart).toBeGreaterThan(-1);
    const grp = DB.slice(gStart, DB.indexOf('kind: "group",', gStart));
    expect(grp.length, "the group-branch slice collapsed").toBeGreaterThan(300);
    expect(grp, "first name only — a full name eats the words it introduces").toMatch(
      /displayName\?\.trim\(\)\.split\(\/\\s\+\/\)\[0\]/,
    );
    expect(grp, "resolved from the SAME map the row's title comes from").toMatch(/otherById\.get\(senderId\)/);
    expect(grp, "null for my own — the client says You: without a lookup").toMatch(
      /latest\?\.mine === true \|\| senderId == null/,
    );
    expect(ROUTERS).toMatch(/lastMessageSender: b\.lastMessageSender,/);
  });

  it("an unresolved sender yields NULL, never a placeholder", () => {
    // A wrong name on somebody else's message is worse than no name.
    const gStart = DB.indexOf('if (kind === "group") {');
    const grp = DB.slice(gStart, DB.indexOf('kind: "group",', gStart));
    expect(grp.length, "the group-branch slice collapsed").toBeGreaterThan(300);
    expect(grp).toMatch(/\?\? null\)/);
    expect(grp, "no invented stand-in").not.toMatch(/"Someone"|"Unknown"|"Member"/);
    expect(DB).toMatch(/lastMessageSender: senderName \|\| null,/);
  });

  it("a LOCKED group leaks no member NAME — a worse leak than the preview", () => {
    /* `preview` is the literal "Locked" when hidden, and the prefix must not survive it:
       naming who spoke is exactly the activity the lock exists to cover. */
    const at = MESSAGES.indexOf("{!hidden && t.lastMessageAt &&");
    expect(at, "the prefix is gone").toBeGreaterThan(-1);
    const block = MESSAGES.slice(at, at + 400);
    expect(block).toMatch(/!hidden/);
    expect(block).toMatch(/t\.lastMessageMine \? "You" : t\.lastMessageSender/);
    // …and it is INSIDE the truncating span, so a long name is clipped with the words
    // it introduces rather than squeezing them to nothing.
    const span = MESSAGES.lastIndexOf('className={"min-w-0 flex-1 truncate ', at);
    expect(span, "the prefix must sit inside the truncating preview span").toBeGreaterThan(-1);
    expect(span).toBeLessThan(at);
  });
});
