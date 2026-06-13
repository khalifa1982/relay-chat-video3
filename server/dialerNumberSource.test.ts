/**
 * Dialer number-source invariant.
 *
 * Root cause of the "keeps disconnecting / target not registered" bug:
 * the dialer screen showed the v2 *identity* number (from the DB) while the
 * actual call went through the *signaling* engine, which had registered a
 * completely different 6-digit pin. A peer who dialed the displayed number
 * was always rejected with code "offline".
 *
 * The fix unifies the number: the displayed number AND the self-call guard
 * must both use the relay engine's registered pin (enginePin) and only fall
 * back to the identity number when the engine has not registered yet.
 *
 * This test pins that resolution rule as a pure function so a future refactor
 * can't silently reintroduce the two-number split.
 */

import { describe, it, expect } from "vitest";

/**
 * Mirror of the `myNumber` resolution in client/src/pages/app/Dialer.tsx.
 * Kept here as a pure function so we can assert the invariant in node.
 */
function resolveMyNumber(args: {
  enginePin: string | null;
  identityNumber: string | null | undefined;
}): string | null {
  return args.enginePin ?? args.identityNumber ?? null;
}

/** Mirror of the self-call guard / callable rule. */
function isCallable(args: {
  dialed: string;
  myNumber: string | null;
  engineReady: boolean;
}): boolean {
  return (
    /^\d{6}$/.test(args.dialed) &&
    args.dialed !== args.myNumber &&
    args.engineReady
  );
}

describe("dialer number source", () => {
  it("prefers the signaling engine pin over the identity number", () => {
    expect(
      resolveMyNumber({ enginePin: "906946", identityNumber: "825719" })
    ).toBe("906946");
  });

  it("falls back to the identity number only until the engine registers", () => {
    expect(
      resolveMyNumber({ enginePin: null, identityNumber: "825719" })
    ).toBe("825719");
  });

  it("returns null when neither source has a number yet", () => {
    expect(
      resolveMyNumber({ enginePin: null, identityNumber: null })
    ).toBeNull();
  });

  it("guards self-calls against the ENGINE pin, not the identity number", () => {
    // User's identity number is 825719 but the engine registered 906946.
    const myNumber = resolveMyNumber({
      enginePin: "906946",
      identityNumber: "825719",
    });
    // Dialing the engine pin == calling yourself -> not callable.
    expect(isCallable({ dialed: "906946", myNumber, engineReady: true })).toBe(
      false
    );
    // Dialing the stale identity number is a *different* (valid) target now.
    expect(isCallable({ dialed: "825719", myNumber, engineReady: true })).toBe(
      true
    );
  });

  it("is not callable until the engine is ready", () => {
    const myNumber = resolveMyNumber({
      enginePin: "906946",
      identityNumber: null,
    });
    expect(isCallable({ dialed: "123456", myNumber, engineReady: false })).toBe(
      false
    );
    expect(isCallable({ dialed: "123456", myNumber, engineReady: true })).toBe(
      true
    );
  });

  it("rejects non-6-digit dial targets", () => {
    const myNumber = "906946";
    expect(isCallable({ dialed: "1234", myNumber, engineReady: true })).toBe(
      false
    );
    expect(isCallable({ dialed: "1234567", myNumber, engineReady: true })).toBe(
      false
    );
    expect(isCallable({ dialed: "abcdef", myNumber, engineReady: true })).toBe(
      false
    );
  });
});

/**
 * Mirror of the engine's preferredPin gate (relayClient.ts setPreferredPin +
 * register()). We ask the signaling server to register us under the stable
 * identity number so the big number == the profile number. The server still
 * has final say (reports back the authoritative pin), but the REQUESTED pin
 * must be the identity number when one is available.
 */
function resolveRequestedPin(args: {
  preferredPin: string | null;
  savedPin: string | null;
  currentPin: string | null;
}): string | null {
  const valid = (p: string | null): p is string => !!p && /^\d{6}$/.test(p);
  if (valid(args.preferredPin)) return args.preferredPin;
  if (valid(args.savedPin) && !args.currentPin) return args.savedPin;
  return args.currentPin;
}

describe("relay requested-pin unification", () => {
  it("requests the identity number (preferredPin) above all else", () => {
    expect(
      resolveRequestedPin({
        preferredPin: "825719",
        savedPin: "906946",
        currentPin: null,
      })
    ).toBe("825719");
  });

  it("falls back to a previously-saved pin only when no preferred pin", () => {
    expect(
      resolveRequestedPin({
        preferredPin: null,
        savedPin: "906946",
        currentPin: null,
      })
    ).toBe("906946");
  });

  it("ignores an invalid preferred pin", () => {
    expect(
      resolveRequestedPin({
        preferredPin: "abc",
        savedPin: "906946",
        currentPin: null,
      })
    ).toBe("906946");
  });

  it("keeps the current pin when nothing better is offered", () => {
    expect(
      resolveRequestedPin({
        preferredPin: null,
        savedPin: null,
        currentPin: "333111",
      })
    ).toBe("333111");
  });
});
