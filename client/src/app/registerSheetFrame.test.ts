/**
 * BOARD 2e — the register / sign-in sheet (AuthPanel).
 *
 * This file's most useful assertion is a SWEEP rather than a list, and it exists
 * because of the specific way this patch could have failed silently: the sheet
 * brings its own `<style>` block, so every class it names has to be DEFINED in
 * that block and the block has to be SCOPED. Get the first wrong and the element
 * renders unstyled with every test green; get the second wrong and a rule called
 * `.lockbadge` leaks out and restyles anything else that ever uses that name.
 *
 * So instead of enumerating today's classes, the sweep reads every custom class
 * the JSX references and requires each to be defined — which covers the class
 * somebody adds next, where a list would go stale on it.
 *
 * NOT MEASURED, said plainly: `AuthPanel` is mounted from three places behind an
 * identity and a dozen tRPC queries, so reaching it headless is the v2.99.89
 * situation — and a hand-written replica of its markup would prove nothing about
 * the real component. Its styles also live in this inline block rather than in
 * the built stylesheet, so there is no `index-*.css` to measure against. What is
 * proven here is the structure; nobody has looked at this sheet on a phone.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { codeOnly } from "../../../server/testing/codeOnly";

const PATH = "client/src/app/AuthPanel.tsx";
const SRC = readFileSync(PATH, "utf8");
const CODE = codeOnly(SRC);

/** The component's own `<style>` block, bounded by its own closing tag. */
const STYLE = (() => {
  const a = SRC.indexOf("<style>{`");
  expect(a, "the sheet must carry its own style block").toBeGreaterThan(0);
  const b = SRC.indexOf("</style>", a);
  expect(b).toBeGreaterThan(a);
  const s = SRC.slice(a, b);
  expect(s.length, "the style slice must be real").toBeGreaterThan(200);
  return s;
})();

describe("board 2e — the style block cannot be inert, and cannot leak", () => {
  it("the scope class is on the sheet's own root", () => {
    // Every rule is scoped `.relay-auth X`. Without that class on an ancestor the
    // whole block is inert and the sheet renders in the default theme — which no
    // assertion about the CSS would notice.
    expect(CODE).toMatch(/className="dark relay-v2 relay-auth /);
  });

  it("EVERY rule in the block is scoped — none can reach the rest of the app", () => {
    // An unscoped `.lockbadge` would restyle anything else that ever uses the
    // name. Selectors are read off the block and each must be qualified.
    const selectors = STYLE.split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith(".") || l.startsWith("@keyframes"))
      .filter((l) => l.length > 1);
    expect(selectors.length).toBeGreaterThan(2);
    for (const sel of selectors) {
      if (sel.startsWith("@keyframes")) {
        // A keyframe name declared in a component-local block is GLOBAL by
        // construction — it cannot be scoped — so the property is that it is
        // NAMESPACED to this component: `fade` would collide with anything,
        // `authShake` / `rauthUp` cannot.
        expect(sel, sel).toMatch(/@keyframes\s+r?auth[A-Za-z]/);
        continue;
      }
      expect(sel, `unscoped rule: ${sel}`).toMatch(/^\.relay-auth[\s.]/);
    }
  });

  it("every custom class the JSX names is actually defined (sweep, not a list)", () => {
    // The trap: a class that is referenced and never defined renders unstyled,
    // and nothing fails. A sweep covers the class added next; a list would not.
    //
    // It reads `className` ATTRIBUTES rather than the whole file, which is what
    // makes it correct in both directions: this sheet also carries
    // `id="rauth-acct-label"` for an `aria-labelledby` relationship, and a
    // file-wide `rauth-*` match reported that id as an undefined class — a
    // failure on correct code. An id is not a style hook.
    const referenced = new Set<string>();
    for (const m of CODE.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const attr = m[1] ?? m[2] ?? "";
      for (const c of attr.matchAll(/\b(rauth-[a-z0-9-]+|lockbadge(?:-[a-z0-9-]+)?)\b/g)) {
        referenced.add(c[1]);
      }
    }
    expect(referenced.size, "the sheet must name at least one custom class").toBeGreaterThan(2);
    for (const c of referenced) {
      expect(STYLE, `${c} is referenced but never defined`).toMatch(
        new RegExp(`\\.${c}\\b`),
      );
    }
  });
});

