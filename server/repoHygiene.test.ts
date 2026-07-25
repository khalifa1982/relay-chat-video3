import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.99.46 — a tripwire for the failure that put a broken commit on `main`.
 *
 * v2.99.49 shipped with unresolved merge-conflict markers in three files. The
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
