import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inviteTargetFromSearch } from "./OnboardingGate";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Call-link direct-join (owner: "paramount"). A shared invite link
 * (`/i/<pin>` → `/app/dialer?to=<pin>`) must land a not-yet-identified clicker
 * on a FOCUSED "enter your name to connect" card — not the generic marketing
 * login — then straight into the dial. These pin the URL parser + the presence
 * of the focused-join affordance so a redesign can't silently regress it back
 * to the full login wall.
 */
describe("inviteTargetFromSearch — pull the call target out of the URL", () => {
  it("extracts a 6-digit ?to= target", () => {
    expect(inviteTargetFromSearch("?to=800165")).toBe("800165");
    expect(inviteTargetFromSearch("to=800165")).toBe("800165");
    expect(inviteTargetFromSearch("?to=800165&video=1")).toBe("800165");
  });

  it("strips non-digits and caps at 6", () => {
    expect(inviteTargetFromSearch("?to=800-165")).toBe("800165");
    expect(inviteTargetFromSearch("?to=8001650000")).toBe("800165");
  });

  it("returns null for absent / malformed / short targets", () => {
    expect(inviteTargetFromSearch("")).toBe(null);
    expect(inviteTargetFromSearch("?foo=bar")).toBe(null);
    expect(inviteTargetFromSearch("?to=800")).toBe(null); // too short
    expect(inviteTargetFromSearch("?to=")).toBe(null);
  });
});

describe("OnboardingGate — focused call-link join UI", () => {
  const src = read("client/src/app/OnboardingGate.tsx");

  it("branches on a URL call target to a focused join card", () => {
    expect(src).toMatch(/inviteTargetFromSearch/);
    expect(src).toMatch(/const showJoin\b/);
    // The join CTA — distinct from the generic "Enter as guest".
    expect(src).toMatch(/Join call/);
    expect(src).toMatch(/Enter your name to connect/);
  });

  it("resolves who's being called via the public directory.lookup", () => {
    expect(src).toMatch(/directory\.lookup\.useQuery/);
    // Enabled only when there's a target and no identity yet.
    expect(src).toMatch(/enabled:\s*!!callTarget/);
  });

  it("keeps a sign-in escape and a party-line variant", () => {
    expect(src).toMatch(/Have a RELAY account/);
    expect(src).toMatch(/Join the line/);
  });
});
