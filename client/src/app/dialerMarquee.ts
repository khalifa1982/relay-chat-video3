/* ──────────────────────────────────────────────────────────────────────────
 * THE DIALER'S IDLE MARQUEE — the pure engine.
 *
 * Owner, circling the dialed-digit echo area on their own Dialer screenshot:
 * *"again my pin is mentioned down, not here — make a matrix message that press
 * the numbers to dial to find your friends family team workers, but make them
 * like it's flashy matrix random colours … don't show it all in one time, it's
 * like blinking showing in out … if you have saved contacts, it will appear
 * there. The name and the pin on the name on the left and the pin on the place
 * of the six digits. It's like marketing, but it will be showing and it will
 * hide … it will fetch randomly, but only it will appear your contacts, not
 * other people contact. Now, if you don't have contact, it will tell you
 * contact your family and it will show the other categories empty, but without
 * showing numbers."*
 *
 * WHY THIS FILE HAS NO DOM AND NO REACT IN IT. `Dialer.tsx` is the one app tab
 * that is NOT `React.lazy` (App.tsx imports it at top level), and
 * `Dialer.test.ts` module-evaluates it under vitest's `node` environment. So a
 * module-scope `window` or `document` here turns twenty currently-green tests
 * red and lands in the entry chunk besides. Everything that decides anything
 * lives in this file; the leaf that paints owns the DOM.
 *
 * THE PURITY SEAM IS `frameAt`, AND IT IS DELIBERATE: it returns WHICH ALPHABET
 * a cell should be rolling from, never a rolled glyph. That keeps the whole
 * state machine deterministic and assertable in a node test — "does the PIN
 * always resolve to the right six digits", "can an empty category ever render a
 * number" — while the painter, which needs randomness, needs no test at all.
 * ────────────────────────────────────────────────────────────────────────── */
import { CONTACT_TAGS, type ContactTag } from "@shared/contactTags";
import { RELAY_ACCENT_CYCLE_MS } from "@/lib/relayBackground";

/* ── the rows this engine accepts ───────────────────────────────────────────
 * A structural subset of `contacts.list`'s projection, so the engine can be
 * driven from a plain object in a test AND from the real payload in the app
 * without either side casting.
 *
 * `tags` IS READ DIRECTLY AND THAT IS CORRECT: the server already resolves it
 * through `contactTagsOf` (server/v2routers.ts), so the wire value is a real
 * ContactTag[] and a pre-v2.106.14 row whose only tag lives in the legacy
 * `category` mirror has already been folded in. Re-resolving here would be a
 * second implementation of a rule the server owns. */
export type MarqueeContactRow = {
  number: string;
  displayName: string | null;
  tags: ContactTag[];
  blocked: boolean;
  identityId: number | null;
};

/** A contact the marquee is willing to put on screen. */
export type MarqueeContact = { number: string; name: string };

/* ── the slide union ────────────────────────────────────────────────────────
 * ONLY THE `contact` VARIANT CARRIES A `pin`, AND THAT IS THE OWNER'S OWN
 * CLAUSE MADE UNREPRESENTABLE RATHER THAN MERELY TESTED. They said it twice —
 * *"it will show the other categories empty, but without showing numbers"* — so
 * a prompt slide and an empty-category slide have no field a number could be
 * put in. A test can only assert that today's code does not do it; a type
 * forbids tomorrow's. */
export type MarqueeSlide =
  /** The viewer's own number. Present ONLY on a short viewport — see
   *  `buildRotations` — because that is where MY NUMBER is hidden. */
  | { kind: "own"; pin: string }
  /** Two timed lines of marketing copy. No contact, no number. */
  | { kind: "hint" }
  /** A category with somebody in it: prompt, then that person decodes. */
  | { kind: "contact"; round: MarqueeRound; prompt: string; contact: MarqueeContact }
  /** A category with nobody in it: the prompt alone, and structurally nothing else. */
  | { kind: "empty"; round: MarqueeRound; prompt: string };

