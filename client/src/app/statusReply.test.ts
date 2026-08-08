/* ============================================================
   v2.99.80 — status replies + emoji reactions.

   Owner: "When any user plays status, you can see his status. If he put it everyone
   or contact, and you can make a kind of emoji or put a reply. So it will reply to
   him on the private message on the message showing that I replied on this status.
   So put the list of all emojis."

   The catalogue and the emoji predicates are tested BEHAVIOURALLY — a source pin
   cannot tell you whether "lau" finds 😂, and search that doesn't work is the whole
   feature. The wiring (which guard runs, in what order, what is NOT exposed) is
   pinned against source, because those are the properties that decay.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { copyOnScreen } from "../../../server/testing/copyOnScreen";
import { DICT } from "./i18n";
import {
  EMOJI_GROUPS,
  REACTION_QUICK,
  allEmoji,
  emojiCount,
  searchEmoji,
  isSingleEmoji,
} from "@/lib/emojiCatalog";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const ROUTERS = read("server/v2routers.ts");
const STATUS = read("client/src/pages/app/Status.tsx");
const MESSAGES = read("client/src/pages/app/Messages.tsx");
/** #115 — the marker's parser and labels moved here, shared with the server. */
const SHARED_STATUS_REPLY = read("shared/statusReply.ts");
const PICKER = read("client/src/app/EmojiPicker.tsx");
const CATALOG = read("client/src/lib/emojiCatalog.ts");

/** Strip comment lines before a "this pattern is absent" assertion.
 *
 *  Four releases running, a `not.toMatch` matched a COMMENT explaining why the
 *  pattern was gone, so it passed on prose rather than behaviour (v2.99.75). */
