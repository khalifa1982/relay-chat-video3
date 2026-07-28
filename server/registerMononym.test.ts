/**
 * Registration must accept a display name with no surname.
 *
 * THE BUG THIS PINS, reported from production: the redesigned login page
 * (RELAY_LOGIN_HANDOFF.md) asks for ONE "permanent display name" and splits it
 * on the first space, so a mononym — "Prince", "Zendaya", and the many naming
 * conventions that are simply one name — arrives as
 * `{ firstName: "Prince", lastName: "" }`. `otpAuth.register` declared
 * `lastName: NameSchema` (`.min(1)`), so zod rejected it before the resolver
 * ever ran and the user saw a raw validator dump:
 *
 *   [{"code":"too_small","minimum":1,"path":["lastName"],
 *     "message":"Too small: expected string to have >=1 characters"}]
 *
 * The old two-field panel required both boxes, so the strictness was
 * unreachable and shipped unnoticed for as long as it existed.
 *
 * Nothing downstream ever needed the surname: BOTH places that compose a
 * display name already do
 *   `${firstName ?? ""} ${lastName ?? ""}`.trim() || email.split("@")[0]`
 * which yields a clean "Prince" with no trailing space. So the fix is the
 * schema, and this test drives the REAL procedure input — not a copy of it —
 * because a hand-written duplicate of the schema is exactly the thing that
 * drifts from the one the server actually enforces.
 */
import { describe, it, expect } from "vitest";
import { v2OtpAuthRouter } from "./v2routers";

/** The register procedure's ACTUAL input validator, pulled off the router. */
function registerInput() {
  const proc = (v2OtpAuthRouter as unknown as {
    _def: { procedures: Record<string, { _def: { inputs: unknown[] } }> };
  })._def.procedures.register;
  expect(proc, "otpAuth.register must exist").toBeTruthy();
  const schema = proc._def.inputs[0] as { parse: (v: unknown) => unknown };
  expect(typeof schema?.parse, "register must declare an input schema").toBe("function");
  return schema;
}

describe("otpAuth.register accepts a one-word display name", () => {
  const email = "mononym@example.com";

  it("accepts an EMPTY surname — the reported failure", () => {
    const out = registerInput().parse({ firstName: "Prince", lastName: "", email }) as {
      firstName: string; lastName: string;
    };
    expect(out.firstName).toBe("Prince");
    expect(out.lastName).toBe("");
  });

  it("accepts an OMITTED surname, since the client may not send the key at all", () => {
    const out = registerInput().parse({ firstName: "Zendaya", email }) as { lastName: string };
    expect(out.lastName).toBe("");
  });

  it("still accepts an ordinary two-part name", () => {
    const out = registerInput().parse({ firstName: "Alex", lastName: "Mercer", email }) as {
      firstName: string; lastName: string;
    };
    expect(out).toMatchObject({ firstName: "Alex", lastName: "Mercer" });
  });

  it("a surname with spaces survives intact (van der Berg)", () => {
    const out = registerInput().parse({ firstName: "Ada", lastName: "van der Berg", email }) as {
      lastName: string;
    };
    expect(out.lastName).toBe("van der Berg");
  });

  it("STILL rejects an empty FIRST name — the display name itself is required", () => {
    // Relaxing the surname must not turn registration into a nameless account.
    expect(() => registerInput().parse({ firstName: "", lastName: "", email })).toThrow();
    expect(() => registerInput().parse({ firstName: "   ", lastName: "", email })).toThrow();
    expect(() => registerInput().parse({ lastName: "Mercer", email })).toThrow();
  });

  it("still bounds both names at 64 characters", () => {
    const long = "x".repeat(65);
    expect(() => registerInput().parse({ firstName: long, lastName: "", email })).toThrow();
    expect(() => registerInput().parse({ firstName: "Alex", lastName: long, email })).toThrow();
  });

  it("leaves email VALIDITY to the resolver, which is where it actually lives", () => {
    // EmailSchema is deliberately permissive — `z.string().trim().max(320)` —
    // and `register`'s resolver does the real check with
    // `isValidEmail(normalizeEmail(input.email))`, so normalisation happens
    // before judgement. Asserting a schema-level rejection here would have been
    // pinning a rule that is enforced one layer down.
    expect(() => registerInput().parse({ firstName: "Alex", lastName: "", email: "nope" })).not.toThrow();
    // …but the schema still bounds the length, which is its job.
    expect(() =>
      registerInput().parse({ firstName: "Alex", lastName: "", email: "x".repeat(321) }),
    ).toThrow();
  });
});

describe("the display name a mononym produces", () => {
  /** The composition both server sites use, reproduced to show the OUTPUT is
   *  clean — no trailing space, no email fallback for a real name. */
  const compose = (firstName: string, lastName: string, email: string) =>
    `${firstName ?? ""} ${lastName ?? ""}`.trim() || email.split("@")[0];

  it('"Prince" + "" composes to "Prince", not "Prince "', () => {
    expect(compose("Prince", "", "p@example.com")).toBe("Prince");
  });
  it("a two-part name is unaffected", () => {
    expect(compose("Alex", "Mercer", "a@example.com")).toBe("Alex Mercer");
  });
  it("only a genuinely empty name falls back to the email local part", () => {
    expect(compose("", "", "fallback@example.com")).toBe("fallback");
  });
});
