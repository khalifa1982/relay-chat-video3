/**
 * #115 — a story reply in the thread list carries its context.
 *
 * A one-tap story reaction IS an emoji-only message, so the inbox showed a floating ❤️
 * with nothing saying what it was about. The conversation bubble has said so since
 * v2.99.80; the thread list and the reply-quote line did not.
 *
 * THE COST NOTE THIS CLOSES WAS WRONG, and that is the finding. `OPEN-ITEMS.md` deferred
 * this as a performance decision — "adding `meta` touches the groupwise-max query every
 * client polls". It does not. That aggregate (`MAX(id) GROUP BY conversationId`) selects
 * two integer columns and is a SEPARATE query, untouched here; the row the projection
 * reads comes from a bare `.select()` over at most a few dozen PRIMARY KEYS, and `meta`
 * was already in it — the disappearing-message guard reads it on the adjacent line. So
 * the deferral was made against a cost that does not exist.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { composeThreadSummaries } from "./v2db";
import { statusReplyOf, isStatusReply, storyKindLabel, STORY_KIND_LABEL } from "@shared/statusReply";
import { previewOf, previewOfStoryReply } from "../client/src/app/messagePreview";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const DB = read("server/v2db.ts");
const ROUTERS = read("server/v2routers.ts");
const MESSAGES = read("client/src/pages/app/Messages.tsx");
const SHARED = read("shared/statusReply.ts");
const PREVIEW = read("client/src/app/messagePreview.ts");

/** Comment-stripped source — this repo has matched its own prose 16+ times. */
function code(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

/** A function's BODY. The first `{` after the name can be a destructured parameter
 *  (v2.105.9) or a `Promise<{…}>` return type (v2.105.27) — take the first brace
 *  reached with parens closed AND angle depth zero.
 *
 *  The depths are SEEDED FROM THE ANCHOR rather than assumed to start at zero: an
 *  anchor that already contains `(` (e.g. `function f(msg:`) otherwise leaves the
 *  counter at 0, and the parameter object's own `{` is taken as the body — the same
 *  trap, in a third position. */
function fnAt(src: string, decl: string): string {
  const i = src.indexOf(decl);
  expect(i).toBeGreaterThan(-1);
  const seed = (open: string, close: string) =>
    decl.split(open).length - decl.split(close).length;
  let par = seed("(", ")"), ang = seed("<", ">"), start = -1;
  for (let j = i + decl.length; j < src.length; j++) {
    const c = src[j];
    if (c === "(") par++;
    else if (c === ")") par--;
    else if (c === "<") ang++;
    else if (c === ">") ang--;
    else if (c === "{" && par === 0 && ang <= 0) { start = j; break; }
  }
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("unbalanced: " + decl);
}

describe("the marker parser is shared, and reads defensively", () => {
  it("accepts what `status.reply` actually stamps", () => {
    const m = statusReplyOf({ statusReply: { id: 7, kind: "image", excerpt: "hi" } });
    expect(m).toEqual({ id: 7, kind: "image", excerpt: "hi" });
    expect(isStatusReply({ statusReply: { id: 7, kind: "image" } })).toBe(true);
  });

  it("refuses anything that is not the real shape", () => {
    // It comes off a JSON column, so it may be anything at all.
    for (const bad of [
      null, undefined, 0, "x", [], {},
      { statusReply: null },
      { statusReply: "yes" },
      { statusReply: 1 },
      { statusReply: {} },
      { statusReply: { id: "7", kind: "image" } }, // id must be a NUMBER
      { statusReply: { id: 7 } },                   // kind is required
      { statusReply: { kind: "image" } },
    ]) {
      expect(statusReplyOf(bad)).toBeNull();
      expect(isStatusReply(bad)).toBe(false);
    }
  });

  it("caps the excerpt and drops a non-string one", () => {
    expect(statusReplyOf({ statusReply: { id: 1, kind: "text", excerpt: "y".repeat(500) } })!.excerpt!.length).toBe(80);
    expect(statusReplyOf({ statusReply: { id: 1, kind: "text", excerpt: 42 } })!.excerpt).toBeUndefined();
  });

  it("says STORY, never 'status' — the v2.101.0 vocabulary", () => {
    // These strings are user-facing, and that release fixed the word everywhere a
    // person can see it.
    for (const label of Object.values(STORY_KIND_LABEL)) {
      expect(label.toLowerCase()).not.toContain("status");
      expect(label.toLowerCase()).toContain("story");
    }
    expect(storyKindLabel("image")).toBe("📷 Photo story");
  });

  it("an unknown kind falls back to the bare word, not to nothing", () => {
    expect(storyKindLabel("something-new")).toBe("Story");
  });

  it("lives in shared/ and is imported by BOTH sides — one rule, two consumers", () => {
    expect(code(DB)).toMatch(/import \{ isStatusReply \} from "@shared\/statusReply"/);
    expect(code(MESSAGES)).toMatch(/from "@shared\/statusReply"/);
    // And the client no longer keeps its own copy, which is the whole point of moving it.
    expect(code(MESSAGES)).not.toMatch(/function statusReplyOf/);
    expect(code(MESSAGES)).not.toMatch(/STATUS_KIND_LABEL/);
  });
});

describe("the preview line", () => {
  it("names whose story it was, from the sender", () => {
    // A story reply is always a DM to the story's AUTHOR, so whoever did not send the
    // reply owns the story — which is what makes `mine` sufficient here.
    expect(previewOfStoryReply({ mine: false, kind: "text", body: "😂" })).toBe("↩ your story · 😂");
    expect(previewOfStoryReply({ mine: true, kind: "text", body: "😂" })).toBe("↩ their story · 😂");
  });

  it("falls through to the kind label when there is no body", () => {
    expect(previewOfStoryReply({ mine: false, kind: "image", body: null })).toBe("↩ your story · 📷 Photo");
    expect(previewOfStoryReply({ mine: false, kind: "text", body: "   " })).toBe("↩ your story · New message");
  });

  it("is SHORTER than the bubble's chip wording, which was measured to clip", () => {
    // Measured against the real built stylesheet: the preview span is 141px at 320px
    // and 181px at 360px, the chip's wording needs 193px, this needs 118px. What clips
    // is the END of the line — exactly the reaction that varies.
    const chip = "↩ Replied to your story · 😂";
    const shipped = previewOfStoryReply({ mine: false, kind: "text", body: "😂" });
    expect(shipped.length).toBeLessThan(chip.length);
  });

  it("leaves an ordinary preview byte-identical", () => {
    // The regression that matters most: every non-story-reply row must be untouched.
    expect(previewOf("text", "See you at 8")).toBe("See you at 8");
    expect(previewOf("image", null)).toBe("📷 Photo");
    expect(previewOf("audio", null)).toBe("🎤 Voice message");
    expect(previewOf("file", null)).toBe("📎 File");
    expect(previewOf("weird", null)).toBe("New message");
  });
});

describe("the projection derives it from the meta already in hand", () => {
  const base = {
    identityId: 1,
    others: [{ conversationId: 10, identityId: 2 }],
    otherIdentities: [{ id: 2, number: "222222", displayName: "Ben", avatarUrl: null }],
    myIdentity: { id: 1, number: "111111", displayName: "Ann", avatarUrl: null },
    convoRows: [{ id: 10, lastMessageAt: new Date(1000), kind: "dm" as const }],
  };
  const one = (latest: { body: string | null; kind: string; statusReply?: boolean; mine?: boolean } | null) =>
    composeThreadSummaries({
      ...base,
      myParts: [{ conversationId: 10, unreadCount: 0 }],
      latestMessageByConvo: new Map([[10, latest]]),
    })[0];

  it("carries both flags through", () => {
    const t = one({ body: "😂", kind: "text", statusReply: true, mine: false });
    expect(t.lastMessageStatusReply).toBe(true);
    expect(t.lastMessageMine).toBe(false);
  });

  it("defaults to FALSE for a thread with no visible message", () => {
    // A row with no preview must never claim to be a story reply.
    const t = one(null);
    expect(t.lastMessageStatusReply).toBe(false);
    expect(t.lastMessageMine).toBe(false);
    expect(t.lastMessagePreview).toBeNull();
  });

  it("defaults to FALSE when a caller omits them (an older shape)", () => {
    const t = one({ body: "hi", kind: "text" });
    expect(t.lastMessageStatusReply).toBe(false);
    expect(t.lastMessageMine).toBe(false);
  });

  it("requires an EXPLICIT true — a truthy value is not enough", () => {
    // `=== true` rather than a coercion, so a future caller passing a string or a 1
    // cannot silently turn every row into a story reply.
    const t = composeThreadSummaries({
      ...base,
      myParts: [{ conversationId: 10, unreadCount: 0 }],
      latestMessageByConvo: new Map([
        [10, { body: "x", kind: "text", statusReply: 1 as unknown as boolean, mine: "y" as unknown as boolean }],
      ]),
    })[0];
    expect(t.lastMessageStatusReply).toBe(false);
    expect(t.lastMessageMine).toBe(false);
  });

  it("derives them where the row is, not from a second query", () => {
    const fn = fnAt(DB, "export async function listThreads");
    expect(fn).toMatch(/statusReply: isStatusReply\(m\.meta\)/);
    expect(fn).toMatch(/mine: m\.senderIdentityId === identityId/);
    // The polled aggregate is untouched: it still selects two integer columns.
    expect(fn).toMatch(/MAX\(\$\{messages\.id\}\)/);
    const agg = fn.slice(fn.indexOf("const maxIdRows"), fn.indexOf("const latestIds"));
    expect(agg.length).toBeGreaterThan(100);
    expect(agg).not.toMatch(/meta|statusReply/);
  });

  it("the expire guard still wins — a locked body is never previewed", () => {
    // The story-reply marker must not become a way to describe a message whose text
    // is deliberately withheld.
    const fn = fnAt(DB, "export async function listThreads");
    const iExpire = fn.indexOf("expire");
    const iReply = fn.indexOf("statusReply: isStatusReply");
    expect(iExpire).toBeGreaterThan(-1);
    expect(iReply).toBeGreaterThan(iExpire);
  });
});

describe("what reaches the browser", () => {
  it("the two booleans are threaded explicitly, and the raw meta is NOT", () => {
    // `meta` carries the replied-to story's own excerpt. The list has no room for it
    // and no reason to hold it, and this projection's standing rule is that a new
    // column cannot reach the wire without a decision.
    const slice = ROUTERS.slice(
      ROUTERS.indexOf("        lastMessageBody: b.lastMessagePreview,"),
      ROUTERS.indexOf("  openThread: publicProcedure"),
    );
    expect(slice.length).toBeGreaterThan(100);
    expect(slice).toMatch(/lastMessageStatusReply: b\.lastMessageStatusReply,/);
    expect(slice).toMatch(/lastMessageMine: b\.lastMessageMine,/);
    expect(code(slice)).not.toMatch(/\bmeta\b/);
  });
});

describe("the row renders it, and a locked group still says nothing", () => {
  const rowSlice = MESSAGES.slice(
    MESSAGES.indexOf("const hidden = isGroup && isGroupHidden"),
    MESSAGES.indexOf("<SwipeRow"),
  );

  it("the slice really found the preview decision", () => {
    expect(rowSlice.length).toBeGreaterThan(200);
    expect(rowSlice).toMatch(/const preview =/);
  });

  it("uses the shared formatter rather than its own wording", () => {
    expect(rowSlice).toMatch(/previewOfStoryReply\(\{/);
    expect(code(MESSAGES)).toMatch(/import \{ previewOf, previewOfStoryReply \}/);
  });

  it("takes that branch BECAUSE the server said so, not merely somewhere in the file", () => {
    /* Found by mutation: asserting `previewOfStoryReply({` appears says nothing about
       whether the branch is ever REACHED — replacing the condition with `false` left
       the text in place and every assertion green while the row went back to showing a
       bare emoji. Pin the condition, and forbid a constant. */
    expect(rowSlice).toMatch(/t\.lastMessageStatusReply\s*\n?\s*\?\s*previewOfStoryReply\(\{/);
    expect(rowSlice).not.toMatch(/(?:true|false)\s*\n?\s*\?\s*previewOfStoryReply/);
  });

  it("reads whose story it was from the server, not from a constant", () => {
    // Same class: `mine: false` survived, which would say "your story" about a reply
    // we sent ourselves.
    expect(rowSlice).toMatch(/mine: !!t\.lastMessageMine,/);
    expect(rowSlice).not.toMatch(/mine: (?:true|false),/);
  });

  it("the LOCK is checked first, so a locked group gains no story-reply line", () => {
    // A privacy screen that started naming an activity would leak the thing it covers.
    const iHidden = rowSlice.indexOf('hidden\n');
    const iReply = rowSlice.indexOf("previewOfStoryReply");
    // Anchored on the KEY rather than the word: an ordering assertion whose anchor is
    // copy answers -1 the moment the screen is translated, and -1 is less than every
    // real offset — so this would have gone on passing while the lock check moved
    // BELOW the story-reply line (the negative-index trap, v2.99.78 / v2.106.65).
    const iLocked = rowSlice.indexOf('tr("msg.locked")');
    expect(rowSlice).toMatch(/hidden[\s\S]{0,40}\?\s*tr\("msg\.locked"\)/);
    expect(iLocked).toBeGreaterThan(-1);
    expect(iReply).toBeGreaterThan(iLocked);
    expect(iHidden === -1 || iHidden < iReply).toBe(true);
  });

  it("an ordinary message still takes the plain path", () => {
    expect(rowSlice).toMatch(/previewOf\(t\.lastMessageKind \?\? "text", t\.lastMessageBody\)/);
  });
});

describe("the reply-quote line got the same treatment", () => {
  const fn = fnAt(MESSAGES, "function previewOf(msg:");

  it("describes a quoted story reply instead of showing a bare emoji", () => {
    expect(fn).toMatch(/statusReplyOf\(msg\.meta\)/);
    expect(fn).toMatch(/storyKindLabel\(sr\.kind\)/);
  });

  it("but the disappearing-message guard stays AHEAD of it", () => {
    // Same re-anchoring as above — the masked wording is keyed now, and an anchor made
    // of copy would slide to -1 and satisfy this comparison vacuously.
    const iExpire = fn.indexOf('t("msg.disappearingPreview")');
    const iReply = fn.indexOf("statusReplyOf");
    expect(iExpire).toBeGreaterThan(-1);
    expect(iReply).toBeGreaterThan(iExpire);
  });
});

describe("the shared module keeps no client-only concerns", () => {
  it("has no React, no trpc, and no DOM", () => {
    /* It is imported by the SERVER, so anything browser-shaped in it would be a build
       break waiting for the next importer.
       The needle was `document\.` and a mutation adding a BARE `document` reference
       slipped past it — narrow needles are how a sweep reports safety it does not have.
       Now the bare identifiers, on comment-stripped source so the prose above (which
       legitimately explains the rule) cannot satisfy it. */
    const src = code(SHARED);
    expect(src).not.toMatch(/\b(?:document|window|navigator|localStorage)\b/);
    expect(src).not.toMatch(/from "react"|useState/);
    expect(src).not.toMatch(/trpc/);
  });

  it("the formatter stays on the client, where the width budget is", () => {
    expect(PREVIEW).toMatch(/export function previewOfStoryReply/);
    // And it records the measurement rather than an estimate, so a later reader can
    // check the claim instead of trusting it.
    expect(PREVIEW).toMatch(/141px|193px|118px/);
  });
});
