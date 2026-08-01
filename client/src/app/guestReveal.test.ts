import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * WHERE THE NUMBER REVEAL IS ARMED (#162).
 *
 * This file used to pin `MatrixReveal`, the guest-only reveal of v2.94.6. The owner's
 * newer handoff covers *"either guest or member"*, so that component is gone and
 * `PinReveal` plays for every way in. What survives from the old pins is the two
 * properties they actually stood for, and both are stronger here than they were:
 *
 *   1. The reveal outlasts `me` flipping truthy (it is checked BEFORE the identity
 *      gate), so the dashboard never flashes underneath it.
 *   2. A call-link join skips it and lands straight in the dial.
 *
 * The reveal's own behaviour — the settle, the timings, the jumps — is
 * `pinReveal.test.ts`. This file is only about WHO arms it.
 */
const GATE = codeOnly(read("client/src/app/OnboardingGate.tsx"));
const SCREEN = codeOnly(read("client/src/app/LoginScreen.tsx"));

describe("one reveal, armed by the transition rather than by each entry surface", () => {
  it("arms on signed-out → signed-in, so a fourth way in cannot forget it", () => {
    /* THE LOAD-BEARING DECISION. There are three ways in today — a guest name, an
       email sign-in, and the `/i/<pin>` join card — spread across two components. A
       callback per surface is how the next one ships without it (the recurring failure
       this codebase keeps paying for); the transition is one funnel they all pass
       through by construction. */
    expect(GATE).toMatch(/if \(!loading && !me\) \{[\s\S]{0,80}sawSignedOut\.current = true;/);
    expect(GATE).toMatch(/if \(me && sawSignedOut\.current\) \{/);
    expect(GATE).toMatch(/sawSignedOut\.current = false;/);
  });

  it("CANNOT fire on an ordinary reload of the dashboard", () => {
    /* The thing that would make this maddening rather than delightful. `loading` is
       react-query's `isLoading` — true only on a first fetch with no data — so a
       reload goes loading → identity and never reaches `!loading && !me`. The arming
       therefore depends on the login screen having genuinely been rendered.

       Pinned as the SHAPE of the guard: an arm that keyed on `me` alone, or that
       dropped the `!loading` conjunct, is exactly the regression. */
    const arm = GATE.slice(GATE.indexOf("const sawSignedOut"));
    expect(arm.indexOf("!loading && !me")).toBeGreaterThan(-1);
    expect(arm.indexOf("!loading && !me")).toBeLessThan(arm.indexOf("if (me && sawSignedOut"));
    // …and the flag is a ref, so re-rendering cannot re-arm it.
    expect(GATE).toMatch(/const sawSignedOut = useRef\(false\)/);
  });

  it("renders BEFORE the identity gate, so the dashboard never flashes underneath", () => {
    const revealIdx = GATE.indexOf("if (revealing && me?.number)");
    const meGateIdx = GATE.indexOf("if (me) return <>{children}</>");
    expect(revealIdx).toBeGreaterThan(-1);
    expect(meGateIdx).toBeGreaterThan(-1);
    expect(revealIdx).toBeLessThan(meGateIdx);
  });

  it("a number it cannot show falls THROUGH to the app rather than holding anybody", () => {
    /* `me?.number` in the condition, not inside the component: this screen sits between
       a person and their inbox, so an identity with no readable number must reach the
       dashboard, not a blank reveal. */
    expect(GATE).toMatch(/if \(revealing && me\?\.number\) \{/);
  });

  it("skips the reveal on a call-link join (straight into the dial)", () => {
    // v2.94.5: somebody who tapped a link to reach a person is not on their way to the
    // dashboard, so a screen between them and the ring would be in the way.
    expect(GATE).toMatch(/if \(!callTarget\) setRevealing\(true\)/);
  });
});

describe("the retired guest-only reveal leaves nothing behind", () => {
  it("neither entry surface plays its own", () => {
    expect(GATE).not.toContain("MatrixReveal");
    expect(SCREEN).not.toContain("MatrixReveal");
    // Exactly ONE mount in the whole client, and it is the gate's.
    expect(GATE).toMatch(/<PinReveal\b/);
    expect(SCREEN).not.toMatch(/<PinReveal\b/);
  });

  it("the guest submit no longer reads a number back to feed one", () => {
    /* Both surfaces used to capture `startGuest`'s number for their own reveal. That
       plumbing is dead now — the gate reads `me.number`, which is the same value from
       the one source that also serves a member. A revived read is a second source. */
    expect(GATE).not.toMatch(/setRevealNumber/);
    expect(SCREEN).not.toMatch(/setReveal\(/);
  });
});
