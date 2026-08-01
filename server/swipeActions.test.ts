/**
 * v2.103.0 — swipe a thread row for Unread / Pin / Mute / Delete / Archive.
 *
 * Owner, with two screenshots of the intended row: in the MESSAGES LIST (outside a
 * chat), dragging a row LEFT reveals the right-hand actions (Mute, Delete, Archive) and
 * dragging RIGHT reveals the left-hand ones (Unread, Pin). Glassy buttons. Holding a
 * finger on the row is a second way in.
 *
 * TWO THINGS DOMINATE THIS RELEASE, AND NEITHER IS THE ANIMATION.
 *
 * 1. THE GESTURE LIVES INSIDE A VERTICALLY SCROLLING LIST. A horizontal drag handler
 *    that claims the pointer eagerly makes the whole screen feel broken — the list stops
 *    scrolling whenever a finger drifts sideways. `touch-action: pan-y` plus a
 *    claim-only-once-horizontal-dominates rule is what prevents it, and both are pinned
 *    here as firmly as any correctness property.
 *
 * 2. FOUR OF THE FIVE ACTIONS DID NOT EXIST, and they had to be PER PERSON on the
 *    SERVER. Pinning a chat on a phone that leaves it unpinned on a laptop is the same
 *    lie a localStorage "delete for me" would have been (v2.102.2). Mute is the
 *    exception, and it is an exception on purpose.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "./testing/codeOnly";
import { copyOnScreen } from "../server/testing/copyOnScreen";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SWIPE = read("client/src/app/SwipeRow.tsx");
const MESSAGES = read("client/src/pages/app/Messages.tsx");
const V2DB = read("server/v2db.ts");
const ROUTERS = read("server/v2routers.ts");
const SCHEMA = read("drizzle/schema.ts");


function fn(src: string, name: string): string {
  // EXACT name match, not a prefix. `indexOf("export async function deleteMessage")`
  // also finds `deleteMessageAsGroupAdmin`, which silently re-points a pin at the WRONG
  // function — caught when v2.104.0 added exactly that name and the sender-only unsend
  // guard started reading the admin path instead. `\\b` rejects it because the character
  // after the name is a word character on both sides of the boundary.
  const i = src.search(new RegExp(`export async function ${name}\\b`));
  const j = src.indexOf("\nexport ", i + 10);
  const out = src.slice(i, j === -1 ? undefined : j);
  expect(out.length, `${name} not found`).toBeGreaterThan(120);
  return out;
}

describe("the gesture cannot break the list it lives in", () => {
  it("the browser keeps vertical panning — touch-action: pan-y", () => {
    // Without this the handler and the scroller fight over every diagonal move, and
    // the fix people reach for (preventDefault on touchmove) stops scrolling outright.
    expect(SWIPE).toMatch(/touchAction: "pan-y"/);
  });

  it("the pointer is claimed ONLY once horizontal movement dominates, past a threshold", () => {
    const move = SWIPE.slice(SWIPE.indexOf("const onPointerMove"), SWIPE.indexOf("const finish"));
    expect(move.length).toBeGreaterThan(300);
    // A mostly-VERTICAL move ends our interest entirely, so we can never grab the
    // gesture back mid-scroll.
    expect(move).toMatch(/if \(Math\.abs\(dy\) > Math\.abs\(dx\) && Math\.abs\(dy\) > CLAIM_PX\)/);
    expect(move).toMatch(/d\.active = false;/);
    expect(move).toMatch(/if \(Math\.abs\(dx\) < CLAIM_PX\) return;/);
    // And capture happens AFTER the claim, never before — the browser must have had
    // its chance to start a scroll first.
    const claim = move.indexOf("d.claimed = true;");
    const capture = move.indexOf("setPointerCapture");
    expect(claim).toBeGreaterThan(0);
    expect(capture).toBeGreaterThan(claim);
  });

  it("the drag writes the transform IMPERATIVELY, not through React state", () => {
    // A state update per pointer move re-renders the whole thread list on every frame
    // of every drag — the mistake v2.99.67 recorded for the typing indicator.
    expect(SWIPE).toMatch(/el\.style\.transform = `translate3d\(\$\{x\}px,0,0\)`/);
    const move = SWIPE.slice(SWIPE.indexOf("const onPointerMove"), SWIPE.indexOf("const finish"));
    expect(codeOnly(move)).not.toMatch(/setOpen\(/);
  });

  it("only transform and opacity are animated", () => {
    // Animating width/left/box-shadow repaints every frame, over a list — the class
    // v2.99.84 measured 14 of and removed.
    expect(SWIPE).toMatch(/transition = animate \? "transform 220ms/);
    expect(codeOnly(SWIPE)).not.toMatch(/transition: (width|height|left|right|box-shadow)/);
  });

  it("a hold opens the tray, and any real movement cancels it", () => {
    // The owner's second way in. A hold that survived movement would fire in the middle
    // of a scroll.
    expect(SWIPE).toMatch(/const HOLD_MS = \d+;/);
    expect(SWIPE).toMatch(/d\.holdTimer = setTimeout\(/);
    const move = SWIPE.slice(SWIPE.indexOf("const onPointerMove"), SWIPE.indexOf("const finish"));
    expect((move.match(/clearHold\(\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("a buried action is not focusable, and an open row's tap does not fall through", () => {
    // Otherwise Tab walks through every hidden action on every row in the list.
    expect(SWIPE).toMatch(/tabIndex=\{open === side \? 0 : -1\}/);
    // And the tap that closes an open row must not also open the conversation.
    expect(SWIPE).toMatch(/onClickCapture/);
    expect(SWIPE).toMatch(/e\.preventDefault\(\);\s*\n\s*e\.stopPropagation\(\);/);
  });

  it("no action can be RUN by the gesture — only by a tap on its button", () => {
    /* REWRITTEN v2.106.60. This asserted the exact `&& left.length === 1` /
       `&& right.length === 1` conjuncts of the full-swipe-commits shortcut, i.e. it
       FORBADE the change the owner then asked for — "the bar should stop where you slid
       it, and you can then click on these buttons" — while saying nothing about the
       property it was really there for, which is that a swipe must never Delete a chat
       by itself. That property is now asserted directly, and it is strictly stronger:
       the old form permitted the shortcut on any one-action side, this permits it
       nowhere. (The shortcut was also unreachable in practice — no side in the app has
       exactly one action — so removing it changed nothing today and removed the hazard
       for whoever adds a one-action side.) */
    const code = codeOnly(SWIPE);
    for (const decl of ["const finish = (", "const onPointerMove = (", "const onPointerDown = ("]) {
      const at = code.indexOf(decl);
      expect(at, decl).toBeGreaterThan(-1);
      let d = 0;
      let end = code.length;
      const open = code.indexOf("{", code.indexOf(")", at));
      for (let k = open; k < code.length; k++) {
        if (code[k] === "{") d++;
        else if (code[k] === "}") {
          d--;
          if (d === 0) {
            end = k;
            break;
          }
        }
      }
      const body = code.slice(open, end);
      expect(body.length).toBeGreaterThan(80);
      expect(body, `${decl} must not invoke an action`).not.toMatch(/\.onSelect\(\)/);
    }
    // The one caller is a real button's own click handler.
    expect((code.match(/\.onSelect\(\)/g) || []).length).toBe(1);
    expect(code).toMatch(/onClick=\{\(\)\s*=>\s*\{\s*settle\(null\);\s*a\.onSelect\(\);/);
  });

  it("the chips are a tint of the action's OWN hue, applied inline", () => {
    /* REWRITTEN v2.106.60: this required `backdrop-blur-md`, which was a MECHANISM for
       reading as glass over a see-through tray. The tray has an opaque surface now, so a
       blur behind it buys nothing and costs paint per puck per row on the app's densest
       scrolling list (the v2.99.84 rule). What the assertion is for — the chip carries
       the action's own colour and reads as a lit pane rather than a flat disc — is
       pinned on the parts that deliver it. */
    // Inline, never a runtime-composed Tailwind class — the JIT cannot see one and it
    // comes out unstyled (the tab-accent trap).
    expect(SWIPE).toMatch(/background: `linear-gradient\(160deg, \$\{a\.color\}f2/);
    expect(SWIPE).toMatch(/borderColor: `\$\{a\.color\}80`/);
    expect(SWIPE).toMatch(/inset 0 1px 0 rgba\(255,255,255,\.35\)/);
    expect(codeOnly(SWIPE)).not.toMatch(/bg-\[\$\{/);
  });
});

describe("the four new actions are per-person SERVER state", () => {
  it("all four columns live on the participant row, which is already per person", () => {
    const t = SCHEMA.slice(
      SCHEMA.indexOf("export const conversationParticipants"),
      SCHEMA.indexOf("export const messageHides"),
    );
    expect(t.length).toBeGreaterThan(400);
    for (const c of ["pinnedAt", "archivedAt", "manualUnreadAt", "clearedUpToMessageId"]) {
      expect(t, c).toMatch(new RegExp(`${c}:`));
    }
    // Its primary key is what makes membership free: an UPDATE naming both halves can
    // only ever touch the caller's own participation.
    expect(t).toMatch(/primaryKey\(\{ columns: \[t\.conversationId, t\.identityId\] \}\)/);
  });

  it("MUTE is deliberately NOT among them", () => {
    // It stays per-DEVICE because the service worker has to silence a notification
    // without asking the server anything (v2.99.42). Moving it would quietly reverse
    // that decision and break notification muting.
    const proc = ROUTERS.slice(
      ROUTERS.indexOf("  setThreadState: publicProcedure"),
      ROUTERS.indexOf("  hide: publicProcedure"),
    );
    expect(proc.length).toBeGreaterThan(400);
    expect(codeOnly(proc)).not.toMatch(/muted/i);
    // …and the swipe button drives the existing per-device toggle.
    expect(MESSAGES).toMatch(/setThreadMuted\(t\.conversationId, !isThreadMuted\(t\.conversationId\)\)/);
  });

  it("ONE writer serves all four, and membership is enforced by the WHERE clause", () => {
    // Four endpoints would be four places that can forget the check.
    expect((V2DB.match(/export async function setThreadState/g) || []).length).toBe(1);
    const w = fn(V2DB, "setThreadState");
    // PINNED ON THE UPDATE SPECIFICALLY. A bare toMatch was satisfied by the re-read
    // SELECT's own copy of the same clause, so stripping it from the WRITE passed — and
    // an unscoped UPDATE here pins, archives or CLEARS the thread for every member of
    // the conversation (caught by mutation, the same shape as v2.102.2's survivor).
    const upd = w.slice(w.indexOf(".update(conversationParticipants)"), w.indexOf("const hit ="));
    expect(upd.length).toBeGreaterThan(150);
    expect(upd).toMatch(/eq\(conversationParticipants\.conversationId, input\.conversationId\)/);
    expect(upd).toMatch(/eq\(conversationParticipants\.identityId, input\.identityId\)/);
    // Both halves appear twice in the function — the write and the re-read — so a
    // missing one on either side is caught rather than masked by the other.
    expect((w.match(/eq\(conversationParticipants\.identityId, input\.identityId\)/g) || []).length).toBe(2);
    expect((w.match(/eq\(conversationParticipants\.conversationId, input\.conversationId\)/g) || []).length).toBe(2);
    // A no-op tap and a non-member both yield affectedRows 0, so it re-reads rather
    // than reporting an idempotent tap as a permission failure.
    expect(w).toMatch(/if \(!hit\) \{/);
    expect(w).toMatch(/return \{ ok: false, reason: "not-a-member" \}/);
  });

  it("pin and archive are mutually exclusive", () => {
    // A thread pinned to the top AND hidden in Archive is a contradiction the list
    // cannot render.
    const w = fn(V2DB, "setThreadState");
    expect(w).toMatch(/if \(input\.pinned === true\) set\.archivedAt = null;/);
    expect(w).toMatch(/if \(input\.archived === true\) set\.pinnedAt = null;/);
  });

  it("the endpoint resolves the caller itself and is no oracle over conversation ids", () => {
    const proc = ROUTERS.slice(
      ROUTERS.indexOf("  setThreadState: publicProcedure"),
      ROUTERS.indexOf("  hide: publicProcedure"),
    );
    expect(proc).toMatch(/const me = requireIdentity\(ctx\)/);
    expect(proc).toMatch(/identityId: me\.id/);
    expect(proc).toMatch(/That conversation isn't there\./);
  });
});

describe("pin, unread and archive change what the list DOES", () => {
  it("pinned sorts to the top — a pin that only draws a marker is not a pin", () => {
    // The sort lives in the PURE projection, not the query, which is also where a test
    // could drive it with real rows if the ordering ever grows a third term.
    const c = V2DB.slice(
      V2DB.indexOf("export function composeThreadSummaries"),
      V2DB.indexOf("\nexport async function listThreads"),
    );
    expect(c.length).toBeGreaterThan(400);
    expect(c).toMatch(/if \(a\.pinned !== b\.pinned\) return a\.pinned \? -1 : 1;/);
    // …and within each group the existing recency rule is untouched, so an unpinned
    // list sorts exactly as before.
    expect(c).toMatch(/return b\.lastMessageAt\.getTime\(\) - a\.lastMessageAt\.getTime\(\);/);
  });

  it("archived threads leave every other section and gather in their own", () => {
    // Out of the way but not gone, which is what archiving is.
    expect(MESSAGES).toMatch(/rows: list\.filter\(\(t\) => t\.kind !== "group" && !isNotes\(t\) && !t\.archived\)/);
    expect(MESSAGES).toMatch(/rows: list\.filter\(\(t\) => t\.kind === "group" && !t\.archived\)/);
    expect(MESSAGES).toMatch(/rows: list\.filter\(\(t\) => isNotes\(t\) && !t\.archived\)/);
    expect(MESSAGES).toMatch(/key: "archived"/);
    expect(MESSAGES).toMatch(/rows: list\.filter\(\(t\) => t\.archived\)/);
  });

  it("hand-marked unread shows a DOT, not an invented count", () => {
    // There is no number, and "1 new" would be a claim about a message that may not
    // exist. Withheld when a real count is already shown.
    expect(MESSAGES).toMatch(/\{!unread && t\.manualUnread && \(/);
    expect(MESSAGES).toMatch(/aria-label=\{tr\("msg\.markedUnread"\)\}/);
  });

  it("every action is a TOGGLE that reads the row's own state", () => {
    // An action that cannot be undone by the same gesture that did it is a trap.
    expect(MESSAGES).toMatch(/label: t\.pinned \? tr\("msg\.unpin"\) : tr\("msg\.pin"\)/);
    expect(MESSAGES).toMatch(/label: t\.archived \? tr\("msg\.unarchive"\) : tr\("msg\.archive"\)/);
    expect(MESSAGES).toMatch(/label: t\.manualUnread \? tr\("msg\.markRead"\) : tr\("msg\.markUnread"\)/);
    expect(MESSAGES).toMatch(/pinned: !t\.pinned/);
    expect(MESSAGES).toMatch(/archived: !t\.archived/);
    expect(MESSAGES).toMatch(/unread: !t\.manualUnread/);
  });
});

describe("deleting a thread is recoverable, and says so", () => {
  it("it stamps the newest message id rather than bulk-hiding every message", () => {
    // One column, and the filter rides the (conversationId, id) index — the shape
    // `identities.historyClearedAt` has used for the call log since v2.75.
    const w = fn(V2DB, "setThreadState");
    expect(w).toMatch(/if \(input\.clear\) \{/);
    expect(w).toMatch(/orderBy\(desc\(messages\.id\)\)/);
    expect(w).toMatch(/if \(newest\) set\.clearedUpToMessageId = newest\.id;/);
    // An empty conversation stamps nothing: id 0 would be a claim that message 0 exists.
    expect(codeOnly(w)).not.toMatch(/clearedUpToMessageId = 0/);
  });

  it("clearing also drops the badge and leaves Archive", () => {
    // A hidden thread with a live badge counts toward a total nobody can act on, and a
    // cleared thread sitting in Archive would have no messages in it.
    const w = fn(V2DB, "setThreadState");
    const clear = w.slice(w.indexOf("if (input.clear) {"), w.indexOf("if (Object.keys(set)"));
    expect(clear).toMatch(/set\.unreadCount = 0;/);
    expect(clear).toMatch(/set\.manualUnreadAt = null;/);
    expect(clear).toMatch(/set\.archivedAt = null;/);
  });

  it("the messages are hidden for that person and nobody else", () => {
    expect(fn(V2DB, "listMessages")).toMatch(/clearedUpTo > 0 \? gt\(messages\.id, clearedUpTo\) : undefined/);
    // Search too, or the old messages come back the moment somebody types (the
    // v2.102.2 lesson).
    expect(fn(V2DB, "searchMessages")).toMatch(/clearedUpTo > 0 \? gt\(messages\.id, clearedUpTo\) : undefined/);
    // Read off the membership row both functions already fetch, so it costs no query.
    //
    // REWRITTEN IN v2.105.9 TO THE PROPERTY. This froze the exact expression
    // `member[0]?.clearedUpToMessageId ?? 0`, which #114 replaces with a shared
    // `visibleFloorFor(member[0])` composing the clear watermark with a later JOIN
    // watermark by max. Frozen, it forbade that consolidation while saying nothing about
    // whether a cleared thread's messages are actually hidden. What matters is that the
    // floor is derived from the already-fetched membership row (no extra query) and that
    // the CLEARED column is one of its inputs.
    expect(fn(V2DB, "listMessages")).toMatch(/visibleFloorFor\(member\[0\] \?\? \{\}\)/);
    expect(fn(V2DB, "searchMessages")).toMatch(/visibleFloorFor\(member\[0\] \?\? \{\}\)/);
    // `visibleFloorFor` is `export function`, not `export async function`, so the helper
    // above cannot find it — sliced by hand rather than loosening a locator twenty other
    // assertions depend on.
    // …and bounded by the RETURN rather than by the next `\n}`, which is the end of the
    // destructured PARAMETER object — the same brace-matching trap that bit twice while
    // writing this release.
    const floorAt = V2DB.indexOf("export function visibleFloorFor");
    expect(floorAt).toBeGreaterThan(-1);
    const ret = V2DB.indexOf("return Math.max(", floorAt);
    expect(ret).toBeGreaterThan(floorAt);
    const floorFn = V2DB.slice(ret, V2DB.indexOf(";", ret));
    expect(floorFn).toMatch(/clearedUpToMessageId \?\? 0/);
    expect(floorFn).toMatch(/joinedAtMessageId \?\? 0/);
  });

  it("the thread RETURNS by itself when something newer arrives — no write on send", () => {
    const lt = fn(V2DB, "listThreads");
    // Compared against the id the groupwise-max already produced, so the reappear rule
    // costs neither an extra query nor a write on the hot send path.
    expect(lt).toMatch(/if \(!newest \|\| newest\.id <= upTo\) \{/);
    expect(lt).toMatch(/clearedHidden\.add\(convoId\)/);
    // Dropped BEFORE the projection, so nothing downstream sees it. Note this differs
    // from a per-MESSAGE hide, where the thread STAYS with no preview: here the person
    // asked for the thread itself to go.
    expect(lt).toMatch(/\.filter\(\(p\) => !clearedHidden\.has\(p\.conversationId\)\)/);
  });

  it("it is the ONLY action behind a confirmation, and the copy names what survives", () => {
    expect(copyOnScreen(MESSAGES, "Delete this chat for you?")).toBe(true);
    expect(copyOnScreen(MESSAGES, "Everyone else keeps")).toBe(true);
    expect(copyOnScreen(MESSAGES, "comes back here if they message you again")).toBe(true);
    // The other four are undone by the same gesture, so a dialog on them would be noise.
    expect(MESSAGES).toMatch(/onSelect: \(\) =>\s*\n\s*setClearingThread\(/);
    /* …and deleting the OPEN thread navigates away, rather than leaving an empty
       conversation nobody can escape except with Back.

       REWRITTEN TO THE PROPERTY (v2.106.2): this froze the literal `/app/messages`, which
       the Groups tab made wrong — that tab is the same page at `/app/groups`, so a
       hardcoded target would move the user to Messages mid-delete. The property is that
       the guard fires and navigates to the tab's OWN base path, not that the path is
       spelled one particular way. */
    expect(MESSAGES).toMatch(
      /if \(activeConvoId === clearingThread\.conversationId\) setLocation\(basePath\)/,
    );
    // `basePath` really is the current tab, not a constant that happens to be named that.
    expect(MESSAGES).toMatch(/loc\.startsWith\("\/app\/groups"\) \? "\/app\/groups" : "\/app\/messages"/);
  });
});
