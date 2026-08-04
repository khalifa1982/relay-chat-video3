/**
 * VOICE TRANSCRIPTS (v2.107.31) — the model-reply CONTRACT, tested where it is
 * pure. The failure this suite exists for is the quiet one: a model that starts
 * fencing its JSON, naming the language "Arabic" instead of "ar", or padding
 * the object with prose would — without these rules — cache garbage onto an
 * attachment row FOREVER, because a stored transcript is never re-asked.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_TRANSCRIBE_BYTES,
  TRANSCRIBE_INSTRUCTION,
  normalizeLang,
  parseTranscriptReply,
  translateInstruction,
} from "./voiceTranscribe";

describe("voice transcripts — language names collapse to the two codes the UI branches on", () => {
  it("every way a model says Arabic or English lands on ar / en", () => {
    for (const v of ["ar", "AR", "ara", "ar-SA", "Arabic", "العربية"]) expect(normalizeLang(v)).toBe("ar");
    for (const v of ["en", "EN", "eng", "en-US", "English"]) expect(normalizeLang(v)).toBe("en");
  });

  it("an unknown language stays a code, never a crash and never empty", () => {
    expect(normalizeLang("fr-FR")).toBe("fr");
    expect(normalizeLang("")).toBe("und");
    expect(normalizeLang(null)).toBe("und");
    expect(normalizeLang(42)).toBe("und");
  });
});

describe("voice transcripts — the reply parser survives a model's bad days", () => {
  it("reads a clean object", () => {
    expect(parseTranscriptReply('{"lang":"ar","text":"مرحبا"}')).toEqual({ lang: "ar", text: "مرحبا" });
  });

  it("reads an object wrapped in code fences and prose", () => {
    const raw = 'Sure! Here is the transcript:\n```json\n{"lang":"en-US","text":" hello there "}\n```\nHope that helps.';
    expect(parseTranscriptReply(raw)).toEqual({ lang: "en", text: "hello there" });
  });

  it("refuses anything without a readable text — null, not a cached lie", () => {
    expect(parseTranscriptReply("I could not process the audio.")).toBeNull();
    expect(parseTranscriptReply('{"lang":"en"}')).toBeNull();
    expect(parseTranscriptReply('{"lang":"en","text":42}')).toBeNull();
    expect(parseTranscriptReply("")).toBeNull();
  });

  it("an empty spoken transcript parses as empty — the ROUTE turns that into a retryable refusal", () => {
    expect(parseTranscriptReply('{"lang":"en","text":"  "}')).toEqual({ lang: "en", text: "" });
  });
});

describe("voice transcripts — the instructions carry the contract the parser depends on", () => {
  it("transcription demands the exact JSON shape, verbatim text, and the spoken language", () => {
    expect(TRANSCRIBE_INSTRUCTION).toContain('{"lang"');
    expect(TRANSCRIBE_INSTRUCTION).toContain("verbatim");
    expect(TRANSCRIBE_INSTRUCTION.toLowerCase()).toContain("language actually spoken");
  });

  it("translation names its target and forbids commentary", () => {
    expect(translateInstruction("ar")).toContain("Arabic");
    expect(translateInstruction("en")).toContain("English");
    expect(translateInstruction("en")).toContain("ONLY the translation");
  });

  it("the size cap refuses anything that is not a voice note", () => {
    // A minute of opus is well under a megabyte; 12 MB is hours, not a note.
    expect(MAX_TRANSCRIBE_BYTES).toBe(12 * 1024 * 1024);
  });
});
