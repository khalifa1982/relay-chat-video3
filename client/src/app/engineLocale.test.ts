import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { copyOnScreen } from "../../../server/testing/copyOnScreen";
import { ENGINE } from "./dict/engine";

/**
 * THE CALL ENGINE'S REACT CHROME SPEAKS ARABIC — and the interesting half of this file
 * is not the strings, it is the three things a localisation sweep silently gets wrong.
 *
 *  1. A SWEEP, NOT A LIST. Pinning "these six sentences are translated" stays green with
 *     the seventh left behind, which is how a screen ends up 90% Arabic. So the rule reads
 *     the component and fails on ANY user-visible English literal — the string somebody
 *     adds next is covered rather than exempt. It is proven to BITE on constructed
 *     fixtures below, because a sweep widened until it stops flagging correct code is
 *     exactly the kind that ends up flagging nothing.
 *
 *  2. THE ONE EXEMPTION IS NAMED AND EARNED. `InCallSaveContacts` still holds English,
 *     and that is deliberate: it has been UNMOUNTED since v2.99.82, so its strings reach
 *     no screen. The exemption is only legitimate while that stays true, so this file
 *     re-checks it rather than trusting the comment — if the component is ever mounted
 *     again the sweep goes red and its copy has to be translated then.
 *
 *  3. DIRECTION IS NOT A FIND-AND-REPLACE. Reading-order spacing must be logical, and
 *     three sites here must stay PHYSICAL or Arabic breaks: two centring pairs (which are
 *     direction-independent) and the mini window's anchor (whose drag clamp is arithmetic
 *     written for a right edge). Both directions are asserted, because a sweep that only
 *     forbids `ml-` would happily accept a "fixed" centre that is no longer centred.
 */
const ROOT = path.resolve(__dirname, "../../..");
const SRC = fs.readFileSync(path.join(ROOT, "client/src/app/RelayEngine.tsx"), "utf8");

/* Comment-stripped, and not for tidiness: this file's own prose necessarily QUOTES the
   English it explains ("Minimize — keep the call in a small window…") and names the
   physical classes it forbids. Text ABOUT a pattern satisfying a search FOR it is the
   trap this repo has hit repeatedly; `codeOnly` is the shared strip. */
const CODE = codeOnly(SRC);

/** The part of the file that actually renders — see exemption (2) in the header. */
const DEAD_AT = CODE.indexOf("function InCallSaveContacts");
/* EVERYTHING BEFORE THE DEAD COMPONENT. That is only the same thing as "everything
   live" while the dead component is LAST in the file — a structural assumption this
   slice made silently, so a component appended after it would have been exempt with
   nothing saying so. Pinned in the slice-reality test below. */
const LIVE = CODE.slice(0, DEAD_AT);
/** Just the JSX, so TypeScript generics (`useState<Array<…>>`) cannot be read as text. */
const JSX = LIVE.slice(
  LIVE.indexOf("<RelayEngineContext.Provider"),
  LIVE.indexOf("</RelayEngineContext.Provider>"),
);

/**
 * Every string a PERSON would read, if it were written as a literal rather than fetched
 * from the dictionary: JSX text nodes, the attributes screen readers and tooltips
 * surface, and the imperative shouts.
 *
 * FIVE BLIND SPOTS WERE CLOSED IN v2.107.0, each proven by planting the shape and
 * watching the old sweep pass it. None was a live defect — the region really is
 * clean — but a sweep with holes is worse than no sweep, because it reports safety
 * for the shapes it cannot see, and the next string added is as likely to take one
 * of these forms as the ones it caught:
 *
 *   1. A TEMPLATE-LITERAL attribute: `aria-label={`Mute ${name}`}`.
 *   2. Text mixed with an expression: `>Muted {n} people<`. The run used to refuse
 *      braces outright, so a text node containing ANY expression was skipped whole
 *      rather than having its English half read — which is the common shape.
 *   3. A single-quoted attribute.
 *   4. `toast.success(…)` / `.error(…)` — only the bare `toast(` call was matched,
 *      and every real call site in this codebase uses a method.
 *   5. A string literal standing alone in a text position: `>{"Reconnecting"}<`.
 *
 * The text run now ALLOWS braces and strips the expressions out of it before asking
 * whether English is left, which is what makes (2) and (5) visible while still
 * confining a match to one node: `<` and `>` end the run, so a nested element or a
 * CSS template cannot be swallowed.
 */
