/**
 * THE RING PUSH HAS ONE LIFETIME, AND IT IS THE RING'S OWN (v2.106.74).
 *
 * v2.106.69 unified the call-push PAYLOAD across APNs and FCM and left each
 * transport to pick its own EXPIRY. They diverged, as two literals for one rule
 * always do:
 *
 *     apnsVoip.ts   const VOIP_EXPIRY_SECONDS = 45      (named, commented)
 *     fcm.ts        ttl: kind === "incoming-call" ? "70s" : "3600s"   (bare inline)
 *
 * One event, two lifetimes. The gap was not academic: a handset that reconnected
 * between 45s and 70s got a ring on Android and NOTHING on iOS, which is the exact
 * situation a ring push exists to serve.
 *
 * These tests pin the PROPERTY (both transports bound the ring by the same number,
 * and that number is the server's own pending-ring TTL) rather than the literal, so
 * the value stays free to retune while a divergence cannot come back.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { CALL_PUSH_EXPIRY_SECONDS } from "./callPushPayload";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** Strip comment spans so a rule is never satisfied by prose describing it. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const APNS = read("server/apnsVoip.ts");
const FCM = read("server/fcm.ts");
const RELAY = read("server/relay.ts");

describe("the ring push's expiry is derived, not chosen per transport", () => {
  it("equals the server's own pending-ring TTL", () => {
    // THE LOAD-BEARING ASSERTION. `PENDING_RING_TTL_MS` is how long the server
    // keeps the pending ring that `deliverPendingRing` hands over when the app
    // opens, so it is the exact point where the two failure modes cross:
    //
    //   shorter → a phone that reconnects inside the ring's life is refused a
    //             push for a ring the server would still have served.
    //   longer  → the push outlives the ring and somebody answers into nothing.
    //
    // Equality makes the second cost zero by construction rather than by luck.
    const m = RELAY.match(/PENDING_RING_TTL_MS = ([\d_]+)/);
    expect(m, "PENDING_RING_TTL_MS must still be declared in relay.ts").toBeTruthy();
    const ttlMs = Number(m![1].replace(/_/g, ""));
    expect(ttlMs).toBeGreaterThan(0);
    expect(CALL_PUSH_EXPIRY_SECONDS).toBe(ttlMs / 1000);
  });

  it("is defined in a module that imports nothing, so neither transport can cycle", () => {
    // It cannot live in relay.ts: fcm.ts and apnsVoip.ts would then import the
    // signaling server to learn a number. callPushPayload.ts is pure.
    const payload = read("server/callPushPayload.ts");
    expect(codeOnly(payload)).not.toMatch(/^\s*import\s/m);
    expect(payload).toMatch(/export const CALL_PUSH_EXPIRY_SECONDS/);
  });
});

describe("both transports reach for the shared bound", () => {
  it("APNs sets apns-expiration from it, and carries no private literal", () => {
    const code = codeOnly(APNS);
    expect(code).toMatch(/import[\s\S]{0,200}CALL_PUSH_EXPIRY_SECONDS[\s\S]{0,80}callPushPayload/);
    // The header must be computed from the shared constant.
    expect(code).toMatch(
      /"apns-expiration":\s*String\(\s*Math\.floor\(Date\.now\(\) \/ 1000\) \+ CALL_PUSH_EXPIRY_SECONDS\s*\)/
    );
    // And the retired private literal must be gone rather than merely unused —
    // a dangling `VOIP_EXPIRY_SECONDS = 45` is what the next reader wires back up.
    expect(code).not.toMatch(/VOIP_EXPIRY_SECONDS/);
  });

  it("FCM sets the ring's ttl from it, and never a bare number of seconds", () => {
    const code = codeOnly(FCM);
    expect(code).toMatch(/import\s*\{\s*CALL_PUSH_EXPIRY_SECONDS\s*\}\s*from\s*"\.\/callPushPayload"/);
    expect(code).toMatch(/ttl:[\s\S]{0,140}`\$\{CALL_PUSH_EXPIRY_SECONDS\}s`/);
    // The ring branch must not carry a hardcoded "<digits>s" any more. The
    // non-ring arm legitimately keeps "3600s" — a message is still worth
    // delivering an hour later, which a ring is not — so only the ring's own
    // ternary arm is swept.
    const ring = code.match(/data\.kind === "incoming-call"[\s\S]{0,120}?:/);
    expect(ring, "the ring/non-ring ternary must still exist").toBeTruthy();
    expect(ring![0]).not.toMatch(/"\d+s"/);
  });

  it("keeps the long TTL for everything that is not a ring", () => {
    // Deliberately asserted so a later 'tidy-up' cannot collapse both arms onto
    // the ring's short bound and silently stop delivering offline messages.
    expect(codeOnly(FCM)).toMatch(/"3600s"/);
  });
});

describe("the expiry outlives the callee's own ring UI", () => {
  it("is at least as long as the callee auto-decline, so a push is never dead on arrival", () => {
    // The ladder recorded at v2.106.24: callee auto-decline 60s < caller backstop
    // 65s < server pending-ring TTL 70s. A push bound BELOW the auto-decline
    // could expire while the callee still had a card in front of them.
    expect(CALL_PUSH_EXPIRY_SECONDS).toBeGreaterThanOrEqual(60);
  });
});
