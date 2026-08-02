/**
 * THE PRESENCE DOT AND THE SIGN-IN NOTICE SPEAK ARABIC (v2.107.0).
 *
 * Both of these were found by the adversarial verifiers of the 60-agent Arabic run,
 * and both are the same shape: a function returning FINISHED ENGLISH that a screen
 * then renders. Neither is visible to a literal sweep, because the offender is an
 * EXPRESSION — `aria-label={dot.label}` contains no English at all — which is why
 * they survived a pass that took every screen through the dictionary.
 *
 *   1. `presenceDot()` returned `label: "Online" | "Away" | "Offline" | "On a call"`,
 *      and SEVEN surfaces put it into an `aria-label`. A screen reader on an Arabic
 *      phone therefore heard English on every contact row, every thread row, every
 *      group member and every call-picker entry.
 *
 *   2. `describeLogin()` on the server composes "Dubai, AE · Email code", and BOTH
 *      surfaces that show a waiting sign-in rendered it whole — so the one part of
 *      that line that is genuinely prose arrived untranslated.
 *
 * THE FIX FOR (1) IS A REMOVAL, NOT AN ADDITION, and that is the load-bearing
 * decision. Adding `labelKey` BESIDE `label` would have left the English available
 * for the eighth surface to adopt, with no sweep able to see it. Deleting the field
 * turns every such site into a COMPILE ERROR — which is also how this change proved
 * it had found all seven rather than most of them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { presenceDot, type PresenceDotState } from "./presenceDot";
import { loginDetailLine, loginMethodKey } from "./loginOriginCopy";
import { DICT, type TKey } from "./i18n";
import { loginMethodLabel, LOGIN_METHODS } from "../../../server/loginOrigin";
import { codeOnly } from "../../../server/testing/codeOnly";

const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/** A translator that renders the ENGLISH half — the dictionary's own fallback. */
const en = (k: TKey, vars?: Record<string, string | number>) => {
  let s: string = DICT[k].en;
  for (const [name, v] of Object.entries(vars ?? {})) s = s.replaceAll(`{${name}}`, String(v));
  return s;
};
/** …and one that renders the Arabic half, for the parity assertions. */
const ar = (k: TKey, vars?: Record<string, string | number>) => {
  let s: string = DICT[k].ar;
  for (const [name, v] of Object.entries(vars ?? {})) s = s.replaceAll(`{${name}}`, String(v));
  return s;
};

/* ══════════════════════════════════════════════════════════════════════════════
   1 — THE PRESENCE DOT
   ══════════════════════════════════════════════════════════════════════════════ */

