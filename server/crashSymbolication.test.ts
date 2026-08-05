/**
 * CRASH SYMBOLICATION, PROVEN END TO END (v2.107.43).
 *
 * The whole machine shipped in v2.107.28 — hidden sourcemaps, a static server
 * that refuses `.map` over HTTP, a hand-rolled VLQ decoder, and a call in
 * `recordCrash` that appends the decoded block after the fingerprint. But it
 * had NO test, so its correctness was a matter of faith: a minified crash frame
 * like `index-CTcS1510.js:2:74599` either becomes `floating-ui.dom.mjs:758:37`
 * or it doesn't, and nothing in CI ever checked which. When the owner asked to
 * "make future crashes readable," the honest finding was that the code was
 * already there — and the real gap was this file.
 *
 * Two things nearly hid a silent no-op during that investigation, and both are
 * pinned below:
 *   1. `distDir()` keyed on `NODE_ENV`, so a wrong/unset value pointed map
 *      reads at a directory with no assets and every frame resolved to null —
 *      symbolication OFF, no error. It now probes both candidate paths.
 *   2. The first mapped line of a Vite bundle is line 2 (line 1 is the banner,
 *      its mapping group empty), and real columns run into the tens of
 *      thousands — so a naive test frame at `1:20` resolves to nothing and
 *      looks like a decoder bug. The proof below reads a REAL (line, column)
 *      out of the actual map.
 *
 * This test builds nothing itself; it runs only when a client build is present
 * (the maps in `dist/public/assets`), and self-skips otherwise so it never
 * fails a server-only checkout — while `vitest run` after a build, and every
 * deploy's build, exercises it for real.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { decodeCrashStack } from "./crashDecode";

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist", "public");
const ASSETS = path.join(DIST, "assets");

const built =
  fs.existsSync(path.join(DIST, "index.html")) && fs.existsSync(ASSETS);

/** Base64-VLQ first field (genColumn) of a mapping segment. */
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const IDX: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) IDX[B64[i]] = i;
function firstField(seg: string): number {
  let val = 0;
  let shift = 0;
  for (const ch of seg) {
    const d = IDX[ch];
    val += (d & 31) << shift;
    if (d & 32) shift += 5;
    else return val & 1 ? -(val >>> 1) : val >>> 1;
  }
  return 0;
}

describe.runIf(built)("crash symbolication (needs a client build)", () => {
  // NODE_ENV=development so the module's distDir points at dist/public here in
  // the tsx runner — mirrors how it resolves in the bundled server, and the
  // whole point of the v2.107.43 hardening is that a WRONG value still works.
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";

  const indexJs = built
    ? (fs.readFileSync(path.join(DIST, "index.html"), "utf8").match(/assets\/(index-[\w-]+\.js)/) ?? [])[1]
    : undefined;

  it("the live index bundle has a hidden map beside it (never served)", () => {
    expect(indexJs, "index bundle name").toBeTruthy();
    expect(fs.existsSync(path.join(ASSETS, indexJs + ".map"))).toBe(true);
    // HIDDEN: the JS must NOT point browsers at the map.
    const js = fs.readFileSync(path.join(ASSETS, indexJs!), "utf8");
    expect(js).not.toMatch(/sourceMappingURL/);
  });

  it("a REAL minified frame resolves to an original source:line", () => {
    const map = JSON.parse(fs.readFileSync(path.join(ASSETS, indexJs + ".map"), "utf8")) as {
      mappings: string;
    };
    // Line 2 is the first line with segments; walk its running genColumn and
    // pick one from the middle so the decoder's binary search lands mid-array.
    const line2 = map.mappings.split(";")[1].split(",").filter(Boolean);
    let g = 0;
    const cols: number[] = [];
    for (const seg of line2) {
      g += firstField(seg);
      cols.push(g);
    }
    const realCol = cols[Math.floor(cols.length / 2)] + 1; // stacks are 1-based
    const stack = `Error: boom\n    at fn (https://your-chat.io/assets/${indexJs}:2:${realCol})`;

    const decoded = decodeCrashStack(stack);
    expect(decoded, "a real frame must resolve").toBeTruthy();
    expect(decoded).toMatch(/── decoded ──/);
    // The resolved frame names a real source file with a line number — the
    // whole point: a human-readable location instead of index-XXXX.js:2:74599.
    expect(decoded).toMatch(/at [\w./@+-]+\.(?:ts|tsx|mjs|js):\d+:\d+/);
  });

  it("a frame for a bundle we have NO map for resolves to a marked miss, not a throw", () => {
    const stack =
      "Error\n    at x (https://your-chat.io/assets/index-DEADBEEF.js:2:100)";
    // No map on disk → the frame is emitted as an explicit '?', and the block
    // is null because nothing actually resolved (hits === 0).
    expect(decodeCrashStack(stack)).toBeNull();
  });

  it("a stack with no /assets/ frames at all is null (nothing to do)", () => {
    expect(decodeCrashStack("Error: x\n    at <anonymous>")).toBeNull();
  });

  // restore
  process.env.NODE_ENV = prevEnv;
});

describe("the hardening that keeps it from silently switching off", () => {
  it("distDir probes BOTH candidate paths rather than trusting NODE_ENV", () => {
    const src = fs.readFileSync(path.join(ROOT, "server", "crashDecode.ts"), "utf8");
    expect(src).toMatch(/const bundled = path\.resolve\(import\.meta\.dirname, "public"\)/);
    expect(src).toMatch(/const dev = path\.resolve\(import\.meta\.dirname, "\.\.", "dist", "public"\)/);
    expect(src).toMatch(/if \(fs\.existsSync\(path\.join\(primary, "assets"\)\)\) return primary/);
    expect(src).toMatch(/if \(fs\.existsSync\(path\.join\(secondary, "assets"\)\)\) return secondary/);
  });

  it("recordCrash still appends the decoded block AFTER the fingerprint", () => {
    // Grouping must not shift because a stack became readable — the decode is
    // additive, taken after crashFingerprint. (The v2.107.28 contract, pinned
    // so a refactor can't reorder it.)
    const v2db = fs.readFileSync(path.join(ROOT, "server", "v2db.ts"), "utf8");
    const fpAt = v2db.indexOf("const fp = crashFingerprint(");
    const decAt = v2db.indexOf("decodeCrashStack(stack)");
    expect(fpAt).toBeGreaterThan(-1);
    expect(decAt).toBeGreaterThan(fpAt);
  });
});
