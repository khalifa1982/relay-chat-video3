/**
 * RTL SPACING SWEEP — THE WHOLE APP (v2.107.40).
 *
 * `rtl-contacts.test.ts` swept ONE file and closed with: "Propagating this
 * widening to them is the orchestrator's call — they are not this task's
 * files." This file is that call. Same comment-stripped source, same widened
 * detector (the one that catches `ml-auto`, exempts `left-1/2` centring, and
 * refuses to read `rounded-lg` as `rounded-l`), pointed at every page and app
 * component instead of one.
 *
 * The sweep that produced it converted eleven sites in nine files — six
 * `text-left` rows, the desktop sidebar's `border-r`, eight avatar-corner
 * badges, and the message bubbles' TAILS (`rounded-br/bl` → `rounded-ee/es`:
 * a tail marks the SPEAKER'S side, and in Arabic own bubbles sit on the left,
 * so the physical corners pointed at the wrong person). What remains physical
 * remains ON PURPOSE, each entry below carrying its reason — and the allowlist
 * is checked ALIVE, so a site that later gets fixed must be removed from it
 * rather than rot into a hole the next offender hides in.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

const ROOT = resolve(__dirname, "../../..");

/** Same detector as the Contacts sweep — see that file for every design note. */
const PHYSICAL = new RegExp(
  "(?:^|[\\s\"'`{(+])" +
    "(-?(?:pl|pr|ml|mr|border-l|border-r|rounded-l|rounded-r|space-x|divide-x|scroll-pl|scroll-pr)-(?:\\[[^\\]]*\\]|[0-9][0-9a-z./]*|auto|px|full)" +
    "|-?(?:left|right)-(?:\\[[^\\]]*\\]|[0-9][0-9a-z.]*|auto|px|full)" +
    "|text-left|text-right" +
    "|origin-left|origin-right)" +
    "(?![-a-zA-Z0-9/])",
  "g",
);

/**
 * The physical-on-purpose survivors. `file` is a suffix, `token` the exact
 * class; a hit matching a row is permitted, everything else fails the sweep.
 */
const ALLOW: Array<{ file: string; token: string; why: string }> = [
  {
    file: "app/TopBar.tsx",
    token: "-left-10",
    why:
      "the brand sheen: a light-pass DECORATION whose keyframes travel physically " +
      "left→right. Light direction is aesthetic, not reading order — and a lone " +
      "`-start-10` under physical keyframes would half-mirror it into nonsense.",
  },
  {
    file: "app/VideoRecordSheet.tsx",
    token: "origin-right",
    why:
      "logical BY HAND: `transform-origin` has no start/end form, so the code " +
      "branches on `rtl` itself (its own essay: 'origin-left grows a " +
      "right-to-left screen backwards').",
  },
  {
    file: "app/VideoRecordSheet.tsx",
    token: "origin-left",
    why: "the LTR arm of the same hand-rolled logical pair.",
  },
  {
    file: "app/VoicemailPrompt.tsx",
    token: "origin-right",
    why: "same hand-rolled `rtl ? origin-right : origin-left` progress fill.",
  },
  {
    file: "app/VoicemailPrompt.tsx",
    token: "origin-left",
    why: "the LTR arm of the same pair.",
  },
];

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      // `ui/` is vendored shadcn primitives — not this app's prose to edit.
      if (e !== "ui" && e !== "node_modules") yield* walk(p);
    } else if (p.endsWith(".tsx") && !p.includes(".test.")) yield p;
  }
}

const FILES = [
  ...walk(resolve(ROOT, "client/src/pages")),
  ...walk(resolve(ROOT, "client/src/app")),
  ...walk(resolve(ROOT, "client/src/components")),
];

type Hit = { file: string; token: string };
const hits: Hit[] = [];
for (const f of FILES) {
  const rel = relative(ROOT, f);
  const code = codeOnly(readFileSync(f, "utf8"));
  for (const m of code.matchAll(PHYSICAL)) hits.push({ file: rel, token: m[1] });
}

describe("app-wide RTL sweep", () => {
  it("the harness walks a real app and the detector actually bites", () => {
    expect(FILES.length).toBeGreaterThan(40);
    expect(physical('className="h-11 pl-10 rounded-xl"')).toEqual(["pl-10"]);
    expect(physical('className="size-4 mr-1.5"')).toEqual(["mr-1.5"]);
    expect(physical('className="ms-auto text-start rounded-lg left-1/2"')).toEqual([]);
    function physical(s: string): string[] {
      return [...s.matchAll(PHYSICAL)].map((m) => m[1]);
    }
  });

  it("every physical utility in the app is on the allowlist, with its reason", () => {
    const unexplained = hits.filter(
      (h) => !ALLOW.some((a) => h.file.endsWith(a.file) && h.token === a.token),
    );
    expect(
      unexplained,
      "physical direction utilities with no recorded reason:\n" +
        unexplained.map((h) => `  ${h.file} → ${h.token}`).join("\n"),
    ).toEqual([]);
  });

  it("the allowlist is ALIVE — a fixed site must be removed, not left to rot", () => {
    for (const a of ALLOW) {
      const alive = hits.some((h) => h.file.endsWith(a.file) && h.token === a.token);
      expect(alive, `${a.file} no longer contains ${a.token} — delete its row`).toBe(true);
    }
  });
});
