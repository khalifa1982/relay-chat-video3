/* ============================================================
   v2.99.93 — the pending-task batch: find a contact by first digit OR first letter,
   icons on the profile contact rows, and an honest guest-hold notice.

   Owner (#91): start a new conversation "by first digit or first letter". The
   New-conversation field STRIPPED every non-digit on the way in, so a name could not
   be typed at all — you had to know the six digits by heart.

   The ranking is tested BEHAVIOURALLY because that is the entire feature: a source
   pin cannot tell you whether typing `7` surfaces 777777, or whether "ham" finds
   somebody by their surname.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  suggestContacts,
  digitsOf,
  isNumberQuery,
  foldName,
  type SuggestableContact,
} from "./contactSuggest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const MESSAGES = read("client/src/pages/app/Messages.tsx");
const HUB = read("client/src/pages/app/ProfileHubSections.tsx");
const PROFILE = read("client/src/pages/app/Profile.tsx");

function codeOnly(src: string): string {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

const C = (number: string, displayName: string, extra: Partial<SuggestableContact> = {}): SuggestableContact => ({
  number,
  displayName,
  ...extra,
});

const BOOK: SuggestableContact[] = [
  C("777777", "Khalifa Alhammadi", { favorite: true }),
  C("735680", "Khaloud Alhammadi"),
  C("601586", "Mohamed Idris", { isOnline: true }),
  C("235680", "Sara Nunez"),
  C("712345", "Zain Ali"),
  C("999999", "Blocked Person", { blocked: true }),
];

/* ── by number ────────────────────────────────────────────────────────────── */

describe("typing DIGITS matches the start of the number", () => {
  it("one digit narrows to everyone starting with it", () => {
    const hits = suggestContacts(BOOK, "7").map((c) => c.number);
    expect(hits).toEqual(["712345", "735680", "777777"]);
  });

  it("more digits narrow further", () => {
    expect(suggestContacts(BOOK, "77").map((c) => c.number)).toEqual(["777777"]);
    expect(suggestContacts(BOOK, "735").map((c) => c.number)).toEqual(["735680"]);
  });

  it("NOT an infix match — a 6-digit number has no meaningful interior", () => {
    // `55` matching 155234 would put a stranger above the person being dialled.
    expect(suggestContacts([C("155234", "Someone")], "55")).toEqual([]);
  });

  it("accepts the grouping people actually type", () => {
    // The app DISPLAYS numbers as 777-777, so refusing that shape back would be rude.
    expect(suggestContacts(BOOK, "777-7").map((c) => c.number)).toEqual(["777777"]);
    expect(suggestContacts(BOOK, "735 6").map((c) => c.number)).toEqual(["735680"]);
  });

  it("a full six digits resolves to exactly that person", () => {
    expect(suggestContacts(BOOK, "601586").map((c) => c.displayName)).toEqual(["Mohamed Idris"]);
  });
});

/* ── by name ──────────────────────────────────────────────────────────────── */

