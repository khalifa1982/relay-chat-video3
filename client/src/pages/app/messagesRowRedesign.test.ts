import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const M = read("client/src/pages/app/Messages.tsx");

/** The thread-row block only (so a match elsewhere in this 2000-line file can't
 *  pass a row assertion). */
const ROW = M.slice(M.indexOf("cat.rows.map((t) => {"), M.indexOf("})}", M.indexOf("cat.rows.map((t) => {")));

/**
 * v2.99.37 — MESSAGES THREAD-LIST REDESIGN (owner brief + the Snapchat chat-list
 * screenshot they supplied as the reference).
 *
 * Owner, verbatim: "redesign the message section … the icon, the name, showing
 * typing when he's typing indicators. Down, it shows you message. Put the PIN
 * number. Put verified beside his name. If he has a status. I needed to redesign
 * and make it very flexible for the eyes, NOT compact. … no need to put message,
 * dial, voice, this outside. If you go inside the message you will see it in the
 * top bar … no need to put the message because you're already in the message
 * section. So act, think professional as perfect designer."
 *
 * Chosen by a 3-design / 3-judge panel (winner "Quiet Two-Line", 87.5 pts) with
 * the grafts all three judges independently agreed on — chiefly moving the
 * timestamp to the end of line 1.
 */