function codeOnly(src: string): string {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

/* ─────────────── the catalogue, behaviourally ─────────────── */

describe("the emoji catalogue", () => {
  it("carries a real library, not another 32-glyph hand list", () => {
    // The point of this module is that it REPLACES three small lists. A regression
    // to a token set would defeat it while every other test still passed.
    expect(emojiCount()).toBeGreaterThan(800);
    expect(EMOJI_GROUPS.length).toBeGreaterThanOrEqual(8);
    for (const g of EMOJI_GROUPS) {
      expect(g.items.length, `${g.id} is populated`).toBeGreaterThan(20);
      expect(g.label.length, `${g.id} has a label`).toBeGreaterThan(0);
      expect(g.icon.length, `${g.id} has a tab glyph`).toBeGreaterThan(0);
    }
  });

  it("the flat list is DEDUPED even though tabs cross-list", () => {
    // 🧗 is under both People and Activity on purpose — somebody looking for a
    // climber looks in either. In a flat list that repeat is a duplicate React key.
    const all = allEmoji();
    expect(new Set(all).size).toBe(all.length);
    const climbers = EMOJI_GROUPS.filter((g) => g.items.some((i) => i.e === "🧗"));
    expect(climbers.length, "🧗 really is cross-listed").toBeGreaterThan(1);
  });

  it("search finds a glyph by the word a person would actually type", () => {
    // Keyword search, not Unicode names: nobody types "grinning face with smiling
    // eyes". Each of these is a query a real user would enter.
    expect(searchEmoji("happy")).toContain("😀");
    expect(searchEmoji("pizza")).toEqual(["🍕"]);
    expect(searchEmoji("thumbs")).toContain("👍");
    expect(searchEmoji("fire")).toContain("🔥");
    expect(searchEmoji("uae")).toContain("🇦🇪");
    expect(searchEmoji("pray")).toContain("🙏");
    expect(searchEmoji("cry")).toContain("😢");
  });

  it("search matches a keyword PREFIX but never an infix", () => {
    // Prefix so "lau" finds "laugh". NOT infix: a 2-letter infix query matches most
    // of the catalogue, which is indistinguishable from no filter at all.
    expect(searchEmoji("lau")).toContain("😂");
    // "ough" is an infix of "doughnut" and must not match it.
    expect(searchEmoji("ough")).not.toContain("🍩");
    expect(searchEmoji("doughnut")).toContain("🍩");
  });

  it("search results are deduped and bounded", () => {
    const r = searchEmoji("climb");
    expect(new Set(r).size).toBe(r.length);
    const many = searchEmoji("a", 10);
    expect(many.length).toBeLessThanOrEqual(10);
  });

  it("an empty query returns nothing, not everything", () => {
    // The caller distinguishes "not searching" (show the tab) from "no results"
    // (say so). Returning the whole catalogue would collapse that distinction.
    expect(searchEmoji("")).toEqual([]);
    expect(searchEmoji("   ")).toEqual([]);
  });

  it("pasting a glyph into the search box finds it", () => {
    expect(searchEmoji("🍕")).toContain("🍕");
  });

  it("every quick reaction exists in the catalogue", () => {
    // Otherwise the one-tap row and the full picker would offer different glyphs.
    const all = new Set(allEmoji());
    for (const e of REACTION_QUICK) expect(all.has(e), `${e} is in the catalogue`).toBe(true);
    expect(REACTION_QUICK.length).toBeLessThanOrEqual(8); // a quick row, not a wall
  });
});

describe("isSingleEmoji — one tap vs a sentence", () => {
  it("accepts one glyph, including COMPOSED ones", () => {
    // A flag, a skin tone and "heart on fire" are several code points joined by a
    // ZWJ or a variation selector, and are still one glyph. Counting code points
    // would reject all three.
    for (const s of ["❤️", "😂", "👍🏽", "🏳️‍🌈", "❤️‍🔥", "🇦🇪"]) {
      expect(isSingleEmoji(s), `${s} is one emoji`).toBe(true);
    }
  });

  it("rejects several glyphs, text, and mixtures", () => {
    for (const s of ["😂😂", "hello", "hi 😂", "", "   ", "😂 ok", null, undefined]) {
      expect(isSingleEmoji(s as string), `${String(s)} is not one emoji`).toBe(false);
    }
  });

  it("is built through the RegExp constructor, not a u-flagged literal", () => {
    // A `/…/u` literal trips TS1501 against this repo's downlevel target — the
    // same reason Messages.tsx builds its own predicate this way. A literal here
    // would fail `pnpm check`, so this pin protects the build, not just the API.
    expect(CATALOG).toMatch(/new RegExp\(\s*\n?\s*"\^\(\?:\\\\p\{Extended_Pictographic\}/);
    expect(codeOnly(CATALOG)).not.toMatch(/\/\^\[\\p\{Extended_Pictographic\}.*\/u/);
  });
});

/* ─────────────── the server procedure ─────────────── */

describe("status.reply — the guards, in order", () => {
  const PROC = (() => {
    const start = ROUTERS.indexOf("  reply: publicProcedure");
    expect(start, "status.reply exists").toBeGreaterThan(0);
    // Bounded by the router's own close, not a fixed character count: a fixed
    // slice silently shrinks as the procedure grows (the v2.99.78 lesson).
    const end = ROUTERS.indexOf("/* ── admin ──", start);
    expect(end, "the slice has an end").toBeGreaterThan(start);
    const s = ROUTERS.slice(start, end);
    expect(s.length, "the slice is not empty").toBeGreaterThan(500);
    return s;
  })();

  it("resolves an identity, so a GUEST can reply", () => {
    // Guests have identities and can legitimately be in an "everyone" audience.
    // protectedProcedure would lock them out of a feature they are entitled to.
    expect(PROC).toMatch(/const me = requireIdentity\(ctx\);/);
    expect(PROC).toMatch(/reply: publicProcedure/);
    expect(codeOnly(PROC)).not.toMatch(/protectedProcedure/);
  });

  it("throttles BEFORE any database work", () => {
    // Each reply is a message row plus an unread increment in someone else's
    // inbox, so an unthrottled loop is inbox spam. The gate must precede the read.
    const gate = PROC.indexOf("statusGate(ctx)");
    const read = PROC.indexOf("getActiveStatusById");
    expect(gate).toBeGreaterThan(0);
    expect(read).toBeGreaterThan(0);
    expect(gate, "statusGate runs before getActiveStatusById").toBeLessThan(read);
  });

  it("re-checks the AUDIENCE — the viewer's verdict was a different request", () => {
    // Seeing the status and replying to it are separate requests; the first
    // verdict cannot be carried. This one call also covers blocks in both
    // directions, ahead of the "everyone" short-circuit.
    // v2.105.6 — and the GROUP it was addressed to. Without that argument a group
    // member's reply to a group story would be refused, because the author's
    // contacts rule is the wrong question for a story the group authorized.
    // v2.107.71 — and the specific-audience member list (fifth arg): a reply to a
    // hand-picked story must ask whether THIS viewer is on its list.
    expect(PROC).toMatch(
      /statusAudienceAuthorized\(me\.id, st\.identityId, st\.audience, st\.conversationId, st\.audienceMembers\)/
    );
  });

  it("refuses your OWN status rather than posting into your own notes", () => {
    // getOrCreateDmConversation(me, me) is a real self-thread, so an unguarded
    // self-reply succeeds silently and confusingly.
    expect(PROC).toMatch(/st\.identityId === me\.id/);
    expect(PROC).toMatch(/reason: "own"/);
  });

  it("answers missing and expired IDENTICALLY, so it is no existence oracle", () => {
    // Both resolve to the same `unavailable`; only the client, which already holds
    // expiresAt, tells the person which it was.
    const reasons = PROC.match(/reason: "[a-z]+"/g) ?? [];
    expect(reasons).toContain('reason: "unavailable"');
    expect(reasons).not.toContain('reason: "expired"');
    expect(reasons).not.toContain('reason: "forbidden"');
  });

  it("stamps the marker SERVER-SIDE and stores no copy of the media", () => {
    expect(PROC).toMatch(/meta: \{ statusReply: \{ id: st\.id, kind: st\.kind/);
    // A stored mediaUrl/mediaKey would render a broken tile forever after the 24h
    // expiry AND would quietly keep a durable copy of ephemeral media.
    expect(codeOnly(PROC)).not.toMatch(/mediaUrl|mediaKey/);
  });

  it("reuses kind:\"message\" for realtime and push", () => {
    // A bespoke SSE kind is dropped by KNOWN_V2_EVENT_KINDS whenever the recipient's
    // stream is on the other instance (the v2.99.74 trap), and the relay-msg-<id>
    // tag is what makes DND and per-conversation mute apply in the service worker.
    expect(PROC).toMatch(/publishToIdentity\(pid, \{ kind: "message"/);
    expect(PROC).toMatch(/tag: `relay-msg-\$\{convo\.id\}`/);
    expect(PROC).toMatch(/kind: "message",/);
    expect(codeOnly(PROC)).not.toMatch(/kind: "status-reply"|kind: "reaction"/);
  });

  it("pushes only when they cannot see it in the open app, and are reachable", () => {
    expect(PROC).toMatch(/getPresenceForIds\(\[st\.identityId\]\)/);
    // v2.99.92 widened this from `!pres?.isOnline` to the SHARED rule. A
    // BACKGROUNDED app is now `isOnline` — that is what stopped minimising reading
    // as offline — but it still cannot draw an in-page toast, so it needs the OS
    // notification exactly as a closed app does. Pinning the old expression would
    // have pinned a silent regression: replies to a status would stop notifying
    // anyone whose app was merely minimised.
    expect(PROC).toMatch(/presenceNeedsNotification\(pres\) && \(await pushReachable\(st\.identityId\)\)/);
  });

  it("the push body names no content", () => {
    // Standing owner rule: the sender's name, never a word of the message. The
    // reply text must not appear in the notification.
    expect(PROC).toMatch(/body: "Replied to your status — tap to read it\."/);
    expect(codeOnly(PROC)).not.toMatch(/body: body|body: input\.body/);
  });
});

describe("the marker is NOT client-settable", () => {
  it("messages.send's meta schema does not accept statusReply", () => {
    // The marker is a claim about provenance. `messages.send`'s meta is a plain
    // z.object, which STRIPS unknown keys rather than rejecting them, and
    // sendMessage casts meta through without validating it — so exposing the key
    // there would let any client label any message a reply to any status,
    // including one they never had access to.
    const start = ROUTERS.indexOf("  send: publicProcedure");
    const end = ROUTERS.indexOf(".mutation(async ({ ctx, input })", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const sendInput = ROUTERS.slice(start, end);
    expect(sendInput.length).toBeGreaterThan(200);
    expect(sendInput).toMatch(/meta: z/); // the schema is really in this slice
    expect(sendInput).not.toMatch(/statusReply/);
  });
});

/* ─────────────── the viewer ─────────────── */

describe("the reply band in the story viewer", () => {
  it("renders only on SOMEBODY ELSE'S status", () => {
    expect(STATUS).toMatch(/\{!isMine && \(\s*\n\s*<StatusReplyBar/);
  });

  it("sits OUTSIDE the body wrapper, whose pointer handlers would fight typing", () => {
    // The body div sets paused on pointerdown and clears it on pointerup/leave, so
    // a composer inside it has every keystroke's pointer events churning the clock.
    const band = STATUS.indexOf("<StatusReplyBar");
    const bodyEnd = STATUS.indexOf("{/* caption */}");
    expect(bodyEnd).toBeGreaterThan(0);
    expect(band, "the band comes after the body block closes").toBeGreaterThan(bodyEnd);
  });

  it("holds the story with its OWN state, not `paused`", () => {
    // `paused` is churned by the body's onPointerUp/onPointerLeave, so the very
    // pointerup that ends the tap opening the composer clears it and the story
    // advances mid-sentence. replyOpen is owned solely by the band — the same
    // mechanism showViewers already uses.
    expect(STATUS).toMatch(/if \(paused \|\| showViewers \|\| replyOpen\)/);
    expect(STATUS).toMatch(/\}, \[gi, ii, itemMs, paused, showViewers, replyOpen\]\);/);
  });

  it("closes on an advance so a draft cannot be sent against the NEXT status", () => {
    // Same class as the reply-target leak fixed in Messages (QA M5).
    expect(STATUS).toMatch(/useEffect\(\(\) => \{ setReplyOpen\(false\); \}, \[gi, ii\]\);/);
    // …and the bar is keyed on the status, so its own draft is discarded with it.
    expect(STATUS).toMatch(/key=\{item\.id\}\s*\n\s*statusId=\{item\.id\}/);
  });

  it("tap zones AND desktop chevrons both dismiss instead of navigating", () => {
    // The chevrons bypass the HOLD_MS check entirely, so guarding only the tap
    // zones would still let a stray click advance mid-compose.
    const guards = STATUS.match(/if \(replyOpen\) \{ setReplyOpen\(false\); return; \}/g) ?? [];
    expect(guards.length, "both tap zones and both chevrons are guarded").toBe(4);
  });

  it("re-enables text selection, which the viewer root disables", () => {
    // The property, not the class prefix: this pin froze `className="select-text
    // px-3` and broke the moment a width cap was prepended, while saying nothing
    // about whether selection is actually re-enabled.
    expect(STATUS).toMatch(/className="fixed inset-0 z-\[100\] flex flex-col bg-black text-white select-none"/);
    const bar = STATUS.slice(STATUS.indexOf("function StatusReplyBar"));
    expect(bar.length).toBeGreaterThan(500);
    expect(bar).toMatch(/select-text/);
  });

  it("derives EXPIRY locally, because the server deliberately won't say", () => {
    // The server answers a dead id and an unauthorised one identically. Without
    // this the person gets a bare refusal with no explanation.
    expect(STATUS).toMatch(/const expired = new Date\(expiresAt\)\.getTime\(\) <= Date\.now\(\);/);
    /* THE PIN FROZE THE WRONG WORD. It required the literal "This status has expired."
       — and v2.101.0's whole correction is that the ephemeral post is a STORY, so this
       sentence was one of two on the screen still naming the profile label. It survived
       because `storyVsStatus.test.ts`'s sweep reads only quoted title/placeholder/
       aria-label/toast literals and this is a bare JSX text node.

       Rewritten to the property it always stood for: the bar SAYS the thing has expired,
       rather than leaving a refusal unexplained. `copyOnScreen` is satisfied by the
       literal or by a key whose English half is that sentence, and is stronger than
       either, because reaching the dictionary also proves an Arabic half exists. */
    expect(
      copyOnScreen(STATUS, "has expired."),
      "the reply bar must still say the story has expired",
    ).toBe(true);
    expect(STATUS).toMatch(/\{t\("status\.expired"\)\}/);
    // …and it says STORY, which is the word this sentence was getting wrong.
    expect(DICT["status.expired"].en.toLowerCase()).toContain("story");
  });

  it("guards against a double-tap sending twice", () => {
    // Each tap is a message and an unread increment.
    expect(STATUS).toMatch(/if \(!b \|\| sending \|\| expired\) return;/);
  });

  it("offers the quick row AND the full catalogue", () => {
    expect(STATUS).toMatch(/REACTION_QUICK\.map/);
    expect(STATUS).toMatch(/<EmojiPicker/);
  });

  it("the reply input is direction-agnostic", () => {
    // An Arabic reply must lay out right-to-left as it is typed.
    const bar = STATUS.slice(STATUS.indexOf("function StatusReplyBar"));
    expect(bar).toMatch(/dir="auto"/);
  });
});

/* ─────────────── the recipient's bubble ─────────────── */

describe("the recipient sees WHAT the reply was about", () => {
  it("a one-emoji reply keeps its bubble instead of rendering as a bare glyph", () => {
    // THE BUG THIS PREVENTS: a one-tap reaction is precisely an emoji-only
    // message, and that branch has no bubble and so nowhere for the chip — the
    // recipient would see a floating ❤️ with no idea what it referred to, which is
    // the one thing the owner asked for.
    expect(MESSAGES).toMatch(
      /const emojiOnly =\s*\n?\s*!m\.attachment && m\.replyToId == null && !sr && isEmojiOnly\(m\.body\)/
    );
  });

  it("renders the chip from the marker's own snapshot, never a live lookup", () => {
    // v2.101.0 renamed the ephemeral post to STORY in every user-facing string.
    expect(copyOnScreen(MESSAGES, "Replied to your story")).toBe(true);
    expect(copyOnScreen(MESSAGES, "Replied to their story")).toBe(true);
    /* REWRITTEN in #115 to the PROPERTY. This froze the exact expression
       `STATUS_KIND_LABEL[sr.kind]`, so it forbade moving the labels into `shared/`
       while saying nothing about what it is actually for — that the chip's label comes
       from the MARKER's own kind rather than from a fetch of a story that is
       unreachable after 24h by design. */
    expect(MESSAGES).toMatch(/storyKindLabel\(sr\.kind\)/);
    expect(codeOnly(MESSAGES)).not.toMatch(/status\.byId|status\.get\b/);
  });

  it("reads the marker defensively — it comes off a JSON column", () => {
    /* REWRITTEN in #115: this asserted the parser is DEFINED in `Messages.tsx`, i.e. it
       pinned a location. The rule now lives in `shared/statusReply.ts` because the
       server's thread projection needs the same answer, and it is tested
       BEHAVIOURALLY over twelve malformed shapes in `server/threadStoryReply.test.ts`.
       What matters here is that this file does not keep a second copy. */
    expect(MESSAGES).toMatch(/import \{ statusReplyOf, storyKindLabel \} from "@shared\/statusReply"/);
    expect(codeOnly(MESSAGES)).not.toMatch(/function statusReplyOf\(/);
    expect(SHARED_STATUS_REPLY).toMatch(/typeof o\.id !== "number" \|\| typeof o\.kind !== "string"/);
  });

  it("withholds the chip while a self-destructing message is still LOCKED", () => {
    // A locked message has its body withheld, so the chip would sit above an empty
    // bubble — mirroring how the whole received menu is withheld there.
    expect(MESSAGES).toMatch(/\{sr && !\(m as \{ locked\?: boolean \}\)\.locked && \(/);
  });

  it("isolates the label from an RTL excerpt", () => {
    /* The chip concatenates a Latin label with a possibly-Arabic excerpt; without
       isolation the excerpt reorders the phrase (the PinTag lesson, v2.99.77).

       THIS PIN WAS PASSING FOR THE WRONG REASON, and the mechanism is worth naming.
       It anchored on "Replied to your STATUS" — text that v2.101.0 renamed to
       "story", so `indexOf` returned **-1**. `slice(-1 - 900)` is `slice(-901)`,
       which in JavaScript means "the LAST 901 characters", so the window was the
       tail of the file and it matched an unrelated `[unicode-bidi:isolate]` down in
       `SuggestList`. It never read the chip at all. A negative index does not throw;
       it silently reads from the other end — the inverted-anchor trap with a new
       twist, and it only surfaced when board 3d's insertion pushed that unrelated
       span past the 901-character mark.

       Now anchored on text that EXISTS, bounded by the chip's own end, and asserting
       the window is real before asserting anything about it. */
    const at = MESSAGES.indexOf('t("msg.repliedToYourStory")');
    expect(at, "the chip's label must exist — a stale needle makes this vacuous").toBeGreaterThan(0);
    const end = MESSAGES.indexOf("{m.replyToId != null &&", at);
    expect(end).toBeGreaterThan(at);
    const chip = MESSAGES.slice(at - 600, end);
    expect(copyOnScreen(chip, "Replied to your story")).toBe(true);
    /* PINNED ON THE LABEL'S OWN SPAN, not on the region containing one. The chip has
       TWO isolated spans (the label and the story-kind), so a region-wide match
       survived removing the isolation from either — proven by mutation. The property
       is that the span CARRYING the Latin phrase is the isolated one. */
    const label = MESSAGES.slice(MESSAGES.lastIndexOf("<span", at), at);
    expect(label).toMatch(/\[unicode-bidi:isolate\]/);
    expect(label).toMatch(/dir="ltr"/);
  });
});

/* ─────────────── the shared picker ─────────────── */

describe("one picker, shared", () => {
  it("the Messages composer uses it instead of its own hand list", () => {
    expect(MESSAGES).toMatch(/<EmojiPicker className="mb-2" onPick=\{insertEmoji\}/);
    // The 32-glyph EMOJI_QUICK it replaced is gone, in CODE not just in a comment.
    expect(codeOnly(MESSAGES)).not.toMatch(/EMOJI_QUICK/);
  });

  it("both surfaces import the SAME catalogue", () => {
    expect(PICKER).toMatch(/from "@\/lib\/emojiCatalog"/);
    expect(STATUS).toMatch(/from "@\/lib\/emojiCatalog"/);
  });

  it("stops taps reaching the overlay behind it", () => {
    // The picker renders inside the status viewer, whose tap zones sit underneath
    // and would navigate the story on every glyph tap.
    expect(PICKER).toMatch(/onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/);
    expect(PICKER).toMatch(/onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  });

  it("is not a portal, so it cannot land behind the fixed viewer", () => {
    expect(codeOnly(PICKER)).not.toMatch(/createPortal/);
  });

  it("hides the category tabs while searching", () => {
    // A filter and a selected tab showing at once is ambiguous about which is in
    // effect.
    expect(PICKER).toMatch(/\{!results && \(/);
  });

  it("says so when a search matches nothing", () => {
    expect(PICKER).toMatch(/No emoji match/);
  });

  it("is width-capped, MEASURED not guessed", () => {
    // Without a cap the panel stretches to its parent, which in the status viewer
    // is the whole viewport: a headless desktop render measured 153px emoji cells
    // for a 20px glyph. Capped, the same render measures 49px.
    expect(PICKER).toMatch(/mx-auto w-full max-w-\[420px\]/);
    expect(STATUS).toMatch(/mx-auto w-full max-w-\[440px\] select-text/);
  });

  it("adds no npm dependency", () => {
    const pkg = read("package.json");
    expect(pkg).not.toMatch(/"emoji-/);
    expect(pkg).not.toMatch(/"node-emoji"/);
    expect(pkg).not.toMatch(/"emojibase/);
  });
});