describe("typing LETTERS matches the start of a name", () => {
  it("one letter finds everyone whose name starts with it", () => {
    const hits = suggestContacts(BOOK, "k").map((c) => c.displayName);
    // Favourite first among equal ranks.
    expect(hits).toEqual(["Khalifa Alhammadi", "Khaloud Alhammadi"]);
  });

  it("a SURNAME works too — people search either way", () => {
    const hits = suggestContacts(BOOK, "alham").map((c) => c.displayName);
    expect(hits).toEqual(["Khalifa Alhammadi", "Khaloud Alhammadi"]);
  });

  it("a first-name match OUTRANKS a surname match", () => {
    // THE EXAMPLE IS CHOSEN SO ALPHABETICAL ORDER DISAGREES WITH RANK. The first
    // version used "Zain Ali" / "Ali Hassan", where the alphabetical tiebreak
    // happens to produce the same order — so deleting the rank comparison entirely
    // left the test green, which the mutation run caught. Here the rank-1 match
    // ("Ahmed Ali", matched on its surname) sorts BEFORE the rank-0 match
    // ("Ali Hassan", matched on its whole name), so only the rank term can put them
    // in this order.
    const book = [C("111222", "Ahmed Ali"), C("333444", "Ali Hassan")];
    expect(suggestContacts(book, "ali").map((c) => c.displayName)).toEqual([
      "Ali Hassan",
      "Ahmed Ali",
    ]);
  });

  it("NEVER an infix — one or two letters inside a word matches most of a book", () => {
    // Indistinguishable from no filter at all (the v2.99.80 emoji-catalogue lesson).
    expect(suggestContacts(BOOK, "ham").map((c) => c.displayName)).toEqual([]);
    expect(suggestContacts(BOOK, "ris")).toEqual([]);
  });

  it("case and accents do not matter", () => {
    expect(suggestContacts(BOOK, "KHAL").length).toBe(2);
    const book = [C("111222", "Ålvaro Núñez")];
    expect(suggestContacts(book, "alv").map((c) => c.number)).toEqual(["111222"]);
    expect(suggestContacts(book, "nun").map((c) => c.number)).toEqual(["111222"]);
  });

  it("a contact with no name is unreachable by letters but fine by number", () => {
    const book = [C("444555", "")];
    expect(suggestContacts(book, "a")).toEqual([]);
    expect(suggestContacts(book, "444").map((c) => c.number)).toEqual(["444555"]);
  });
});

/* ── the rules that decide which mode ─────────────────────────────────────── */

describe("which search a query means", () => {
  it("digits and grouping are a NUMBER search", () => {
    for (const q of ["7", "777777", "777-777", "735 680", " 12 "]) {
      expect(isNumberQuery(q), q).toBe(true);
    }
  });

  it("anything with a letter is a NAME search", () => {
    // Otherwise "7th floor" would be read as the number 7.
    for (const q of ["k", "7th floor", "sara", "a1"]) {
      expect(isNumberQuery(q), q).toBe(false);
    }
  });

  it("an empty query is neither", () => {
    expect(isNumberQuery("")).toBe(false);
    expect(isNumberQuery("   ")).toBe(false);
  });

  it("digitsOf keeps only digits, so a typo cannot become a valid number", () => {
    expect(digitsOf("777-777")).toBe("777777");
    expect(digitsOf("7a7b7c7d7e7f")).toBe("777777"); // <- and this is WHY the submit
    // path also requires isNumberQuery: stripping alone would read that as 777777.
    expect(digitsOf("")).toBe("");
  });

  it("foldName strips diacritics and case", () => {
    expect(foldName("Ålvaro NÚÑEZ")).toBe("alvaro nunez");
    expect(foldName("")).toBe("");
  });
});

/* ── what it withholds ────────────────────────────────────────────────────── */

describe("what the list refuses to offer", () => {
  it("a contact YOU blocked is never suggested", () => {
    // Offering to start a conversation with somebody you deliberately blocked is a
    // mis-suggestion; unblocking is a decision to make in Contacts, on purpose.
    expect(suggestContacts(BOOK, "blocked")).toEqual([]);
    expect(suggestContacts(BOOK, "999").map((c) => c.number)).toEqual([]);
  });

  it("a malformed number is skipped rather than offered and then refused", () => {
    const book = [C("12", "Short"), C("abcdef", "Letters"), C("777777", "Real")];
    expect(suggestContacts(book, "").map((c) => c.number)).toEqual(["777777"]);
  });

  it("nothing typed shows favourites, then whoever is online", () => {
    const hits = suggestContacts(BOOK, "", 3).map((c) => c.displayName);
    expect(hits[0]).toBe("Khalifa Alhammadi"); // favourite
    expect(hits[1]).toBe("Mohamed Idris"); // online
  });

  it("the limit is honoured", () => {
    expect(suggestContacts(BOOK, "", 2).length).toBe(2);
    expect(suggestContacts(BOOK, "k", 1).length).toBe(1);
  });

  it("survives a junk contact list without throwing", () => {
    // The list comes from a query that can be mid-flight or empty.
    expect(suggestContacts([], "k")).toEqual([]);
    expect(suggestContacts(undefined as unknown as SuggestableContact[], "k")).toEqual([]);
    expect(suggestContacts([null as unknown as SuggestableContact], "k")).toEqual([]);
  });
});

