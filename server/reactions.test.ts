/**
 * Message reactions — DATA-CONTRACTS §2, board 4c.
 *
 * The model is driven BEHAVIOURALLY, because every claim here is about what a set of
 * rows RESOLVES to: whether a second tap removes or moves, what a malformed emoji
 * does, what order chips come out in. A source pin can tell you a validator exists
 * and cannot tell you it refuses a sentence.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "./testing/codeOnly";
import {
  QUICK_REACTIONS,
  REACTION_MAX_LENGTH,
  normalizeReactionEmoji,
  projectReactions,
  myReaction,
  reactionOpFor,
  reactionChips,
} from "@shared/reactions";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the quick row is the contract's five", () => {
  it("exactly ❤️ 👍 😂 😮 😢, in that order", () => {
    expect([...QUICK_REACTIONS]).toEqual(["❤️", "👍", "😂", "😮", "😢"]);
  });

  it("every one of them is a legal reaction", () => {
    // A shortcut the validator would refuse is a button that always fails.
    for (const e of QUICK_REACTIONS) expect(normalizeReactionEmoji(e)).toBe(e);
  });
});

describe("normalizeReactionEmoji — the field is not a text channel", () => {
  it("accepts ordinary emoji, including ZWJ sequences and skin tones", () => {
    // These MUST pass: forbidding the joiner or the variation selector would refuse
    // "👩‍🚀" and even the plain "❤️", whose second code unit is U+FE0F.
    for (const e of ["👍", "❤️", "🎉", "👩‍🚀", "👋🏽", "🏳️‍🌈"]) {
      expect(normalizeReactionEmoji(e), e).toBe(e);
    }
  });

  it("refuses a sentence — the whole reason this validator exists", () => {
    // Without it, `react({emoji: "you are an idiot"})` renders under somebody else's
    // own words, in their thread, unsolicited.
    expect(normalizeReactionEmoji("you are an idiot")).toBeNull();
    expect(normalizeReactionEmoji("lol")).toBeNull();
    expect(normalizeReactionEmoji("👍 nice")).toBeNull();
  });

  it("refuses digits, which is what stops it carrying a number", () => {
    expect(normalizeReactionEmoji("777777")).toBeNull();
    expect(normalizeReactionEmoji("1")).toBeNull();
  });

  it("refuses whitespace of every kind — one glyph, not a phrase", () => {
    expect(normalizeReactionEmoji("👍 👍")).toBeNull();
    expect(normalizeReactionEmoji("👍\n👍")).toBeNull();
    expect(normalizeReactionEmoji("👍\t")).toBe("👍"); // trailing is TRIMMED, not refused
  });

  it("refuses bidi controls, which can reorder the text around the chip", () => {
    // U+202E RIGHT-TO-LEFT OVERRIDE — the class every PIN surface isolates against.
    expect(normalizeReactionEmoji("👍" + String.fromCharCode(0x202e))).toBeNull();
    expect(normalizeReactionEmoji(String.fromCharCode(0x2066) + "👍")).toBeNull();
    expect(normalizeReactionEmoji("👍" + String.fromCharCode(0x200f))).toBeNull();
  });

  it("refuses control characters", () => {
    expect(normalizeReactionEmoji("👍" + String.fromCharCode(0x00))).toBeNull();
    expect(normalizeReactionEmoji("👍" + String.fromCharCode(0x07))).toBeNull();
  });

  it("is bounded, so the column cannot be used as storage", () => {
    expect(normalizeReactionEmoji("👍".repeat(REACTION_MAX_LENGTH))).toBeNull();
  });

  it("fails to NULL for a non-string rather than to a default", () => {
    // A defaulted reaction would put a sentiment in somebody's mouth.
    for (const v of [null, undefined, 7, {}, [], true]) {
      expect(normalizeReactionEmoji(v as unknown)).toBeNull();
    }
    expect(normalizeReactionEmoji("")).toBeNull();
    expect(normalizeReactionEmoji("   ")).toBeNull();
  });
});

describe("projectReactions — the contract's {emoji: pins[]} shape", () => {
  it("groups by emoji and keeps INSERTION order", () => {
    // Order is meaning: the chip row reads in the order people reacted, so a re-sort
    // would reshuffle a group's chips on every poll.
    const out = projectReactions([
      { emoji: "😂", pin: "573882" },
      { emoji: "❤️", pin: "219406" },
      { emoji: "❤️", pin: "842317" },
    ]);
    expect(Object.keys(out)).toEqual(["😂", "❤️"]);
    expect(out["❤️"]).toEqual(["219406", "842317"]);
  });

  it("drops a duplicated pin rather than counting one person twice", () => {
    // The unique key makes this impossible in the store; a count that is simply
    // wrong is worse than a defensive line that never fires.
    const out = projectReactions([
      { emoji: "❤️", pin: "219406" },
      { emoji: "❤️", pin: "219406" },
    ]);
    expect(out["❤️"]).toEqual(["219406"]);
  });

  it("drops a row whose emoji would not be accepted today", () => {
    const out = projectReactions([
      { emoji: "spam", pin: "219406" },
      { emoji: "👍", pin: "219406" },
    ]);
    expect(out).toEqual({ "👍": ["219406"] });
  });

  it("is empty for no rows", () => {
    expect(projectReactions([])).toEqual({});
  });
});

describe("myReaction + reactionOpFor — the toggle IS the contract's rule", () => {
  const reactions = { "❤️": ["219406"], "😂": ["573882"] };

  it("finds mine and only mine", () => {
    expect(myReaction(reactions, "219406")).toBe("❤️");
    expect(myReaction(reactions, "573882")).toBe("😂");
    expect(myReaction(reactions, "000111")).toBeNull();
  });

  it("survives a missing map and an empty pin", () => {
    expect(myReaction(null, "219406")).toBeNull();
    expect(myReaction(undefined, "219406")).toBeNull();
    expect(myReaction(reactions, "")).toBeNull();
  });

  it("re-picking the SAME emoji removes it", () => {
    expect(reactionOpFor("❤️", "❤️")).toEqual({ emoji: "❤️", op: "remove" });
  });

  it("picking a DIFFERENT emoji moves it — one add, never a remove first", () => {
    // The unique key makes the move one atomic upsert. A remove-then-add would leave
    // the reaction gone if the second half failed.
    expect(reactionOpFor("❤️", "😂")).toEqual({ emoji: "😂", op: "add" });
  });

  it("a first reaction is an add", () => {
    expect(reactionOpFor(null, "👍")).toEqual({ emoji: "👍", op: "add" });
  });
});

describe("reactionChips — what a bubble draws", () => {
  it("counts, and marks mine", () => {
    const chips = reactionChips({ "❤️": ["219406", "842317"], "😂": ["573882"] }, "219406");
    expect(chips).toEqual([
      { emoji: "❤️", count: 2, mine: true },
      { emoji: "😂", count: 1, mine: false },
    ]);
  });

  it("drops an emoji nobody holds rather than drawing a zero", () => {
    expect(reactionChips({ "❤️": [] }, "219406")).toEqual([]);
  });

  it("is empty when there are none", () => {
    expect(reactionChips(null, "219406")).toEqual([]);
    expect(reactionChips(undefined, "219406")).toEqual([]);
  });
});

describe("the store holds the contract's own invariant", () => {
  const SCHEMA = read("drizzle/schema.ts");
  const V2DB = codeOnly(read("server/v2db.ts"));

  it("one-per-user is a UNIQUE KEY, not an application check", () => {
    // Held as a JSON map on `messages` instead, the rule would be a check around a
    // read-modify-write and a concurrent reaction would be silently lost.
    expect(SCHEMA).toMatch(
      /uniqueIndex\("message_reactions_one_each"\)\.on\(t\.messageId, t\.identityId\)/
    );
  });

  it("the migrator creates it with that key", () => {
    expect(V2DB).toMatch(/UNIQUE KEY[^\n]*message_reactions_one_each/);
    expect(V2DB).toMatch(/CREATE TABLE IF NOT EXISTS[^\n]*message_reactions/);
  });

  it("no `reactions` column was added to `messages`", () => {
    // The contract's map is a PROJECTION, built at read time. A stored copy beside
    // the table would be a second answer to the same question.
    const at = SCHEMA.indexOf('export const messages = mysqlTable(');
    expect(at).toBeGreaterThan(0);
    const end = SCHEMA.indexOf("\n);", at);
    expect(end).toBeGreaterThan(at);
    expect(SCHEMA.slice(at, end)).not.toMatch(/\breactions\b/);
  });
});

describe("the writer", () => {
  const V2DB = codeOnly(read("server/v2db.ts"));
  const body = (() => {
    const at = V2DB.indexOf("export async function setMessageReaction");
    expect(at).toBeGreaterThan(0);
    const end = V2DB.indexOf("\nexport async function", at + 10);
    expect(end).toBeGreaterThan(at);
    return V2DB.slice(at, end);
  })();

  it("validates the emoji BEFORE any query", () => {
    // A malformed reaction must cost no database work and must never reach the
    // column, where it would render as text on somebody's message.
    const norm = body.indexOf("normalizeReactionEmoji");
    const select = body.indexOf(".select(");
    expect(norm).toBeGreaterThan(0);
    expect(select).toBeGreaterThan(0);
    expect(norm).toBeLessThan(select);
  });

  it("a move is ONE upsert, never a delete followed by an insert", () => {
    expect(body).toMatch(/onDuplicateKeyUpdate\(\{\s*set:\s*\{\s*emoji\s*\}/);
  });

  it("the DELETE is scoped to the caller's OWN row", () => {
    // By messageId alone it would remove anybody's reaction.
    const at = body.indexOf(".delete(messageReactions)");
    expect(at).toBeGreaterThan(0);
    const where = body.slice(at, body.indexOf("return", at));
    expect(where).toMatch(/eq\(messageReactions\.messageId/);
    expect(where).toMatch(/eq\(messageReactions\.identityId/);
  });

  it("membership is checked, and an unsent message answers like a missing one", () => {
    expect(body).toMatch(/getConversationParticipantIds/);
    /* PINNED AS THE CONDITION, not as the presence of the words. `if (false) return
       {reason:"not-a-member"}` leaves both strings in the file, so an assertion that
       only looked for them stayed green while ANYBODY could react to ANY message by
       guessing a sequential integer id — their pin then rendering on a stranger's
       message. That survivor is the recurring class (v2.105.16, v2.106.14) and it
       showed up here on the first mutation run. */
    expect(body).toMatch(
      /if \(!members\.includes\(input\.identityId\)\) return \{ ok: false, reason: "not-a-member" \};/
    );
    expect(body).not.toMatch(/if \(false\)/);
    // Same answer for both, so the endpoint is no oracle over sequential ids.
    expect(body).toMatch(/!row \|\| row\.deletedAt/);
  });

  it("touches NO thread state — the contract says reacting never changes unread", () => {
    // A reaction that bumped a thread would re-order everybody's inbox on every tap.
    expect(body).not.toMatch(/unreadCount/);
    expect(body).not.toMatch(/lastMessageAt/);
    expect(body).not.toMatch(/recomputeUnreadFor/);
  });
});