/** The rounds the marquee rotates through.
 *
 *  FOUR OF THEM ARE THE APP'S OWN TAG VOCABULARY, and that is the owner's
 *  answer to a question I put to them directly: "friends family team workers"
 *  names four things and `CONTACT_TAGS` already holds exactly four, so
 *  "workers" maps to `team` rather than inventing a fifth tag nothing else in
 *  the app would understand.
 *
 *  THE FIFTH IS THE ONE THIS FEATURE CANNOT SHIP WITHOUT — see
 *  `UNTAGGED_ROUND` below. */
export type MarqueeRound = ContactTag | "saved";

/** The untagged round.
 *
 *  THIS IS THE FINDING THAT WOULD HAVE MADE THE WHOLE FEATURE INERT, and it is
 *  worth stating in full because it is invisible until you look at how contacts
 *  are actually created. EVERY add-contact call site in the app sends
 *  `{ number, displayName }` and nothing else — the Dialer's save pill,
 *  RelayEngine's in-call save, History's row action, the peer profile's two —
 *  and `tags` is `.optional()` on the server input with nothing backfilling it.
 *  Even the explicit Add-contact dialog opens with an empty tag list. Tags are
 *  set ONLY by three deliberate after-the-fact editors.
 *
 *  So UNTAGGED IS THE DEFAULT STATE OF EVERY CONTACT, and a marquee that
 *  rotated only the four tags would tell a user with five hundred saved
 *  contacts that they have no family, no friends and no team — the exact
 *  failure the owner described for the ZERO-contact case, delivered to the
 *  fullest address book in the fleet, as the DEFAULT experience. Their own
 *  clause is *"if you have saved contacts, it will appear there"*.
 *
 *  IT IS NOT `sectionsFor`'s `other` BUCKET, and the difference is not
 *  pedantry: that one means "in no SECTION", and VIP has no section (it renders
 *  as a chip). Here VIP has a ROUND of its own, so borrowing that predicate
 *  would show a vip-only contact twice — once under VIP and once under
 *  "everyone else". This asks the question this screen actually has: is this
 *  person in NONE of the rounds. */
export const UNTAGGED_ROUND = "saved" as const;

export const ROUND_PROMPT: Record<MarqueeRound, string> = {
  /* "Contact your family" is the owner's own words, verbatim. The rest match its
     shape: an instruction, no apology, and nothing that claims anything about
     the reader's address book. */
  family: "Contact your family",
  friend: "Call a friend",
  team: "Reach your team",
  vip: "Call a VIP",
  saved: "Someone you've saved",
};

/** The two timed lines of the hint slide. Both are bounded by
 *  `MARQUEE_COPY_MAX` — a wrap grows the row, and the row's height is part of
 *  the keypad's hardcoded budget (see MARQUEE_MIN_VIEWPORT_H). */
export const HINT_LINES = ["Press the numbers to dial", "Find friends, family & team"] as const;

/** No copy string may exceed this. Measured against the row's own font size at
 *  the narrowest supported width; asserted for every string in this file. */
export const MARQUEE_COPY_MAX = 34;

/* ── timing ─────────────────────────────────────────────────────────────────
 * THE CONTACT SLIDE'S TOTAL IS DERIVED FROM THE ACCENT CYCLE, NOT CHOSEN.
 *
 * The owner asked for colours that *"match to the background colouring, which
 * is keep changing"*. The background eases to a fresh hue every
 * RELAY_ACCENT_CYCLE_MS, so a contact slide lasting exactly half of that means
 * every OTHER contact arrives under a visibly different accent — the match is a
 * property with a test behind it rather than a coincidence that survives until
 * somebody retunes one of the two numbers.
 *
 * The other slide kinds are hand-picked. Said plainly rather than dressed up:
 * only the contact slide carries the payload the colour clause is about, and
 * forcing 3-second prompts onto a 9500ms cycle divides badly. */
export const SLIDE_CONTACT_MS = RELAY_ACCENT_CYCLE_MS / 2;