/**
 * Drop every `{…}` expression from a JSX text run, INNERMOST FIRST until stable.
 *
 * One pass is not enough and getting that wrong was caught by this file's own
 * "and the translated forms still pass" case: `{t("k", { n })}` has a nested brace,
 * so a single `\{[^{}]*\}` strips only the inner `{ n }` and leaves the outer
 * expression looking like text — which would flag correct, translated code.
 */
function stripBraces(run: string): string {
  let prev = "";
  let cur = run;
  while (cur !== prev) {
    prev = cur;
    cur = cur.replace(/\{[^{}]*\}/g, "");
  }
  return cur.trim();
}

function userVisibleLiterals(jsx: string, rest = ""): string[] {
  const out: string[] = [];
  const all = jsx + rest;
  for (const m of jsx.matchAll(/>\s*([^<>]*?)\s*</g)) {
    const run = m[1];
    /* A brace run that is EXACTLY one quoted string is a literal in a text position
       (blind spot 5); anything else in braces is an expression and is dropped. */
    for (const lit of run.matchAll(/\{\s*(["'])([^"']*[A-Za-z]{2}[^"']*)\1\s*\}/g)) {
      out.push(lit[2]);
    }
    const bare = stripBraces(run);
    /* AN UNBALANCED BRACE MEANS THIS IS NOT A TEXT NODE. A multi-line JSX expression
       — `{cond ? (` … `) : null}` — puts a lone `{` between a `>` and the next `<`,
       and reading its residue as text flagged five perfectly correct ternaries the
       first time this widening ran. A guard that cries wolf on correct code is as
       useless as one that never fires, so a run with a leftover brace is skipped
       rather than reported; the balanced case is the one that is really text. */
    if (!/[{}]/.test(bare) && /[A-Za-z]{2}/.test(bare)) out.push(bare);
  }
  for (const m of all.matchAll(
    /\b(?:aria-label|title|placeholder|alt)=(["'])([^"']*[A-Za-z]{2}[^"']*)\1/g,
  )) {
    out.push(m[2]);
  }
  /* A template literal in an attribute: the English lives outside the `${…}` holes,
     so they are stripped and what remains is asked. */
  for (const m of all.matchAll(
    /\b(?:aria-label|title|placeholder|alt)=\{`([^`]*)`\}/g,
  )) {
    const bare = m[1].replace(/\$\{[^{}]*\}/g, "").trim();
    if (/[A-Za-z]{2}/.test(bare)) out.push(bare);
  }
  for (const m of all.matchAll(
    /\b(?:toast(?:\.\w+)?|alert|confirm)\(\s*(["'])([^"']*[A-Za-z]{2}[^"']*)\1/g,
  )) {
    out.push(m[2]);
  }
  return out.filter((s) => s.length > 0);
}

describe("RelayEngine's call chrome is translated", () => {
  it("the slices this file reasons about are real (guards a vacuous pass)", () => {
    /* Every assertion below is scoped to a slice. A stale anchor would make the slice
       empty and every `not.toMatch` in it pass while proving nothing — the collapsed-slice
       trap this repo has recorded more than once. */
    expect(DEAD_AT, "the dead component is still findable").toBeGreaterThan(0);
    /* `LIVE` is everything BEFORE the dead component, so anything appended AFTER it
       is silently exempt. That held only because the dead component was last — an
       assumption the slice never stated. Pinned: nothing may declare a component
       below it. */
    const below = CODE.slice(DEAD_AT + "function InCallSaveContacts".length);
    expect(
      [...below.matchAll(/^(?:export )?function ([A-Z]\w*)/gm)].map((m) => m[1]),
      "a component was added BELOW the dead one, where the sweep does not look — " +
        "move it above InCallSaveContacts, or the slice has to change",
    ).toEqual([]);
    expect(LIVE.length).toBeGreaterThan(10_000);
    expect(JSX.length).toBeGreaterThan(2_000);
    expect(JSX).toContain("relay-root relay-embedded");
  });

  it("renders NO hardcoded user-visible English — the sweep, not a list of six sentences", () => {
    const leftovers = userVisibleLiterals(JSX, LIVE);
    expect(
      leftovers,
      `these reach a screen as English literals — put them in dict/engine.ts:\n` +
        leftovers.map((s) => `  ${JSON.stringify(s)}`).join("\n"),
    ).toEqual([]);
  });

  it("…and that sweep really bites", () => {
    /* Constructed rather than assumed. A rule that has been narrowed to stop flagging
       correct code has to be shown still catching the thing it exists for. */
    expect(userVisibleLiterals(`<div>Reconnecting to your call</div>`)).toEqual([
      "Reconnecting to your call",
    ]);
    expect(userVisibleLiterals(`<button aria-label="End the call" />`)).toEqual(["End the call"]);
    expect(userVisibleLiterals(``, `toast("Saved to your contacts.")`)).toEqual([
      "Saved to your contacts.",
    ]);
    // …and passes the translated forms, so it is not merely "flags everything".
    expect(userVisibleLiterals(`<div>{t("engine.reconnecting")}</div>`)).toEqual([]);
    expect(userVisibleLiterals(`<button aria-label={t("engine.endCall")} />`)).toEqual([]);
  });

  it("…and bites on the five shapes it used to be blind to", () => {
    /* One case per closed blind spot, each planted rather than reasoned about. The
       old sweep returned [] for every one of these. */
    // 1 — a template-literal attribute
    expect(userVisibleLiterals("<button aria-label={`Mute ${name}`} />")).toEqual(["Mute"]);
    // 2 — text mixed with an expression
    expect(userVisibleLiterals(`<div>Muted {n} people</div>`)).toEqual(["Muted  people"]);
    // 3 — a single-quoted attribute
    expect(userVisibleLiterals(`<button title='End the call' />`)).toEqual(["End the call"]);
    // 4 — toast via a method rather than the bare call
    expect(userVisibleLiterals(``, `toast.success("Saved to your contacts.")`)).toEqual([
      "Saved to your contacts.",
    ]);
    expect(userVisibleLiterals(``, `toast.error("Could not connect.")`)).toEqual([
      "Could not connect.",
    ]);
    // 5 — a bare string literal in a text position
    expect(userVisibleLiterals(`<div>{"Reconnecting"}</div>`)).toEqual(["Reconnecting"]);

    /* …and the translated forms of the SAME shapes still pass, so the widening did
       not turn the sweep into "flags everything" — which would be the other way of
       making it useless. */
    expect(userVisibleLiterals("<button aria-label={`${t(\"engine.mute\")}`} />")).toEqual([]);
    expect(userVisibleLiterals(`<div>{t("engine.muted", { n })}</div>`)).toEqual([]);
    expect(userVisibleLiterals(``, `toast.success(t("engine.saved"))`)).toEqual([]);
  });

  it("the ONE exemption is earned: the untranslated component is still unmounted", () => {
    /* `InCallSaveContacts` keeps its English `aria-label`/`title` because they reach no
       screen. That is only true while nothing mounts it — asserted here rather than
       trusted, so the exemption cannot rot into a comment. */
    expect(CODE).not.toMatch(/<InCallSaveContacts/);
    // …and the strings really are in there, so the exemption is describing something
    // real rather than quietly covering an empty function.
    expect(CODE.slice(DEAD_AT)).toContain("to contacts");
  });

  it("the provider reaches the translator, and no local shadows it", () => {
    /* The PROPERTY is that the component imports the translator from the app's own
       i18n module — not the exact shape of the import clause. The original froze
       `{ useT }` alone, so it broke when the engine wiring legitimately needed
       `type TKey` beside it for the boundary cast, while saying nothing about
       whether the translator is reached at all. */
    expect(CODE).toMatch(/import \{[^}]*\buseT\b[^}]*\} from "\.\/i18n"/);
    expect(LIVE).toMatch(/const t = useT\(\);/);
    /* A `const t = setInterval(...)` in an effect would shadow the translator and hand a
       later edit a Timeout where it expected a function. The repo's precedent is to
       REMOVE the shadow rather than alias around it (v2.106.85). */
    expect(LIVE).not.toMatch(/const t = setInterval/);
  });
});

