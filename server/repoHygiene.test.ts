import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "./testing/codeOnly";

/**
 * v2.99.46 — a tripwire for the failure that put a broken commit on `main`.
 *
 * v2.99.45 shipped with unresolved merge-conflict markers in three files. The
 * typecheck caught the two `.ts` ones, but the pre-push verification chain
 * piped `pnpm check` into `tail`, so the pipeline's exit status came from
 * `tail` (always 0) and the `&&` chain sailed past a failing gate. `CLAUDE.md`
 * would not have been caught by ANY gate — markdown is not compiled.
 *
 * Two guards came out of that: `pnpm verify` (one script, nothing to pipe) and
 * this test, which fails the SUITE on a stray marker in any tracked text file.
 * The suite is the one gate every workflow runs, so a marker can no longer
 * reach a deploy through a docs file or an untypechecked corner of the tree.
 */
const ROOT = path.resolve(__dirname, "..");

/** Built by concatenation so this file does not itself contain a marker. */
const OPEN = "<".repeat(7) + " ";
const CLOSE = ">".repeat(7) + " ";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".pnpm-store",
  "android",
  "ios",
  "Pods",
]);

const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".css",
  ".html",
  ".yml",
  ".yaml",
  ".sql",
  ".sh",
  ".kt",
  ".java",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile() && TEXT_EXT.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

describe("repo hygiene — no unresolved merge-conflict markers", () => {
  const files = walk(ROOT);

  it("finds a non-trivial number of text files to scan (the walker itself works)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith("CLAUDE.md"))).toBe(true);
    expect(files.some((f) => f.endsWith(path.join("shared", "version.ts")))).toBe(true);
  });

  it("no tracked text file carries a conflict marker", () => {
    const hits: string[] = [];
    for (const file of files) {
      if (file === __filename) continue; // this file names the markers on purpose
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (line.startsWith(OPEN) || line.startsWith(CLOSE)) {
          hits.push(`${path.relative(ROOT, file)}:${i + 1}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it("no test resolves the repo root from a hardcoded ABSOLUTE path", () => {
    /* A test that reads its sources from a literal sandbox path passes on the machine it
       was written on and can NEVER pass in CI, where the checkout lives under
       `/home/runner/work/…` — so `pnpm verify` goes green locally and the runner fails
       with an ENOENT that has nothing to do with the change under review. That happened
       once (v2.106.60, `client/src/app/swipeRowBehaviour.test.ts`), and the local gate is
       structurally unable to catch it, which is exactly what a standing sweep is for.

       The rule is only about the ROOT: an absolute path built from `__dirname` is fine,
       and so is one a test constructs for a temp file. What is forbidden is a literal
       pointing into somebody's working copy.

       SCOPED TO A ROOT THAT IS READ FROM, and both halves of that were learned by this
       sweep flagging correct code on its first run:
         - it matched its OWN comment quoting the bad path (the prose trap this repo has
           recorded fifteen times), so it runs on comment-stripped source; and
         - it flagged `server/voipDeploy.test.ts` asserting `/home/relay/.env`, which is
           the app's real location on the production fleet and exactly what that test is
           for. An absolute literal is only a defect when it is the base a test READS
           repo sources through — a path asserted as a string is data, not a root. */
    const READS_FROM = /(?:readFileSync|readdirSync|existsSync|statSync|readFile)\s*\(\s*$/;
    const IS_A_ROOT = /\b(?:ROOT|REPO|REPO_ROOT|BASE|BASE_DIR|SRC|SRC_DIR|PROJECT|DIR)\w*\s*=\s*$/;
    const hits: string[] = [];
    for (const file of files) {
      if (!/\.test\.[cm]?tsx?$/.test(file)) continue;
      if (file === __filename) continue; // this file names the shapes on purpose
      const src = codeOnly(fs.readFileSync(file, "utf8"));
      for (const m of src.matchAll(/["'`](\/(?:home|Users|root|workspace)\/[^"'`\n]*)["'`]/g)) {
        const before = src.slice(Math.max(0, m.index - 60), m.index);
        if (!READS_FROM.test(before) && !IS_A_ROOT.test(before)) continue;
        hits.push(`${path.relative(ROOT, file)} → ${m[1]}`);
      }
    }
    expect(
      hits,
      "resolve the repo root from __dirname (see server/swipeActions.test.ts) — a literal " +
        "working-copy path cannot exist on the CI runner",
    ).toEqual([]);
  });

  it("that sweep really looks at the test files (a vacuous walk passes for the wrong reason)", () => {
    const tests = files.filter((f) => /\.test\.[cm]?tsx?$/.test(f));
    expect(tests.length).toBeGreaterThan(200);
    expect(tests.some((f) => f.endsWith(path.join("server", "swipeActions.test.ts")))).toBe(true);
    expect(tests.some((f) => f.endsWith(path.join("client", "src", "app", "swipeRowBehaviour.test.ts")))).toBe(true);
  });
});

describe("pnpm verify — a single gate with no pipe to swallow its exit code", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  it("exists and chains all three gates", () => {
    const v = pkg.scripts.verify;
    expect(v).toBeTruthy();
    for (const gate of ["check", "test", "build"]) {
      expect(v).toContain(gate);
    }
  });

  it("pipes nothing — a pipeline's status is the LAST command's, which hides a failing gate", () => {
    expect(pkg.scripts.verify).not.toContain("|");
  });
});