export const MARQUEE_TIMING = {
  /** Fade + rise in. */
  IN: 260,
  /** The prompt holds alone — this is the "don't show it all in one time". */
  PROMPT: 1200,
  /** Extra hold for a prompt-only slide, which has nothing following it. */
  PROMPT_EXTRA: 1200,
  /** The six cells scramble and lock. */
  DECODE: 780,
  /** Fade out. */
  OUT: 320,
  /** FULL BLANK between slides — the owner's *"blinking showing in out"*. */
  GAP: 180,
  /** How long the viewer's own number rests. */
  OWN_SETTLE: 3400,
  /** First cell locks here; each subsequent cell LOCK_STEP later. */
  LOCK_START: 220,
  LOCK_STEP: 110,
  /** One glyph roll. ~18Hz: slow enough that a character is readable, which is
   *  what makes it read as a scramble rather than a smear. */
  FLICK: 55,
} as const;

/** The contact slide's settle is what is LEFT of the derived total, so the two
 *  can never drift: change any constant above and the settle absorbs it. */
export const SETTLE_MS =
  SLIDE_CONTACT_MS -
  (MARQUEE_TIMING.IN +
    MARQUEE_TIMING.PROMPT +
    MARQUEE_TIMING.DECODE +
    MARQUEE_TIMING.OUT +
    MARQUEE_TIMING.GAP);

/** Below this viewport height the MY NUMBER card is hidden by index.css, so the
 *  viewer's own number gets a rotation of its own here.
 *
 *  THIS DUPLICATES A CSS CONSTANT IN JS — the v2.99.71 class, where a checker
 *  that re-derived a value ended up disagreeing with the thing it checked and
 *  reported two live TURN relays permanently down. There is no way to share a
 *  number between a `@media` query and a `matchMedia` call, so it is covered by
 *  an explicit parity test that reads index.css and compares. */
export const MARQUEE_MIN_VIEWPORT_H = 660;

/* ── alphabets ──────────────────────────────────────────────────────────────
 * A cell CONVERGES: it rolls alien glyphs while it is far from locking and
 * digits over its last few flicks, so it settles as a number rather than
 * snapping from katakana to a digit in one frame. That is the vocabulary the
 * owner has already seen in this app — MatrixReveal plays it on guest signup. */
export const MATRIX_GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ0123456789ABCDEF";
export const DIGIT_GLYPHS = "0123456789";

/** How many flicks before its lock a cell switches to digits. */
export const CONVERGE_FLICKS = 3;

export type CellFrame = {
  /** The settled character, or "" while still scrambling / on a slide with no
   *  number at all. The painter rolls its own glyph when this is empty AND
   *  `alphabet` is non-null. */
  digit: string;
  locked: boolean;
  /** null ⇒ paint nothing. This is what makes an `empty` slide structurally
   *  incapable of showing a number: no alphabet, no settled digit, no glyph. */
  alphabet: string | null;
  opacity: number;
  /** A short pop as the cell locks. Compositor-only. */
  scale: number;
};

export type MarqueeFrame = {
  promptText: string;
  promptOpacity: number;
  /** Rise-in offset in px. Transform, never `top`. */
  promptShiftPx: number;
  nameText: string;
  nameOpacity: number;
  cells: CellFrame[];
  /** True once the slide's whole timeline (including the blank GAP) is spent. */
  done: boolean;
};

const EMPTY_CELL: CellFrame = { digit: "", locked: false, alphabet: null, opacity: 0, scale: 1 };
const emptyCells = (): CellFrame[] => Array.from({ length: 6 }, () => ({ ...EMPTY_CELL }));

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Total lifetime of a slide, blank gap included. */
export function slideDuration(slide: MarqueeSlide): number {
  const T = MARQUEE_TIMING;
  switch (slide.kind) {
    case "contact":
      return SLIDE_CONTACT_MS;
    case "empty":
      return T.IN + T.PROMPT + T.PROMPT_EXTRA + T.OUT + T.GAP;
    case "hint":
      return T.IN + T.PROMPT + T.IN + T.PROMPT + T.OUT + T.GAP;
    case "own":
      return T.IN + T.OWN_SETTLE + T.OUT + T.GAP;
  }
}