describe("dict/engine.ts — every key is read, every reference exists", () => {
  const KEYS = Object.keys(ENGINE);

  it("publishes a real module (guards a vacuous pass)", () => {
    expect(KEYS.length).toBeGreaterThan(15);
    expect(KEYS.every((k) => k.startsWith("engine."))).toBe(true);
  });

  it("every key this module publishes is actually rendered", () => {
    /* `dictCoverage.test.ts` asks this app-wide; asking it locally is what stops THIS
       module accumulating keys for copy that was later deleted. */
    const dead = KEYS.filter((k) => !LIVE.includes(`"${k}"`));
    expect(dead, `keys with no reader in RelayEngine.tsx:\n${dead.join("\n")}`).toEqual([]);
  });

  it("every engine.* key the component asks for exists — a typo would render the KEY", () => {
    /* `translate()` deliberately falls back to the key when it does not know it, so a
       mistyped key does not throw: it puts `engine.reconnnecting` on somebody's screen. */
    const asked = [...LIVE.matchAll(/\bt\("(engine\.[\w.]+)"\)/g)].map((m) => m[1]);
    expect(asked.length).toBeGreaterThan(15);
    const missing = asked.filter((k) => !(k in ENGINE));
    expect(missing, `asked for but not defined: ${missing.join(", ")}`).toEqual([]);
  });

  it("numbers stay WESTERN, even inside Arabic prose", () => {
    /* The mini window's head-count is interpolated raw, and every number in this product
       is six Western digits. An Arabic-Indic numeral beside a substituted Western one
       reads as a rendering fault, so none may enter this module. */
    const indic = Object.entries(ENGINE).filter(([, e]) => /[٠-٩۰-۹]/.test(e.ar));
    expect(indic.map(([k]) => k)).toEqual([]);
  });
});