/* ── the wiring ───────────────────────────────────────────────────────────── */

describe("both New-conversation fields accept a name", () => {
  it("neither field strips non-digits any more", () => {
    // That strip is what made a name untypeable, and it is the bug being fixed.
    const code = codeOnly(MESSAGES);
    expect(code).not.toMatch(/setNumber\(e\.target\.value\.replace\(\/\\D\/g, ""\)/);
    expect(code).not.toMatch(/setGroupInput\(e\.target\.value\.replace\(\/\\D\/g, ""\)/);
    expect(MESSAGES).toMatch(/setNumber\(e\.target\.value\.slice\(0, 64\)\)/);
    expect(MESSAGES).toMatch(/setGroupInput\(e\.target\.value\.slice\(0, 64\)\)/);
  });

  it("the keyboard is TEXT, because a numeric pad cannot type a name", () => {
    expect([...MESSAGES.matchAll(/inputMode="text"/g)].length).toBeGreaterThanOrEqual(2);
  });

  it("but the SUBMIT path still only ever sees six digits", () => {
    // `digitsOf` alone is not enough: it would read "7a7b7c7d7e7f" as 777777, so the
    // number-shape rule guards the button too.
    expect(MESSAGES).toMatch(/openThread\.mutate\(\{ number: digitsOf\(number\) \}\)/);
    expect(MESSAGES).toMatch(/digitsOf\(number\)\.length !== 6 \|\| !isNumberQuery\(number\)/);
    expect(MESSAGES).toMatch(/digitsOf\(groupInput\)\.length !== 6 \|\| !isNumberQuery\(groupInput\)/);
  });

  it("both fields render suggestions, and the group one hides existing members", () => {
    // A suggestion that does nothing when tapped reads as broken.
    expect([...MESSAGES.matchAll(/<SuggestList/g)].length).toBe(2);
    expect(MESSAGES).toMatch(/exclude=\{groupNumbers\}/);
  });

  it("tapping a suggestion supplies the number itself", () => {
    expect(MESSAGES).toMatch(/onPick=\{\(n\) => openThread\.mutate\(\{ number: n \}\)\}/);
    expect(MESSAGES).toMatch(/onPick=\{\(n\) => addGroupNumber\(n\)\}/);
  });

  it("the contact list loads only while the sheet is open", () => {
    expect(MESSAGES).toMatch(/trpc\.contacts\.list\.useQuery\(undefined, \{ enabled: open/);
  });

  it("an empty result renders NOTHING rather than a 'no matches' row", () => {
    // The field still works by number, so an absent list is not an error state and
    // saying so would be noise under every unmatched keystroke.
    const at = MESSAGES.indexOf("function SuggestList(");
    const body = MESSAGES.slice(at);
    expect(body).toMatch(/if \(hits\.length === 0\) return null;/);
  });

  it("the suggestion's number stays LTR + bidi-isolated", () => {
    // An Arabic name on the line above must not reorder the digits (v2.99.77).
    const at = MESSAGES.indexOf("function SuggestList(");
    const body = MESSAGES.slice(at);
    expect(body).toMatch(/dir="ltr"/);
    expect(body).toMatch(/\[unicode-bidi:isolate\]/);
  });
});

/* ── the profile rows get icons ───────────────────────────────────────────── */

describe("icons on the profile contact rows, without losing the words", () => {
  it("email and mobile carry an icon", () => {
    expect(HUB).toMatch(/<Mail className="size-3\.5 shrink-0" aria-hidden="true" \/>/);
    expect(HUB).toMatch(/<Smartphone className="size-3\.5 shrink-0" aria-hidden="true" \/>/);
  });

  it("each social link carries a PER-PLATFORM icon", () => {
    expect(HUB).toMatch(/<SocialIcon platform=\{l\.platform\} \/>/);
    const at = HUB.indexOf("function SocialIcon(");
    expect(at).toBeGreaterThan(-1);
    const body = HUB.slice(at);
    for (const p of ["x", "website", "snapchat", "whatsapp"]) {
      expect(body, `${p} has an icon`).toMatch(new RegExp(`case "${p}":`));
    }
    // A FIFTH platform added to SOCIAL_PLATFORMS without an icon degrades to a
    // neutral link glyph rather than rendering nothing.
    expect(body).toMatch(/default:\s*\n\s*return <LinkIcon/);
  });

  it("the LABELS stay — an icon alone is a guess, and silent to a screen reader", () => {
    expect(HUB).toMatch(/\{d\?\.label \?\? l\.platform\}/);
    expect(HUB).toMatch(/Email\n/);
    expect(HUB).toMatch(/Mobile numbers \(optional\)/);
    // Every icon is decorative, so it is not announced twice per row.
    const at = HUB.indexOf("function SocialIcon(");
    const icons = [...HUB.slice(at).matchAll(/<\w+ className=\{cls\}/g)];
    expect(icons.length).toBeGreaterThanOrEqual(5);
    expect([...HUB.slice(at).matchAll(/aria-hidden="true"/g)].length).toBe(icons.length);
  });
});

/* ── the guest hold notice ────────────────────────────────────────────────── */

describe("the guest notice is accurate rather than alarming", () => {
  const at = PROFILE.indexOf("function GuestHoldNotice(");
  const body = PROFILE.slice(at);

  it("reads the SERVER's own clock, not a hardcoded number of days", () => {
    expect(at).toBeGreaterThan(-1);
    expect(PROFILE).toMatch(/<GuestHoldNotice expiresAt=\{me\.guestExpiresAt \?\? null\} \/>/);
    expect(body).toMatch(/new Date\(expiresAt\)\.getTime\(\)/);
    // No "30 days" written into the copy, where it could drift from GUEST_DAYS.
    expect(codeOnly(body)).not.toMatch(/30 days|\b30\b/);
  });

  it("says the clock RESETS on each visit, which is the non-alarming truth", () => {
    // `touchGuestExpiry` pushes it forward every visit, so an active guest never
    // runs out — a bare "expires in N days" would imply a countdown they cannot stop.
    expect(body).toMatch(/resets every time you open RELAY/);
    expect(read("server/v2db.ts")).toMatch(/export async function touchGuestExpiry\(/);
  });

  it("renders nothing when there is no clock to report", () => {
    expect(body).toMatch(/if \(!expiresAt\) return null;/);
    expect(body).toMatch(/if \(!Number\.isFinite\(ms\)\) return null;/);
  });

  it("never claims data is deleted, because nothing deletes it", () => {
    // Expiry stops the guest COOKIE resolving; the row survives and this browser can
    // still reclaim it with the recovery key (v2.99.68). An automatic purge does not
    // exist and is not invented here — deleting somebody's messages on a timer is the
    // owner's decision to make on purpose.
    expect(codeOnly(body)).not.toMatch(/delet|erase|wiped|removed forever/i);
    const v2db = read("server/v2db.ts");
    const reapers = [...v2db.matchAll(/\.delete\(identities\)/g)];
    // The ONLY identity delete is Adopt-and-Retire's provably-empty retire.
    expect(reapers.length).toBeLessThanOrEqual(1);
  });
});
