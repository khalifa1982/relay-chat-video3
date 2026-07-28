/**
 * Strip comments from a source file before asserting about its CODE.
 *
 * WHY THIS EXISTS
 * ---------------
 * This repo has matched its own prose at least fourteen times: a `not.toMatch`
 * forbidding a pattern happily matches the COMMENT that explains why the pattern is
 * absent, so the assertion passes on English rather than on behaviour. Every test
 * that forbids something in a source file therefore strips comments first.
 *
 * WHY IT IS SHARED RATHER THAN COPIED (v2.105.6)
 * ----------------------------------------------
 * It was copied into fourteen test files, and the copies had a bug. The block-comment
 * stripper was `/\/\*[\s\S]*?\*\//g`, which treats the `/*` in
 * `accept="image/*,video/*,audio/*"` as a comment opener — so on `Status.tsx` it ate
 * **7,015 characters**, through the whole media-picker section and out to the next
 * real `/* … *\/` divider comment. Eight test files read a source containing that
 * attribute, and every `not.toMatch` of theirs landing in the swallowed region was
 * VACUOUS: it passed because the code was gone, not because the pattern was.
 *
 * That is the v2.102.1 defect in a second place — there the JSX-comment strip
 * swallowed a documented prop block, cutting 5,412 characters to 1,084 — and it was
 * fixed by hand in eleven files. One shared implementation is the fix that does not
 * come back.
 *
 * THE RULE, AND WHICH WAY IT ERRS
 * -------------------------------
 * A block comment's `/*` is only treated as one when it sits where a comment can
 * legally begin: at the start of the input, or after whitespace or a character that
 * cannot end an expression. `image/*` has `e` before the slash, so it is left alone.
 *
 * This deliberately errs toward NOT stripping. Failing to strip a real comment makes
 * an assertion STRICTER — it may fail on prose, which is loud and gets fixed. Wrongly
 * stripping code makes an assertion VACUOUS — it passes for the wrong reason, which
 * is silent and is exactly the bug above. When in doubt, keep the text.
 */

/** Characters after which a `/` can only begin a comment or a regex, never a division. */
const COMMENT_MAY_START_AFTER = "\n\r\t (){}[],;=:>?&|!+-*<~%^";

/**
 * Remove JSX comment spans, block comments and whole-line `//` comments.
 *
 * A JSX `{/* … *\/}` span collapses to `{}` rather than vanishing, so the surrounding
 * JSX still parses as the shape a test expects to see.
 */
export function codeOnly(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "/" && src[i + 1] === "*" && commentMayStartAt(src, i)) {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) break; // unterminated — drop the rest, as a real parser would
      // A JSX span `{ /* … */ }` collapses to `{}`; a bare block comment vanishes.
      const openBrace = /\{\s*$/.exec(out);
      const after = /^\s*\}/.exec(src.slice(end + 2));
      if (openBrace && after) {
        out = out.slice(0, out.length - openBrace[0].length) + "{}";
        i = end + 2 + after[0].length;
        continue;
      }
      i = end + 2;
      continue;
    }
    out += src[i];
    i += 1;
  }
  return out
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

function commentMayStartAt(src: string, at: number): boolean {
  if (at === 0) return true;
  return COMMENT_MAY_START_AFTER.includes(src[at - 1]);
}
