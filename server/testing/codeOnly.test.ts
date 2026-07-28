import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "./codeOnly";

const R = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * v2.105.6 — the shared comment stripper, and the bug that made eight test files
 * assert about nothing.
 *
 * Fourteen test files carried a copy of this, all with the same block-comment regex:
 * `/\/\*[\s\S]*?\*\//g`. That reads the `/*` in `accept="image/*,video/*,audio/*"`
 * as a comment opener, so on Status.tsx it swallowed 7,015 characters — the whole
 * media-picker section and everything up to the next real divider comment. Every
 * `not.toMatch` landing inside that region passed because the CODE was gone.
 *
 * Tested behaviourally against the real files, because the whole point is what it
 * does to sources that actually exist in this repo.
 */
describe("codeOnly", () => {
  it("does NOT treat a mime-type wildcard as a comment opener", () => {
    // The exact string that caused the bug.
    const src = 'const a = 1;\n<input accept="image/*,video/*,audio/*" />\nconst b = 2;';
    const out = codeOnly(src);
    expect(out).toContain('accept="image/*,video/*,audio/*"');
    expect(out).toContain("const b = 2;");
  });

  it("keeps every line of Status.tsx that follows its file input", () => {
    const out = codeOnly(R("client/src/pages/app/Status.tsx"));
    expect(out).toContain('accept="image/*');
    // Markup that sits AFTER the input, i.e. inside the region the old rule ate.
    expect(out).toContain("myGroups.length > 0 && (");
    expect(out).toContain("{audiencePickerApplies ? (");
  });

  it("keeps every line of Messages.tsx that follows its file input", () => {
    const out = codeOnly(R("client/src/pages/app/Messages.tsx"));
    expect(out).toContain('accept="image/*');
    // Markup from the very END of the file — a stray `/*` anywhere earlier would
    // swallow it, which is precisely how the old rule failed.
    expect(out).toContain("{c.number.slice(0, 3)}-{c.number.slice(3)}");
  });

  it("still removes the prose it exists to remove", () => {
    const src = [
      "const a = 1;",
      "// a line comment mentioning forbiddenThing",
      "/* a block comment mentioning forbiddenThing */",
      "const b = 2; /* trailing mentioning forbiddenThing */",
      "{/* a JSX span mentioning forbiddenThing */}",
    ].join("\n");
    const out = codeOnly(src);
    expect(out).not.toContain("forbiddenThing");
    expect(out).toContain("const a = 1;");
    expect(out).toContain("const b = 2;");
  });

  it("collapses a JSX comment span to `{}` so the surrounding JSX still parses", () => {
    const out = codeOnly("<div>\n  {/* note */}\n  <span/>\n</div>");
    expect(out).toContain("{}");
    expect(out).toContain("<span/>");
  });

  it("errs toward KEEPING text rather than dropping it", () => {
    /* THE DIRECTION MATTERS. Failing to strip a real comment makes an assertion
       STRICTER — it may fail on prose, which is loud and gets fixed. Wrongly
       stripping code makes it VACUOUS — it passes for the wrong reason, silently,
       which is the bug this file records. So a `/` that could be division is left
       alone even at the cost of keeping an unusual comment. */
    const out = codeOnly("const r = total/*half*/;");
    expect(out).toContain("total");
    // Not stripped, because `l` cannot precede a comment — and that is the safe
    // failure: the text stays, so nothing passes for the wrong reason.
    expect(out).toContain("half");
  });

  it("drops the remainder of an unterminated block comment, like a parser would", () => {
    const out = codeOnly("const a = 1;\n/* never closed\nconst b = 2;");
    expect(out).toContain("const a = 1;");
    expect(out).not.toContain("const b = 2;");
  });
});
