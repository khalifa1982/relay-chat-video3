/**
 * The day header stays on screen while you scroll through that day (v2.105.3).
 *
 * The CSS half is not testable here and was MEASURED instead — headless Chromium
 * against the real built stylesheet at 320/375/390/430/1280, confirming the
 * header pins at the scrollport's padding edge, rides its whole day, hands off to
 * the next day, never escapes its own section, and paints below the search
 * overlay. What this file pins is the structure that measurement rests on, plus
 * the grouping rule, which IS pure and therefore testable behaviourally.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { dayKey, dayLabel, groupMessagesByDay } from "@/app/messageDays";
import { codeOnly } from "../../../../server/testing/codeOnly";

const SRC = fs.readFileSync(path.resolve(__dirname, "Messages.tsx"), "utf8");
const CODE = codeOnly(SRC);

const at = (iso: string) => ({ createdAt: iso, id: iso });

describe("groupMessagesByDay", () => {
  it("returns nothing for an empty conversation", () => {
    expect(groupMessagesByDay([])).toEqual([]);
  });

  it("puts one day's messages in one group", () => {
    const gs = groupMessagesByDay([
      at("2026-06-26T08:00:00"),
      at("2026-06-26T12:30:00"),
      at("2026-06-26T23:59:00"),
    ]);
    expect(gs).toHaveLength(1);
    expect(gs[0].items).toHaveLength(3);
  });

  it("splits at the calendar boundary, in order", () => {
    const gs = groupMessagesByDay([
      at("2026-06-26T23:59:00"),
      at("2026-06-27T00:01:00"),
      at("2026-06-27T09:00:00"),
      at("2026-06-28T09:00:00"),
    ]);
    expect(gs.map((g) => g.items.length)).toEqual([1, 2, 1]);
  });

  it("carries every message's ORIGINAL flat index", () => {
    // Load-bearing, not bookkeeping: the stacking rules read each message's
    // neighbours in the flat list, and two of those comparisons legitimately
    // cross a day boundary. An index relative to the day slice would silently
    // change which messages are considered adjacent.
    const gs = groupMessagesByDay([
      at("2026-06-26T10:00:00"),
      at("2026-06-27T10:00:00"),
      at("2026-06-27T10:01:00"),
      at("2026-06-28T10:00:00"),
    ]);
    expect(gs.flatMap((g) => g.items.map((x) => x.index))).toEqual([0, 1, 2, 3]);
    expect(gs[1].items.map((x) => x.index)).toEqual([1, 2]);
  });

  it("gives every group a key unique among its siblings", () => {
    // React reuses a subtree when two children share a key. With a bare day key
    // an out-of-order list could produce the same key twice and the wrong day's
    // DOM — and therefore the wrong scroll position — would be reused.
    const gs = groupMessagesByDay([
      at("2026-06-26T10:00:00"),
      at("2026-06-27T10:00:00"),
      at("2026-06-26T11:00:00"),
    ]);
    expect(new Set(gs.map((g) => g.key)).size).toBe(gs.length);
  });

  it("starts a NEW group for a day that reappears, rather than reopening it", () => {
    // The honest rendering of out-of-order data: merging them would move a
    // message somewhere other than where the server put it, and a bubble that
    // silently jumps is worse than a repeated header.
    const gs = groupMessagesByDay([
      at("2026-06-26T10:00:00"),
      at("2026-06-27T10:00:00"),
      at("2026-06-26T11:00:00"),
    ]);
    expect(gs).toHaveLength(3);
    expect(gs[0].label).toBe(gs[2].label);
  });

  it("labels relative to a supplied 'now', so the label is deterministic", () => {
    const now = new Date("2026-06-28T15:00:00");
    expect(dayLabel("2026-06-28T09:00:00", now)).toBe("Today");
    expect(dayLabel("2026-06-27T09:00:00", now)).toBe("Yesterday");
    expect(dayLabel("2026-06-20T09:00:00", now)).toMatch(/June 20, 2026/);
  });

  it("labels the month boundary correctly (yesterday can be last month)", () => {
    const now = new Date("2026-07-01T10:00:00");
    expect(dayLabel("2026-06-30T23:00:00", now)).toBe("Yesterday");
  });

  it("keys on the LOCAL day, so the divider lands on the reader's midnight", () => {
    const a = new Date(2026, 5, 26, 0, 5);
    const b = new Date(2026, 5, 26, 23, 55);
    expect(dayKey(a)).toBe(dayKey(b));
    expect(dayKey(new Date(2026, 5, 27, 0, 5))).not.toBe(dayKey(b));

    /* AND STRUCTURALLY, because in a UTC environment no behavioural test can
       tell the two apart — a mutation swapping every accessor for its getUTC*
       twin left the assertions above green on this runner, while shifting the
       date divider by hours for most of the world. The property here IS "use the
       local accessors", so that is what is asserted. */
    const src = fs.readFileSync(path.resolve(__dirname, "..", "..", "app", "messageDays.ts"), "utf8");
    const body = src.slice(src.indexOf("export function dayKey"), src.indexOf("export function dayLabel"));
    expect(body.length).toBeGreaterThan(80);
    expect(body).toMatch(/getFullYear\(\)/);
    expect(body).toMatch(/getMonth\(\)/);
    expect(body).toMatch(/getDate\(\)/);
    expect(body).not.toMatch(/getUTC/);
  });
});