/**
 * The frame to paint for `slide` at `t` ms into its own timeline.
 *
 * Pure. No clock, no DOM, no randomness — the painter supplies the roll.
 */
export function frameAt(slide: MarqueeSlide, t: number): MarqueeFrame {
  const T = MARQUEE_TIMING;
  const total = slideDuration(slide);
  const done = t >= total;
  /* The tail of every slide is OUT then a fully blank GAP. Computed from the
     end so each kind gets the same exit without restating it. */
  const outStart = total - T.GAP - T.OUT;
  const envelope =
    t < T.IN
      ? clamp01(t / T.IN)
      : t < outStart
        ? 1
        : t < outStart + T.OUT
          ? 1 - clamp01((t - outStart) / T.OUT)
          : 0;
  const shift = t < T.IN ? 6 * (1 - clamp01(t / T.IN)) : 0;

  if (slide.kind === "own") {
    return {
      promptText: "",
      promptOpacity: 0,
      promptShiftPx: 0,
      nameText: "",
      nameOpacity: 0,
      cells: slide.pin.split("").map((d) => ({
        digit: d,
        locked: true,
        alphabet: DIGIT_GLYPHS,
        opacity: envelope,
        scale: 1,
      })),
      done,
    };
  }

  if (slide.kind === "hint") {
    /* TWO BEATS, NOT ONE STRING. The owner's sentence is two ideas and they are
       delivered as two — which is the same clause as "don't show it all in one
       time", answered inside a slide rather than only between slides. */
    const second = t >= T.IN + T.PROMPT;
    const line = second ? HINT_LINES[1] : HINT_LINES[0];
    /* The crossfade re-runs the IN envelope for the second line. */
    const localT = second ? t - (T.IN + T.PROMPT) : t;
    const lineOp = localT < T.IN ? clamp01(localT / T.IN) : 1;
    return {
      promptText: line,
      promptOpacity: Math.min(envelope, lineOp),
      promptShiftPx: localT < T.IN ? 6 * (1 - clamp01(localT / T.IN)) : 0,
      nameText: "",
      nameOpacity: 0,
      cells: emptyCells(),
      done,
    };
  }

  if (slide.kind === "empty") {
    return {
      promptText: slide.prompt,
      promptOpacity: envelope,
      promptShiftPx: shift,
      nameText: "",
      nameOpacity: 0,
      /* NO ALPHABET, NO DIGIT, NO GLYPH — the owner's "without showing numbers",
         made structural. There is no branch here that could produce one. */
      cells: emptyCells(),
      done,
    };
  }

  /* ── contact ───────────────────────────────────────────────────────────── */
  const decodeStart = T.IN + T.PROMPT;
  const dt = t - decodeStart;
  const digits = slide.contact.number.split("");
  const cells: CellFrame[] = digits.map((d, i) => {
    if (dt < 0) return { ...EMPTY_CELL };
    const lockAt = T.LOCK_START + i * T.LOCK_STEP;
    if (dt >= lockAt) {
      const since = dt - lockAt;
      return {
        digit: d,
        locked: true,
        alphabet: DIGIT_GLYPHS,
        /* SETTLED CELLS ARE ALWAYS FULLY OPAQUE (modulo the slide envelope).
           The dim ramp below applies ONLY to scrambling glyphs, which carry no
           information — a settled digit at 0.55 on the light theme's measured
           4.85:1 accent would land near 2.9:1 and fail AA. */
        opacity: envelope,
        scale: since < 140 ? 1 + 0.18 * (1 - since / 140) : 1,
      };
    }
    const flicksLeft = Math.ceil((lockAt - dt) / T.FLICK);
    return {
      digit: "",
      locked: false,
      alphabet: flicksLeft > CONVERGE_FLICKS ? MATRIX_GLYPHS : DIGIT_GLYPHS,
      /* The bright leading edge sweeps left-to-right because the locks do —
         that is a falling matrix column expressed as opacity on ONE colour,
         rather than a second hue on a screen whose colour allocation is full
         (green Voice, sky Video, violet Group, red erase, amber DND, pink add). */
      opacity:
        envelope * (0.42 + 0.58 * clamp01((CONVERGE_FLICKS - flicksLeft) / CONVERGE_FLICKS)),
      scale: 1,
    };
  });

  /* THE PROMPT AND THE CONTACT CROSS-FADE IN THE SAME SPACE — they are a
     SEQUENCE, not a stack, which is both what the owner described (*"then it
     will say contact your family. It will show the family contact"*) and what
     keeps the marquee inside ONE row.
     That second half is not cosmetic: the row's `minHeight` is
     `clamp(2rem, 7vw, 3rem)`, which resolves to 32px on a 390px phone, and the
     keypad's own size subtracts a HARDCODED 422px that includes a frozen
     "readout and preview ~80" term. Stacking a prompt line above the digits
     would add ~15px that the keypad does not shrink to absorb — the card would
     silently start scrolling, first visible on the shortest phones. */
  const cross = clamp01((t - decodeStart) / T.IN);
  return {
    promptText: slide.prompt,
    promptOpacity: envelope * (1 - cross),
    promptShiftPx: shift,
    nameText: slide.contact.name,
    nameOpacity: envelope * cross,
    cells,
    done,
  };
}