describe("the presence dot hands over a key, never a finished label", () => {
  const CASES: Array<{ state: PresenceDotState; input: Parameters<typeof presenceDot>[0] }> = [
    { state: "inCall", input: { isOnline: true, inCall: true } },
    { state: "offline", input: { isOnline: false } },
    { state: "away", input: { isOnline: true, idle: true } },
    { state: "online", input: { isOnline: true } },
  ];

  it("every state carries a key that exists in the dictionary", () => {
    for (const c of CASES) {
      const d = presenceDot(c.input);
      expect(d.state, JSON.stringify(c.input)).toBe(c.state);
      expect(d.labelKey in DICT, `${d.labelKey} is not a real key`).toBe(true);
    }
  });

  it("the English is byte-identical to what shipped before it took a key", () => {
    /* ONLY THE BROKEN HALF MOVES. Reusing the longer `peer.presence*` set would have
       been tempting — those keys already exist and read slightly better — and would
       have silently changed the English on seven surfaces. What was wrong was that
       English reached an Arabic screen, not what the English said. */
    const SHIPPED: Record<PresenceDotState, string> = {
      inCall: "On a call",
      offline: "Offline",
      away: "Away",
      online: "Online",
    };
    for (const c of CASES) {
      expect(en(presenceDot(c.input).labelKey), c.state).toBe(SHIPPED[c.state]);
    }
  });

  it("the four states stay four distinct words in BOTH languages", () => {
    /* The vocabulary is the whole reason the states exist. Collapsing two onto one
       word is silent in whichever language the edit missed — and a translator reusing
       one Arabic word for "Away" and "Offline" produces a screen that is wrong only
       for Arabic readers, which is exactly the case nobody reviewing English sees. */
    const keys = CASES.map((c) => presenceDot(c.input).labelKey);
    expect(new Set(keys).size, "two states share a key").toBe(4);
    for (const [name, render] of [
      ["English", en],
      ["Arabic", ar],
    ] as const) {
      const words = keys.map((k) => render(k));
      expect(new Set(words).size, `two states share one ${name} word: ${words.join(" / ")}`).toBe(4);
    }
  });

  it("no surface can reach a finished English label — the field is GONE", () => {
    /* The property the removal exists for. `presenceDot` must expose no string a
       caller could render directly, or the next surface adopts it and no sweep can
       see the regression. */
    const SRC = codeOnly(read("client/src/app/presenceDot.ts"));
    expect(SRC).not.toMatch(/^\s*label\??:\s*string/m);
    expect(SRC).not.toMatch(/\blabel:\s*["'`]/);
  });

  it("all seven consumers label their dot through the translator", () => {
    /* ENUMERATED rather than counted, so a surface that stops labelling its LED — or
       one added without a label — is named. The seventh (the Messages contact picker)
       has no `title`, which is fine: a picker row is already labelled by its own
       text, and the LED's `aria-label` is what a screen reader needs. */
    const SURFACES = [
      "client/src/app/GroupInfoSheet.tsx",
      "client/src/pages/app/Contacts.tsx",
      "client/src/pages/app/GroupCallScreen.tsx",
      "client/src/pages/app/Messages.tsx",
      "client/src/pages/app/History.tsx",
    ];
    let sites = 0;
    for (const f of SURFACES) {
      const src = read(f);
      expect(src, `${f} no longer reads the shared rule`).toMatch(/\bpresenceDot\(/);
      // `t` or `tr` — Messages aliases the translator where a thread shadows `t`.
      const labelled = [...src.matchAll(/aria-label=\{tr?\((?:dot|d)\.labelKey\)\}/g)].length;
      expect(labelled, `${f} draws a dot with no translated label`).toBeGreaterThan(0);
      sites += labelled;
      /* ON STRIPPED CODE. History's comment EXPLAINS the removal and therefore names
         `dot.label`, so a raw sweep failed on correct source — the prose trap, in the
         very assertion written to catch the thing the prose describes. */
      expect(codeOnly(src), `${f} still renders a finished label`).not.toMatch(
        /\b(?:dot|d)\.label\b/,
      );
    }
    /* …and the strip is doing real work rather than hiding a live one: the reason IS
       recorded in prose, and only there. */
    const HISTORY = read("client/src/pages/app/History.tsx");
    expect(HISTORY).toMatch(/\bdot\.label\b/);
    expect(codeOnly(HISTORY)).not.toMatch(/\bdot\.label\b/);
    expect(sites, "a labelled dot disappeared").toBeGreaterThanOrEqual(7);
  });

  it("History keys its own tooltip on the STATE, never on the English label", () => {
    /* Its tooltips name the CONSEQUENCE ("calling will page their phone") rather than
       the state, so the wording legitimately stays History's. What was wrong is that
       it SELECTED that wording by comparing `dot.label` against four English words —
       a mapping that keeps working right up until somebody edits one of them, and
       then falls silently through to the offline branch with every test still green. */
    const SRC = codeOnly(read("client/src/pages/app/History.tsx"));
    expect(SRC).not.toMatch(/dot\.label\s*===/);
    expect(SRC).toMatch(/HISTORY_PRESENCE_TITLE\[dot\.state\]/);
    /* Exhaustive over the union by TYPE (`Record<PresenceDotState, TKey>`), so a
       fifth state is a compile error here rather than a row that quietly reads
       "Offline" — asserted structurally because a type error is invisible to a test. */
    expect(SRC).toMatch(/Record<PresenceDotState, TKey>/);
    for (const s of ["inCall", "online", "away", "offline"]) {
      expect(SRC, `${s} has no tooltip`).toMatch(new RegExp(`\\b${s}: "history\\.presence\\.`));
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   2 — THE SIGN-IN NOTICE
   ══════════════════════════════════════════════════════════════════════════════ */

describe("the sign-in detail line translates its method", () => {
  it("every method the server can send has a key", () => {
    /* Driven from the SERVER's own enum rather than a copy of it, so a fourth way in
       cannot be added on one side and silently render nothing on the other. */
    for (const m of LOGIN_METHODS) {
      const k = loginMethodKey(m);
      expect(k, `no key for ${m}`).not.toBeNull();
      expect(k! in DICT).toBe(true);
    }
  });

  it("the English is byte-identical to the server's own phrase", () => {
    /* Same rule as the dot: the English half was not what was broken, so it does not
       move. Compared against the REAL `loginMethodLabel` rather than a transcription
       of it, so the two cannot drift. */
    for (const m of LOGIN_METHODS) {
      expect(en(loginMethodKey(m)!), m).toBe(loginMethodLabel(m));
    }
  });

  it("an unknown method falls back to the server's phrase rather than blanking", () => {
    /* A rolling deploy serves both bundles for about a minute. During it a payload
       carrying no `method` must still show the line — degrading to English is a
       far smaller cost than a card that suddenly says nothing about the sign-in
       somebody is being asked to approve. */
    expect(loginMethodKey(undefined)).toBeNull();
    expect(loginMethodKey("telepathy")).toBeNull();
    expect(loginDetailLine({ place: "Dubai, AE", detail: "Dubai, AE · Email code" }, en)).toBe(
      "Dubai, AE · Email code",
    );
    // …and null when there is nothing at all to say, never an empty string that
    // renders as a blank line looking like a claim.
    expect(loginDetailLine({}, en)).toBeNull();
  });

  it("the separator appears only BETWEEN two present halves", () => {
    /* "Dubai, AE ·" with nothing after it is the dangling-separator trap the server
       side already records; recomposing on the client reintroduces the chance to
       make it, so it is pinned here too. */
    expect(loginDetailLine({ place: "Dubai, AE", method: "code" }, en)).toBe(
      "Dubai, AE · Email code",
    );
    expect(loginDetailLine({ place: null, method: "code" }, en)).toBe("Email code");
    expect(loginDetailLine({ place: "  ", method: "pin" }, en)).toBe("4-digit passcode");
    for (const out of [
      loginDetailLine({ place: null, method: "code" }, en),
      loginDetailLine({ place: "AE", method: "register" }, en),
    ]) {
      expect(out).not.toMatch(/·\s*$/);
      expect(out).not.toMatch(/^\s*·/);
    }
  });

  it("the PLACE is passed through untouched in both languages", () => {
    /* A city arrives written as the geo service writes it and an ISO country code is
       the same everywhere, so translating either would be inventing a fact. Only the
       method differs between the two renderings. */
    const d = { place: "Dubai, AE", method: "code" as const };
    const e = loginDetailLine(d, en)!;
    const a = loginDetailLine(d, ar)!;
    expect(e).toContain("Dubai, AE");
    expect(a).toContain("Dubai, AE");
    expect(a).not.toBe(e);
    expect(a.replace(ar("alerts.loginMethodCode"), "")).toBe(
      e.replace(en("alerts.loginMethodCode"), ""),
    );
  });

  it("the wire carries the enum BESIDE the composed phrase, not instead of it", () => {
    const SRC = codeOnly(read("server/v2routers.ts"));
    expect(SRC).toMatch(/method: normalizeLoginMethod\(r\.method\)/);
    // `methodLabel` survives, or a client on the previous bundle loses the line.
    expect(SRC).toMatch(/methodLabel: loginMethodLabel\(r\.method\)/);
    expect(SRC).toMatch(/detail: describeLogin\(/);
  });

  it("both surfaces compose through the ONE renderer", () => {
    /* Two copies of "how do I phrase a login" is how two screens come to describe one
       sign-in differently — which `server/loginOrigin.ts` already says in its own
       header about the three surfaces it serves, and is why the client half is one
       function rather than a line in each screen. */
    for (const f of ["client/src/app/MissedCalls.tsx", "client/src/pages/app/Profile.tsx"]) {
      const src = read(f);
      expect(src, `${f} does not use the shared renderer`).toMatch(
        /loginDetailLine\((?:pendingDetail|p|inlineApprove\.detail), t\)/,
      );
    }
    // …and nothing else hand-composes it.
    const users = ["client/src/app/MissedCalls.tsx", "client/src/pages/app/Profile.tsx"];
    for (const f of users) {
      expect(codeOnly(read(f)), `${f} still renders the server phrase whole`).not.toMatch(
        /\{(?:pendingDetail|p)\.detail\}/,
      );
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   3 — THE GRAMMAR FIX
   ══════════════════════════════════════════════════════════════════════════════ */

describe("a named person is singular", () => {
  it("'{name} was already in this group', not 'were'", () => {
    /* The plural verb was inherited from the pronoun sibling directly below it, so
       the named form rendered "Sara were already in this group." English is the
       default language, so this is the half most people see. */
    expect(en("groups.alreadyNamed", { name: "Sara" })).toBe("Sara was already in this group.");
    // …and the pronoun form keeps its plural verb, which is correct for "They".
    expect(en("groups.alreadyUnnamed")).toBe("They were already in this group.");
  });
});