describe("the realtime kind is declared in BOTH places", () => {
  const EV = read("server/v2events.ts");

  it("is in the V2Event union", () => {
    expect(EV).toMatch(/kind: "reaction"; conversationId: number; messageId: number/);
  });

  it("is in KNOWN_V2_EVENT_KINDS", () => {
    // The v2.99.74 trap: an undeclared kind is delivered locally and SILENTLY
    // DROPPED whenever the recipient's stream is on the other instance — which on a
    // two-instance fleet is most of the time, while single-instance dev looks fine.
    const at = EV.indexOf("KNOWN_V2_EVENT_KINDS");
    expect(at).toBeGreaterThan(0);
    /* Bounded by the Set literal's OWN end. A bare `indexOf("]")` finds the bracket
       inside `V2Event["kind"]` — the type annotation on the declaration line — so
       the window is 34 characters and never reaches the list, which is how this
       assertion first failed on perfectly correct code. */
    const end = EV.indexOf("]);", at);
    expect(end).toBeGreaterThan(at);
    const list = EV.slice(at, end);
    expect(list).toMatch(/"message"/); // the window really is the list
    expect(list).toMatch(/"reaction"/);
  });

  it("carries the message id and NOT the emoji", () => {
    // One authority for what the reactions are. A client applying its own delta off
    // the event would drift permanently, because the wire op is a toggle.
    expect(EV).not.toMatch(/kind: "reaction"[^\n]*emoji/);
  });
});

