/* ============================================================
   v2.99.74 — DELIVERY RECEIPTS, THE MESSAGE MENU, AND THE INFO PANEL.

   Owner, off a screenshot of a thread:

     "When you send the message it shows you what check if it's delivered. I mean the
      other user is online and he received, but he didn't open it. It should show
      second check mark beside that. If he [read] it, it will turn both check marks
      into blue colour means delivered, and any type of message either voice text
      video whatever. Now there is three dots beside each message, so when you click
      there is reply or put forward or delete or info. If info you click, it will show
      you the time sent, the time received, the time read."

   `messages.status` has carried a `delivered` value since the schema was written and
   NOTHING ever wrote it, so one tick and two ticks were the same state. This is the
   missing transition, plus the two surfaces that expose it.

   The load-bearing logic is WHICH conversations report delivery and how often, so
   that part is tested behaviourally rather than pinned — a source pin cannot tell you
   whether a 15-second poll fires a write every 15 seconds forever.
   ============================================================ */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  pendingDeliveryReports,
  resetDeliveryReports,
  alreadyReported,
} from "./useDeliveryReceipts";
import { codeOnly } from "../../../server/testing/codeOnly";
import { copyOnScreen } from "../../../server/testing/copyOnScreen";

const here = path.resolve(__dirname);
const root = path.resolve(here, "..", "..", "..");
const MSG = fs.readFileSync(path.join(root, "client/src/pages/app/Messages.tsx"), "utf8");
const SHELL = fs.readFileSync(path.join(root, "client/src/app/AppShell.tsx"), "utf8");
const RT = fs.readFileSync(path.join(root, "client/src/app/useRealtime.ts"), "utf8");
const V2DB = fs.readFileSync(path.join(root, "server/v2db.ts"), "utf8");
const ROUTERS = fs.readFileSync(path.join(root, "server/v2routers.ts"), "utf8");
const EVENTS = fs.readFileSync(path.join(root, "server/v2events.ts"), "utf8");

const t = (id: number, unread: number, at: string | null) => ({
  conversationId: id,
  unreadCount: unread,
  lastMessageAt: at,
});

