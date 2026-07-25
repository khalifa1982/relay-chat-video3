import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { normalizeEmail } from "./emailInbound";

/**
 * v2.99.57 — fixes from the 20-expert sweep (46 findings confirmed by a 3-lens
 * adversarial panel out of 65 raised).
 *
 * Grouped by root cause, not by finding, because several experts independently
 * reported the same bug from different angles.
 */
const ROOT = path.resolve(__dirname, "..");
const RELAY = fs.readFileSync(path.join(ROOT, "server/relay.ts"), "utf8");
const INBOUND = fs.readFileSync(path.join(ROOT, "server/emailInbound.ts"), "utf8");

/* ══════════════════════════════════════════════════════════════════════════
   R-GENPIN (findings 1, 8, 45) — HIGH.

   `genPin` excluded ONLY `reg.clients`, so an anonymous `register` (no resolvable
   cookie ⇒ `__ownedNumber` null ⇒ `requested` undefined ⇒ the genPin fallback)
   could be handed a number belonging to a real identity that merely had no live
   SSE stream. Consequences the panel confirmed: inbound dials fan to the
   squatter's socket (MULTI_DEVICE_RING is baked on fleet-wide), a ring already in
   flight is handed over by `deliverPendingRing`, `sendRejoinIfInRoom` drops the
   squatter into a still-live call with the member list and a LiveKit token, and
   the ring card renders the VICTIM's name/avatar/badge because the callee resolves
   the caller by pin.

   The registry cannot see `identities` (the register path must stay synchronous),
   so the fix is two-layered: shrink the collision window, and make an unverified
   registration non-addressable so a collision is harmless.
   ══════════════════════════════════════════════════════════════════════════ */