describe("the router", () => {
  const R = codeOnly(read("server/v2routers.ts"));

  it("fans to EVERY member including the reactor's own other devices", () => {
    const at = R.indexOf('kind: "reaction"');
    expect(at).toBeGreaterThan(0);
    const before = R.slice(Math.max(0, at - 700), at);
    expect(before).toMatch(/for \(const pid of members\)/);
    // Not `if (pid !== me.id)`, which is right for a message and wrong here: chips
    // are shared state and a phone and a laptop must not show different counts.
    expect(before).not.toMatch(/pid !== me\.id/);
  });

  it("sends reactions for a LOCKED message too", () => {
    // A reaction is not the message's content; withholding chips would make a
    // view-once bubble the one place they vanish, which is itself a signal.
    expect(R).toMatch(/reactions: projectReactions\(reactionRows\.get\(r\.id\) \?\? \[\]\)/);
  });

  it("reads reactions in ONE batched query, outside the per-row map", () => {
    // Inside the map it is an N+1 on the app's most-polled list.
    const at = R.indexOf("const reactionRows = await reactionsForMessages");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(R.indexOf("return rows.map((r) =>", at));
  });
});

describe("the purge registry knows about it", () => {
  it("message_reactions.identityId is declared, and cascades", () => {
    // The machine-checked registry fails the build on an undeclared identity column;
    // leaving these would render a chip attributed to a pin that no longer resolves.
    const P = read("server/purgeIdentity.ts");
    const at = P.indexOf('table: "message_reactions"');
    expect(at).toBeGreaterThan(0);
    expect(P.slice(at, at + 260)).toMatch(/strategy: "cascade"/);
  });
});