describe("which conversations report delivery (behavioural)", () => {
  beforeEach(() => resetDeliveryReports());

  it("reports an unread thread once, then stays silent on every later poll", () => {
    // The thread list refetches every 15s. Re-reporting on each tick would be a write
    // over the conversation's messages every 15 seconds, forever, for a fact that has
    // not changed — which is worse than the missing feature it implements.
    const threads = [t(1, 3, "2026-07-26T10:00:00Z")];
    expect(pendingDeliveryReports(threads, 7)).toEqual([1]);
    expect(pendingDeliveryReports(threads, 7)).toEqual([]);
    expect(pendingDeliveryReports(threads, 7)).toEqual([]);
  });

  it("reports AGAIN when a newer message arrives", () => {
    expect(pendingDeliveryReports([t(1, 1, "2026-07-26T10:00:00Z")], 7)).toEqual([1]);
    expect(pendingDeliveryReports([t(1, 2, "2026-07-26T10:05:00Z")], 7)).toEqual([1]);
  });

  it("does NOT report an older timestamp than one already reported", () => {
    // Two tabs, or a stale cached list, must not walk the watermark backwards and
    // re-fire for something already handled.
    expect(pendingDeliveryReports([t(1, 2, "2026-07-26T10:05:00Z")], 7)).toEqual([1]);
    expect(pendingDeliveryReports([t(1, 2, "2026-07-26T10:00:00Z")], 7)).toEqual([]);
  });

  it("ignores threads with nothing unread", () => {
    // A message that has been READ was already stamped delivered by markThreadRead's
    // COALESCE, so there is nothing left to report.
    expect(pendingDeliveryReports([t(1, 0, "2026-07-26T10:00:00Z")], 7)).toEqual([]);
    expect(pendingDeliveryReports([{ conversationId: 2, lastMessageAt: "2026-07-26T10:00:00Z" }], 7)).toEqual([]);
  });

  it("ignores a thread with no or an unparseable last-message time", () => {
    // Without a usable watermark there is no way to dedupe, and a report that cannot
    // be deduped is a report on every poll.
    expect(pendingDeliveryReports([t(1, 5, null)], 7)).toEqual([]);
    expect(pendingDeliveryReports([t(2, 5, "not a date")], 7)).toEqual([]);
  });

  it("does nothing at all with no identity", () => {
    expect(pendingDeliveryReports([t(1, 5, "2026-07-26T10:00:00Z")], null)).toEqual([]);
  });

  it("forgets everything when the identity changes", () => {
    // Sign out, sign in as somebody else in the same tab: the previous person's
    // watermarks are not ours to suppress, and suppressing them would cost the new
    // user's senders their second tick.
    expect(pendingDeliveryReports([t(1, 1, "2026-07-26T10:00:00Z")], 7)).toEqual([1]);
    expect(pendingDeliveryReports([t(1, 1, "2026-07-26T10:00:00Z")], 7)).toEqual([]);
    expect(pendingDeliveryReports([t(1, 1, "2026-07-26T10:00:00Z")], 9)).toEqual([1]);
  });

  it("caps one sweep, so opening the app with a huge backlog is not a write storm", () => {
    const many = Array.from({ length: 40 }, (_, i) => t(i + 1, 1, "2026-07-26T10:00:00Z"));
    const first = pendingDeliveryReports(many, 7);
    expect(first.length).toBe(12);
    // The remainder is not lost — the next sweep takes the next batch.
    const second = pendingDeliveryReports(many, 7);
    expect(second.length).toBe(12);
    expect(second.some((id) => first.includes(id))).toBe(false);
  });

  it("claims BEFORE the request, so two sweeps in one tick cannot double-fire", () => {
    // The live `message` event and the thread refetch it triggers can both land in the
    // same tick.
    const threads = [t(1, 1, "2026-07-26T10:00:00Z")];
    pendingDeliveryReports(threads, 7);
    expect(alreadyReported(1, new Date("2026-07-26T10:00:00Z").getTime())).toBe(true);
  });

  it("un-claims on failure, so a blip does not cost the sender their tick", () => {
    expect(RT).toBeTruthy();
    const src = fs.readFileSync(path.join(here, "useDeliveryReceipts.ts"), "utf8");
    expect(src).toMatch(/onError: \(\) => \{[\s\S]{0,300}?reported\.delete\(conversationId\);/);
  });
});

describe("the server transition — delivered means the app has it", () => {
  const fn = V2DB.slice(
    V2DB.indexOf("export async function markThreadDelivered("),
    V2DB.indexOf("export async function markThreadRead(")
  );

  it("only ever promotes from `sent`", () => {
    // Excluding `read` is what stops a late-arriving report walking a receipt
    // BACKWARDS from two blue ticks to two grey ones; excluding `failed` leaves a
    // genuine failure visible rather than claiming it arrived.
    expect(fn).toMatch(/eq\(messages\.status, "sent"\)/);
    expect(fn).not.toMatch(/inArray\(messages\.status/);
  });

  it("never delivers a message to its own sender", () => {
    expect(fn).toMatch(/messages\.senderIdentityId\} <> \$\{input\.identityId\}/);
  });

  it("is membership-scoped, and refuses a non-member outright", () => {
    // Without this, any identity could stamp receipts on conversations it is not part
    // of by iterating conversation ids — the S6 finding, in a second place.
    expect(fn).toMatch(/conversationParticipants/);
    expect(fn).toMatch(/if \(membership\.length === 0\) return false;/);
    expect(fn.indexOf("membership.length === 0")).toBeLessThan(fn.indexOf(".update(messages)"));
  });

  it("skips soft-deleted messages", () => {
    expect(fn).toMatch(/isNull\(messages\.deletedAt\)/);
  });

  it("returns false rather than throwing — a receipt is not worth a failed render", () => {
    expect(fn).toMatch(/catch \{[\s\S]{0,200}?return false;/);
  });

  it("a DELIVERED message can still become read", () => {
    // The one thing that would silently break the whole chain: if the read transition
    // only accepted `sent`, then every message that got its second tick could never
    // get the third state at all — ticks would stop going blue for anyone whose app
    // reported delivery first, which is everyone. It already accepted both before this
    // release; pinned so a future narrowing has to come back and think about it.
    const read = V2DB.slice(
      V2DB.indexOf("export async function markThreadRead("),
      V2DB.indexOf("export async function markThreadRead(") + 4000
    );
    expect(read).toMatch(/or\(eq\(messages\.status, "sent"\), eq\(messages\.status, "delivered"\)\)/);
  });

  it("reading a message BACKFILLS its delivered time", () => {
    // Otherwise the info panel shows a message read at 10:05 that was never delivered,
    // which is not a thing that can happen and reads as a bug in the panel.
    const read = V2DB.slice(
      V2DB.indexOf("export async function markThreadRead("),
      V2DB.indexOf("export async function markThreadRead(") + 4000
    );
    expect(read).toMatch(/deliveredAt: sql`COALESCE\(\$\{messages\.deliveredAt\}, \$\{now\}\)`/);
    expect(read).toMatch(/readAt: now,/);
  });

  it("both timestamps are additive nullable columns via the boot migrator", () => {
    expect(V2DB).toMatch(/\{ table: "messages", column: "deliveredAt", ddl: "ADD COLUMN `deliveredAt` timestamp NULL" \}/);
    expect(V2DB).toMatch(/\{ table: "messages", column: "readAt", ddl: "ADD COLUMN `readAt` timestamp NULL" \}/);
  });
});

describe("the receipt reaches the sender live", () => {
  it("`delivered` is a DECLARED event kind, not a cast", () => {
    // It has to be in the union AND in KNOWN_V2_EVENT_KINDS: that allowlist gates the
    // RECEIVE side of the Redis bus, so an undeclared kind is delivered locally and
    // silently DROPPED whenever the sender happens to be on the other instance —
    // which is most of the time on a two-instance fleet.
    expect(EVENTS).toMatch(/\| \{ kind: "delivered"; conversationId: number; by: number \}/);
    const allow = EVENTS.slice(
      EVENTS.indexOf("const KNOWN_V2_EVENT_KINDS"),
      EVENTS.indexOf("function writeEvent")
    );
    expect(allow).toMatch(/"delivered"/);
    expect(ROUTERS).not.toMatch(/kind: "delivered"[\s\S]{0,200}?as unknown as/);
  });

  it("the procedure fans out only to the OTHER participants", () => {
    const proc = ROUTERS.slice(
      ROUTERS.indexOf("  markDelivered: publicProcedure"),
      ROUTERS.indexOf("  markDelivered: publicProcedure") + 1400
    );
    expect(proc).toMatch(/if \(pid !== me\.id\)/);
    // …and only when the caller really was a member, so a refused call is silent
    // rather than a fan-out primitive.
    expect(proc).toMatch(/if \(wasMember\) \{/);
    expect(proc.indexOf("if (wasMember)")).toBeLessThan(proc.indexOf("publishToIdentity"));
  });

  it("the client refreshes on it, and makes no noise", () => {
    // The sender is the only person a delivery receipt concerns, and a tick appearing
    // is the entire notification. A chime here would beep at you for your own message.
    expect(RT).toMatch(/case "read":\s*\n\s*case "delivered":/);
    const arm = RT.slice(RT.indexOf('case "read":'), RT.indexOf('case "presence":'));
    expect(arm).toMatch(/utils\.messages\.list\s*\n?\s*\.invalidate\(\{ conversationId: payload\.conversationId \}\)/);
    expect(arm).toMatch(/utils\.messages\.threads\.invalidate\(\)/);
    expect(arm).not.toMatch(/playMessageChime|notify\(/);
  });

  it("the reporting hook is mounted where the thread list always is", () => {
    // In AppShell, not in Messages: a recipient who was offline when the message was
    // sent must report delivery on opening the APP, without opening the thread — that
    // is the exact case the second tick exists for.
    expect(SHELL).toMatch(/import \{ useDeliveryReceipts \} from "\.\/useDeliveryReceipts";/);
    expect(SHELL).toMatch(/useDeliveryReceipts\(threads\.data, me\?\.id \?\? null\);/);
  });
});

describe("what the sender sees on the bubble", () => {
  const fn = MSG.slice(MSG.indexOf("function Receipt("), MSG.indexOf("/** Three-dot context menu"));

  it("one tick sent, two ticks delivered, and READ is the MORE visible of the two", () => {
    expect(fn).toMatch(/const read = status === "read";/);
    expect(fn).toMatch(/const twoTicks = read \|\| status === "delivered";/);
    /* REWRITTEN TWICE, and each rewrite replaced a frozen literal with the property one
       step closer to what the owner actually asked to see.
       v2.99.74 froze `text-[#4db6ff]` — it forbade the accent. v2.106.4 froze
       `var(--rb)` — it forbade fixing the accent. THE PROPERTY IS ONLY THIS: the two
       states must be distinguishable, and read must be the more prominent, because read is
       the state the owner said they wanted at a glance.
       REWRITTEN A THIRD TIME (v2.106.62), and this one was a MEASUREMENT ON THE WRONG
       SURFACE rather than a frozen literal. v2.106.40 measured the accent at 1.34:1 against
       the own bubble's SOLID `#fb923c` — correct for that fill, and that fill was the app's
       own invention. The board fills an outgoing bubble `rgba(245,140,60,.17)` and draws its
       ✓✓ in `var(--rb)` on it. Re-measured across all 12 accent hues, worst case
       (mobile `--background` / desktop `--card`):
         accent on the old solid #fb923c        1.06:1
         accent on the board's .17 tint   5.44 / 4.82:1
         white 55%                        5.77 / 5.44:1
         white 45%                        4.35 / 4.13:1
       So read returns to the accent and delivered drops to 45%.
       THE 45% IS THE LOAD-BEARING HALF: at 55% delivered would OUTRANK read and reinstate
       the very inversion the previous rewrite existed to fix, so the bound is asserted, not
       just the difference. An ALPHA COMPARISON alone is no longer sufficient either — the
       read arm is now a CSS variable whose alpha reads as 1 whatever hue it resolves to, so
       "1 > 0.45" would hold even if the two arms were swapped for something inverted. The
       property is stated directly instead: read is the accent, delivered is a translucent
       white, and its alpha is bounded below where the measurement says it starts competing.
       ONE expression decides it, deliberately: an earlier cut set a grey class and overrode
       it inline for read, and the mutation run showed the class could be deleted with nothing
       changing, because an inline style beats it (v2.105.17). */
    const m = fn.match(/const tickStyle = \{\s*color: read \? (".+?") : (".+?"),?\s*\}/);
    expect(m, "one expression, both arms named").toBeTruthy();
    const [, readArm, deliveredArm] = m as RegExpMatchArray;
    expect(readArm).not.toBe(deliveredArm);
    expect(readArm, "read is the app's accent read-vocabulary").toMatch(/var\(--rb[, )]/);
    // Never `var(--rb, var(--rb))` — a custom-property cycle drops the declaration (v2.106.7).
    expect(readArm).not.toMatch(/var\(--rb[a-z-]*,\s*var\(--rb/);
    expect(deliveredArm, "delivered is a translucent white").toMatch(/rgba\(255,\s*255,\s*255/);
    const alpha = (css: string) => {
      const rgba = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/.exec(css);
      return rgba ? Number(rgba[1]) : 1;
    };
    expect(
      alpha(deliveredArm),
      "delivered must stay below where it starts outranking the accent (measured: .5 ties, .55 wins)",
    ).toBeLessThan(0.5);
    expect(fn).toMatch(/<CheckCheck /);
    expect(fn).toMatch(/<Check /);
    // `read` must imply two ticks — a read single tick is a state that does not exist.
    expect(fn).toMatch(/twoTicks \? \(\s*\n?\s*<CheckCheck/);
  });

  it("a failed send is visibly NOT a receipt", () => {
    expect(fn).toMatch(/const failed = status === "failed";/);
    expect(fn).toMatch(/line-through/);
    // Checked first, so a failure can never render as a tick.
    expect(fn.indexOf("{failed ? (")).toBeLessThan(fn.indexOf("twoTicks ? ("));
  });

  it("is announced, not just drawn", () => {
    expect(fn).toMatch(/const label = failed/);
    expect(fn).toMatch(/aria-label=\{label\}/);
    expect(fn).toMatch(/title=\{label\}/);
  });

  it("renders on our own messages only, and only once a status exists", () => {
    expect(fn).toMatch(/if \(!mine \|\| !status\) return null;/);
  });

  it("replaces the hand-drawn ticks EVERYWHERE, for every kind of message", () => {
    // The owner's "any type of message either voice text video whatever": the receipt
    // hangs off the message ROW, not off the text renderer, so an image, a voice note
    // and a video get it by construction. The old hand-drawn literal is gone from the
    // file entirely — a second, older tick renderer surviving anywhere is the way this
    // regresses.
    expect(MSG).not.toMatch(/\? "✓✓" : "✓"/);
    /* Checked against CODE, not the whole file: several comments legitimately mention the
       old glyphs while describing the history, and matching those would make this pass or
       fail on prose rather than on behaviour.
       THE FILTER WAS ITS OWN VERSION OF THAT TRAP and it fired: it dropped lines beginning
       with `//`, `*` or `/*`, but a block comment whose CONTINUATION lines begin with an
       ordinary word is not dropped by any of those — so a new comment recording the measured
       tick contrast turned this red on correct code. It now uses the shared `codeOnly`,
       which strips comment SPANS rather than guessing from how a line starts. */
    expect(codeOnly(MSG).split("\n").filter((l) => l.includes("✓✓"))).toEqual([]);
    // Both live message renderers — the ordinary bubble and the bubble-less emoji
    // row. The search-results panel deliberately has none: it lists hits, not the
    // live conversation.
    expect((MSG.match(/<Receipt status=\{m\.status\} mine=\{!!mine\} \/>/g) || []).length).toBe(2);
  });

  it("has no outer mine/status condition to fall out of step with the component's", () => {
    // Two guards for one rule is how a receipt ends up rendering in one place and not
    // the other after somebody edits only one of them.
    expect(MSG).not.toMatch(/\{mine && m\.status && \(/);
  });
});

describe("the ⋮ menu and the info panel", () => {
  const menu = MSG.slice(MSG.indexOf("function MessageMenu("), MSG.indexOf("function AttachmentView("));

  it("offers Reply, Forward, Copy, Info — and Unsend on our own", () => {
    expect(menu).toMatch(/<Reply className="size-4" \/> Reply/);
    expect(menu).toMatch(/<Forward className="size-4" \/> Forward/);
    expect(menu).toMatch(/<Copy className="size-4" \/> Copy/);
    expect(menu).toMatch(/<Info className="size-4" \/> Info/);
    // Unsend removes the message for EVERYONE, so it is only ever ours to do.
    expect(menu).toMatch(/\{mine && onDelete && \(/);
  });

  it("Forward is WITHHELD from a self-destructing message, in both directions", () => {
    // Copying a view-once message into a second, permanent thread breaks the exact
    // promise it was sent under. Offering a menu item that then refuses is worse than
    // not offering it, so the item is absent AND the action refuses as a backstop.
    expect((MSG.match(/onForward=\{isExpiringMsg\(m\.meta\) \? undefined : \(\) => setForwarding\(m\)\}/g) || []).length).toBe(1);
    expect((MSG.match(/onForward=\{isExpiring \? undefined : \(\) => setForwarding\(m\)\}/g) || []).length).toBe(1);
    const fwd = MSG.slice(MSG.indexOf("async function forwardTo("), MSG.indexOf("async function forwardTo(") + 1200);
    expect(fwd).toBeTruthy();
    expect(MSG).toMatch(/This is a disappearing message — forwarding it would break the promise/);
  });

  it("a still-LOCKED expiring message shows no menu at all (QA H2 stands)", () => {
    // Reply and Copy would extract the plaintext without burning it. Forward and Info
    // must inherit that, which they do by living inside the same guard.
    const received = MSG.slice(MSG.indexOf("{!mine && (() => {"), MSG.indexOf("{!mine && (() => {") + 1400);
    expect(received).toMatch(/if \(locked\) return null;/);
    expect(received.indexOf("if (locked) return null;")).toBeLessThan(received.indexOf("<MessageMenu"));
  });

  it("forwarding RE-SENDS rather than re-pointing the row", () => {
    // The target thread gets its own message with its own receipts, which is what
    // makes a forward behave like a send. The attachment rides by id, and
    // messages.send re-checks the sender may use it — so this cannot smuggle media the
    // forwarder could not already see.
    const fwd = MSG.slice(MSG.indexOf("async function forwardTo("), MSG.indexOf("function deleteMessage("));
    expect(fwd).toMatch(/await sendMutation\.mutateAsync\(\{/);
    expect(fwd).toMatch(/attachmentId: m\.attachment \? \(m\.attachment as \{ id: number \}\)\.id : undefined,/);
    expect(fwd).toMatch(/conversationId: target\.id,/);
  });

  it("the forward picker never offers the thread you are already in", () => {
    /* 2026-08-01 REWRITTEN TO THE PROPERTY. This froze the one-line
       `(threadsQuery.data ?? []).filter(...)` and the exact empty-state SENTENCE, so it
       broke the moment the picker gained a search box while saying nothing about the
       rule it stands for: the thread you are already in is never offered. */
    expect(MSG).toMatch(/t\.conversationId !== conversationId/);
    expect(MSG).toMatch(/\{forwardTargets\.map\(\(th\) => \(/);
    /* And the empty state must tell the two cases apart — "no other conversations yet"
       is a false claim about somebody's own inbox while a search is narrowing it. */
    expect(copyOnScreen(MSG, "No other conversations yet.")).toBe(true);
    expect(MSG).toMatch(/forwardSearch\.trim\(\)\s*\?/);
  });

  it("Info lists sent, delivered and read — the three the owner named", () => {
    const panel = MSG.slice(MSG.indexOf('{t("msg.infoTitle")}'), MSG.indexOf('t("msg.forwardTitle")'));
    expect(panel).toMatch(/\{ key: "msg\.sent", label: t\("msg\.sent"\), at: m\.createdAt \}/);
    expect(panel).toMatch(/\{ key: "msg\.delivered", label: t\("msg\.delivered"\), at: m\.deliveredAt \?\? null \}/);
    expect(panel).toMatch(/\{ key: "msg\.read", label: t\("msg\.read"\), at: m\.readAt \?\? null \}/);
  });

  it("Info shows an honest dash for a time nobody recorded", () => {
    // Every message predating this release has no stored delivered/read time.
    // Inventing one would make the panel lie about the one thing it exists to report.
    const panel = MSG.slice(MSG.indexOf('{t("msg.infoTitle")}'), MSG.indexOf('t("msg.forwardTitle")'));
    expect(panel).toMatch(/\{r\.at \? \(\s*\n?\s*formatExact\(r\.at\)\s*\n?\s*\) : \(/);
    expect(panel).toMatch(/—/);
  });

  it("Info is precise to the SECOND and always names the date", () => {
    // Sent, delivered and read are frequently inside the same minute, so a
    // minute-precision panel shows three identical values and answers nothing.
    const f = MSG.slice(MSG.indexOf("function formatExact("), MSG.indexOf("function isExpiringMsg("));
    expect(f).toMatch(/second: "2-digit"/);
    expect(f).toMatch(/year: "numeric", month: "short", day: "numeric"/);
    expect(f).toMatch(/if \(Number\.isNaN\(d\.getTime\(\)\)\) return "—";/);
    // Deliberately NOT formatTime, which drops today's date and rounds to the minute.
    expect(f).not.toMatch(/if \(sameDay\) return time;/);
  });

  it("the receipt times reach the client at all", () => {
    const proj = ROUTERS.slice(ROUTERS.indexOf("        return {\n          id: r.id,"), ROUTERS.indexOf("          locked,"));
    expect(proj).toMatch(/deliveredAt: r\.deliveredAt \?\? null,/);
    expect(proj).toMatch(/readAt: r\.readAt \?\? null,/);
  });
});

describe("the voice bar moves for an expiring note too", () => {
  it("the revealed-attachment path passes the stored duration", () => {
    // The progress fill is cur/dur, so a missing duration pins the bar at zero however
    // well playback is going — which is the screenshot. v2.99.73 threaded durationMs
    // through the ordinary bubble and MISSED this second render path, so a view-once
    // voice note still had a frozen bar.
    expect(MSG).toMatch(/\(att as \{ durationMs\?: number \| null \}\)\.durationMs \?\? null/);
    expect((MSG.match(/durationMs=\{/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it("learns the length before the first play when nothing told us", () => {
    const player = MSG.slice(MSG.indexOf("function VoiceNotePlayer("), MSG.indexOf("function fmtClock(") > 0 ? MSG.indexOf("function VoiceNotePlayer(") + 6000 : MSG.length);
    // Deferring the probe until paused made it SAFE (v2.99.73) but meant it never ran
    // during a first play — so the bar still sat still for that whole play.
    expect(player).toMatch(/if \(seeded > 0\) return;/);
    expect(player).toMatch(/if \(a\.readyState >= 1\) probeDuration\(a\);/);
    expect(player).toMatch(/\}, \[url\]\);/);
  });

  it("picks the duration up mid-playback if it settles late", () => {
    const player = MSG.slice(MSG.indexOf("function VoiceNotePlayer("), MSG.indexOf("function VoiceNotePlayer(") + 6000);
    // …without ever overwriting a length we already trust.
    expect(player).toMatch(/setDur\(\(prev\) => \(prev > 0 \? prev : d\)\);/);
  });
});
