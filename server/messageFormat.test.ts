/**
 * INLINE FORMATTING (QW-5, v2.107.56) — the WhatsApp-style emphasis parser.
 *
 * The parser is pure, so this is mostly real behaviour: what renders emphasised and,
 * just as important, what does NOT (the false-positive guards are the whole point of
 * the strict boundary rules). Plus source-pins that the renderer is wired into linkify
 * and the composer offers the markers.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./testing/codeOnly";
import { parseInlineFormat, hasInlineFormat, type Mark } from "../shared/messageFormat";

/** Collapse a parse into a compact [marks, text] view for readable assertions. */
const shape = (s: string) => parseInlineFormat(s).map((seg) => [seg.marks.join("+"), seg.text]);
/** The marks covering the first run that carries any mark. */
const marksOf = (s: string, needle: string): Mark[] => {
  const seg = parseInlineFormat(s).find((x) => x.text.includes(needle) && x.marks.length > 0);
  return seg ? seg.marks : [];
};

describe("QW-5 parser — the four markers", () => {
  it("bold / italic / strike / code each produce their mark", () => {
    expect(marksOf("this is *bold* text", "bold")).toEqual(["bold"]);
    expect(marksOf("this is _italic_ text", "italic")).toEqual(["italic"]);
    expect(marksOf("this is ~struck~ text", "struck")).toEqual(["strike"]);
    expect(marksOf("run `code()` here", "code()")).toEqual(["code"]);
  });

  it("keeps the surrounding plain text intact and drops the markers", () => {
    expect(shape("a *b* c")).toEqual([
      ["", "a "],
      ["bold", "b"],
      ["", " c"],
    ]);
  });

  it("reassembles to the original minus the markers (no text lost)", () => {
    const src = "hey *there* _friend_ ~old~ `x` done";
    const rebuilt = parseInlineFormat(src).map((s) => s.text).join("");
    expect(rebuilt).toBe("hey there friend old x done");
  });
});

describe("QW-5 parser — nesting and combination", () => {
  it("nests bold + italic into a run that carries both", () => {
    // *bold _and italic_* → the inner words are both.
    expect(marksOf("*bold _and italic_*", "and italic")).toEqual(["bold", "italic"]);
    // the bold-only lead-in still exists
    expect(marksOf("*bold _and italic_*", "bold ")).toEqual(["bold"]);
  });

  it("treats other markers as LITERAL inside a code span", () => {
    const segs = shape("`*not bold*`");
    expect(segs).toEqual([["code", "*not bold*"]]);
  });
});

describe("QW-5 parser — false positives are NOT formatted", () => {
  it("leaves snake_case alone", () => {
    expect(hasInlineFormat("my_var_name here")).toBe(false);
    expect(parseInlineFormat("my_var_name").map((s) => s.text).join("")).toBe("my_var_name");
  });

  it("leaves arithmetic and stray asterisks alone", () => {
    expect(hasInlineFormat("5 * 3 = 15")).toBe(false);
    expect(hasInlineFormat("a * b * c")).toBe(false);
  });

  it("does not open on a marker followed by a space", () => {
    expect(hasInlineFormat("* not a list")).toBe(false);
    expect(hasInlineFormat("~ nope")).toBe(false);
  });

  it("does not treat an unmatched marker as a span", () => {
    expect(hasInlineFormat("this is *unclosed")).toBe(false);
    expect(parseInlineFormat("this is *unclosed").map((s) => s.text).join("")).toBe("this is *unclosed");
  });

  it("ignores an empty span like ** or __", () => {
    expect(hasInlineFormat("wow ** ok")).toBe(false);
    expect(hasInlineFormat("__")).toBe(false);
  });

  it("null-safety: empty string yields no segments", () => {
    expect(parseInlineFormat("")).toEqual([]);
    expect(hasInlineFormat("")).toBe(false);
  });
});

describe("QW-5 parser — punctuation boundaries", () => {
  it("opens after punctuation and closes before it", () => {
    // "(*bold*)" — parens are boundaries on the outer side.
    expect(marksOf("(*bold*)", "bold")).toEqual(["bold"]);
    // "wait *what*?!" — closes before ? even though not whitespace.
    expect(marksOf("wait *what*?!", "what")).toEqual(["bold"]);
  });
});

/* ─────────────────── renderer + composer wiring (source pins) ─────────────────── */

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const linkify = codeOnly(read("../client/src/lib/linkify.tsx"));

describe("QW-5 — renderer is wired into linkify", () => {
  it("imports and calls the parser, mapping marks to element classes", () => {
    expect(linkify).toMatch(/import \{ parseInlineFormat, type Mark \} from "@shared\/messageFormat"/);
    expect(linkify).toMatch(/withFormatting\(part, members, i\)/);
    // The four marks map to real emphasis styling.
    expect(linkify).toMatch(/font-semibold/);
    expect(linkify).toMatch(/italic/);
    expect(linkify).toMatch(/line-through/);
    expect(linkify).toMatch(/font-mono/);
  });

  it("does not resolve mentions inside a code segment", () => {
    // hasCode short-circuits the mention pass for that leaf.
    expect(linkify).toMatch(/const hasCode = seg\.marks\.includes\("code"\)/);
    expect(linkify).toMatch(/!hasCode && members && members\.length/);
  });
});
