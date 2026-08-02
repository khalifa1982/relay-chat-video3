/**
 * THE IMPERATIVE CALL SURFACE SPEAKS ARABIC, AND CANNOT SILENTLY STOP.
 *
 * The owner asked three times for the whole app to speak Arabic — "map everything on
 * the web app to Arabic", "the system will switch completely", "make sure that
 * whatever changes you make impact both languages". An audit found the sweep had
 * landed on the tab chrome and stopped: `dict/calls.ts` shipped as
 * `export const CALLS = {}` while being imported and spread into `dict/index.ts`, so
 * it read as a wired surface and contributed nothing — the "published value nothing
 * consumes" antipattern this repo retired `--relay-zoom` for.
 *
 * `dict/engine.ts` had recorded the reason as "a real remaining gap, not an
 * oversight: the engine writes raw DOM from plain functions, so it cannot call a hook
 * and none of its copy is reachable from this dictionary." Right about the
 * CONSTRAINT, wrong about the conclusion — a plain function cannot call a hook, but
 * it does not have to. The translator is injected at the one boundary where React
 * meets the engine.
 *
 * ── WHY THESE ASSERTIONS AND NOT A LIST OF STRINGS ───────────────────────────────
 * A test naming today's forty labels would go green the day somebody adds the
 * forty-first in English. Every rule below is therefore a SWEEP over the markup, so
 * the control added NEXT is covered rather than exempt. That is the durable half of
 * this fix: the audit's sharpest finding was not any single English string, it was
 * that "new work is still arriving in English after the foundation shipped", and a
 * backlog fixed without fixing the habit regrows.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALL_DICT } from "./dict/index";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const ASSETS = read("client/src/lib/relayAssets.ts");
const ENGINE_TSX = read("client/src/app/RelayEngine.tsx");

/** Just the MARKUP half — the CSS below it legitimately contains none of this. */
const MARKUP = ASSETS.slice(0, ASSETS.indexOf("export const RELAY_CSS"));

const KEYS = new Set(Object.keys(ALL_DICT));

function annotations(attr: string): string[] {
  return [...MARKUP.matchAll(new RegExp(`${attr}="([^"]+)"`, "g"))].map((m) => m[1]);
}
const ALL_ATTRS = ["data-i18n", "data-i18n-aria", "data-i18n-title", "data-i18n-placeholder", "data-i18n-msg"];

describe("the engine markup is annotated with real keys", () => {
  it("every data-i18n* value names a key that exists", () => {
    /* THE CHECK THE TYPE SYSTEM CANNOT DO. These keys live inside a template
       literal, so TypeScript sees only a string — which is exactly why
       `applyEngineLabels` takes a plain `string` and the cast happens at the
       boundary in RelayEngine.tsx with this test named as its safety argument.
       A typo here would leave the control English forever with nothing failing. */
    const bad: string[] = [];
    for (const attr of ALL_ATTRS) {
      for (const key of annotations(attr)) if (!KEYS.has(key)) bad.push(`${attr}="${key}"`);
    }
    expect(bad, "annotations naming a key that does not exist").toEqual([]);
  });

  it("the sweep is not vacuous — the bar really is annotated", () => {
    /* A regex that matches nothing passes the rule above trivially. This is the
       companion that stops it reporting safety over an unannotated file. */
    expect(annotations("data-i18n").length).toBeGreaterThan(30);
    expect(annotations("data-i18n-aria").length).toBeGreaterThan(5);
    expect(annotations("data-i18n-title").length).toBeGreaterThan(15);
  });

  it("every annotated key is a calls.* key", () => {
    /* One surface, one module. Reaching into another screen's dictionary is how two
       surfaces come to share a word that must differ between them — the reason this
       repo keeps one module per surface at all. */
    const foreign = ALL_ATTRS.flatMap(annotations).filter((k) => !k.startsWith("calls."));
    expect(foreign, "engine markup borrowing another surface's keys").toEqual([]);
  });
});

