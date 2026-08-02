/**
 * THE ALERT SURFACES SPEAK ARABIC (#159) — the catch-up card, the missed-call banner
 * and the notification bell — and keep the distinctions that make them readable.
 *
 * ── WHY A SWEEP AND NOT A LIST OF SENTENCES ──────────────────────────────────────────
 * "These 37 strings are translated" goes stale the moment somebody adds the 38th, and
 * it goes stale SILENTLY: the list still passes while a fresh English literal sits on
 * the screen. So the load-bearing assertions walk the component for anything a person
 * could read and fail on whatever is not routed through the translator, which covers
 * the string added next rather than exempting it.
 *
 * ── AND WHY THIS SCREEN NEEDS A THIRD SWEEP THE OTHER LOCALE FILES DO NOT ────────────
 * Most copy here is a JSX text node or an attribute, and those are the two shapes
 * `groupsLocale.test.ts` already sweeps. This screen has a third: `ago()` is a pure
 * helper OUTSIDE any component, so it cannot call a hook, and before this release it
 * returned finished English ("just now", "3m ago"). A sweep that only reads JSX would
 * report the screen as fully translated while every timestamp on it stayed English —
 * so the helper bodies are swept for string literals too.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { copyOnScreen, whyCopyMissing } from "../../../server/testing/copyOnScreen";
import { ALERTS } from "./dict/alerts";
import { DICT, translate } from "./i18n";

/* Resolved from THIS file, never a hardcoded repo root: a literal absolute path passes
   on the machine it was written on and can never pass on a runner whose checkout lives
   somewhere else (the v2.106.60 finding, now a standing rule). */
const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const RAW = read("client/src/app/MissedCalls.tsx");
const SRC = codeOnly(RAW);

/* `loginOriginCopy.ts` is a SECOND renderer of `alerts.*` — the sign-in detail line,
   which BOTH this screen and Profile → Devices show, so its wording lives in one
   place rather than in two that can drift (v2.107.0). Read here rather than
   exempted, so its keys are genuinely covered. */
const RENDERERS = SRC + "\n" + codeOnly(read("client/src/app/loginOriginCopy.ts"));

/* Reached through `METHOD_KEY[method]` — a key chosen at RUNTIME from an enum the
   server sends, which no static reader can follow. Named rather than tolerated by a
   count, and pinned at the selector below so the exemption cannot become a hiding
   place for a key nothing returns. */
const INDIRECT_ALERT_KEYS = new Set([
  "alerts.loginMethodCode",
  "alerts.loginMethodPin",
  "alerts.loginMethodRegister",
]);

const entries = Object.entries(ALERTS) as [string, { en: string; ar: string }][];

/** The body of a top-level `function name(` … `)` declaration, sliced to the closing
 *  brace in column 0. Guarded by its callers, which assert the slice is real — an
 *  anchor that stopped matching would otherwise make every rule inside it vacuous. */
function fnBody(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  if (at === -1) return "";
  const open = src.indexOf("{", src.indexOf(")", at));
  const end = src.indexOf("\n}", open);
  return end === -1 ? "" : src.slice(open, end);
}

/* ════════════════════════════════════════════════════════════════════════════════════
   1 — NOTHING A PERSON CAN READ IS STILL AN ENGLISH LITERAL
   ══════════════════════════════════════════════════════════════════════════════════ */

/** The attributes on these surfaces whose value is rendered or announced. */
const VISIBLE_ATTRS = ["aria-label", "title", "placeholder", "alt"];

/** A LABEL may be one word (`aria-label="Dismiss"` is copy), so the attribute rule
 *  accepts one. A TEXT NODE cannot use that rule — the spans between `>` and `<` also
 *  catch fragments of ordinary code — so it requires two space-separated words. */
const WORD = /[A-Za-z]{2,}/;
const SENTENCE = /[A-Za-z]{2,}\s+[A-Za-z]{2,}/;

