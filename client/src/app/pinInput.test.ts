/**
 * v2.106.63 — a RELAY number never exceeds six digits, in ANY box.
 *
 * Owner: *"anywhere in the system for the pin number don't exceed six digits — such as when
 * you add inside the group it gives you more than six digits."*
 *
 * The behaviour is driven against the real functions, because "does typing a seventh digit do
 * anything" is exactly what a source pin cannot answer. The SWEEP at the bottom is the part
 * that makes the owner's "anywhere" true for the input somebody adds next.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { expandCopy } from "../../../server/testing/copyOnScreen";
import {
  PIN_INPUT_MAXLENGTH,
  PIN_LENGTH,
  capPinInput,
  isCompletePin,
  pinDigits,
} from "./pinInput";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* THE SWEEP'S OWN READER. Comments stripped (prose describing a PIN box is not one) and
   `t("key")` resolved to its English (a placeholder that has moved into `dict/` names no
   digits, so the predicate would find nothing and the file would report ZERO boxes while
   still holding one — the v2.106.65 vacuity by a different road). One function, because
   two call sites reading differently is how this arose. */
const swept = (p: string) => expandCopy(codeOnly(read(p)));

describe("capPinInput — the cap", () => {
  it("stops at six digits however many are typed or pasted", () => {
    expect(capPinInput("777777")).toBe("777777");
    expect(capPinInput("7777779")).toBe("777777");
    expect(capPinInput("777777999")).toBe("777777");
    expect(capPinInput("1234567890123")).toBe("123456");
  });

  it("keeps the grouping the app itself renders", () => {
    // `formatPin` displays `777-777`, so refusing the form the app just showed you would be
    // the app arguing with itself (the v2.99.75 call, at the input layer this time).
    expect(capPinInput("777-777")).toBe("777-777");
    expect(capPinInput("777 777")).toBe("777 777");
    expect(pinDigits(capPinInput("777-777"))).toBe("777777");
  });

  it("a separator is not a digit, so grouping cannot buy an extra one", () => {
    expect(pinDigits(capPinInput("77-77-77-99"))).toBe("777777");
    expect(pinDigits(capPinInput("7-7-7-7-7-7-7"))).toHaveLength(PIN_LENGTH);
  });

  it("DROPS a letter rather than folding it away", () => {
    /* `raw.replace(/\D/g, "")` reads `7a7b7c7d7e7f` as `777777` — a typo becoming a
       successful operation on somebody ELSE's number. Dropping as typed means the field
       always shows exactly what will be submitted. */
    expect(capPinInput("7a7b7c")).toBe("777");
    expect(capPinInput("abcdef")).toBe("");
    expect(capPinInput("77x7")).toBe("777");
  });

  it("is idempotent, so re-running it on its own output cannot drift", () => {
    for (const raw of ["777777999", "777-777", "7a7b7c7d7e7f", "", "12"]) {
      expect(capPinInput(capPinInput(raw))).toBe(capPinInput(raw));
    }
  });

  it("survives a non-string without throwing", () => {
    expect(capPinInput(null)).toBe("");
    expect(capPinInput(undefined)).toBe("");
    expect(pinDigits(null)).toBe("");
  });

  it("isCompletePin needs exactly six digits, grouping or not", () => {
    expect(isCompletePin("777777")).toBe(true);
    expect(isCompletePin("777-777")).toBe(true);
    expect(isCompletePin("77777")).toBe(false);
    expect(isCompletePin("")).toBe(false);
    expect(isCompletePin(capPinInput("777777999"))).toBe(true);
  });

  it("isCompletePin refuses an OVER-long value, not only a short one", () => {
    /* Every value the fields hand it has been through `capPinInput`, so it can only ever
       fail short THERE — which is exactly why a `>=` bound survives a test that feeds it
       capped input only, and why this case exists. The gate is also read by callers that
       hydrate a value from elsewhere (a draft, a paste handler, a future caller), where
       seven digits would otherwise read as a submittable number. */
    expect(isCompletePin("7777777")).toBe(false);
    expect(isCompletePin("777-7777")).toBe(false);
    expect(pinDigits("7777777")).toHaveLength(7);
  });

  it("the browser's own cap AGREES with ours instead of contradicting it", () => {
    // It was 9, which is what let the owner type past the limit in the first place.
    expect(PIN_INPUT_MAXLENGTH).toBe(PIN_LENGTH + 1);
  });
});

