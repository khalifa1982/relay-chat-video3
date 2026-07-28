import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GROUP_PALETTE, peerPaletteIndex } from "@/app/peerColors";
import { codeOnly } from "../../../../server/testing/codeOnly";

const R = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const MSG = R("client/src/pages/app/Messages.tsx");
const ROUTERS = R("server/v2routers.ts");
const OVERLAYS = R("client/src/app/PeerOverlays.tsx");


const THUMB = MSG.slice(MSG.indexOf("function SenderThumb"), MSG.indexOf("export default function MessagesPage"));

/**
 * v2.103.3 — the sender's thumbnail in a group row, and sixteen bubble colours.
 *
 * Owner (a screenshot batch about groups): *"every user gets a different bubble colour
 * (up to 16) … each user's message shows a small clickable thumbnail of their profile
 * image beside their name on the left, opening their status/story … show name,
 * message/attachment content, date and time; group by day with a header at the top of
 * each day."*
 *
 * THREE OF THOSE FOUR WERE ALREADY BUILT, and this file pins that they were not
 * rebuilt — which is the expensive failure in a codebase this mature:
 *   · per-person bubble colours have existed since v2.99.85 (`peerColors.ts`), so the
 *     owner's "up to 16" is a palette WIDENING from ten, not a new mechanism;
 *   · day grouping with a header at the top of each day has existed since v2.71
 *     (`dayKey` / `dayLabel` / `showDay`), giving Today / Yesterday / "June 28, 2026";
 *   · a message from a previous day already carries its DATE as well as its time
 *     (`formatTime`, v2.99.73) — today's messages deliberately show time only, because
 *     repeating today's date forty times is noise.
 * The genuinely missing piece was the thumbnail, and it needed NO server change:
 * `conversationInfo` has always returned each member's number and avatarUrl, and the
 * roster memo was simply discarding both.
 *
 * THE LOAD-BEARING PART IS THE GUTTER, NOT THE AVATAR. `PeerAvatar` draws its story
 * ring only when the person HAS a story, so its footprint is 28px without one and
 * ~36px with one. Placed bare in the row that would make every bubble's left edge
 * depend on somebody else's story state, and make the whole column jump when a story
 * expired 24 hours later. Measured headlessly against the real built stylesheet at
 * 320 / 375 / 390 / 430: with the fixed gutter the bubble's left edge is 54px in all
 * three states (ring, no ring, stacked spacer), the ringed avatar fits its 36px gutter
 * exactly, and there is no horizontal overflow. A unit test cannot re-run that, so
 * what it pins below is every source rule the measurement rests on.
 */
