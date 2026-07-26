/* ============================================================
   v2.99.75 — CHOOSE YOUR OWN 6-DIGIT NUMBER.

   Owner: "my personal number is 235680. Can you change it to 777777 and make sure
   whoever added me in his contact book or has any communications and messages
   makes sure they appear with the new number and keep the old data, such as calls
   or messages, but only updates to 777777."

   The propagation half of that already existed and is pinned by
   `numberContinuity.test.ts` (v2.99.54). What did NOT exist was any way to pick a
   SPECIFIC number — `regenerateNumber` only ever handed out a random one.

   THE CONSTRAINT THAT SHAPES THE WHOLE CHANGE: `guestUpgrade.test.ts` pins that
   the codebase contains exactly ONE writer of `identities.number`. Propagation is
   the entire difficulty of renumbering, and a second implementation is precisely
   how History's number copies came to rot before v2.99.54. So this is a PARAMETER
   on the existing writer, never a parallel function — and the pin below is what
   makes any other shape unshippable.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { normalizeDesiredNumber, NUMBER_BEARING_COLUMNS } from "./v2db";

const read = (...p: string[]) => fs.readFileSync(path.resolve(__dirname, ...p), "utf8");

/**
 * Drop comment lines before asserting a token is ABSENT.
 *
 * Four releases running, a "this pattern is gone" assertion has matched a comment
 * explaining why the pattern is gone — so it passed or failed on prose rather than
 * on behaviour, which is worse than having no assertion at all. Any `not.toMatch`
 * against a source file goes through this.
 */
const codeOnly = (src: string) =>
  src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
const V2DB = read("v2db.ts");
const ROUTERS = read("v2routers.ts");
const PROFILE = read("..", "client", "src", "pages", "app", "Profile.tsx");

describe("normalizeDesiredNumber — what a person is allowed to type", () => {
  it("accepts six plain digits", () => {
    expect(normalizeDesiredNumber("777777")).toBe("777777");
    expect(normalizeDesiredNumber("235680")).toBe("235680");
    // A leading zero must survive: this is a string, not a number.
    expect(normalizeDesiredNumber("012345")).toBe("012345");
  });

  it("accepts the grouping people naturally type", () => {
    // The app renders numbers as "777 777" everywhere, so somebody typing it back
    // that way is following our own display, and refusing it would just be rude.
    expect(normalizeDesiredNumber("777 777")).toBe("777777");
    expect(normalizeDesiredNumber("777-777")).toBe("777777");
    expect(normalizeDesiredNumber("  235 680  ")).toBe("235680");
  });

  it("strips ONLY spacing and grouping — never every non-digit", () => {
    // Stripping all non-digits would silently read "7a7b7c7d7e7f" as 777777, i.e.
    // turn a typo into a successful renumber of somebody's identity.
    expect(normalizeDesiredNumber("7a7b7c7d7e7f")).toBeNull();
    expect(normalizeDesiredNumber("(777) 777")).toBeNull();
    expect(normalizeDesiredNumber("+777777")).toBeNull();
  });

  it("refuses anything that is not exactly six digits", () => {
    for (const bad of ["", "77777", "7777777", "abcdef", "77777a", "1e5"]) {
      expect(normalizeDesiredNumber(bad), `${bad} is refused`).toBeNull();
    }
  });

  it("refuses the reserved prefixes, same as the allocator", () => {
    // RESERVED_PREFIXES exists because 000xxx / 111xxx are trivially confused.
    // A chosen number must obey the same rule a random one does, or the reserved
    // range is only reserved against the allocator and not against people.
    expect(normalizeDesiredNumber("000123")).toBeNull();
    expect(normalizeDesiredNumber("111111")).toBeNull();
    expect(normalizeDesiredNumber("777000")).toBe("777000"); // only the PREFIX is reserved
  });

  it("fails closed on a non-string", () => {
    for (const bad of [undefined, null, 777777, {}, [], true]) {
      expect(normalizeDesiredNumber(bad), `${String(bad)} is refused`).toBeNull();
    }
  });
});