describe("the UI — board 4c", () => {
  const UI = codeOnly(read("client/src/pages/app/Messages.tsx"));

  it("the quick row is IN FLOW, not absolutely positioned", () => {
    // An absolutely-positioned bar over a bubble that can sit at either edge needs
    // measuring then clamping — the class that clipped the ⋮ menu (v2.99.0) and the
    // video-consent card (v2.99.54). In flow it cannot leave the viewport at all.
    const at = UI.indexOf("function QuickReact");
    expect(at).toBeGreaterThan(0);
    const end = UI.indexOf("\nfunction ", at + 10);
    expect(end).toBeGreaterThan(at);
    expect(UI.slice(at, end)).not.toMatch(/\babsolute\b/);
  });

  it("both entry points route through the ONE shared toggle", () => {
    // The row and the chips must not come to mean different things by a tap on the
    // same emoji.
    expect(UI).toMatch(/const toggleReaction = \(m: Msg, emoji: string\) =>/);
    expect(UI).toMatch(/onPick=\{\(e\) => toggleReaction\(m, e\)\}/);
    expect(UI).toMatch(/onToggle=\{\(e\) => toggleReaction\(m, e\)\}/);
    expect(UI).toMatch(/reactionOpFor\(mine, emoji\)/);
  });

  it("my own chip's accent fallbacks are LITERALS, never a self-reference", () => {
    // `var(--rb, var(--rb))` is a custom-property CYCLE: it resolves to the
    // guaranteed-invalid value and the browser DROPS the declaration, leaving a chip
    // with no fill and no border. That trap bit v2.106.7.
    expect(UI).toMatch(/rgba\(var\(--rb-rgb, 63, 224, 197\), 0\.18\)/);
    expect(UI).not.toMatch(/var\(--rb[a-z-]*,\s*var\(--rb/);
  });

  it("the count is withheld at 1", () => {
    expect(UI).toMatch(/c\.count > 1 &&/);
  });

  it("the chips are ONE insertion in the per-message wrapper", () => {
    // Inside a bubble branch they would miss the emoji-only and attachment shapes —
    // the v2.103.3 gutter argument, and how three copies of the sender label came to
    // need keeping in step by hand.
    expect((UI.match(/<ReactionChips/g) ?? []).length).toBe(1);
  });

  it("the `+` reuses the composer's picker rather than a second catalogue", () => {
    // Two emoji lists is how they come to hold different glyphs; v2.99.80
    // consolidated three into one for exactly that reason.
    const at = UI.indexOf("pickerFor === m.id");
    expect(at).toBeGreaterThan(0);
    expect(UI.slice(at, at + 400)).toMatch(/<EmojiPicker/);
  });
});

describe("realtime on the client", () => {
  const RT = codeOnly(read("client/src/app/useRealtime.ts"));

  it("refreshes the message list and NOT the thread list", () => {
    // Reacting must not change unread state or bump the thread.
    const at = RT.indexOf('case "reaction":');
    expect(at).toBeGreaterThan(0);
    const block = RT.slice(at, RT.indexOf("break;", at));
    expect(block).toMatch(/messages\.list/);
    expect(block).not.toMatch(/messages\.threads/);
  });
});

/**
 * `[A-Za-z0-9]` IS ASCII, AND THE RULE IT ENFORCED WAS "NOT A WORD".
 *
 * So the free-text channel this validator exists to close stood open in every other
 * script. `react({ emoji: "غبي" })` — or Cyrillic, or CJK — passed and rendered as a
 * chip under somebody else's own message, which is exactly the unsolicited-text
 * scenario the function's own header describes. This app ships an Arabic UI.
 *
 * The same class check refused ten glyphs the picker OFFERS: `0️⃣`–`9️⃣` are a real
 * ASCII digit plus U+FE0F plus U+20E3, so tapping one was silently rejected by the
 * server it had just been offered by.
 */
describe("a reaction is a glyph, not a word in some other alphabet", () => {
  it("refuses letters in every script, not only Latin", () => {
    for (const word of [
      "غبي", // Arabic
      "дурак", // Cyrillic
      "笨蛋", // Chinese
      "バカ", // Japanese katakana
      "바보", // Korean
      "μωρό", // Greek
      "טיפש", // Hebrew
      "मूर्ख", // Devanagari
      "โง่", // Thai
      "ahmak", // Latin, as before
    ]) {
      expect(normalizeReactionEmoji(word), word).toBeNull();
    }
  });

  it("refuses digits in every script too", () => {
    // A bare number is not a reaction, in any numeral system.
    for (const n of ["1", "42", "٤٢", "四", "௧"]) {
      expect(normalizeReactionEmoji(n), n).toBeNull();
    }
  });

  it("still admits every emoji shape the app uses", () => {
    for (const e of ["👍", "❤️", "😂", "👩🏽‍🚀", "🇦🇪", "🔟", "™️", "▶️", "#️⃣", "*️⃣"]) {
      expect(normalizeReactionEmoji(e), e).toBe(e);
    }
  });

  it("admits the keycap digits the picker offers — they used to be rejected", () => {
    for (const k of ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"]) {
      expect(normalizeReactionEmoji(k), k).toBe(k);
    }
    // The variation selector is optional in a keycap sequence.
    expect(normalizeReactionEmoji("1⃣")).toBe("1⃣");
  });

  it("stripping keycaps does not smuggle a digit past the rule", () => {
    // Only a WELL-FORMED sequence is removed, so a digit that is merely NEAR a
    // keycap still counts as a digit.
    expect(normalizeReactionEmoji("1️⃣2")).toBeNull();
    expect(normalizeReactionEmoji("7")).toBeNull();
    expect(normalizeReactionEmoji("a1️⃣")).toBeNull();
  });

  it("REFUSES NOTHING the picker offers — checked against the picker itself", () => {
    // An allowlist was rejected for rotting; this is the same guarantee, measured.
    // It is what proved the ten keycaps were being refused in the first place.
    const src = readFileSync(resolve(__dirname, "../client/src/lib/emojiCatalog.ts"), "utf8");
    const entries = new Set<string>();
    for (const m of src.matchAll(/"([^"\\\n]{1,24})"/g)) {
      if (/[^\x00-\x7F]/.test(m[1])) entries.add(m[1]);
    }
    expect(entries.size).toBeGreaterThan(1000);
    const refused: string[] = [];
    entries.forEach((e) => {
      if (normalizeReactionEmoji(e) === null) refused.push(e);
    });
    expect(refused, "the picker offers a reaction the server refuses").toEqual([]);
  });
});
