import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.50.2 — the dialer header showed the identity number while the big dialer
 * display showed the relay signaling pin, and the two could diverge (the engine
 * registered with a stale localStorage pin before whoami's `number` had loaded,
 * then never switched). These guard the reconciliation that forces the engine's
 * pin to equal the authoritative identity number so the user only ever sees ONE.
 */

const RELAY_CLIENT = fs.readFileSync(
  path.resolve(__dirname, "..", "lib", "relayClient.ts"),
  "utf8",
);
const RELAY_ENGINE = fs.readFileSync(
  path.resolve(__dirname, "RelayEngine.tsx"),
  "utf8",
);

describe("identity-number ↔ relay-pin reconciliation", () => {
  it("setPreferredPin switches the engine to a differing pin (idle, registered)", () => {
    const fn = RELAY_CLIENT.slice(
      RELAY_CLIENT.indexOf("setPreferredPin(pin)"),
      RELAY_CLIENT.indexOf("setSelfFlag(flag)"),
    );
    // It re-registers under the new pin only when it differs, we're registered,
    // and NOT in a call (an identity switch tears down room membership).
    expect(fn).toMatch(/next\s*&&\s*me\.pin\s*&&\s*next !== me\.pin\s*&&\s*!inCall/);
    expect(fn).toMatch(/sendWS\(\{\s*type:\s*["']register["']/);
    expect(fn).toMatch(/relay_pin/);
  });

  it("the engine provider reconciles the pin to the identity number once ready", () => {
    // An effect calls setPreferredPin(me.number) gated on `ready` so the switch
    // can take effect after the engine has registered.
    expect(RELAY_ENGINE).toMatch(/setPreferredPin\(me\.number\)/);
    expect(RELAY_ENGINE).toMatch(/\[\s*me\?\.number\s*,\s*ready\s*\]/);
  });
});