describe("the vocabulary distinctions survive the translation", () => {
  it("ENDING a call and EXITING an auto-rejoin are different words", () => {
    /* `engine.endCall` hangs up a call you are ON. `engine.exitCall` refuses to be
       reconnected to one you were DROPPED from — at that moment there is nothing to end.
       Collapse them and the rejoin overlay's button claims to end a call that does not
       exist yet, which is the class of lie this repo keeps removing. */
    expect(ENGINE["engine.endCall"].en).not.toBe(ENGINE["engine.exitCall"].en);
    expect(ENGINE["engine.endCall"].ar).not.toBe(ENGINE["engine.exitCall"].ar);
  });

  it("Minimize, Maximize and Fit are three words, not two", () => {
    const words = [
      ENGINE["engine.minimize"].ar,
      ENGINE["engine.maximize"].ar,
      ENGINE["engine.fit"].ar,
    ];
    expect(new Set(words).size, `collapsed: ${words.join(" / ")}`).toBe(3);
    /* THE ACTUAL TRAP, pinned: "Fit screen" is naturally rendered «تكبير الشاشة», which
       is the word Maximize already owns — two adjacent controls, one Arabic verb. So no
       Fit string may contain the Maximize word. */
    const maximize = ENGINE["engine.maximize"].ar;
    for (const k of ["engine.fit", "engine.fitLabel", "engine.fitOnHint", "engine.fitOffHint"] as const) {
      expect(ENGINE[k].ar, `${k} borrows the Maximize word`).not.toContain(maximize);
    }
  });

  it("the two Fit tooltips describe opposite states", () => {
    /* One toggle, two hints: what it is doing now vs what tapping would do. If they ever
       become the same string the control stops telling you which way it is set. */
    expect(ENGINE["engine.fitOnHint"].en).not.toBe(ENGINE["engine.fitOffHint"].en);
    expect(ENGINE["engine.fitOnHint"].ar).not.toBe(ENGINE["engine.fitOffHint"].ar);
    expect(JSX).toMatch(/fitContain \? t\("engine\.fitOnHint"\) : t\("engine\.fitOffHint"\)/);
  });

  it("the rejoin caption commits to no gender, because it sits under a NAME", () => {
    /* Arabic verbs are gendered and we do not know the knocker's gender, so the caption
       under their name is a VERBAL NOUN («طلب العودة…») rather than «يريد»/«تريد».
       `engine.knockLabel` may use a verb — its subject there is «شخص ما», which is
       grammatically masculine whoever the person turns out to be — so the rule is
       deliberately scoped to the one string that renders beside a real name. */
    for (const gendered of ["يريد", "تريد", "يطلب", "تطلب"]) {
      expect(ENGINE["engine.knockWants"].ar).not.toContain(gendered);
    }
    expect(ENGINE["engine.knockWants"].ar).toContain("طلب");
    // The label, whose subject is "someone", is where the verb legitimately lives.
    expect(ENGINE["engine.knockLabel"].ar).toContain("شخص ما");
  });

  it("this module keeps its OWN Approve, rather than borrowing the sign-in one", () => {
    /* Admitting a PERSON to a live call and approving a DEVICE sign-in are different acts
       on different screens. One shared key means a copy edit to either silently rewrites
       the other; the Arabic being the same word today is fine and not the point. */
    expect(ENGINE).toHaveProperty("engine.approve");
    expect(LIVE).toMatch(/t\("engine\.approve"\)/);
    expect(LIVE).not.toMatch(/t\("auth\.approve"\)/);
  });

  it("the copy the owner reviewed still reaches this screen", () => {
    /* `copyOnScreen` asks the property these pins always stood for — this sentence is on
       this screen — satisfied by the literal OR by a key whose English half carries it.
       Strictly stronger than the literal it replaces, because reaching the dictionary
       also proves an Arabic half exists. */
    for (const line of [
      "Reconnecting to your call",
      "You were in an active call.",
      "Exit the call",
      "wants to rejoin the call",
      "Minimize",
      "Fit the whole video on screen",
      "Maximize the call back to full screen",
      "Approve",
      "Decline",
    ]) {
      expect(copyOnScreen(LIVE, line), `"${line}" no longer reaches the call chrome`).toBe(true);
    }
  });
});