describe("Messages.tsx — the sticky day header's structure", () => {
  it("renders one <section> per day, with the header inside it", () => {
    // The header used to live inside the FIRST MESSAGE's wrapper. `position:
    // sticky` is bounded by its containing block, so there it would unstick the
    // instant that single bubble scrolled past — which is why this needed a
    // structural change rather than one class.
    expect(CODE).toMatch(/groupMessagesByDay\(messagesQuery\.data \?\? \[\]\)\.map\(\(day\) => \(/);
    expect(CODE).toMatch(/<section key=\{day\.key\}/);
    const sec = CODE.slice(CODE.indexOf("<section key={day.key}"));
    const hdrAt = sec.indexOf("sticky top-0");
    const itemsAt = sec.indexOf("day.items.map");
    expect(hdrAt).toBeGreaterThan(0);
    expect(itemsAt).toBeGreaterThan(hdrAt); // header precedes the day's messages
  });

  it("is sticky at the top, above the bubbles and below the overlays", () => {
    const hdr = CODE.slice(CODE.indexOf("sticky top-0"), CODE.indexOf("sticky top-0") + 400);
    expect(hdr).toMatch(/sticky top-0 z-10/);
    // The search overlay is z-20 and the lightbox z-[90]; a date pill floating
    // over an opened photo would be absurd. Measured too, by hit-test.
    const z = /z-(\d+)/.exec(hdr);
    expect(z).toBeTruthy();
    expect(Number(z![1])).toBeLessThan(20);
  });

  it("the pill is OPAQUE, because it overlaps scrolling content", () => {
    /* While the pill sat in the flow, `bg-muted/70` was invisible as a defect. The moment it
       pins, bubbles pass behind it — and a translucent pill with text sliding through it is
       unreadable.

       REWRITTEN (v2.106.62): this froze `bg-muted`. Board 3c draws no pill at all, and the way
       to have both is a backing that MATCHES the scroller's own surface — invisible against it,
       still occluding — so the token moved to `bg-background md:bg-card`. Opacity is the rule;
       which opaque token carries it is not. */
    const at = CODE.indexOf("sticky top-0");
    const hdr = CODE.slice(at, at + 700);
    expect(hdr, "an opaque surface token").toMatch(/bg-(?:muted|background|card|popover)\b/);
    expect(hdr, "never alpha-modified").not.toMatch(/bg-(?:muted|background|card|popover)\/\d/);
    expect(hdr, "and never fully transparent").not.toMatch(/bg-transparent/);
  });

  it("exactly ONE day header is mounted", () => {
    // Two would drift, and this pill already exists on three other surfaces'
    // worth of history.
    expect(CODE.match(/sticky top-0 z-10 flex justify-center/g) ?? []).toHaveLength(1);
  });

  it("keeps the day comparison that stops 23:59 stacking with 00:01", () => {
    // It used to ride on `!showDay`, a variable the section header replaced. If
    // it were dropped, two messages two minutes apart would be stacked as one
    // run — straddling the header just inserted between them.
    const same = CODE.slice(CODE.indexOf("const sameAsPrev ="), CODE.indexOf("const sameAsNext ="));
    expect(same.length).toBeGreaterThan(60);
    expect(same).toMatch(/dayKey\(prev\.createdAt\) === dayKey\(m\.createdAt\)/);
    expect(same).toMatch(/senderIdentityId === m\.senderIdentityId/);
    expect(same).toMatch(/GROUP_MS/);
  });

  it("indexes messages against the FLAT array, not the day slice", () => {
    const body = CODE.slice(CODE.indexOf("day.items.map"), CODE.indexOf("const GROUP_MS"));
    expect(body).toMatch(/day\.items\.map\(\(\{ item: m, index: i \}\) =>/);
    expect(body).toMatch(/const arr = messagesQuery\.data \?\? \[\];/);
    expect(body).toMatch(/const prev = arr\[i - 1\];/);
    expect(body).toMatch(/const next = arr\[i \+ 1\];/);
  });

  it("has ONE definition of the day rule, in the shared module", () => {
    // Two copies of "which day is this" is how two surfaces come to disagree
    // about where a divider goes.
    expect(SRC).toMatch(/from "@\/app\/messageDays"/);
    expect(CODE).not.toMatch(/function dayKey\(/);
    expect(CODE).not.toMatch(/function dayLabel\(/);
  });

  it("no longer computes a per-message showDay flag", () => {
    // The header is the section's now. A leftover flag would render a second
    // pill inside the day it belongs to.
    expect(CODE).not.toMatch(/const showDay =/);
    expect(CODE).not.toMatch(/\{showDay &&/);
  });
});