/* ── the contact list ───────────────────────────────────────────────────── */

/**
 * Which saved contacts the marquee may put on screen.
 *
 * ORDER MATTERS AND EACH TEST EARNS ITS PLACE:
 *
 * 1. A MALFORMED STORED NUMBER is never offered as dialable.
 *
 * 2. `identityId != null` — a saved number that resolves to NO identity is not
 *    a RELAY user. That happens two ways and both are real: a number that never
 *    registered, and a person whose identity was PURGED (v2.100.0 deliberately
 *    KEEPS third-party contact rows, because `blocked` lives on them). Without
 *    this the marquee advertises a dead number, the user taps it, the lookup
 *    resolves to null and the Dialer disables Voice, Video, Group AND the save
 *    pill — the screen invited a call and then refused it, which is the
 *    false-claim class v2.106.25 spent a release removing.
 *
 * 3. `!blocked` — the contactSuggest rule verbatim: offering to call somebody
 *    you deliberately blocked is a mis-suggestion. LOAD-BEARING, because
 *    `contacts.list` RETURNS blocked rows (it emits `blocked: true` rather than
 *    dropping them, so the Contacts screen can render them visible-but-disabled).
 *
 * 4. A NAME IS REQUIRED. The marquee's whole shape is "name on the left, PIN in
 *    the digit slot"; a row with no name would render as a bare number with an
 *    empty gutter, which is the thing the owner asked to REMOVE from this spot.
 */
export function eligibleForMarquee(rows: readonly MarqueeContactRow[]): MarqueeContactRow[] {
  return rows.filter(
    (c) =>
      /^\d{6}$/.test(c.number) &&
      c.identityId != null &&
      !c.blocked &&
      typeof c.displayName === "string" &&
      c.displayName.trim().length > 0
  );
}

/**
 * A stable key for memoising the rotation list.
 *
 * NOT THE ARRAY IDENTITY, and that is a correctness fix rather than an
 * optimisation. `contacts.list` carries `isOnline`, `idle`, `lastSeenAt` and
 * `inCall` per row and is refetched every 60s, so react-query's structural
 * sharing hands back a NEW array on essentially every poll for any account with
 * one online contact — the deck would reshuffle roughly every minute, including
 * the slide currently on screen.
 *
 * SORTED BY NUMBER so it is order-independent: `listContacts` orders by
 * `favourite` then `updatedAt`, so editing any contact reorders the whole list
 * without changing what the marquee reads.
 */