describe("there is still exactly ONE writer of an identity's number", () => {
  it("the chosen-number path is a parameter, not a second implementation", () => {
    // This is the load-bearing assertion of the release. A parallel renumber
    // function would inherit none of the propagation, and the failure mode is
    // silent: contacts keep dialling a number that is no longer that person.
    const writes = [...V2DB.matchAll(/\.update\(identities\)\s*\n?\s*\.set\(\{ number:/g)];
    expect(writes.length).toBe(1);
    expect(V2DB).toMatch(/desiredNumber\?: string\n?/);
    expect(V2DB).toMatch(/export async function regenerateIdentityNumber\(\s*\n?\s*identityId: number,\s*\n?\s*desiredNumber\?: string\s*\n?\s*\)/);
  });

  it("the chosen number joins the SAME transaction, so it inherits every copy", () => {
    const fn = V2DB.slice(
      V2DB.indexOf("export async function regenerateIdentityNumber"),
      V2DB.indexOf("export async function claimIdentityNumber")
    );
    // One transaction covering the identity and every "renumber" copy.
    expect(fn).toMatch(/await db\.transaction\(async \(tx\) => \{/);
    expect(fn).toMatch(/const plan = planRenumber\(affected, oldNumber, newNumber\);/);
    // The desired-number branch must resolve to `newNumber` BEFORE the
    // transaction, so the body it shares with a random allocation is identical.
    expect(fn.indexOf("newNumber = want;")).toBeLessThan(fn.indexOf("db.transaction"));
    expect(fn).toMatch(/newNumber = await allocateNumber\(\);/);
  });

  it("claimIdentityNumber writes no number of its own", () => {
    const fn = V2DB.slice(
      V2DB.indexOf("export async function claimIdentityNumber"),
      V2DB.indexOf("export async function claimIdentityNumber") + 2600
    );
    expect(codeOnly(fn)).not.toMatch(/\.update\(identities\)/);
    expect(codeOnly(fn)).not.toMatch(/\.update\(contacts\)/);
    expect(fn).toMatch(/await regenerateIdentityNumber\(identityId, want\)/);
  });

  it("the number-bearing registry still covers every column, unchanged", () => {
    // The chosen-number path moves the same five columns' worth of truth, so it
    // needs no new registry entry — but if that ever stops being true, this is
    // where somebody notices.
    const strategies = NUMBER_BEARING_COLUMNS.map((c) => `${c.table}.${c.column}:${c.strategy}`);
    expect(strategies).toEqual([
      "identities.number:identity",
      "contacts.number:renumber",
      "conference_participants.number:renumber",
      "conference_history.dialedNumber:live",
      "party_lines.number:not-a-person",
    ]);
  });
});

describe("taking a specific number safely", () => {
  const fn = V2DB.slice(
    V2DB.indexOf("export async function regenerateIdentityNumber"),
    V2DB.indexOf("export async function claimIdentityNumber")
  );

  it("re-validates the number itself rather than trusting the caller", () => {
    expect(fn).toMatch(/const want = normalizeDesiredNumber\(desiredNumber\);/);
    expect(fn).toMatch(/if \(!want\) throw new Error\("invalid"/);
  });

  it("checks BOTH number tables and then reserves atomically", () => {
    // numberTaken guards rows that already exist; tryReserveNumber closes the
    // cross-table NEW-vs-NEW race against a party line minted in the same instant.
    expect(fn).toMatch(/if \(await numberTaken\(db, want\)\) throw new Error\("taken"/);
    expect(fn).toMatch(/if \(!\(await tryReserveNumber\(db, want\)\)\) throw new Error\("taken"/);
    expect(fn.indexOf("numberTaken(db, want)")).toBeLessThan(fn.indexOf("tryReserveNumber(db, want)"));
  });

  it("spends the same global mint budget a random allocation does", () => {
    // Otherwise the drain backstop is sidesteppable by NAMING numbers instead of
    // asking for them — same permanent claim on the same finite space.
    expect(fn).toMatch(/if \(!claimMintBudget\(Date\.now\(\)\)\) throw new Error\("budget"/);
  });

  it("choosing the number you already have is a no-op, not an error", () => {
    // Makes a double-tap and a retry after a dropped response both harmless,
    // rather than reporting "taken" about the caller's own number.
    expect(fn).toMatch(/if \(want === oldNumber\) return \{ oldNumber, newNumber: oldNumber \};/);
    expect(fn.indexOf("want === oldNumber")).toBeLessThan(fn.indexOf("claimMintBudget"));
  });
});

describe("a failed claim never steals someone else's reservation", () => {
  const fn = V2DB.slice(
    V2DB.indexOf("export async function claimIdentityNumber"),
    V2DB.indexOf("export async function claimIdentityNumber") + 2600
  );

  it("the pre-flight refusals release NOTHING", () => {
    // THE SUBTLE ONE. "taken" means somebody ELSE holds the reservation, possibly
    // an allocation that has reserved the number but not yet inserted its row.
    // Handing that back would un-reserve a stranger's in-flight number and let two
    // people end up with it. So the early return must precede the release.
    expect(fn).toMatch(/if \(msg === "invalid" \|\| msg === "taken" \|\| msg === "budget"\) \{/);
    expect(fn.indexOf('msg === "taken"')).toBeLessThan(
      fn.indexOf("releaseUnusedNumberReservation")
    );
  });

  it("a genuine failure after reserving DOES give the number back", () => {
    expect(fn).toMatch(/await releaseUnusedNumberReservation\(want\)\.catch\(\(\) => \{\}\);/);
  });

  it("a lost race reads as `taken`, not as a server fault", () => {
    // The identity's unique index is the final authority; a duplicate-key failure
    // means somebody bound the number between our check and our write.
    expect(fn).toMatch(/err\?\.errno === 1062 \|\| err\?\.code === "ER_DUP_ENTRY"/);
    expect(fn).toMatch(/reason: dup \? "taken" : "unavailable"/);
  });

  it("never releases the OLD number", () => {
    // The ledger is monotonic on purpose: recycling a number somebody kept written
    // down would later connect them to a stranger.
    expect(codeOnly(fn)).not.toMatch(/releaseUnusedNumberReservation\(oldNumber\)/);
    expect(V2DB).toMatch(/reservation stays forever/);
  });
});

describe("the endpoint", () => {
  const proc = ROUTERS.slice(
    ROUTERS.indexOf("  setNumber: publicProcedure"),
    ROUTERS.indexOf("  setNumber: publicProcedure") + 3000
  );

  it("requires a registered account, refusing guests", () => {
    // A chosen number is first-come and permanent (the ledger never recycles), and
    // a guest identity is session-scoped — so a guest claim would squat a memorable
    // number and then strand it the moment the browser closed.
    expect(proc).toMatch(/if \(me\.isGuest \|\| !ctx\.user\) \{/);
    expect(proc).toMatch(/code: "FORBIDDEN"/);
    expect(proc.indexOf("me.isGuest")).toBeLessThan(proc.indexOf("claimIdentityNumber"));
  });

  it("is rate limited before it touches the number space", () => {
    expect(proc).toMatch(/guestMintGate\(ctx\);/);
    expect(proc.indexOf("guestMintGate(ctx)")).toBeLessThan(proc.indexOf("claimIdentityNumber"));
  });

  it("names every refusal, because each has a different next step", () => {
    // Collapsing them would tell somebody whose typo was rejected to go and pick a
    // different number.
    for (const reason of ["invalid", "taken", "budget", '"not-found"', "unavailable"]) {
      expect(proc).toMatch(new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    expect(proc).toMatch(/code: "CONFLICT", message: "That number is already in use\."/);
  });

  it("delegates the move — it does not renumber anything itself", () => {
    expect(proc).toMatch(/await claimIdentityNumber\(me\.id, input\.number\)/);
    expect(codeOnly(proc)).not.toMatch(/\.update\(/);
  });

  it("reports the number by RE-READING the identity, not from its own input", () => {
    expect(proc).toMatch(/const fresh = await getIdentityById\(me\.id\);/);
    expect(proc).toMatch(/number: fresh\?\.number \?\? res\.newNumber,/);
  });

  it("leaves the random regenerate exactly as it was", () => {
    const regen = ROUTERS.slice(
      ROUTERS.indexOf("  regenerateNumber: publicProcedure"),
      ROUTERS.indexOf("  setNumber: publicProcedure")
    );
    expect(regen).toMatch(/await regenerateIdentityNumber\(me\.id\)/);
    // No desired number, so its behaviour is byte-identical to before.
    expect(codeOnly(regen)).not.toMatch(/claimIdentityNumber/);
  });
});

describe("Profile lets the owner do it themselves", () => {
  it("offers both a chosen and a random number", () => {
    expect(PROFILE).toMatch(/Choose my number/);
    expect(PROFILE).toMatch(/Random number/);
    expect(PROFILE).toMatch(/trpc\.identity\.setNumber\.useMutation/);
  });

  it("the dialog does NOT close on submit", () => {
    // The number may be taken, and closing before the server answers would hide
    // the one message that tells the person to pick a different one.
    const onClick = PROFILE.slice(
      PROFILE.indexOf("if (!wantedOk) return;"),
      PROFILE.indexOf("if (!wantedOk) return;") + 220
    );
    expect(onClick).toMatch(/choose\.mutate\(\{ number: wantedDigits \}\)/);
    expect(codeOnly(onClick)).not.toMatch(/setChooseOpen\(false\)/);
    expect(PROFILE).toMatch(/e\.preventDefault\(\);/);
  });

  it("surfaces the server's own reason rather than a generic failure", () => {
    expect(PROFILE).toMatch(/onError: \(e\) => setChooseError\(e\.message/);
  });

  it("uses a text input with a numeric keypad, not type=number", () => {
    // type="number" brings spinners, accepts "1e5", and drops a leading zero.
    expect(PROFILE).toMatch(/inputMode="numeric"/);
    expect(PROFILE).toMatch(/id="relay-wanted-number"/);
    const field = PROFILE.slice(
      PROFILE.indexOf('id="relay-wanted-number"') - 200,
      PROFILE.indexOf('id="relay-wanted-number"') + 400
    );
    expect(codeOnly(field)).not.toMatch(/type="number"/);
    // LTR-isolated so an RTL locale cannot reorder the digits being typed.
    expect(field).toMatch(/dir="ltr"/);
  });

  it("the client's own shape check AGREES with the server's", () => {
    // Two gates disagreeing about one rule is the recurring bug in this codebase.
    // The client only gates the BUTTON; the server re-validates regardless, which
    // is why this is a UX check and not the security boundary.
    expect(PROFILE).toMatch(/const wantedDigits = wanted\.replace\(\/\[\\s\\-\.\]\/g, ""\);/);
    expect(PROFILE).toMatch(/\/\^\\d\{6\}\$\/\.test\(wantedDigits\) && !\/\^\(000\|111\)\/\.test\(wantedDigits\)/);
  });

  it("tells the truth about what happens to their data", () => {
    expect(PROFILE).toMatch(/Everyone who saved you is updated\s*\n?\s*automatically/);
    expect(PROFILE).toMatch(/messages, calls and contacts all stay exactly as they/);
    expect(PROFILE).toMatch(/is never given to anyone else/);
  });
});
