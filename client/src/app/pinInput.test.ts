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
import {
  PIN_INPUT_MAXLENGTH,
  PIN_LENGTH,
  capPinInput,
  isCompletePin,
  pinDigits,
} from "./pinInput";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

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

describe("every 6-digit PIN input in the app is capped", () => {
  /* THE SWEEP, which is the point rather than the four fixes. The owner asked for this
     "anywhere in the system", and four hand-edits is how the fifth input forgets — so this
     walks every numeric input in the client and requires each to be bounded.

     A PIN box is identified by what it is FOR (its placeholder or label names a 6-digit
     number), not by which file it is in, so a new one is covered rather than exempt. Two
     shapes count as capped: routing through `capPinInput`, or the older
     `.replace(/\D/g,"").slice(0, 6)` that the Contacts and group-call pickers already use —
     both bound the digits, and churning working code to unify the spelling would be a bigger
     change than the rule requires. */
  const FILES = [
    "client/src/app/GroupInfoSheet.tsx",
    "client/src/pages/app/Profile.tsx",
    "client/src/pages/app/Admin.tsx",
    "client/src/pages/app/Contacts.tsx",
    "client/src/pages/app/GroupCallScreen.tsx",
    "client/src/pages/app/Dialer.tsx",
  ];

  /** The window around one `<input …>`, found by walking back to its own opening tag. */
  function inputsIn(src: string): string[] {
    const out: string[] = [];
    let i = src.indexOf('inputMode="numeric"');
    while (i > -1) {
      const open = src.lastIndexOf("<input", i);
      const close = src.indexOf("/>", i);
      if (open > -1 && close > -1) out.push(src.slice(open, close + 2));
      i = src.indexOf('inputMode="numeric"', i + 1);
    }
    return out;
  }

  const SIX_DIGIT = /777777|6-digit|six digits|e\.g\. \d{6}|\{r\.number\}/i;

  it("finds the inputs at all — a vacuous sweep passes for the wrong reason", () => {
    const total = FILES.reduce((n, f) => n + inputsIn(read(f)).length, 0);
    expect(total).toBeGreaterThanOrEqual(6);
  });

  it("no PIN box accepts a seventh digit", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const el of inputsIn(read(f))) {
        // Only boxes that are ABOUT a 6-digit number: a 4-digit passcode is a different
        // field with its own maxLength={4}, and folding it in here would be a false finding.
        if (!SIX_DIGIT.test(el)) continue;
        if (/maxLength=\{4\}/.test(el)) continue;
        const capped =
          /capPinInput\(/.test(el) ||
          /\.slice\(0,\s*6\)/.test(el) ||
          /maxLength=\{PIN_INPUT_MAXLENGTH\}/.test(el);
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
      for (const el of inputsIn(codeOnly(read(f)))) {
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
      "client/src/pages/app/Profile.tsx",
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

    // The other two derive the same rule from `pinDigits` + an explicit six-digit shape.
    // Asserted as the SHAPE rather than the exact expression, so a retune is free while a
    // loosening is not.
    const profile = codeOnly(read("client/src/pages/app/Profile.tsx"));
    expect(profile).toMatch(/\/\^\\d\{6\}\$\/\.test\(wantedDigits\)/);
    const admin = codeOnly(read("client/src/pages/app/Admin.tsx"));
    expect(admin).toMatch(/pinDigits\(confirmNum\) !== r\.number/);
  });

  it("the duplicated separator strip is gone from the submit gates", () => {
    /* `replace(/[\s\-.]/g, "")` was hand-rolled at four sites and had already drifted in
       which separators it knew about — the same rule in four places is how two of them come
       to disagree about whether `777‑777` (a non-ASCII hyphen) is a valid number. */
    for (const f of [
      "client/src/app/GroupInfoSheet.tsx",
      "client/src/pages/app/Profile.tsx",
      "client/src/pages/app/Admin.tsx",
    ]) {
      expect(read(f), f).not.toMatch(/replace\(\/\[\\s\\-\.\]\/g/);
    }
  });
});