describe("R-GENPIN — an unverified registration cannot impersonate a number", () => {
  /** genPin's body. */
  const genPin = RELAY.slice(
    RELAY.indexOf("export function genPin("),
    RELAY.indexOf("function pinIsAddressable("),
  );

  it("excludes room membership, not just live clients", () => {
    // `cleanupRegistryConn` deliberately KEEPS pinRoom membership for auto-rejoin
    // while deleting the client record — precisely the state a clients-only check
    // treated as free, and the state in which a collision is most dangerous.
    expect(genPin).toMatch(/reg\.clients\.has\(p\)/);
    expect(genPin).toMatch(/reg\.pinRoom\.has\(p\)/);
    expect(genPin).toMatch(/reg\.heldRoom\.has\(p\)/);
  });

  it("draws from a CSPRNG", () => {
    // v2.99.20 #9 replaced Math.random() in `randomDigits6` for exactly this
    // reason and missed this second minting site.
    expect(genPin).toMatch(/crypto\.randomInt\(100000, 1000000\)/);
    // Per-LINE and comment-stripped: the doc comment above genPin NAMES
    // Math.random() to explain the history, and a whole-slice negative assertion
    // matched that prose rather than code. Only a real call matters.
    const code = genPin
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
      .join("\n");
    expect(code).not.toMatch(/Math\.random/);
  });

  it("is bounded — it can neither spin forever nor throw into the register path", () => {
    // Throwing here would deny service to every new client.
    expect(genPin).toMatch(/i < 200/);
    expect(genPin).toMatch(/for \(let n = 100000; n < 1000000; n\+\+\)/);
  });

  it("an UNVERIFIED target is not dialable — invite treats it as unregistered", () => {
    // This is the layer that actually closes the exploit.
    const invite = RELAY.slice(RELAY.indexOf("const targetReachable ="), RELAY.indexOf("const targetReachable =") + 700);
    expect(invite).toMatch(/pinIsAddressable\(target\)/);
    // …and it must sit in the SAME conjunction as the liveness check, so an
    // unverified record takes the existing offline/paging branch rather than a new
    // one (the callee still gets paged and the caller still gets a missed-call row).
    expect(invite).toMatch(/!!target &&[\s\S]{0,600}pinIsAddressable\(target\) &&/);
  });

  it("a rejoin and a pending ring require a PROVEN pin", () => {
    // A rejoin hands over the room id, member list, ICE servers and a LiveKit
    // publish token; a pending ring hands over a live call.
    expect(RELAY).toMatch(
      /const provenPin = verifiedClaim\(pin\) \|\| \(!!effectiveOwned && pin === effectiveOwned\)/,
    );
    expect(RELAY).toMatch(/if \(!keptPrimaryElsewhere && provenPin\) sendRejoinIfInRoom\(/);
    expect(RELAY).toMatch(/if \(provenPin\) deliverPendingRing\(/);
  });

  it("…but an ordinary RELOAD still rejoins (the availability half)", () => {
    // `verifiedClaim` alone would strand a legitimate reload whose createContext
    // hiccupped. `effectiveOwned` is this cid's previously-registered pin, which a
    // fresh anonymous cid cannot have — so the reload works and the squatter is
    // still refused. Asserting the OR is present is asserting that distinction.
    const line = RELAY.split("\n").find((l) => l.includes("const provenPin ="));
    expect(line).toBeTruthy();
    expect(line).toContain("||");
    expect(line).toContain("effectiveOwned");
  });

  it("pinIsAddressable fails OPEN for a record with no verdict", () => {
    // Records created by a direct handleMessage call (unit tests, no untrusted
    // transport) have verifiedPin undefined; those must stay dialable, or every
    // protocol test and every bare deploy loses calling.
    const fn = RELAY.slice(
      RELAY.indexOf("function pinIsAddressable("),
      RELAY.indexOf("function pinIsAddressable(") + 260,
    );
    expect(fn).toMatch(/rec\.verifiedPin !== false/);
    expect(fn).not.toMatch(/rec\.verifiedPin === true/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Finding 4 — HIGH. ReDoS in `normalizeEmail`.

   M42 (v2.99.41) bounded `/<([^>]+)>/` against untrusted header values — but
   only inside `parseInboundAddress`. `normalizeEmail` runs the SAME regex over
   the SAME headers (reached from `extractFrom` and `isSupportRecipient`) with no
   cap, on a route that accepts 5MB of JSON. Node is single-threaded and this one
   process owns every SSE stream, so one request stalls calls fleet-wide.
   ══════════════════════════════════════════════════════════════════════════ */
describe("normalizeEmail — bounded before the quadratic match", () => {
  it("returns '' for an over-long value instead of running the regex", () => {
    expect(normalizeEmail("<".repeat(5000))).toBe("");
    expect(normalizeEmail("a".repeat(2000) + "@x.com")).toBe("");
  });

  it("the pathological input completes in milliseconds", () => {
    // The shape that made it quadratic: many `<`, no `>`.
    const evil = "<".repeat(200_000);
    const t0 = Date.now();
    expect(normalizeEmail(evil)).toBe("");
    expect(Date.now() - t0).toBeLessThan(50);
  });

  it("still parses every legitimate shape", () => {
    expect(normalizeEmail("Alice <alice@example.org>")).toBe("alice@example.org");
    expect(normalizeEmail("  Bob@Example.ORG  ")).toBe("bob@example.org");
    expect(normalizeEmail({ address: "c@d.io" })).toBe("c@d.io");
    expect(normalizeEmail({ email: "E@F.io" })).toBe("e@f.io");
    expect(normalizeEmail(undefined)).toBe("");
    // RFC 5321 caps an addr-spec at 320 bytes, so nothing real is near the bound.
    expect(normalizeEmail("x".repeat(300) + "@y.io")).toContain("@y.io");
  });

  it("the cap lives in the FUNCTION, not at each call site", () => {
    // A per-call-site cap is the thing that failed the first time: two call sites
    // existed and only one was covered. Any future caller must inherit it.
    const fn = INBOUND.slice(
      INBOUND.indexOf("export function normalizeEmail("),
      INBOUND.indexOf("export function extractFrom("),
    );
    expect(fn).toMatch(/if \(s\.length > MAX_INBOUND_ADDRESS_LEN\) return "";/);
    // …and the guard must precede the match.
    expect(fn.indexOf("MAX_INBOUND_ADDRESS_LEN")).toBeLessThan(fn.indexOf("s.match("));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Finding 2 — HIGH. A parked peer could inject SDP into the victim's ACTIVE call.

   The S2 membership gate deliberately counts a HELD room as shared, and it is
   evaluated from the SENDER's side — but the relayed frame carried no room, so the
   receiver could not distinguish a held-room signal from a live-call one. A peer
   whose call the victim had parked could therefore land in `onSignal` with no
   matching `peers[from]`, have `createPeer` built around the victim's CURRENTLY
   live stream, and receive the mic and camera from a different, private call.
   ══════════════════════════════════════════════════════════════════════════ */
describe("Finding 2 — a relayed signal names the room that authorized it", () => {
  it("the server stamps roomId and derives it from the matching room", () => {
    const sig = RELAY.slice(RELAY.indexOf('case "signal": {'), RELAY.indexOf('case "leave": {'));
    // The room is chosen by WHICH clause matched, not blindly from the active room.
    expect(sig).toMatch(
      /const matchedRid =\s*\n?\s*!!activeRid && reg\.rooms\.get\(activeRid\)\?\.has\(to\) \? activeRid : heldRid;/,
    );
    expect(sig).toMatch(/if \(!matchedRid\) break;/);
    expect(sig).toMatch(/roomId: matchedRid,/);
    // …and the client never supplies it, so it cannot be forged.
    expect(sig).not.toMatch(/roomId: (msg|String\(msg)/);
  });

  it("the client passes the frame's room into onSignal", () => {
    const client = fs.readFileSync(path.join(ROOT, "client/src/lib/relayClient.ts"), "utf8");
    expect(client).toMatch(/case "signal":\s+onSignal\(m\.from!, m\.data, m\.roomId\);/);
    // The disposition is consulted BEFORE any peer is looked up or created.
    const fn = client.slice(client.indexOf("async function onSignal("), client.indexOf("async function flushCand("));
    expect(fn.indexOf("signalDisposition(")).toBeLessThan(fn.indexOf("let peer = peers[from]"));
    expect(fn.indexOf("signalDisposition(")).toBeLessThan(fn.indexOf("createPeer("));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   R-MODSCOPE (findings 13, 33) — MEDIUM. Moderation reached HELD members and
   acted on their OTHER call.

   `room.has(target)` is true for someone who PARKED this call — the roster keeps
   held members precisely so they can resume. So `force-mute` was delivered to a
   member who was live in a different call and applied there, and `kick` called
   `leaveRoom`, which removes the target from their ACTIVE room: kicking a held
   member dropped an unrelated call AND left them a member of the room they were
   kicked from. Bypassable and destructive at the same time.

   Finding 14 — MEDIUM. No host succession when the host's SSE is grace-reaped.
   ══════════════════════════════════════════════════════════════════════════ */
describe("R-MODSCOPE — moderation is scoped to the room it was issued for", () => {
  // `mod` is the LAST case in handleMessage, so slice to the end of the file.
  const mod = RELAY.slice(RELAY.indexOf('case "mod": {'));

  it("distinguishes ACTIVE membership from mere roster membership", () => {
    expect(mod).toMatch(/const inActiveRoom = \(p: string\) =>/);
    expect(mod).toMatch(/reg\.pinRoom\.get\(p\) \?\? reg\.clients\.get\(p\)\?\.roomId \?\? null\) === rid/);
  });

  it("mute and mute-all skip a member who parked this call", () => {
    expect(mod).toMatch(/if \(!room\.has\(target\) \|\| !inActiveRoom\(target\)\) break;/);
    expect(mod).toMatch(/if \(p !== conn\.pin && inActiveRoom\(p\)\) sendTo\(p, \{ type: "force-mute"/);
  });

  it("kick removes the target from THIS room, by whichever route they are in it", () => {
    // The three cases: holding it, active in it, or a reaped connection whose
    // membership survives for auto-rejoin.
    expect(mod).toMatch(/if \(reg\.heldRoom\.get\(target\) === rid\) \{\s*\n\s*releaseHeldRoom\(reg, target\);/);
    expect(mod).toMatch(/\} else if \(inActiveRoom\(target\)\) \{\s*\n\s*leaveRoom\(reg, target\);/);
    expect(mod).toMatch(/reg\.rooms\.get\(rid\)\?\.delete\(target\);/);
    // A bare `leaveRoom(reg, target)` as the ONLY removal path is the bug.
    expect(mod).not.toMatch(/sendTo\(target, \{ type: "kicked"[^\n]*\}\);\s*\n\s*leaveRoom\(reg, target\);/);
  });

  it("moderation frames name their room, and the client honours it", () => {
    expect(mod).toMatch(/type: "force-mute", on: action === "mute", by: conn\.pin, roomId: rid/);
    expect(mod).toMatch(/type: "kicked", by: conn\.pin, roomId: rid/);
    const client = fs.readFileSync(path.join(ROOT, "client/src/lib/relayClient.ts"), "utf8");
    // Fails OPEN on a missing room (an older frame still applies).
    expect(client).toMatch(/if \(!m\.roomId \|\| m\.roomId === roomId\) onForceMute\(m\)/);
    // A kick for a PARKED call must not hang up the call we are actually on.
    expect(client).toMatch(/if \(m\.roomId === heldRoomId\) dropHeld\(\);/);
  });

  it("does NOT add the active-room predicate to the knock APPROVER", () => {
    // v2.99.43/M53: a host whose own call is on HOLD must still be able to admit
    // a knocker. That gate is `room.has(conn.pin)` on the approver and must stay.
    // Window must clear the long M45 rationale comment before the check itself.
    const knock = RELAY.slice(
      RELAY.indexOf('case "knock-approve"'),
      RELAY.indexOf('case "refresh-ice"'),
    );
    expect(knock).toMatch(/room\.has\(conn\.pin\)/);
    expect(knock).not.toMatch(/inActiveRoom\(conn\.pin\)/);
  });
});

describe("Finding 14 — a grace-reaped host is succeeded", () => {
  it("promoteHostIfVacant runs on the active-call reap branch, AFTER the delete", () => {
    // v2.99.47's M53 fix covered `leaveRoom`; a host whose SSE simply dies reaches
    // this branch instead, and moderation plus the History "Join" knock died with
    // them. The call must come after `reg.clients.delete(pin)`, because the
    // successor filter is `reg.clients.has(p)`.
    const branch = RELAY.slice(
      RELAY.indexOf('broadcastToRoom(reg, rid, { type: "peer-left", pin }, pin);'),
      RELAY.indexOf("touchBusyState();", RELAY.indexOf('broadcastToRoom(reg, rid, { type: "peer-left", pin }, pin);')),
    );
    expect(branch).toMatch(/promoteHostIfVacant\(reg, rid, pin\);/);
    expect(branch.indexOf("reg.clients.delete(pin)")).toBeLessThan(branch.indexOf("promoteHostIfVacant"));
  });
});