describe("v2.99.37 — the row is airy: avatar + exactly two text lines", () => {
  it("no dividers — separation is whitespace (rounded inset row, generous padding)", () => {
    expect(ROW).toMatch(/rounded-2xl mx-1\.5 my-0\.5 px-3 py-3\.5/);
    // ANCHORED: `border-b` is a PREFIX of `border-border`, so an ordinary border
    // anywhere in the row tripped this (the group avatar's, in v2.102.0). The
    // negative lookahead pins the bottom-border UTILITY, which is what the old
    // per-row divider used.
    expect(ROW).not.toMatch(/border-b(?![a-z-])/);
  });
  it("the avatar is LARGE (60px) and keeps its status ring + presence LED", () => {
    expect(ROW).toMatch(/<PeerAvatar[\s\S]{0,400}size=\{60\}/);
    // v2.99.92 moved the LED onto the shared `presenceDot` helper so the new idle
    // state could not be learnt by some dots and not others. The property this line
    // guards — the row HAS a presence LED with an accessible label — is unchanged.
    expect(ROW).toMatch(/presenceDot\(\{ isOnline: t\.peerIsOnline, idle: t\.peerIdle \}\)/);
    expect(ROW).toMatch(/aria-label=\{dot\.label\}/);
  });
  it("the name is the biggest thing in the row (19px) and goes bold when unread", () => {
    expect(ROW).toMatch(/text-\[19px\]/);
    expect(ROW).toMatch(/\(unread \? "font-bold" : "font-semibold"\)/);
  });
  it("nothing that can WRAP has a fixed height (a hard-coded one clipped a badge)", () => {
    /* The lookbehinds let `min-h-…` through on purpose: a MINIMUM height sets the row's
       rhythm and still grows for a wrapped line — a fixed `h-…` cannot.

       v2.106.67 NARROWED THIS TO WHAT IT IS FOR. It banned EVERY `h-[Npx]` in the row,
       which is broader than the defect: the bug was a hard-coded 16px on a text LINE, so
       a badge on that line was clipped. A fixed-size CENTRED PUCK — board 1c's 17px unread
       badge, `grid place-items-center` — cannot clip anything, because its height is its
       own and its content is centred in it. Banning those too made the rule forbid the
       board's own row badge while saying nothing about the clipping it exists to prevent.

       So a fixed height is allowed exactly when the element centres its content, and
       forbidden otherwise. `h-4` stays banned outright: it is the line height that caused
       the original defect and nothing in this row legitimately wants it. */
    expect(ROW).not.toMatch(/(?<![\w-])h-4(?![\w.[])/);
    for (const m of ROW.matchAll(/className=(?:"([^"]*)"|\{[^}]*?"([^"]*)")/g)) {
      const cls = m[1] ?? m[2] ?? "";
      if (!/(?<![\w-])h-\[\d+px\]/.test(cls)) continue;
      expect(
        /place-items-center|items-center/.test(cls),
        `a fixed height on something that is not a centred puck can clip:\n  ${cls}`,
      ).toBe(true);
    }
  });
});

describe("v2.99.37 — every element the owner listed is present", () => {
  it("the tier/verified mark sits BESIDE the name (caption-less, so it can't clip)", () => {
    expect(ROW).toMatch(/const tier = isDm \? roleFromFlags\(t\.peerRole, t\.peerVerified\) : null;/);
    expect(ROW).toMatch(/<RoleBadge role=\{tier\} size=\{16\} caption=\{false\}/);
  });
  it("the PIN is shown, formatted NNN-NNN, for 1:1 threads only", () => {
    // REWRITTEN in v2.102.0: a GROUP now has its own 6-digit id too, so the number
    // is no longer 1:1-only. The property is that the row shows the number of
    // whatever the row is ABOUT, and notes-to-self shows none (that is me).
    expect(ROW).toMatch(/const ownNumber = isGroup \? t\.groupNumber : isDm \? t\.peerNumber : null;/);
    expect(ROW).toMatch(/ownNumber && \/\^\\d\{6\}\$\/\.test\(ownNumber\)/);
    expect(ROW).toMatch(/\$\{ownNumber\.slice\(0, 3\)\}-\$\{ownNumber\.slice\(3\)\}/);
    // …and the row's title is no longer the only thing naming a group, so a group
    // row must be able to reach a number at all: the old assertion pinned
    // `t.peerNumber`, which for a group is undefined.
    expect(ROW).toMatch(/t\.groupNumber/);
  });
  it("typing REPLACES the preview while they type", () => {
    expect(ROW).toMatch(/const typing = typingConvos\.includes\(t\.conversationId\)/);
    /* REWRITTEN v2.105.20 to the PROPERTY. `{typing ? (` froze the exact condition, so
       it broke the moment a LOCKED group started suppressing the indicator — while
       saying nothing about what it was for. The property is that typing and the
       preview are the two arms of ONE ternary, so they can never both render; the
       condition itself is free to gain a conjunct. */
    expect(ROW).toMatch(/\{typing[^?\n]*\? \(/);
    expect(ROW).toMatch(/\{preview\}/);
    expect((ROW.match(/\{preview\}/g) || []).length).toBe(1);
  });
  it("the timestamp is right-aligned at the end of line 1 (all three judges' graft)", () => {
    // REWRITTEN in v2.103.0: a PINNED row shows a pin marker before the timestamp, and
    // `ms-auto` moves to whichever of the two comes first — otherwise both would claim
    // it and the timestamp would stop ending the line. The PROPERTY is that the line's
    // last element is pushed right and stays tabular, either way.
    /* LOGICAL, not physical (#156's RTL pass): this padding sits at the START of the
       timestamp, and in Arabic the start edge is the RIGHT one — `pl-` would put it on
       the wrong side of the number. `ms-auto` was already logical, so this makes the two
       agree rather than introducing the idea. */
    expect(ROW).toMatch(/t\.pinned \? "shrink-0 ps-1\.5 " : "ms-auto shrink-0 ps-1 "/);
    expect(ROW).not.toMatch(/\bpl-1(\.5)?\b/);
    expect(ROW).toMatch(/text-\[11\.5px\] tabular-nums/);
    /* RE-ANCHORED (v2.106.42): this required the `<Pin` to be the very next thing after
       `{t.pinned && (`, so a COMMENT between them broke it — while saying nothing about the
       property, which is only that the marker renders under that gate and claims `ms-auto`. */
    const gate = ROW.indexOf("{t.pinned && (");
    expect(gate).toBeGreaterThan(-1);
    const marker = ROW.indexOf("<Pin", gate);
    expect(marker, "the marker renders inside the pinned gate").toBeGreaterThan(gate);
    expect(ROW.slice(marker, marker + 200)).toMatch(/className="ms-auto size-3\.5 shrink-0/);
  });
  it("the unread count is bounded and never a WHITE pill", () => {
    /* v2.106.67 REWROTE THIS. It read "colour + weight, not a heavy pill" and froze the
       literal `{n} new` — but board 1c's own row markup IS a pill
       (`min-width:17px;height:17px;border-radius:10px;background:var(--rb);color:#04211a`),
       so the pin forbade the board while citing the reference. The comment it came from
       named "the reference's '2 New Chats' treatment", which is a SECTION heading
       elsewhere on the board rather than this badge — reasoning about the wrong element.

       WHAT ACTUALLY MATTERED IN THE OLD RULE SURVIVES, and it is the second line: the
       badge must not be the generic white-on-neutral pill. It is the ACCENT with the
       on-accent token, which `threadRowFrame.test.ts` pins. Here: the count is BOUNDED
       (a four-digit backlog must not stretch the row) and it is not white. */
    expect(ROW).toMatch(/\{t\.unreadCount > 99 \? "99\+" : t\.unreadCount\}/);
    expect(ROW, "the old white badge pill").not.toMatch(/rounded-full text-white text-\[10/);
    const at = ROW.indexOf("aria-label={`${t.unreadCount} unread`}");
    expect(at, "the unread count is gone").toBeGreaterThan(-1);
    expect(ROW.slice(at, at + 400), "the badge must not be white").not.toMatch(/text-white/);
  });
});

describe("v2.99.37 — the per-row call/message buttons are GONE (owner)", () => {
  it("the row renders no AccentCircle action cluster any more", () => {
    expect(ROW).not.toMatch(/AccentCircle/);
  });
  it("the row links to no dialer deep-link — voice/video live in the conversation header", () => {
    expect(ROW).not.toMatch(/dialer\?to=/);
    // …and that header still has them, so nothing was actually lost.
    expect(M).toMatch(/dialer\?to=\$\{encodeURIComponent\(thread\.peerNumber\)\}&voice=1/);
    expect(M).toMatch(/dialer\?to=\$\{encodeURIComponent\(thread\.peerNumber\)\}&video=1/);
  });
  it("the whole text column is ONE tap that opens the thread", () => {
    /* REWRITTEN TO THE PROPERTY (v2.106.2): this froze the literal `/app/messages?c=`,
       which the Groups tab made wrong — that tab is this same page at `/app/groups`, so
       a hardcoded target would jump the user to the Messages tab on opening a group. The
       property is that the row's tap opens THIS thread on the CURRENT tab. */
    expect(ROW).toMatch(/onClick=\{\(\) => setLocation\(`\$\{basePath\}\?c=\$\{t\.conversationId\}`\)\}/);
  });
});

describe("v2.99.37 — robustness the earlier rows got wrong", () => {
  it("the PIN and the time are bidi-isolated so an Arabic (RTL) name can't reorder them", () => {
    expect((ROW.match(/\[unicode-bidi:isolate\]/g) || []).length).toBeGreaterThanOrEqual(2);
    expect((ROW.match(/dir="ltr"/g) || []).length).toBeGreaterThanOrEqual(2);
  });
  it("the name uses dir=auto so an Arabic name renders in its own direction", () => {
    expect(ROW).toMatch(/dir="auto"/);
  });
  it("line 2 may wrap rather than starve the preview on a narrow phone", () => {
    expect(ROW).toMatch(/flex-wrap items-center gap-x-1\.5 gap-y-1/);
  });
  it("the avatar button stays OUTSIDE the row button (nested buttons are invalid)", () => {
    // Anchored on the row-open HANDLER rather than on the URL it navigates to, for the
    // same reason as above: the path moved with the Groups tab, and an anchor that names
    // it silently returns -1, which is LESS than any index and would have made this
    // comparison pass vacuously in the other direction.
    const avatarAt = ROW.indexOf("<PeerAvatar");
    const rowBtnAt = ROW.indexOf("onClick={() => setLocation(`${basePath}?c=");
    expect(avatarAt).toBeGreaterThan(0);
    expect(rowBtnAt).toBeGreaterThan(0);
    expect(rowBtnAt).toBeGreaterThan(avatarAt); // avatar is rendered first, as a sibling
  });
  it("group / notes-to-self / muted variants are all still handled", () => {
    /* REWRITTEN (v2.106.89): the group disc's glyph moved into the shared `GroupAvatar`,
       which draws it UNDERNEATH the photo so a failed load degrades to it rather than to
       a hole. The property is that a group row still renders a group disc at all. */
    expect(ROW).toMatch(/<GroupAvatar/);
    expect(ROW).toMatch(/<StickyNote className="size-7"/);
    expect(ROW).toMatch(/\{muted && <BellOff/);
  });
  it("the active thread is exposed to assistive tech, and motion is reduced-motion safe", () => {
    expect(ROW).toMatch(/aria-current=\{isActive \? "true" : undefined\}/);
    expect(ROW).toMatch(/motion-safe:animate-pulse/);
  });
});
