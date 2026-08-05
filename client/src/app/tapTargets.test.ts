/**
 * TAP-TARGET SWEEP — RULE 9, APP-WIDE (v2.107.42).
 *
 * The board's rule 9: every tap target on a 390×812 phone is at least 44px.
 * The audit that produced this found fourteen buttons under it — two 32px
 * mobile back chevrons (primary navigation!), the entire reaction strip,
 * a biometric toggle, a mini send, and a scatter of dismiss ✕s. Two answers,
 * both held here: where a control had ROOM it was simply made 44px (the
 * backs); where small is the DESIGN — an ✕ drawn at 44px stops being an ✕ —
 * the `.rhit` halo satisfies the rule in hit-testing instead of paint (an
 * invisible centred ::after never smaller than 44×44; see index.css).
 *
 * The sweep below re-runs the audit on every test run: any `<button>` whose
 * own classes imply a small box, without `rhit` and without any big-box
 * class, fails the build with its file and line. The heuristic reads the
 * button's OWN class string, so a small-looking button inside a padded parent
 * can false-positive — the correct response is `rhit` (free) or a listed
 * exemption with a reason, never loosening the detector.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const BIG =
  /(min-h-\[4[4-9]|min-h-1[12]\b|\bh-1[123]\b|\bsize-1[123]\b|min-w-\[4[4-9]|min-w-1[12]\b|py-2\.5|py-3|p-2\.5|p-3\b|p-4\b|rcta|\brhit\b|h-\[4[4-9]|size-\[4[4-9]|size-\[(?:[5-9]\d|1\d\d)px\])/;
const SMALL = /(\bsize-[4-8]\b|\bh-[4-8]\b|\bp-0\.5\b|\bp-1\b|\bp-1\.5\b|\bp-2\b(?!\.5))/;

/** Physical-on-purpose small buttons would be listed here, with reasons. Empty today. */
const ALLOW: Array<{ file: string; line: number; why: string }> = [];

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== "ui" && e !== "node_modules") yield* walk(p);
    } else if (p.endsWith(".tsx") && !p.includes(".test.")) yield p;
  }
}

type Hit = { file: string; line: number; cls: string };
function sweep(): Hit[] {
  const hits: Hit[] = [];
  for (const root of ["client/src/pages", "client/src/app"]) {
    for (const f of walk(resolve(ROOT, root))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/<button\b[^>]*?>/gs)) {
        const cls = [...m[0].matchAll(/"([^"]*)"/g)].map((x) => x[1]).join(" ");
        if (SMALL.test(cls) && !BIG.test(cls)) {
          hits.push({
            file: relative(ROOT, f),
            line: src.slice(0, m.index!).split("\n").length,
            cls: cls.replace(/\s+/g, " ").slice(0, 100),
          });
        }
      }
    }
  }
  return hits;
}

describe("rule 9 sweep", () => {
  it("the harness reads a real app and the detector bites", () => {
    let n = 0;
    for (const root of ["client/src/pages", "client/src/app"]) for (const _ of walk(resolve(ROOT, root))) n++;
    expect(n).toBeGreaterThan(40);
    expect(SMALL.test('grid size-7 place-items-center')).toBe(true);
    expect(BIG.test('rhit grid size-7 place-items-center')).toBe(true);
    expect(BIG.test('grid size-11 place-items-center')).toBe(true);
    expect(BIG.test('size-[70px] p-2')).toBe(true); // the QR tile shape — big by pixels
  });

  it("every small-box button is haloed, upsized, or explained", () => {
    const bad = sweep().filter(
      (h) => !ALLOW.some((a) => h.file.endsWith(a.file) && a.line === h.line),
    );
    expect(
      bad,
      "buttons under rule 9 with no halo and no reason:\n" +
        bad.map((h) => `  ${h.file}:${h.line} :: ${h.cls}`).join("\n"),
    ).toEqual([]);
  });

  it("the two mobile back chevrons were UPSIZED for real, not haloed", () => {
    const src = readFileSync(resolve(ROOT, "client/src/pages/app/Messages.tsx"), "utf8");
    expect(src).toMatch(/grid size-11 shrink-0 place-items-center md:hidden/);
    expect(src).toMatch(/md:hidden grid place-items-center size-11 shrink-0/);
  });

  it("the halo's contract: invisible, centred, never under 44×44", () => {
    const css = readFileSync(resolve(ROOT, "client/src/index.css"), "utf8");
    expect(css).toMatch(/\.rhit::after \{/);
    expect(css).toMatch(/width: max\(100%, 44px\);/);
    expect(css).toMatch(/height: max\(100%, 44px\);/);
  });
});