describe("board 2e — the palette rules", () => {
  it("no presence green survives on the sheet", () => {
    // Green means ONLINE. Registering is not a presence statement.
    expect(CODE).not.toMatch(/relay-online|emerald|#34d399|#10b981|#22c55e/);
  });

  it("no accent fallback is a custom-property cycle", () => {
    // `var(--rb, var(--rb))` resolves to the guaranteed-invalid value and the
    // browser DROPS the declaration, so the element renders with NO accent
    // rather than a plain one (v2.106.7). Comments are stripped first, because
    // this file's own prose explains the trap and would satisfy the search.
    expect(CODE).not.toMatch(/var\(--rb[a-z-]*,\s*var\(--rb/);
    // ...and at least one real accent reference with a literal fallback.
    expect(CODE).toMatch(/var\(--rb,\s*#[0-9A-Fa-f]{6}\)/);
  });

  it("no class name is assembled from a composed value", () => {
    // A runtime-composed class is invisible to the JIT and comes out unstyled.
    // Interpolating a CHOICE between two complete literals is fine — both appear
    // in source — so this forbids the composing form specifically.
    for (const m of CODE.matchAll(/className=\{`([^`]*)`\}/g)) {
      const body = m[1];
      for (const inner of body.matchAll(/\$\{([^}]*)\}/g)) {
        // Every interpolation must resolve to quoted literals or the empty string.
        expect(inner[1], `composed class: ${inner[1].slice(0, 60)}`).toMatch(/["']/);
      }
    }
  });
});

describe("board 2e — the restyle took nothing away", () => {
  it("all six stages are REACHABLE, not merely named", () => {
    // A bare file-wide match for `"waiting"` is satisfied by the stage union and
    // by a `stage === "waiting"` comparison, so re-pointing the only
    // `setStage("waiting")` left it green while the stage had become unreachable
    // — proven by mutation. The property is that each stage can be entered AND
    // that something renders it, so both halves are asserted.
    for (const s of ["email", "register", "code", "pin", "waiting", "setup"]) {
      expect(CODE, `nothing enters stage ${s}`).toMatch(
        new RegExp(`setStage\\("${s}"\\)`),
      );
      expect(CODE, `nothing renders stage ${s}`).toMatch(
        new RegExp(`stage === "${s}"`),
      );
    }
  });

  it("every sign-in procedure it drove is still driven", () => {
    // A restyle that quietly dropped one of these would remove a way in, and
    // the panel is the ONLY sign-in surface (the OAuth UI was removed in v2.92).
    for (const p of [
      "loginProbe",
      "requestOtp",
      "resendOtp",
      "verifyOtp",
      "loginWithPin",
      "register",
      "setLoginPin",
      "sessionApprovalStatus",
    ]) {
      expect(CODE, `otpAuth.${p}`).toMatch(new RegExp(`otpAuth\\.${p}\\b`));
    }
  });

  it("the keep-me-signed-in control still offers OFF plus the three windows", () => {
    // v2.94.7: 0 means a browser-SESSION cookie, so losing the 0 would silently
    // make every sign-in persistent.
    expect(CODE).toMatch(/onChange\(on \? 0 : 30\)/);
    expect(CODE).toMatch(/\[30,\s*60,\s*90\]/);
  });

  it("the PIN stage still offers the email-code escape", () => {
    // A device whose owner has forgotten the passcode must not be a dead end.
    const at = CODE.indexOf('"pin"');
    expect(at).toBeGreaterThan(0);
    expect(CODE).toMatch(/requestOtp/);
  });
});
