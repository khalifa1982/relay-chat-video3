/**
 * Message reactions — `DATA-CONTRACTS.md` §2, for board 4c.
 *
 * WHAT LIVES HERE AND WHY IT IS SHARED
 * ------------------------------------
 * The quick row, the validation rule and the projection into the contract's
 * `{emoji: pins[]}` shape. All three have a reader on BOTH sides of the wire — the
 * server validates and projects, the client renders and decides the toggle — and
 * two copies of "is this a legal reaction" is exactly how a client comes to offer
 * something the server then refuses.
 */

/** The board's quick-react row. `+` opens the full picker, so this is the
 *  shortlist rather than the permitted set — anything `normalizeReactionEmoji`
 *  accepts can be a reaction. */
export const QUICK_REACTIONS = ["❤️", "👍", "😂", "😮", "😢"] as const;

/** The contract's stored/wire shape: emoji → reactor pins, insertion-ordered. */
export type MessageReactions = Record<string, string[]>;

/** One row as the server holds it. `pin` rather than an identity id because the
 *  contract keys by pin and the client already resolves names from pins. */
export interface ReactionRow {
  emoji: string;
  pin: string;
}

/** Longest reaction we will store. A single emoji can be a ZWJ sequence with skin
 *  tone modifiers — "👩🏽‍🚀" is 7 UTF-16 code units and a four-person family emoji
 *  is 11 — so this is generous for one glyph and far too short for a sentence. */
export const REACTION_MAX_LENGTH = 32;

/**
 * C0/C1 controls, plus the bidi marks, embeddings, overrides and isolates.
 *
 * TESTED NUMERICALLY RATHER THAN WITH A CHARACTER CLASS, and that is not a style
 * choice: writing these as literal characters puts a raw U+202E in the source,
 * which is invisible in every editor and reorders the line it sits on — a guard
 * against bidi, written in bidi, for whoever reads it next. The first draft of this
 * file did exactly that, and `grep` reporting the whole file as BINARY is how it was
 * caught. Escapes would have been fine too; numbers cannot be got wrong at all.
 *
 * ZWJ (0x200D) and the variation selectors are deliberately NOT here — they are what
 * joins an emoji sequence, so forbidding them would refuse "👩‍🚀" and even the plain
 * "❤️", whose second code unit is U+FE0F.
 *
 * An index loop rather than `for…of`, which over a string needs `downlevelIteration`
 * under this tsconfig (TS2802 — recorded three times in this repo). Every forbidden
 * value is BMP, so reading code UNITS is sound: a surrogate half is 0xD800-0xDFFF and
 * none of these ranges reach it.
 */
function hasForbiddenCodePoint(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return true; // C0 / C1 controls
    if (c === 0x200e || c === 0x200f) return true; // LRM / RLM
    if (c >= 0x202a && c <= 0x202e) return true; // embeddings + overrides
    if (c >= 0x2066 && c <= 0x2069) return true; // isolates
  }
  return false;
}

/**
 * A KEYCAP: an ASCII digit (or `#`/`*`), an optional variation selector, and the
 * combining enclosing keycap U+20E3. `0️⃣`–`9️⃣` are all in the picker.
 *
 * Recognised as a unit because the digit inside one is a real ASCII digit, and the
 * "an emoji is not a word" rule tests exactly that. Stripping the whole well-formed
 * sequence is what lets the rule stay strict without refusing glyphs the app offers.
 */