describe("direction: logical where it is reading order, physical where it is not", () => {
  it("reading-order spacing is logical", () => {
    expect(LIVE).not.toMatch(/\b-?(?:pl|pr|ml|mr)-/);
    expect(LIVE).not.toMatch(/\btext-(?:left|right)\b/);
    // The one site that had it: the mini window's controls sit at the row's TRAILING
    // edge, which must swap sides in Arabic.
    expect(JSX).toMatch(/className="ms-auto flex items-center gap-1"/);
  });

  it("the idle engine host parks off the INLINE-START edge, not the physical left", () => {
    /* A correctness fix, not tidiness. Scrollable overflow never extends past a scroll
       container's inline-start edge — but `left` is that edge only in LTR. In Arabic
       `left` is the inline-END side, where a box 10,000px out IS reachable: a horizontal
       scrollbar on every screen this provider renders on. */
    expect(JSX).toContain("-start-[10000px]");
    expect(JSX).not.toContain("-left-[10000px]");
  });

  it("CENTRING stays physical — the logical form would push it off-centre", () => {
    /* `left-1/2` + `-translate-x-1/2` and `inset-x-0` + `mx-auto` are direction
       INDEPENDENT. Both halves are pinned together, so a half-conversion (which is what
       a blanket sweep produces) fails rather than silently de-centring a control. */
    expect(JSX).toMatch(/fixed top-16 left-1\/2 z-\[70\] flex -translate-x-1\/2/);
    expect(JSX).toMatch(/fixed inset-x-0 top-4 z-\[85\] mx-auto/);
    expect(JSX, "a `start-1/2` centre is not a centre").not.toMatch(/\bstart-1\/2\b/);
  });

  it("the mini window's anchor stays physical BECAUSE its clamp is physical arithmetic", () => {
    /* Pinned as the PAIR rather than as a literal: `x` runs from 0 at the right edge down
       to `-(vw - 120)`. Flip the anchor to `insetInlineEnd` without flipping that
       arithmetic and in Arabic the box drags straight off the screen and never comes
       back. Whoever changes one of these has to change the other. */
    expect(LIVE).toMatch(/right: 14,/);
    expect(LIVE).toMatch(/Math\.max\(-\(vw - 120\)/);
    expect(LIVE).not.toMatch(/insetInline(?:Start|End)/);
    /* And the clamp still measures in the POINTER's own unit (v2.106.86) — an unzoomed
       `window.innerWidth` here let the window be dragged past the edge at Large text. */
    expect(LIVE).toMatch(/document\.documentElement\.clientWidth/);
  });
});