describe("the markup keeps its English, so a failure degrades rather than blanks", () => {
  it("each annotated element still carries its English text or attribute", () => {
    /* If `applyEngineLabels` never runs — a mount race, a missing provider, an
       unresolvable key — the bar must read English rather than empty. On a live call
       an UNLABELLED control is far worse than an untranslated one, and this is the
       same fail-soft rule `useLocale` already follows.
       Checked structurally: a `data-i18n` element must have non-empty text between
       its tags, and an attribute annotation must sit beside the attribute it fills. */
    const empties = [...MARKUP.matchAll(/data-i18n="[^"]+"[^>]*>(\s*)</g)].map((m) => m[0]);
    expect(empties, "annotated elements with no English fallback text").toEqual([]);

    for (const [attr, real] of [
      ["data-i18n-aria", "aria-label"],
      ["data-i18n-title", "title"],
      ["data-i18n-placeholder", "placeholder"],
      ["data-i18n-msg", "data-msg"],
    ] as const) {
      for (const m of MARKUP.matchAll(new RegExp(`<[^>]*${attr}="[^"]+"[^>]*>`, "g"))) {
        expect(m[0], `${attr} without a matching ${real} fallback`).toContain(`${real}="`);
      }
    }
  });
});

describe("the applier is wired at the one React/engine boundary", () => {
  it("the mount applies the labels immediately after injecting the markup", () => {
    /* Ordering is the property: applying BEFORE `innerHTML` would find no elements
       and silently do nothing, which is indistinguishable from the bug being fixed. */
    const inject = ENGINE_TSX.indexOf("el.innerHTML = RELAY_MARKUP;");
    const apply = ENGINE_TSX.indexOf("applyEngineLabels(el,");
    expect(inject, "the markup is injected").toBeGreaterThan(-1);
    expect(apply, "the labels are applied").toBeGreaterThan(-1);
    expect(apply, "applied AFTER the markup exists").toBeGreaterThan(inject);
  });

  it("a language change re-labels in place rather than re-rendering the markup", () => {
    /* Re-injecting `RELAY_MARKUP` would destroy a LIVE CALL's DOM, its listeners and
       its media elements. The effect keyed on `t` re-applies over the existing nodes
       instead — and that only works because the applier reads the KEY, never the
       current text, so it is idempotent and reversible. */
    /* Pinned as the PROPERTY, not the adjacency: the re-apply must sit inside an
       effect whose dependency list is exactly `[t]`. An earlier draft required the
       apply call to be the LAST statement before `}, [t]);`, which broke the moment
       a second, legitimate line joined it (handing the engine the new translator) —
       a test frozen on today's arrangement rather than on what it stands for. */
    const effectStart = ENGINE_TSX.indexOf("applyLabelsRef.current(el, tAny)");
    expect(effectStart, "the labels are re-applied somewhere").toBeGreaterThan(-1);
    const close = ENGINE_TSX.indexOf("}, [t]);", effectStart);
    expect(close, "…inside an effect keyed on the translator").toBeGreaterThan(effectStart);
    // and it must NOT re-inject the markup on that path
    const effect = ENGINE_TSX.slice(
      ENGINE_TSX.indexOf("applyLabelsRef.current(el, tAny)") - 400,
      ENGINE_TSX.indexOf("applyLabelsRef.current(el, tAny)") + 80,
    );
    expect(effect, "the language effect must not re-render the engine").not.toMatch(
      /innerHTML\s*=/,
    );
  });

  it("the applier reads the KEY, never the current text", () => {
    /* A version that decided from the existing text would be one-way: it could turn
       English into Arabic once and never back, so a mid-call switch to English would
       leave the bar Arabic. Reading the attribute makes it idempotent by
       construction. */
    const fn = ASSETS.slice(ASSETS.indexOf("export function applyEngineLabels"));
    expect(fn).toMatch(/el\.getAttribute\(attr\)/);
    expect(fn, "never branches on what the element currently says").not.toMatch(
      /textContent\s*===|\.textContent\s*\.\s*trim\(\)\s*===/,
    );
  });

  it("one unresolvable key cannot cost the other labels", () => {
    const fn = ASSETS.slice(ASSETS.indexOf("export function applyEngineLabels"));
    expect(fn, "per-element catch").toMatch(/catch\s*\{/);
    // A key that resolves to itself means the lookup failed; the English must stay.
    expect(fn).toMatch(/value !== key/);
  });
});

describe("the engine's asset module stays free of the React tree", () => {
  it("relayAssets imports no i18n and no React", () => {
    /* The engine is mounted by a dynamic import specifically to keep it out of the
       entry chunk, and it runs in contexts with no provider above it. Reaching for
       `useT` here would be both a hook violation and a bundling regression — the
       translator is HANDED to it instead. */
    const imports = [...ASSETS.matchAll(/^import .*$/gm)].map((m) => m[0]).join("\n");
    expect(imports).not.toMatch(/from "react"|\.\/i18n|app\/i18n/);
  });
});

describe("the backtick trap, which bit again in this very change", () => {
  /**
   * Where does the literal opened by `decl` actually END? — the first UNESCAPED
   * backtick after it. That is the whole point: if a stray backtick in a comment
   * terminates the string early, this returns THAT position, and the caller can see
   * the literal stopped somewhere it should not have.
   *
   * Asking "does the literal contain a backtick" cannot work, because a terminated
   * literal simply ends before the offending character — which is exactly why the
   * pre-existing guard in `relayAssets.test.ts`, which inspects the PARSED
   * `RELAY_CSS` VALUE, has never once reported this trap in four occurrences. A
   * parsed value can never contain the character that ended it.
   */
  function literalEnd(decl: string): { start: number; end: number } {
    const start = ASSETS.indexOf(decl) + decl.length;
    expect(start, `found ${decl}`).toBeGreaterThan(decl.length - 1);
    for (let i = start; i < ASSETS.length; i++) {
      if (ASSETS[i] === "\\") {
        i++;
        continue;
      }
      if (ASSETS[i] === "`") return { start, end: i };
    }
    throw new Error(`${decl} is never terminated`);
  }

  it("RELAY_MARKUP ends where it is meant to, not at a stray backtick", () => {
    /* CLAUDE.md records this at v2.99.16, v2.99.82, v2.105.24 and v2.106.6 — and it
       bit a FIFTH time while writing this file, in an HTML comment inside the markup
       half, surfacing as a syntax error 300 lines away. The existing guard covers
       only the CSS half and, as above, structurally could not have caught it.
       The property is that the literal's terminator is immediately followed by `;`
       and then the next export — i.e. nothing ended it early. */
    const { end } = literalEnd("export const RELAY_MARKUP = `");
    expect(
      ASSETS.slice(end, ASSETS.indexOf("export const RELAY_CSS")).trim(),
      "RELAY_MARKUP terminated early — a stray backtick inside it",
    ).toBe("`;");
  });

  it("RELAY_CSS ends at the end of the file, not at a stray backtick", () => {
    const { end } = literalEnd("export const RELAY_CSS = `");
    const after = ASSETS.slice(end).trim();
    expect(after.startsWith("`;"), "RELAY_CSS terminated early").toBe(true);
    /* Whatever follows must be the applier and its table — real code — rather than
       the tail of a string that got away. Asserted so an early termination that
       happened to land near the end is still caught. */
    expect(after, "the applier follows the CSS").toContain("export function applyEngineLabels");
  });
});
