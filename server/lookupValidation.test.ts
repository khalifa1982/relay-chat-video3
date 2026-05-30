/**
 * Validation pin for the 6-digit `NumberSchema` used by every
 * contact / messaging / call-related procedure that accepts a PIN.
 *
 * We test the schema directly (rather than going through the tRPC
 * surface) so we get fast, deterministic coverage of the boundary
 * conditions the add-by-PIN UI relies on:
 *
 *   - A 6-digit numeric string is the only accepted shape.
 *   - Leading zeros are preserved (the schema treats the value as a
 *     string, which matches how the database stores it).
 *   - Anything else \u2014 5 digits, 7 digits, alphabetic, mixed,
 *     dashes \u2014 is rejected with a recognisable message.
 *   - Trimming is the *caller's* responsibility: we don't auto-strip
 *     whitespace, so the UI has to call `.trim()` before sending the
 *     value. Pinning that here keeps the contract honest.
 */
import { describe, expect, it } from "vitest";
import { NumberSchema } from "./v2routers";

describe("NumberSchema (used by directory.lookup, contacts.upsert, messages.openThread, calls.start)", () => {
  it("accepts a 6-digit string", () => {
    expect(NumberSchema.safeParse("123456").success).toBe(true);
    expect(NumberSchema.safeParse("982954").success).toBe(true);
  });

  it("preserves leading zeros (schema is string-typed)", () => {
    const parsed = NumberSchema.parse("000042");
    expect(parsed).toBe("000042");
    expect(parsed.length).toBe(6);
  });

  it("rejects strings shorter or longer than 6 digits", () => {
    expect(NumberSchema.safeParse("12345").success).toBe(false);
    expect(NumberSchema.safeParse("1234567").success).toBe(false);
    expect(NumberSchema.safeParse("").success).toBe(false);
  });

  it("rejects non-numeric input", () => {
    expect(NumberSchema.safeParse("12a456").success).toBe(false);
    expect(NumberSchema.safeParse("abcdef").success).toBe(false);
    expect(NumberSchema.safeParse("12-345").success).toBe(false);
    expect(NumberSchema.safeParse(" 123456").success).toBe(false);
    expect(NumberSchema.safeParse("123456 ").success).toBe(false);
  });

  it("rejects non-string types", () => {
    expect(NumberSchema.safeParse(123456).success).toBe(false);
    expect(NumberSchema.safeParse(null).success).toBe(false);
    expect(NumberSchema.safeParse(undefined).success).toBe(false);
  });

  it("returns a recognisable error message", () => {
    const r = NumberSchema.safeParse("12345");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe("Number must be 6 digits");
    }
  });
});