describe("v2.103.3 — the sender thumbnail", () => {
  it("reuses PeerAvatar rather than drawing a second avatar", () => {
    // PeerAvatar already owns the photo, the initials fallback when a photo 403s, the
    // story ring and the tap that opens the story or the profile. A second avatar here
    // is how two surfaces come to disagree about the same person.
    expect(THUMB.length).toBeGreaterThan(300);
    expect(THUMB).toMatch(/<PeerAvatar/);
    expect(THUMB).toMatch(/size=\{28\}/);
    // v2.105.6: the import became multi-line (the group story ring needs two more
    // symbols from the same module), so the property is that PeerAvatar comes from
    // PeerOverlays — not that the import fits on one line.
    const imp = MSG.slice(MSG.indexOf("import {"), MSG.indexOf('from "@/app/PeerOverlays";') + 30);
    expect(imp).toContain("PeerAvatar");
    expect(imp).toContain('from "@/app/PeerOverlays"');
    // …and no hand-rolled <img>/initials disc inside the thumb.
    expect(codeOnly(THUMB)).not.toMatch(/<img\b/);
  });

  it("the gutter is FIXED WIDTH and cannot be shrunk", () => {
    // The property the whole component exists for. w-9 = 36px = the ringed footprint.
    expect(THUMB).toMatch(/className="w-9 shrink-0 self-start grid place-items-center"/);
  });

  it("the gutter renders UNCONDITIONALLY and only the avatar inside is gated", () => {
    // If the span itself were conditional, a stacked run would lose its spacer and
    // those bubbles would slide left — the run visibly breaking mid-conversation.
    const span = THUMB.slice(THUMB.indexOf("<span className=\"w-9"));
    expect(span.length).toBeGreaterThan(100);
    // The conditional sits INSIDE the span, after it opens.
    expect(span.indexOf("{show &&")).toBeGreaterThan(0);
    expect(span.indexOf("{show &&")).toBeLessThan(span.indexOf("</span>"));
    // The span is not itself wrapped in a `show` test.
    expect(codeOnly(THUMB)).not.toMatch(/show &&\s*\(?\s*<span className="w-9/);
  });

  it("aligns with the sender NAME at the top, not the bubble's bottom", () => {
    // The row is `items-end` so the bubble tails line up; without self-start a 36px
    // avatar would sink to the bottom of a tall bubble, away from the name it labels.
    expect(THUMB).toMatch(/self-start/);
    expect(MSG).toMatch(/"group flex items-end gap-1\.5 "/);
  });

  it("a sender who has left the roster gets a NON-clickable avatar, not a dead button", () => {
    // PeerAvatar's own open() returns early with no number, so without this it would
    // render a focusable button that does nothing when tapped.
    expect(THUMB).toMatch(/clickable=\{!!member\?\.number\}/);
    expect(OVERLAYS).toMatch(/if \(!number\) return;/);
  });

  it("is mounted ONCE, in the row shared by every message shape", () => {
    // Three copies is exactly how three copies of the sender LABEL came to exist
    // (v2.99.85 had to keep them in sync by hand). The row container wraps both the
    // emoji-only branch and the ordinary bubble branch, so one insertion covers the
    // attachment, status-reply, emoji and text shapes alike.
    expect(MSG.match(/<SenderThumb\b/g)?.length).toBe(1);
    const rowAt = MSG.indexOf('"group flex items-end gap-1.5 "');
    const thumbAt = MSG.indexOf("<SenderThumb");
    const menuAt = MSG.indexOf("<MessageMenu");
    expect(rowAt).toBeGreaterThan(0);
    // Inside the row, and before the first MessageMenu so it is the leftmost child.
    expect(thumbAt).toBeGreaterThan(rowAt);
    expect(thumbAt).toBeLessThan(menuAt);
  });

  it("only for a group, and only for somebody else's message", () => {
    expect(MSG).toMatch(/\{isGroup && !mine && \(\s*<SenderThumb member=\{memberById\.get\(m\.senderIdentityId\)\} show=\{!sameAsPrev\} \/>/);
  });

  it("the roster memo keeps the number and avatar the old one discarded", () => {
    expect(MSG).toMatch(/const memberById = useMemo\(/);
    const memo = MSG.slice(MSG.indexOf("const memberById = useMemo("));
    const body = memo.slice(0, memo.indexOf("}, [infoQuery.data]);"));
    expect(body.length).toBeGreaterThan(100);
    expect(body).toMatch(/number: mem\.number/);
    expect(body).toMatch(/avatarUrl: mem\.avatarUrl \?\? null/);
    // nameById is left ALONE — it has four other readers that want a plain string.
    expect(MSG).toMatch(/const nameById = useMemo\(/);
    expect(MSG.match(/nameById\.get\(/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("needs NO server change — conversationInfo already returned both fields", () => {
    const proc = ROUTERS.slice(ROUTERS.indexOf("  conversationInfo: publicProcedure"));
    const body = proc.slice(0, proc.indexOf("  list: publicProcedure"));
    expect(body.length).toBeGreaterThan(200);
    expect(body).toMatch(/number: i\.number/);
    expect(body).toMatch(/avatarUrl: i\.avatarUrl \?\? null/);
    // And it stays members-only, which is what makes the roster safe to render.
    expect(body).toMatch(/code: "FORBIDDEN"/);
  });
});

describe("v2.103.3 — sixteen bubble colours", () => {
  it("the palette is sixteen, as asked", () => {
    // "every user gets a different bubble colour (up to 16)".
    expect(GROUP_PALETTE.length).toBe(16);
  });

  it("every one of the sixteen is REACHABLE, so widening actually took effect", () => {
    // The failure this catches: adding entries while something still divides by a
    // hardcoded 10 would leave the last six unreachable and the widening cosmetic.
    const seen = new Set<number>();
    for (let id = 1; id <= 20_000 && seen.size < GROUP_PALETTE.length; id++) seen.add(peerPaletteIndex(id));
    expect(seen.size).toBe(GROUP_PALETTE.length);
  });

  it("the six new hues are distinct from the ten that existed", () => {
    // messagingColors.test.ts already pins global distinctness, valid hex, the
    // blue/orange exclusion and name/bubble agreement — this only asserts that the
    // second six are genuinely new rather than near-duplicates of the first ten.
    const first10 = GROUP_PALETTE.slice(0, 10).map((c) => c.from.toLowerCase());
    const next6 = GROUP_PALETTE.slice(10).map((c) => c.from.toLowerCase());
    expect(next6.length).toBe(6);
    for (const hue of next6) expect(first10, `${hue} duplicates an original`).not.toContain(hue);
    // Each new entry carries its own light text tint, or two senders' NAMES would
    // render identically even though their bubbles differ.
    const texts = GROUP_PALETTE.map((c) => c.text.toLowerCase());
    expect(new Set(texts).size).toBe(GROUP_PALETTE.length);
  });
});

describe("v2.103.3 — what was already built and deliberately NOT rebuilt", () => {
  it("day grouping with a header at the top of each day still exists untouched", () => {
    // The owner asked for this and it has worked since v2.71. Re-implementing it was
    // the likeliest waste in this batch, so its absence from the diff is pinned.
    /* REWRITTEN in v2.105.3. The original froze WHERE the rule lived — three
       assertions on functions defined inside Messages.tsx and one on a per-message
       `showDay` flag — so it broke the moment the header became a per-day
       <section>'s, while never actually checking that a header appears at the top
       of each day. That property is what this now asserts, and the labels
       themselves are covered behaviourally against the real function in
       stickyDayHeader.test.ts. */
    expect(MSG).toMatch(/from "@\/app\/messageDays"/);
    expect(MSG).toMatch(/groupMessagesByDay\(messagesQuery\.data \?\? \[\]\)/);
    const sec = MSG.slice(MSG.indexOf("<section key={day.key}"));
    expect(sec.length).toBeGreaterThan(200);
    expect(sec.indexOf("{day.label}")).toBeGreaterThan(0);
    // The header comes BEFORE that day's messages — at the top of each day.
    expect(sec.indexOf("{day.label}")).toBeLessThan(sec.indexOf("day.items.map"));
  });

  it("a message from a previous day already shows its DATE as well as its time", () => {
    // "show name, message/attachment content, date and time". Today is time-only on
    // purpose; an older day carries the date. Both halves pinned so neither drifts.
    const ft = MSG.slice(MSG.indexOf("function formatTime("));
    const body = ft.slice(0, ft.indexOf("\n}"));
    expect(body.length).toBeGreaterThan(100);
    expect(body).toMatch(/if \(sameDay\) return time;/);
    expect(body).toMatch(/return `\$\{day\}\$\{year\} · \$\{time\}`/);
  });

  it("the sender's NAME still renders in their own colour at every message shape", () => {
    // Three sites, deliberately kept in sync (v2.99.85). The thumbnail sits beside
    // them rather than replacing them — an icon alone gives a screen reader nothing.
    expect(MSG.match(/nameColorFor\(\{ isGroup, senderIdentityId: m\.senderIdentityId \}\)/g)?.length).toBe(3);
  });
});