const KEYCAP = /[0-9#*]️?⃣/g;

/**
 * "Is there a letter or a digit in here", in any script — built at RUNTIME.
 *
 * The literal would be `/\p{L}|\p{N}/u`, and `tsc` refuses it with TS1501: this
 * repo's tsconfig sets no `target`, so it defaults to ES5, which predates Unicode
 * property escapes. That is the same downlevel constraint behind the `for…of`
 * TS2802 notes elsewhere in this file. The RUNTIME is esbuild and Vite — neither
 * downlevels that far — and property escapes have been in every browser and in
 * Node since 2018, so the capability is real even though the compiler's target
 * cannot express it.
 *
 * Compiled ONCE, and guarded: an engine that genuinely cannot build it falls back
 * to the ASCII class this rule used to be. That is narrower than intended, but it
 * is the behaviour the file already shipped with — strictly better than a module
 * that throws on import and takes every reaction with it.
 */
const LETTER_OR_NUMBER: RegExp = (() => {
  try {
    return new RegExp("\\p{L}|\\p{N}", "u");
  } catch {
    return /[A-Za-z0-9]/;
  }
})();

/**
 * Normalize a proposed reaction, or null if it is not one.
 *
 * THIS IS NOT COSMETIC VALIDATION. Without it the reaction field is a free-text
 * channel that renders on somebody ELSE'S message, in their thread — an unsolicited
 * `react({emoji: "you are an idiot"})` sitting under their own words. So the rule is
 * a shape rule about what an emoji IS rather than an allowlist of glyphs (the `+`
 * picker offers ~1,124 and the set grows with every Unicode release, so an allowlist
 * would refuse legitimate reactions forever after):
 *
 *   - bounded length,
 *   - no LETTERS and no DIGITS, in any script — an emoji is not a word,
 *   - no whitespace — one glyph, not a phrase,
 *   - no control or bidi characters, which can reorder the text AROUND the chip (the
 *     class every PIN surface in this app isolates against).
 *
 * ── THE SECOND RULE SAID `[A-Za-z0-9]`, WHICH IS ASCII AND ONLY ASCII ─────────
 * So the free-text channel this function exists to close stood open in every other
 * script: `react({ emoji: "غبي" })` — or Cyrillic, or CJK, or Japanese — passed
 * validation and rendered as a chip under somebody else's own message. This app
 * ships an Arabic UI, so that is not a theoretical gap. The test is now the Unicode
 * property, which covers scripts added after this was written too; enumerating
 * alphabets would rot exactly the way the rejected allowlist would.
 *
 * Checked against the picker's own 1,125 entries: with keycaps stripped first,
 * `\p{L}|\p{N}` refuses none of them. Before this change it refused TEN — the keycap
 * digits `0️⃣`–`9️⃣`, which the picker offered and the server had always rejected on
 * the ASCII digit inside them, so tapping one silently did nothing.
 *
 * FAILS TO NULL rather than to a default: a reaction nobody can express is a refused
 * tap, while a defaulted one puts a sentiment in somebody's mouth.
 */
export function normalizeReactionEmoji(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > REACTION_MAX_LENGTH) return null;
  // Keycaps out of the way first: the digit in one is not a word, it is part of a
  // glyph. Only a WELL-FORMED sequence is stripped, so a bare "1" is still refused.
  if (LETTER_OR_NUMBER.test(s.replace(KEYCAP, ""))) return null;
  if (/\s/.test(s)) return null;
  if (hasForbiddenCodePoint(s)) return null;
  return s;
}

/**
 * Project stored rows into the contract's map.
 *
 * ORDER IS INSERTION ORDER, which the contract specifies and which is meaning rather
 * than incident: the chip row reads left to right in the order people reacted, so
 * re-sorting would shuffle a group's chips under the reader every time anybody
 * reacted. Callers pass rows already ordered by id.
 *
 * A pin reacting twice cannot happen (the unique key), but the projection is
 * defensive anyway — a duplicate would render one person as two reactors, i.e. a
 * count that is simply wrong.
 */
export function projectReactions(rows: readonly ReactionRow[]): MessageReactions {
  const out: MessageReactions = {};
  for (const r of rows) {
    const emoji = normalizeReactionEmoji(r.emoji);
    if (!emoji || !r.pin) continue;
    const list = (out[emoji] ??= []);
    if (!list.includes(r.pin)) list.push(r.pin);
  }
  return out;
}

/** Which emoji, if any, this pin has on a message. The client needs it to decide the
 *  toggle AND to tint its own chip; deriving it in one place stops those two answers
 *  disagreeing — a chip tinted as mine that a tap then adds again. */
export function myReaction(
  reactions: MessageReactions | null | undefined,
  myPin: string
): string | null {
  if (!reactions || !myPin) return null;
  for (const [emoji, pins] of Object.entries(reactions)) {
    if (pins.includes(myPin)) return emoji;
  }
  return null;
}

/**
 * The op a tap means, given what I already have.
 *
 * THE TOGGLE IS THE CONTRACT'S RULE AND IT IS DECIDED HERE RATHER THAN AT THE TAP
 * SITE: re-picking the same emoji removes it, picking a different one MOVES it —
 * which the unique key makes one atomic statement rather than a delete followed by an
 * insert that can fail in between and leave the reaction gone. Both ops are
 * idempotent, so a double-tap or a retried request cannot land somewhere unintended.
 */
export function reactionOpFor(
  current: string | null,
  tapped: string
): { emoji: string; op: "add" | "remove" } {
  return current === tapped ? { emoji: tapped, op: "remove" } : { emoji: tapped, op: "add" };
}

/** The chips a bubble shows. Count is RETURNED rather than formatted, because the
 *  contract renders it only above 1 and that is the caller's decision to make. */
export function reactionChips(
  reactions: MessageReactions | null | undefined,
  myPin: string
): { emoji: string; count: number; mine: boolean }[] {
  if (!reactions) return [];
  return Object.entries(reactions)
    .filter(([, pins]) => pins.length > 0)
    .map(([emoji, pins]) => ({ emoji, count: pins.length, mine: pins.includes(myPin) }));
}