function englishAttributes(src: string): string[] {
  const out: string[] = [];
  for (const attr of VISIBLE_ATTRS) {
    for (const m of src.matchAll(new RegExp(`\\b${attr}="([^"]*)"`, "g"))) {
      if (WORD.test(m[1])) out.push(`${attr}="${m[1]}"`);
    }
  }
  return out;
}

function englishText(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/>([^<>{}\n]+)</g)) {
    if (SENTENCE.test(m[1])) out.push(`inline: ${m[1].trim().slice(0, 60)}`);
  }
  for (const m of src.matchAll(/>\s*\n([^<>{}=;"`]*?)\n\s*</g)) {
    if (SENTENCE.test(m[1])) out.push(`block: ${m[1].replace(/\s+/g, " ").trim().slice(0, 60)}`);
  }
  return out;
}

/**
 * A string literal RETURNED from a helper — the shape a JSX sweep cannot see, and the
 * one this screen actually shipped.
 *
 * Scoped to `return`, because a className is also a string literal and is not copy.
 */
function englishReturns(src: string): string[] {
  return [...src.matchAll(/\breturn\s+(`[^`]*`|"[^"]*")/g)]
    .map((m) => m[1])
    .filter((s) => WORD.test(s));
}

describe("every string on the alert surfaces goes through the translator", () => {
  it("is reading the real component (guards against a vacuous pass)", () => {
    /* Every sweep below is `not`-shaped and passes trivially against an empty string,
       so a mis-resolved path or a `codeOnly` that ate the file would report the screen
       as fully translated. */
    expect(SRC.length).toBeGreaterThan(15_000);
    expect(SRC).toContain("export function AwaySummaryToast");
    expect(SRC).toContain("export function MissedCallToast");
    expect(SRC).toContain("export function NotificationBell");
    expect(SRC).toContain("function ago(");
  });

  it("all three components read the locale", () => {
    /* They need `locale` as well as `t` — the two platform date formatters below are
       given the app's language, not the browser's. A component that stopped calling it
       could not translate anything, and every sweep here would still pass, because the
       literals would have gone with it. */
    expect([...SRC.matchAll(/const \{ t, locale \} = useLocale\(\);/g)]).toHaveLength(3);
  });

  it("no user-visible ATTRIBUTE carries an English literal", () => {
    expect(
      englishAttributes(SRC),
      "route these through t() — an attribute is announced just like body text",
    ).toEqual([]);
  });

  it("no JSX TEXT NODE carries an English literal", () => {
    expect(englishText(SRC), "route these through t()").toEqual([]);
  });

  it("no helper RETURNS a finished English string", () => {
    /* This is the one that bit: `ago()` used to return "just now" / "3m ago" from
       outside any component. It now takes the translator as a parameter, which is how
       a module-level helper participates in a dictionary at all. */
    expect(englishReturns(SRC), "take the translator as a parameter instead").toEqual([]);
  });

  it("the relative-time helper routes EVERY branch through the translator", () => {
    /* Four branches say something; the fifth hands the date to the platform. Counted,
       because a single branch left as a literal is exactly what a `not`-shaped sweep
       above would catch and a "does it mention t(" check would not. */
    const body = fnBody(SRC, "ago");
    expect(body.length, "the ago() slice collapsed — re-anchor it").toBeGreaterThan(200);
    expect([...body.matchAll(/t\("alerts\.[A-Za-z]+"/g)]).toHaveLength(4);
    expect(body, "no branch may answer with a literal").not.toMatch(/return\s+["'`]/);
  });

  it("these sweeps really bite — a planted regression is caught by each of them", () => {
    /* THE NON-VACUITY GUARD, and it is not ceremony: all four assertions above are
       `not`-shaped and would pass against a file with no copy in it at all. Each shape
       below is one a contributor would plausibly write. */
    const planted = `
      <div aria-label="While you were away">
        <span>Missed calls, messages and sign-ins land here</span>
        <p>
          If this wasn't you, decline it.
        </p>
      </div>
    `;
    expect(englishAttributes(planted)).toHaveLength(1);
    expect(englishText(planted).filter((s) => s.startsWith("inline:"))).toHaveLength(1);
    expect(englishText(planted).filter((s) => s.startsWith("block:"))).toHaveLength(1);
    expect(englishReturns(`if (s < 60) return "just now";`)).toHaveLength(1);
    // …and none of them fires on ordinary code, which is how a looser first draft of
    // this shape reported 81 offenders in a fully translated file.
    const code = `
      const total = missedCount + unreadCount + pendingDevices;
      return n.length === 6 ? \`\${n.slice(0, 3)}-\${n.slice(3)}\` : n;
      ) : !unread.latest ? (
      {t("alerts.tapMessages")}
    `;
    expect([...englishAttributes(code), ...englishText(code), ...englishReturns(code)]).toEqual([]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   2 — THE KEYS AND THEIR READERS
   ══════════════════════════════════════════════════════════════════════════════════ */

describe("the alerts dictionary and the screen agree", () => {
  it("every alerts.* key has a reader on this screen — a dead key reads as coverage", () => {
    /* v2.106.91's rule, applied locally so the failure names THIS screen rather than
       surfacing as one line in the app-wide sweep. An unread key is worse than a
       missing one: somebody counting keys concludes the screen is translated. */
    const dead = entries.map(([k]) => k).filter((k) => !RENDERERS.includes(k));
    expect(dead, `no reader for:\n${dead.join("\n")}`).toEqual([]);
  });

  it("every alerts.* key the screen references is defined", () => {
    const used = [...SRC.matchAll(/\bt\(\s*"(alerts\.[A-Za-z0-9]+)"/g)].map((m) => m[1]);
    expect(used.length, "the reference sweep found nothing — re-anchor it").toBeGreaterThan(25);
    const missing = used.filter((k) => !(k in ALERTS));
    expect(missing, `referenced but not defined:\n${missing.join("\n")}`).toEqual([]);
  });

  it("every key is reached by a DIRECT t(\"key\") call, never a ternary inside t()", () => {
    /* `t(n === 1 ? "a" : "b")` type-checks and renders correctly — and is invisible to
       `copyOnScreen`, whose whole job is letting a pin on owner-signed-off wording
       survive localisation. A screen written that way cannot have its copy pinned at
       all, which is a guard silently lost rather than a bug. So the branch goes
       OUTSIDE the call. */
    const direct = new Set(
      [...RENDERERS.matchAll(/\bt\(\s*"(alerts\.[A-Za-z0-9]+)"/g)].map((m) => m[1]),
    );
    const indirect = entries
      .map(([k]) => k)
      .filter((k) => !direct.has(k) && !INDIRECT_ALERT_KEYS.has(k));
    expect(indirect, `reached only indirectly — hoist the branch out of t():\n${indirect.join("\n")}`)
      .toEqual([]);

    /* The exemption is EARNED: each named key must be what the map returns for a real
       method, so one that stopped being selected goes red here instead of sitting in
       the list looking covered. */
    const COPY = read("client/src/app/loginOriginCopy.ts");
    for (const k of INDIRECT_ALERT_KEYS) {
      expect(k in ALERTS, `${k} must exist to be exempted`).toBe(true);
      expect(COPY, `${k} is not selected by loginMethodKey`).toContain(`"${k}"`);
    }
  });

  it("every Arabic half really is Arabic, not the English copied across", () => {
    /* The cheap way to satisfy `Entry`'s both-halves requirement is to paste the
       English across, which ships a build claiming to be translated when it is not. */
    const copied = entries.filter(([, e]) => e.en === e.ar).map(([k]) => k);
    expect(copied, `English pasted into the Arabic half:\n${copied.join("\n")}`).toEqual([]);
    const notArabic = entries.filter(([, e]) => !/[؀-ۿ]/.test(e.ar)).map(([k]) => k);
    expect(notArabic, `no Arabic script:\n${notArabic.join("\n")}`).toEqual([]);
    /* …and not merely Arabic-ish: a half still carrying a run of Latin words is English
       with a token pasted in front of it. `RELAY` is the product name and stays Latin. */
    const latinLeft = entries
      .filter(([, e]) => /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(e.ar.replace(/RELAY/g, "")))
      .map(([k]) => k);
    expect(latinLeft, `untranslated English left in the Arabic half:\n${latinLeft.join("\n")}`)
      .toEqual([]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   3 — THE VOCABULARY DISTINCTIONS SURVIVE TRANSLATION
   ══════════════════════════════════════════════════════════════════════════════════ */

const ar = (k: keyof typeof ALERTS) => ALERTS[k].ar;

describe("two English words that mean different things stay two Arabic words", () => {
  it("DISMISS and DECLINE are different words — one is free, the other is irreversible", () => {
    /* The banner's ✕ dismisses a notice and costs nothing. Decline REVOKES a pending
       session, which cannot be taken back — the other device has to start again, which
       is why it carries the destructive colour. One Arabic word for both would hide an
       irreversible act behind the word people learn means "close this", and the two
       even appear in the same panel. */
    expect(ALERTS["alerts.dismiss"].en).toBe("Dismiss");
    expect(ALERTS["alerts.decline"].en).toBe("Decline");
    expect(ar("alerts.dismiss")).not.toBe(ar("alerts.decline"));
  });

  it("APPROVE and DECLINE are different words", () => {
    // They sit side by side on one row, as the only two answers to one question.
    expect(ar("alerts.approve")).not.toBe(ar("alerts.decline"));
  });

  it("APPROVE says the same word the sign-in screen tells you to tap", () => {
    /* `auth.waitingHow` reads "…and tap {approve}", interpolating `auth.approve` — it
       is an instruction naming THIS button on the OTHER device. If the two Arabic
       halves diverge, that sentence names a button which does not exist.
       `alerts.approve` is its own key (one module per surface, so an auth copy edit
       cannot silently reword the bell), and the agreement is asserted instead. */
    expect(
      ar("alerts.approve"),
      "auth.waitingHow tells the user to tap this button by name — move both together",
    ).toBe(DICT["auth.approve"].ar);
  });

  it("NEW and UNREAD are different claims, and both are on screen", () => {
    /* The catch-up card says "New message"; the bell's row says "{n} unread message".
       They are not the same statement — a message can be unread without being new —
       and because both spellings reach the screen, both are translated. */
    expect(ALERTS["alerts.newMessageOne"].en).toBe("New message");
    expect(ALERTS["alerts.unreadRowOne"].en).toBe("{n} unread message");
    expect(ar("alerts.newMessageMany")).not.toBe(ar("alerts.unreadRowMany"));
  });

  it("a MISSED call is not a DECLINED one", () => {
    /* `history.ts` draws that line for the call log («فائتة» vs «مرفوضة») and this
       screen inherits it: a missed call is one nobody answered, a declined one was
       actively refused. The bell must not describe the first with the second's word. */
    expect(ar("alerts.missedOne")).not.toContain(DICT["history.declined"].ar);
    expect(ar("alerts.missedOne")).toBe(DICT["history.missedCall"].ar);
  });

  it("the counted row and the bare heading are separate strings", () => {
    /* The card's heading carries NO number for a single call ("Missed call"); the
       bell's row always carries it ("1 missed call"). Both spellings are on screen, so
       collapsing them would silently reword one of the two surfaces. */
    expect(ALERTS["alerts.missedOne"].en).not.toContain("{n}");
    expect(ALERTS["alerts.missedRowOne"].en).toContain("{n}");
  });

  it("the two 'view missed' labels are WHOLE sentences, never a stem plus a noun", () => {
    /* `View missed {count === 1 ? "call" : "calls"}` is the forbidden shape: Arabic does
       not place the adjective where English does, so a sentence chopped at the English
       seam can only be re-assembled into nonsense (the `translateNodes` rule). */
    expect(ALERTS["alerts.viewMissedOne"].en).toBe("View missed call");
    expect(ALERTS["alerts.viewMissedMany"].en).toBe("View missed calls");
    expect(SRC, "the noun must not be interpolated into the verb phrase").not.toMatch(
      /View missed \{/,
    );
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   4 — DIGITS AND PLACEHOLDERS
   ══════════════════════════════════════════════════════════════════════════════════ */

describe("numbers read the same in both languages", () => {
  it("no Arabic half uses Arabic-Indic numerals", () => {
    /* Every number here is one somebody acts on — a count of missed calls, a 6-digit
       RELAY number. A substituted Western digit beside an Arabic-Indic one on the same
       line reads as a rendering fault (v2.106.84). */
    const bad = entries.filter(([, e]) => /[٠-٩۰-۹]/.test(e.ar)).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("a digit stated in English is still a digit in Arabic", () => {
    const bad = entries
      .filter(([, e]) => (e.en.match(/\d/g) ?? []).some((d) => !e.ar.includes(d)))
      .map(([k]) => k);
    expect(bad, "the number was dropped or spelled out").toEqual([]);
  });

  it("every placeholder in an English half survives into the Arabic half", () => {
    /* Substitution is BY NAME, which is what lets Arabic put `{n}` where the language
       wants it — «منذ {n} د» leads where "{n}m ago" trails. The cost of that freedom is
       that a dropped placeholder is silent: the sentence renders, missing the very
       thing it was about. */
    const bad: string[] = [];
    for (const [k, e] of entries) {
      const want = new Set(e.en.match(/\{\w+\}/g) ?? []);
      const got = new Set(e.ar.match(/\{\w+\}/g) ?? []);
      for (const p of want) if (!got.has(p)) bad.push(`${k} lost ${p}`);
      for (const p of got) if (!want.has(p)) bad.push(`${k} invented ${p}`);
    }
    expect(bad).toEqual([]);
  });

  it("interpolation really works for the sentences that carry a count", () => {
    // Driven, not pinned: whether a substituted count lands INSIDE the Arabic sentence
    // is exactly what reading the dictionary cannot tell you.
    for (const k of [
      "alerts.missedMany",
      "alerts.missedRowOne",
      "alerts.newMessageMany",
      "alerts.unreadRowMany",
      "alerts.andOthersMany",
      "alerts.devicesWaitingMany",
      "alerts.notificationsMany",
      "alerts.minutesAgo",
      "alerts.hoursAgo",
      "alerts.daysAgo",
    ] as const) {
      const out = translate("ar", k, { n: 7 });
      expect(out, `${k} lost its count`).toContain("7");
      expect(out, `${k} rendered the placeholder verbatim`).not.toContain("{n}");
    }
    // …and the count is not stranded outside the sentence in English either.
    expect(translate("en", "alerts.missedRowOne", { n: 1 })).toBe("1 missed call");
  });

  it("the platform date formatter is given the APP's language, with Western digits", () => {
    /* `toLocaleDateString("ar")` renders Arabic-Indic numerals in a real browser, and
       every other number on these surfaces is an interpolated Western digit. The
       `-u-nu-latn` extension pins the numbering system without pinning the format, so
       an Arabic reader still gets Arabic month order and separators.
       (Node's bundled ICU here already answers `latn` for a bare `ar`, so this cannot
       be proven by measurement in this environment — hence a structural pin.) */
    expect(SRC).toMatch(/locale === "ar" \? "ar-u-nu-latn" : "en"/);
    /* …and EVERY platform formatter is given it — one left on the browser default is a
       stamp in the wrong language on a screen just switched to Arabic.

       MATCHED ON WHAT FOLLOWS THE OPEN PAREN, not by capturing the argument: `[^)]*`
       cannot span the callee's own `)`, so a capture reads back the truncated
       `dateLocale(locale` and an equality check on it fails against correct source.
       (It did — my first draft.) */
    const calls = [...SRC.matchAll(/\.toLocale(?:Date)?String\(/g)];
    expect(calls.length, "the formatter sweep found nothing — re-anchor it").toBe(3);
    for (const c of calls) {
      expect(
        SRC.slice(c.index + c[0].length),
        "a platform formatter left on the browser default",
      ).toMatch(/^\s*dateLocale\(locale\),?\s*\)/);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   5 — RTL: LOGICAL SPACING, AND THE ONE THING THAT MUST STAY PHYSICAL
   ══════════════════════════════════════════════════════════════════════════════════ */

describe("the alert surfaces mirror in RTL", () => {
  it("no physical spacing or inset utility is left anywhere in the component", () => {
    /* `dir` is written on the ROOT, so a logical utility flips for free and a physical
       one silently does not — which is how a badge ends up on the wrong corner in
       Arabic while every other test still passes.

       SWEPT OVER THE WHOLE COMMENT-STRIPPED SOURCE rather than over `className="…"`
       matches: this file builds the bell's class list as a CONCATENATED EXPRESSION
       across several lines (`className={"…" + (dnd ? "…" : "…")}`), which an
       attribute-shaped regex cannot see inside. Comments are stripped first because
       the prose here necessarily NAMES the physical spellings it replaced — the trap
       this repo has hit nineteen times. */
    /* `:` AND `!` ARE IN THE BOUNDARY SET, and their absence was a real gap in my own
       first draft: without `:` this never matched `md:left-0` — a VARIANT-PREFIXED
       physical class, which is precisely the one this release changed. The sweep would
       have reported the file clean while `md:left-0` sat in it. Caught by the planted
       regression below failing, which is what that block is for. */
    const PHYSICAL = /(?:^|[\s`"'{(+:!])-?(?:pl|pr|ml|mr|left|right)-(?![a-z])/g;
    const hits = [...SRC.matchAll(PHYSICAL)].map((m) =>
      SRC.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " "),
    );
    /* DELIBERATELY EMPTY, and that is the assertion. Centring (`left-1/2` with
       `-translate-x-1/2`) is direction-INDEPENDENT and must stay physical — the logical
       spelling pushes it the wrong way in RTL — so if one ever arrives here it has to
       be named with its reason rather than slipping through a blanket ban. There is
       none on these surfaces today: every fixed element is centred with `justify-center`
       or spans the viewport with `inset-x-0`, neither of which has a handedness. */
    expect(hits, "use ps-/pe-/ms-/me-/start-/end-").toEqual([]);
    expect(SRC).not.toMatch(/\btext-(?:left|right)\b/);
  });

  it("that sweep really bites", () => {
    /* It is `not`-shaped over a variable, so it passes against anything that stopped
       matching. Both the attribute form and the concatenated-expression form — the one
       an attribute-scoped sweep would miss — are planted. */
    /* `:` AND `!` ARE IN THE BOUNDARY SET, and their absence was a real gap in my own
       first draft: without `:` this never matched `md:left-0` — a VARIANT-PREFIXED
       physical class, which is precisely the one this release changed. The sweep would
       have reported the file clean while `md:left-0` sat in it. Caught by the planted
       regression below failing, which is what that block is for. */
    const PHYSICAL = /(?:^|[\s`"'{(+:!])-?(?:pl|pr|ml|mr|left|right)-(?![a-z])/g;
    expect([...`<p className="mt-2 pl-12 text-xs">`.matchAll(PHYSICAL)]).toHaveLength(1);
    expect([...`"absolute -top-0.5 -right-0.5 inline-flex " + (blink ? "x" : "")`.matchAll(PHYSICAL)])
      .toHaveLength(1);
    expect([...`md:absolute md:left-0 md:mt-2`.matchAll(PHYSICAL)]).toHaveLength(1);
    // …and it does not fire on a logical utility or on an unrelated hyphenated word.
    expect([...`ps-12 me-2 md:start-0 -end-0.5 slide-in-from-top-3`.matchAll(PHYSICAL)]).toEqual([]);
  });

  it("the badge rides the bell's TRAILING corner, logically", () => {
    // The same `-end-` GroupInfoSheet's camera badge and presence LED already use, so
    // every corner affordance in the app agrees about which corner it is on.
    expect(SRC).toMatch(/-top-0\.5 -end-0\.5/);
  });

  it("the panel hangs off the bell's LEADING edge on desktop", () => {
    /* v2.96.3's rule: the bell sits mid-bar, so a trailing-edge anchor ran the panel
       past the screen edge. `md:start-0` keeps that anchor true in Arabic, where
       `md:left-0` would silently open back across the button. */
    expect(SRC).toMatch(/md:absolute md:start-0/);
    expect(SRC).not.toMatch(/md:(?:end|right)-0/);
    // `inset-inline-start-…` is the CSS PROPERTY name and emits NOTHING (v2.106.78);
    // `start-…` is the Tailwind utility.
    expect(SRC).not.toContain("inset-inline-start-");
  });

  it("the caller's 6-digit number stays left-to-right beside an Arabic name", () => {
    /* Without the isolation the bidi algorithm resolves the digits and the hyphen
       against the surrounding RTL run and renders `777-254` with its parts reordered —
       a number read aloud must not differ from the number stored. */
    const body = fnBody(SRC, "PeerNumber");
    expect(body.length, "the PeerNumber slice collapsed — re-anchor it").toBeGreaterThan(60);
    expect(body).toMatch(/dir="ltr"/);
    expect(body).toContain("unicode-bidi:isolate");
    expect(body).toContain("fmtNumber(number)");
    /* ONE component, both banners: two hand-rolled copies is how one surface keeps the
       isolation and the other quietly loses it. */
    expect([...SRC.matchAll(/<PeerNumber number=/g)]).toHaveLength(2);
    expect(SRC, "the number must not be re-inlined without isolation").not.toMatch(
      /` · \$\{fmtNumber/,
    );
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   6 — THE COPY THAT OTHER FILES PIN IS STILL ON THIS SCREEN
   ══════════════════════════════════════════════════════════════════════════════════ */

describe("the sentences other tests pin still reach the screen", () => {
  /* Each of these is pinned elsewhere by an English LITERAL, and moving the copy into
     the dictionary breaks that spelling. The PROPERTY those pins stand for — this
     sentence reaches this screen — is asserted here through `copyOnScreen`, which is
     satisfied by the literal OR by a key whose English half carries it. That is
     strictly stronger than the literal check, because reaching the dictionary also
     proves an Arabic half exists.

     Listed with the file that pins each one, so a future repoint is mechanical. */
  const PINNED: [string, string][] = [
    ["client/src/app/notifCenterRestore.test.ts", "All caught up"],
    ["client/src/app/notifCenterRestore.test.ts", "Missed calls, messages and sign-ins land here"],
    ["client/src/app/newDeviceApproval.test.ts", "new device waiting"],
    ["client/src/app/newDeviceApproval.test.ts", "new devices waiting"],
    ["server/loginOrigin.test.ts", "Approve or decline the sign-in"],
  ];

  it.each(PINNED)("%s — %s", (_file, english) => {
    expect(copyOnScreen(RAW, english), whyCopyMissing(RAW, english)).toBe(true);
  });

  it("…and the list is not empty (a vacuous `it.each` reports nothing)", () => {
    expect(PINNED.length).toBeGreaterThanOrEqual(5);
  });

  it("the panel's own copy survives too", () => {
    // Not pinned elsewhere, but owner-facing: the empty state names what LANDS here,
    // and the sign-in row says what to do if it was not you.
    for (const line of ["If this wasn't you, decline it.", "New device sign-in", "Do Not Disturb"]) {
      expect(copyOnScreen(RAW, line), whyCopyMissing(RAW, line)).toBe(true);
    }
  });
});