describe("the composer's Send is permanent (v2.106.65)", () => {
  /* Owner: *"in place of the voice icon in the bar put send button as icon"*. Nothing
     pinned it, so a mutation restoring the mic/Send SWAP survived — the composer would
     have gone back to a primary control that changes meaning on the first keystroke. */
  const MSG = codeOnly(read("client/src/pages/app/Messages.tsx"));

  it("Send renders unconditionally and is DISABLED when there is nothing to send", () => {
    expect(MSG).toMatch(
      /disabled=\{\(!text\.trim\(\) && !pendingUpload\) \|\| sendMutation\.isPending \|\| uploading\}/,
    );
    // …never gated on having something to send, which is what made the mic occupy the slot.
    expect(MSG).not.toMatch(/\{text\.trim\(\) \|\| pendingUpload \? \(/);
  });

  it("the mic no longer occupies the composer's primary slot", () => {
    // It lives in the + menu now. The `Mic` import stays used — RecordingBar's resume
    // button renders it — so its mere presence proves nothing; the SWAP is what must go.
    expect(MSG).not.toMatch(/aria-label=\{recording \? "Stop" : "Record"\}/);
    expect(MSG).toMatch(/startRecording\(\); \}\}[\s\S]{0,400}Voice note/);
  });
});

describe("every 6-digit PIN input in the app is capped", () => {
  /* THE SWEEP, which is the point rather than the four fixes. The owner asked for this
     "anywhere in the system", and four hand-edits is how the fifth input forgets — so this
     walks every numeric input in the client and requires each to be bounded.

     A PIN box is identified by what it is FOR (its placeholder or label names a 6-digit
     number), not by which file it is in, so a new one is covered rather than exempt.

     THE SOURCE IS RUN THROUGH `expandCopy` FIRST, and that is load-bearing rather than
     tidy: a screen whose placeholder has moved into `dict/` renders `t("groupcall.…")`,
     which names no digits at all — so the predicate would find NOTHING and the file would
     report zero PIN boxes while still holding one. That is the exact vacuity v2.106.65
     measured and rebuilt this sweep to prevent, arriving by a different road, and it is
     why the non-vacuity assertion below (every listed file must yield a recognised box)
     is what actually caught it. Same fix `systemAlerts.test.ts` needed at v2.106.85. Two
     shapes count as capped: routing through `capPinInput`, or the older
     `.replace(/\D/g,"").slice(0, 6)` that the Contacts and group-call pickers already use —
     both bound the digits, and churning working code to unify the spelling would be a bigger
     change than the rule requires. */
  const FILES = [
    "client/src/app/GroupInfoSheet.tsx",
    "client/src/pages/app/Admin.tsx",
    "client/src/pages/app/Contacts.tsx",
    "client/src/pages/app/GroupCallScreen.tsx",
    // Profile.tsx is ABSENT as of v2.106.80: the owner withdrew "Choose my number"
    // ("just keep random number option"), which was its only 6-digit field. A
    // separate assertion below pins that it has NO such box, so this is a removal
    // rather than an exemption — if a PIN input ever returns to Profile, that
    // assertion goes red and this list has to be reconsidered.
    // Dialer.tsx is deliberately ABSENT (v2.106.65): it has no numeric text input at all —
    // it is a keypad, and a keypad is capped structurally because there is no field to
    // paste into. Listing it made the entry inert while reading as coverage.
  ];

  /**
   * ONE ELEMENT, bounded by its own tag.
   *
   * v2.106.65 — THE FIRST VERSION OF THIS SWEEP WAS LARGELY VACUOUS, and the measured
   * numbers are the finding. It searched back for `<input` (lower case) from an
   * `inputMode="numeric"` hit and sliced forward to the next `/>`, which failed two ways:
   *
   *   • Contacts, GroupCallScreen and Dialer yielded ZERO elements — three of the six
   *     files it names, and two of them the comment explicitly claimed to cover — because
   *     they use shadcn's `<Input>` component, capital I.
   *   • In Profile the slices ran to 46,118 and 46,803 characters: most of the file, not
   *     an element. A `capPinInput(` ANYWHERE in 46KB satisfied the is-it-capped check, so
   *     a genuinely uncapped box in that file would have passed.
   *
   * It now scans FORWARD from each opening tag and stops at the `/>` that closes THAT tag,
   * tracking `{}` depth so a JSX expression containing `/>` cannot end it early, and it
   * refuses an implausibly long span rather than silently searching a whole file.
   */
  const MAX_ELEMENT = 3000;

  function inputsIn(src: string): string[] {
    const out: string[] = [];
    const open = /<(?:input|Input)\b/g;
    let m: RegExpExecArray | null;
    while ((m = open.exec(src))) {
      let depth = 0;
      let end = -1;
      for (let i = m.index; i < Math.min(src.length, m.index + MAX_ELEMENT); i++) {
        const ch = src[i];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        else if (depth === 0 && ch === "/" && src[i + 1] === ">") {
          end = i + 2;
          break;
        } else if (depth === 0 && ch === ">" && src[i - 1] !== "=") {
          end = i + 1; // a plain-HTML `<input …>` that does not self-close
          break;
        }
      }
      if (end > -1) out.push(src.slice(m.index, end));
    }
    return out;
  }

  /* Widened v2.106.65: GroupCallScreen says "(6 digits)" — a bare numeral the old
     alternatives (`6-digit` hyphenated, `six digits` spelled out) could not match, so the
     one PIN box in that file was skipped even once the parser started finding it. */
  const SIX_DIGIT =
    /777777|6[- ]digit|six digits|\(6 digits\)|e\.g\. \d{6}|\{r\.number\}|RELAY number/i;

  it("the sweep really parses ELEMENTS, in every file it names", () => {
    /* The old guard was `total >= 6` and passed on 8 — of which four were 46KB slabs and
       three whole files contributed nothing at all. A bare count cannot tell those apart,
       so this asserts the two properties that make the sweep mean anything: every listed
       file yields at least one element, and no "element" is implausibly large. */
    for (const f of FILES) {
      const els = inputsIn(swept(f));
      expect(els.length, `${f} yielded no <input> — is the sweep still looking at it?`)
        .toBeGreaterThan(0);
      for (const el of els) {
        /* A LITERAL bound, deliberately not `MAX_ELEMENT`. Comparing the parser's own
           limit against itself is self-referential: widening the constant moved both
           sides together and the assertion survived a mutation that let a slice be the
           whole file. A real `<input>` is a few hundred characters. */
        expect(el.length, `${f}: a ${el.length}-char slice is not one element`)
          .toBeLessThan(2000);
      }
    }
  });

  it("…and it finds a PIN box in every file that has one", () => {
    // The parser can be right while the PREDICATE misses: GroupCallScreen says
    // "(6 digits)", which neither `6-digit` nor `six digits` matched, so its one PIN box
    // was skipped even after the parser started finding the element.
    for (const f of FILES) {
      const six = inputsIn(swept(f)).filter((el) => SIX_DIGIT.test(el) && !/maxLength=\{4\}/.test(el));
      expect(six.length, `${f}: no input recognised as a 6-digit PIN box`).toBeGreaterThan(0);
    }
  });

  it("no PIN box accepts a seventh digit", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const el of inputsIn(read(f))) {
        // Only boxes that are ABOUT a 6-digit number: a 4-digit passcode is a different
        // field with its own maxLength={4}, and folding it in here would be a false finding.
        if (!SIX_DIGIT.test(el)) continue;
        if (/maxLength=\{4\}/.test(el)) continue;
        /* v2.106.65 — `.slice(0, 6)` is no longer an accepted spelling. It bounds the
           LENGTH and says nothing about the fold: every site that used it also used
           `replace(/\D/g, "")`, which reads `7a7b7c7d7e7f` as `777777`. One module now,
           so the rule cannot be satisfied by a shape that carries the hazard. */
        const capped =
          /capPinInput\(/.test(el) && /maxLength=\{PIN_INPUT_MAXLENGTH\}/.test(el);
        if (!capped) offenders.push(`${f} :: ${el.slice(0, 120).replace(/\s+/g, " ")}`);
      }
    }
    expect(
      offenders,
      "route the onChange through capPinInput (client/src/app/pinInput.ts)",
    ).toEqual([]);
  });

  it("no PIN box's BROWSER cap is looser than the value it can hold", () => {
    /* `capPinInput` alone makes the field behave, so a stale `maxLength={9}` survives every
       other assertion here — which is precisely what happened when this was mutation-run.
       It still matters: a browser cap wider than the value means the field visibly accepts a
       keystroke and then discards it, which is the flicker the owner reported as "it gives
       you more than six digits". The two caps must agree. */
    const offenders: string[] = [];
    for (const f of FILES) {
      // COMMENT-STRIPPED: my own comments in these very inputs quote the `maxLength={9}`
      // they replaced, and the first run of this assertion matched THEM — the prose trap,
      // in the assertion written to catch a regression the prose is describing.
      for (const el of inputsIn(swept(f))) {
        if (!SIX_DIGIT.test(el) || /maxLength=\{4\}/.test(el)) continue;
        const literal = /maxLength=\{(\d+)\}/.exec(el);
        if (literal && Number(literal[1]) > PIN_INPUT_MAXLENGTH) {
          offenders.push(`${f} :: maxLength={${literal[1]}}`);
        }
      }
    }
    expect(offenders, "use maxLength={PIN_INPUT_MAXLENGTH}").toEqual([]);
  });

  it("the four boxes the owner's report covers really are wired to the shared cap", () => {
    // Named explicitly as well as swept: the sweep proves the RULE, these prove the FIX.
    for (const f of [
      "client/src/app/GroupInfoSheet.tsx",
      "client/src/pages/app/Admin.tsx",
    ]) {
      expect(read(f), f).toMatch(/capPinInput\(e\.target\.value\)/);
    }
    // Admin has TWO PIN boxes (the delete confirmation and set-number), so a single fix is
    // not enough. Counted on the CALL, not the identifier: the import spells it
    // `capPinInput,` with no paren, so a bare-identifier count reads 2 and not 3 — my first
    // version of this assertion failed on correct source for exactly that reason.
    expect((read("client/src/pages/app/Admin.tsx").match(/capPinInput\(e\.target\.value\)/g) ?? []).length)
      .toBe(2);
  });

  it("every PIN submit gate still requires SIX digits, not merely something typed", () => {
    /* The cap and the gate are two different rules and this one is the older of the pair:
       capping stops a SEVENTH digit, the gate stops a THIRD being submitted. Loosening
       either while the other holds reads as fixed and is not — a mutation that swapped the
       group gate for `addNumber.length === 0` survived every other assertion here, and the
       server would then answer a 3-digit number with a generic refusal rather than the
       field saying so. */
    const src = codeOnly(read("client/src/app/GroupInfoSheet.tsx"));
    expect(src).toMatch(/disabled=\{!isCompletePin\(addNumber\)/);

    /* Profile's gate is GONE with its field (v2.106.80) — the owner withdrew
       "Choose my number". Pinned as an ABSENCE below rather than dropped silently.
       Admin derives the same rule from `pinDigits` + an explicit six-digit shape,
       asserted as the SHAPE rather than the exact expression so a retune is free
       while a loosening is not. */
    const admin = codeOnly(read("client/src/pages/app/Admin.tsx"));
    expect(admin).toMatch(/pinDigits\(confirmNum\) !== r\.number/);
  });

  it("Profile has NO 6-digit field at all, so its removal from the sweep is earned", () => {
    /* The owner withdrew "Choose my number" (v2.106.80: "just keep random number
       option"). Dropping a file from a coverage list is exactly how a real box
       later becomes exempt, so the removal is EARNED here: Profile must contain no
       6-digit input whatsoever. If one returns, this goes red and the FILES list
       above has to be reconsidered rather than silently under-covering it. */
    const six = inputsIn(read("client/src/pages/app/Profile.tsx")).filter((el) =>
      SIX_DIGIT.test(el),
    );
    expect(six, "Profile no longer has a 6-digit PIN box").toEqual([]);
  });

  it("NO PIN path folds a non-digit away — swept, not enumerated", () => {
    /* v2.106.65 — the old version named THREE files, so the three sites it did not name
       kept `replace(/\D/g, "")`: Contacts' add-by-number, the group-call picker, and the
       in-call add-person field — where the sixth digit AUTO-INVITES, so a folded typo rang
       a stranger into a live call. Swept across every file that handles a RELAY number,
       which is what makes "anywhere in the system" true for the next one. */
    const FOLDING = [...FILES, "client/src/lib/relayClient.ts"];
    const offenders: string[] = [];
    for (const f of FOLDING) {
      const src = codeOnly(read(f));
      /* Scoped to a SIX-digit fold, which is what says "this is a RELAY number".
         `replace(/\D/g, "").slice(0, 4)` is the 4-digit app passcode and the group-lock
         code — different fields with their own rules, and flagging them would be a false
         finding of the kind that gets a guard switched off. */
      for (const m of src.match(/replace\(\/\\D\/g[^\n]*/g) ?? []) {
        if (/slice\(0,\s*6\)/.test(m)) offenders.push(`${f} :: ${m.trim().slice(0, 90)}`);
      }
      if (/replace\(\/\[\\s\\-\.\]\/g/.test(src)) offenders.push(`${f} (separator strip)`);
    }
    expect(offenders, "use pinDigits / capPinInput from client/src/app/pinInput.ts").toEqual([]);
  });

  it("a programmatic dial REFUSES a malformed target rather than repairing it", () => {
    /* `programmaticGroupDial` takes a caller-supplied list, so there is no field being
       rewritten as you type and therefore none of the protection a typing site has. The
       old `replace(/\D/g, "").slice(0, 6)` turned `7a7b7c7d7e7f` into `777777`, which the
       `/^\d{6}$/` filter below it then accepted — a malformed target silently becoming a
       real stranger's number and getting rung.

       The RULE is driven here rather than pinned, because "does junk reach the dial" is
       exactly what reading the source cannot answer. This re-declares the filter chain,
       which is honest only while the source pin below holds. */
    const me = "999999";
    const clean = (targets: string[]) =>
      Array.from(
        new Set(
          targets
            .filter((t) => /^[\d\s.-]+$/.test(String(t).trim()))
            .map((t) => pinDigits(String(t)))
            .filter((t) => /^\d{6}$/.test(t) && t !== me),
        ),
      );
    expect(clean(["7a7b7c7d7e7f"]), "a folded typo must not become a number").toEqual([]);
    expect(clean(["<script>804119</script>"])).toEqual([]);
    expect(clean(["804119"])).toEqual(["804119"]);
    expect(clean(["804-119"]), "the app's own grouping still works").toEqual(["804119"]);
    expect(clean([" 804119 "])).toEqual(["804119"]);
    expect(clean([me]), "never yourself").toEqual([]);
    expect(clean(["80411"]), "short is refused").toEqual([]);

    // …and the source really is that chain, so the re-declaration above is not a fiction.
    const src = codeOnly(read("client/src/lib/relayClient.ts"));
    expect(src).toMatch(/\.filter\(t => \/\^\[\\d\\s\.-\]\+\$\/\.test\(String\(t\)\.trim\(\)\)\)/);
    expect(src).not.toMatch(/replace\(\/\\D\/g, ""\)\.slice\(0, 6\)/);
  });

  it("the in-call add-person field is capped in the markup too", () => {
    // It is raw DOM in a template literal, so no JSX sweep can reach it — and it was the
    // ONE box whose browser cap genuinely exceeded six digits, at `maxlength="16"`.
    const assets = read("client/src/lib/relayAssets.ts");
    expect(assets).toMatch(/<input id="addInput" maxlength="7"/);
    expect(assets).not.toMatch(/id="addInput"[^>]*maxlength="(?!7")/);
  });

  it("being 'capped' requires BOTH the module and the browser cap, never either alone", () => {
    /* Asserted on this test file's OWN source, because on today's code every site already
       satisfies both — so relaxing the rule to an OR changes nothing observable and the
       mutation survived. It is about the site somebody adds NEXT: `.slice(0, 6)` bounds
       the LENGTH and says nothing about the fold, and every site that used it also folded. */
    const self = read("client/src/app/pinInput.test.ts");
    expect(self).toMatch(
      /const capped =\s*\n?\s*\/capPinInput\\\(\/\.test\(el\) && \/maxLength=/,
    );
    expect(self).not.toMatch(/const capped =[\s\S]{0,160}\|\|/);
  });

  it("the duplicated separator strip is gone from the submit gates", () => {
    /* `replace(/[\s\-.]/g, "")` was hand-rolled at four sites and had already drifted in
       which separators it knew about — the same rule in four places is how two of them come
       to disagree about whether `777‑777` (a non-ASCII hyphen) is a valid number. */
    for (const f of [
      "client/src/app/GroupInfoSheet.tsx",
      "client/src/pages/app/Admin.tsx",
    ]) {
      expect(read(f), f).not.toMatch(/replace\(\/\[\\s\\-\.\]\/g/);
    }
  });
});