export function marqueeSignature(rows: readonly MarqueeContactRow[]): string {
  return rows
    .map((c) => `${c.number}:${c.displayName ?? ""}:${c.tags.join("|")}:${c.blocked ? 1 : 0}:${c.identityId ?? ""}`)
    .sort()
    .join("\n");
}

/** Members of one round. VIP has a round here even though it has no SECTION in
 *  the Contacts screen — see UNTAGGED_ROUND for why that asymmetry matters. */
function membersOf(rows: readonly MarqueeContactRow[], round: MarqueeRound): MarqueeContact[] {
  const inRound = (c: MarqueeContactRow) =>
    round === UNTAGGED_ROUND
      ? !c.tags.some((t) => (CONTACT_TAGS as readonly string[]).includes(t))
      : c.tags.includes(round);
  return rows.filter(inRound).map((c) => ({ number: c.number, name: (c.displayName ?? "").trim() }));
}

export type BuildOptions = {
  /** The viewer's own number, or null while a guest's is still being minted. */
  ownNumber?: string | null;
  /** True below MARQUEE_MIN_VIEWPORT_H, where MY NUMBER is hidden. */
  shortViewport?: boolean;
  /** True when `contacts.list` failed. Degrades to the hint ALONE. */
  contactsUnavailable?: boolean;
};

/**
 * The rotation list for one full pass.
 *
 * LEADS WITH A POPULATED ROUND, and that ordering is the difference between a
 * feature and a thing nobody sees. Somebody who opens the Dialer to dial a
 * number is typically gone in two or three seconds; a list that opens on a
 * generic prompt spends the whole visit on copy they have read a hundred times
 * and never reaches the one thing the owner asked for. So: populated rounds
 * (shuffled) first, then the hint, then the empty categories (shuffled) — which
 * still delivers *"it will show the other categories empty"*, just not first.
 *
 * ON A SHORT VIEWPORT the viewer's own number leads instead, because index.css
 * hides the MY NUMBER card below 660px and after v2.106.77 the top bar carries
 * no number either — so on such a phone this is the only copy on the screen.
 * The established order on this card is that the DECORATION yields before the
 * function does.
 *
 * A FAILED READ YIELDS THE HINT ALONE — never a category prompt. Rendering
 * "Contact your family" with nothing in it over a read that FAILED is a
 * confident claim about somebody's own address book, which is v2.106.25
 * verbatim ("ANY failure of contacts.list … rendered No contacts yet").
 */
export function buildRotations(
  rows: readonly MarqueeContactRow[],
  opts: BuildOptions = {},
  rand: () => number = Math.random
): MarqueeSlide[] {
  const own: MarqueeSlide[] =
    opts.shortViewport && opts.ownNumber && /^\d{6}$/.test(opts.ownNumber)
      ? [{ kind: "own", pin: opts.ownNumber }]
      : [];

  if (opts.contactsUnavailable) return [...own, { kind: "hint" }];

  const eligible = eligibleForMarquee(rows);
  const rounds: MarqueeRound[] = [...CONTACT_TAGS, UNTAGGED_ROUND];

  const populated: MarqueeSlide[] = [];
  const empty: MarqueeSlide[] = [];
  for (const round of rounds) {
    const members = membersOf(eligible, round);
    if (members.length) {
      populated.push({
        kind: "contact",
        round,
        prompt: ROUND_PROMPT[round],
        contact: members[Math.floor(clamp01(rand()) * members.length) % members.length],
      });
    } else if (round !== UNTAGGED_ROUND) {
      /* NO EMPTY "everyone else" SLIDE. "Someone you've saved" with nobody in it
         says only "you have no contacts", which the four category prompts
         already convey — a fifth apology adds nothing. */
      empty.push({ kind: "empty", round, prompt: ROUND_PROMPT[round] });
    }
  }

  return [...own, ...shuffle(populated, rand), { kind: "hint" }, ...shuffle(empty, rand)];
}

/** Fisher–Yates on a copy. */
function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(clamp01(rand()) * (i + 1)) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
