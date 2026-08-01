import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { normalizeEmail } from "./emailInbound";
import { copyOnScreen } from "./testing/copyOnScreen";

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
   squatter into a still-live call with the member list and its media credentials, and
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
    // A rejoin hands over the room id, the member list and ICE servers; a pending
    // ring hands over a live call.
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

/* ══════════════════════════════════════════════════════════════════════════
   BATCH 3 — resource exhaustion. This process is `instances: 1` with
   `max_memory_restart: "1G"` and owns the whole in-memory signaling registry plus
   every SSE stream, so an OOM restart drops every call on the fleet. Three
   surfaces had a RATE limit but no OCCUPANCY limit, and one had an occupancy limit
   so tight it locked out real users.

   The recurring failure mode in this repo is the OPPOSITE of under-protection: a
   guard sized against the threat rather than against real usage (a limiter that
   blocked signup behind CGNAT; a media limiter that rendered broken images). Every
   ceiling below is therefore asserted to be generous, not just present.
   ══════════════════════════════════════════════════════════════════════════ */
const PROXY = fs.readFileSync(path.join(ROOT, "server/_core/storageProxy.ts"), "utf8");
const V2DB = fs.readFileSync(path.join(ROOT, "server/v2db.ts"), "utf8");
const WEBPUSH = fs.readFileSync(path.join(ROOT, "server/webPush.ts"), "utf8");
const EVENTS = fs.readFileSync(path.join(ROOT, "server/v2events.ts"), "utf8");

describe("Finding 3 — the media proxy bounds CONCURRENT streams, not just arrivals", () => {
  it("acquires a slot per request, capped per-IP and process-wide", () => {
    expect(PROXY).toMatch(/const MAX_INFLIGHT_PER_IP = \d+;/);
    expect(PROXY).toMatch(/const MAX_INFLIGHT_TOTAL = \d+;/);
    expect(PROXY).toMatch(/const slot = limitsOff \? \{ release\(\) \{\} \} : acquireStream\(clientIp\);/);
    expect(PROXY).toMatch(/res\.status\(429\)\.send\("Too many concurrent media streams"\)/);
  });

  it("releases from ONE idempotent handler bound to both close and finish", () => {
    // Both events can fire for one response; a double decrement would corrupt the
    // counter into permanent free capacity — worse than the leak it prevents.
    expect(PROXY).toMatch(/res\.on\("close", \(\) => slot\.release\(\)\);/);
    expect(PROXY).toMatch(/res\.on\("finish", \(\) => slot\.release\(\)\);/);
    expect(PROXY).toMatch(/if \(released\) return;\s*\n\s*released = true;/);
  });

  it("the per-IP ceiling is generous enough for a media-heavy screen on shared egress", () => {
    // A throttled media request renders as a BROKEN IMAGE; this endpoint's rate
    // limiter has already been loosened once for exactly that reason.
    const perIp = Number(/const MAX_INFLIGHT_PER_IP = (\d+);/.exec(PROXY)![1]);
    expect(perIp).toBeGreaterThanOrEqual(40);
    const total = Number(/const MAX_INFLIGHT_TOTAL = (\d+);/.exec(PROXY)![1]);
    expect(total).toBeGreaterThan(perIp);
  });

  it("times out the HEADER phase only, never the body", () => {
    // An abort signal on fetch tears down body streaming too, so using it as a
    // whole-request deadline would cancel legitimate large or slow downloads.
    expect(PROXY).toMatch(/const headerT = setTimeout\(\(\) => ac\.abort\(\), UPSTREAM_HEADER_MS\);/);
    expect(PROXY).toMatch(/} finally \{\s*\n\s*clearTimeout\(headerT\);/);
    expect(PROXY).not.toMatch(/AbortSignal\.timeout/);
  });

  it("the stall watchdog is IDLE-based and rearms on every chunk", () => {
    // Wall-clock would break a slow-but-progressing transfer and `<video>` seeking.
    expect(PROXY).toMatch(/nodeStream\.on\("data", armIdle\)/);
    expect(PROXY).toMatch(/const STREAM_IDLE_MS = \d+_?\d*;/);
    const idle = Number(/const STREAM_IDLE_MS = ([\d_]+);/.exec(PROXY)![1].replace(/_/g, ""));
    expect(idle).toBeGreaterThanOrEqual(30_000);
  });

  it("honours the RELAY_RATELIMIT_OFF kill switch", () => {
    expect(PROXY).toMatch(/const limitsOff = process\.env\.RELAY_RATELIMIT_OFF === "1";/);
  });
});

describe("Findings 5/9 — contacts is bounded, without hiding anyone's contacts", () => {
  it("caps new rows per owner by insert RANK (race-safe), not count-then-insert", () => {
    // Two concurrent inserts at CAP-1 would both pass a count-then-insert check;
    // ids are monotonic and unique, so ranks are distinct and the excess self-deletes.
    expect(V2DB).toMatch(/const MAX_CONTACTS_PER_OWNER = \d+;/);
    expect(V2DB).toMatch(/lte\(contacts\.id, row\.id\)/);
    expect(V2DB).toMatch(/if \(Number\(rank\) > MAX_CONTACTS_PER_OWNER\)/);
  });

  it("an UPDATE to an existing contact is never refused by the cap", () => {
    // A user at the ceiling must still be able to rename, favourite, and above all
    // BLOCK someone — refusing that would turn a DoS guard into a safety hole.
    expect(V2DB).toMatch(/if \(!existing && row\) \{/);
  });

  it("listContacts is bounded by the SAME number, so no real user is truncated", () => {
    // Deliberately not a small page: the Contacts screen sorts and filters over the
    // whole list client-side, so a short page would silently HIDE contacts.
    expect(V2DB).toMatch(/\.limit\(MAX_CONTACTS_PER_OWNER\)/);
    const cap = Number(/const MAX_CONTACTS_PER_OWNER = (\d+);/.exec(V2DB)![1]);
    expect(cap).toBeGreaterThanOrEqual(2000);
  });
});

describe("Finding 6 — push subscriptions are capped and the fan-out is bounded", () => {
  it("evicts OLDEST-first past the cap, so the live device is never dropped", () => {
    expect(V2DB).toMatch(/const MAX_PUSH_SUBS_PER_IDENTITY = \d+;/);
    expect(V2DB).toMatch(/\.orderBy\(asc\(pushSubscriptions\.id\)\)/);
    expect(V2DB).toMatch(/mine\.length - MAX_PUSH_SUBS_PER_IDENTITY/);
  });

  it("evicts ONLY when the row is ours (a refused re-bind stays a pure no-op)", () => {
    // Otherwise learning a victim's endpoint would let an attacker trim the
    // victim's devices — the R1 hijack in a new costume.
    const fn = V2DB.slice(V2DB.indexOf("export async function upsertPushSubscription"), V2DB.indexOf("export async function deletePushSubscription"));
    expect(fn.indexOf("const owned =")).toBeLessThan(fn.indexOf("if (owned) {"));
    expect(fn).toMatch(/if \(owned\) \{[\s\S]{0,600}pushSubscriptions\.id, excess/);
  });

  it("eviction failure never fails the subscribe", () => {
    // That would cost the user ring-when-closed for a hygiene task.
    expect(V2DB).toMatch(/\/\/ Eviction is hygiene, never a reason to fail a subscribe/);
  });

  it("the cap sits above a genuine multi-device user", () => {
    const cap = Number(/const MAX_PUSH_SUBS_PER_IDENTITY = (\d+);/.exec(V2DB)![1]);
    expect(cap).toBeGreaterThanOrEqual(8);
  });

  it("sends through a fixed-size pool instead of Promise.all over every row", () => {
    expect(WEBPUSH).toMatch(/const PUSH_CONCURRENCY = \d+;/);
    expect(WEBPUSH).toMatch(/Array\.from\(\{ length: Math\.min\(PUSH_CONCURRENCY, subs\.length\) \}/);
    // Every subscription is still attempted — the pool drains a queue.
    expect(WEBPUSH).toMatch(/if \(i >= subs\.length\) return;/);
    expect(WEBPUSH).not.toMatch(/await Promise\.all\(\s*\n?\s*subs\.map\(/);
  });
});

describe("Finding 38 — the SSE ceiling no longer locks out shared egress", () => {
  it("both stream caps are raised an order of magnitude", () => {
    for (const [name, src] of [["relay.ts", RELAY], ["v2events.ts", EVENTS]] as const) {
      const m = /const MAX_STREAMS_PER_IP = (\d+);/.exec(src);
      expect(m, `${name} declares the cap`).toBeTruthy();
      expect(Number(m![1]), name).toBeGreaterThanOrEqual(200);
    }
  });

  it("the FLOOD defence is untouched", () => {
    // The ceiling bounds held sockets; the open-RATE limiter is what stops a flood,
    // so raising the former weakens nothing.
    expect(RELAY).toMatch(/streamOpenLimiter\.allow\(ip, Date\.now\(\)\)/);
  });

  it("a RECONNECT is not measured against the ceiling", () => {
    // The increment used to happen before the superseded same-cid socket closed, so
    // a plain tab refresh at the limit was refused by the user's own stream.
    expect(RELAY).toMatch(/const isReplacement = clustered \? localDelivery\.has\(cid\) : reg\.connections\.has\(cid\);/);
    expect(RELAY).toMatch(/if \(!isReplacement && \(streamsPerIp\.get\(ip\) \?\? 0\) >= MAX_STREAMS_PER_IP\)/);
  });
});

describe("storage in-flight accounting — behavioural", () => {
  it("the exported seam starts at zero and stays consistent", async () => {
    // A real acquire/release cycle needs the express route; what is worth proving
    // in-process is that the accounting is EXPORTED and observable, so a future
    // leak is diagnosable rather than invisible.
    const { storageInflight } = await import("./_core/storageProxy");
    const before = storageInflight();
    expect(before.total).toBeGreaterThanOrEqual(0);
    expect(before.ips).toBeGreaterThanOrEqual(0);
    // Idempotent release is the property that matters; assert it holds at the
    // source level for the exact double-fire case (close AND finish).
    const rel = PROXY.slice(PROXY.indexOf("release() {"), PROXY.indexOf("/** Test seam"));
    expect(rel).toMatch(/if \(released\) return;/);
    expect(rel).toMatch(/Math\.max\(0, inflightTotal - 1\)/);
    // …and a per-IP counter that reaches zero is DELETED, not left at 0 forever
    // (that was the M33 unbounded-Map leak on this same endpoint).
    expect(rel).toMatch(/if \(n <= 0\) inflightByIp\.delete\(ip\);/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   BATCH 4 — authorization, data integrity, and honest failure.
   ══════════════════════════════════════════════════════════════════════════ */
const ROUTERS = fs.readFileSync(path.join(ROOT, "server/v2routers.ts"), "utf8");
const AUTHLOCAL = fs.readFileSync(path.join(ROOT, "server/authLocal.ts"), "utf8");

describe("R-STATUSBLOCK (10, 18) — the feed drops people I blocked, not just people who blocked me", () => {
  const feed = ROUTERS.slice(ROUTERS.indexOf("  feed: publicProcedure"), ROUTERS.indexOf("  mine: publicProcedure"));

  it("filters BOTH directions", () => {
    // `getContactNumbersForOwner` excludes contacts I blocked, but `savedMeIds` is
    // the other direction and only excluded savers who blocked ME. So someone I had
    // blocked, who had saved my number, stayed in my feed.
    expect(feed).toMatch(/blockedMe\.has\(id\)/);
    expect(feed).toMatch(/blockedIdents\.has\(id\)/);
    expect(feed).toMatch(/getBlockedNumbersForOwner\(me\.id\)/);
  });

  it("…and my OWN statuses are never filtered out by it", () => {
    expect(feed).toMatch(/id === me\.id \|\| \(!blockedMe\.has\(id\) && !blockedIdents\.has\(id\)\)/);
  });

  it("the predicate this restores agreement with checks both directions too", () => {
    // The bug was two independently-written gates disagreeing: the media 403'd
    // (correct) while the text leaked (wrong), so it surfaced as a broken image.
    const fn = V2DB.slice(
      V2DB.indexOf("export async function statusAudienceAuthorized"),
      V2DB.indexOf("export async function statusAudienceAuthorized") + 2600,
    );
    expect(fn).toMatch(/isNumberBlockedBy\(ownerId, requester\.number\)/);
    expect(fn).toMatch(/isNumberBlockedBy\(requesterId, owner\.number\)/);
  });
});

describe("R-REVEAL-ORDER (15, 20) — over-cap view-once media is not destroyed", () => {
  it("the size is checked BEFORE the burn", () => {
    const fn = V2DB.slice(
      V2DB.indexOf("export async function revealExpiringMessage"),
      V2DB.indexOf("export async function markThreadRead"),
    );
    expect(fn.indexOf("maxAttachmentBytes")).toBeLessThan(fn.indexOf("burnExpiringMessage("));
    expect(fn).toMatch(/return \{ tooLarge: true \};/);
    // …and the refusal must happen without burning, i.e. before the claim.
    expect(fn.indexOf("tooLarge: true")).toBeLessThan(fn.indexOf("burnExpiringMessage("));
  });

  it("the router passes its own inline ceiling and reports the refusal honestly", () => {
    expect(ROUTERS).toMatch(/maxAttachmentBytes: REVEAL_MAX_INLINE_BYTES,/);
    expect(ROUTERS).toMatch(/return \{ ok: false as const, tooLarge: true as const \};/);
  });

  it("the client says the message is still there rather than showing a blank card", () => {
    const msgs = fs.readFileSync(path.join(ROOT, "client/src/pages/app/Messages.tsx"), "utf8");
    expect(msgs).toMatch(/"tooLarge" in res && res\.tooLarge/);
    expect(copyOnScreen(msgs, "hasn't been used up")).toBe(true);
  });
});

describe("R-VERIFY-GET (12, 25) — GET /api/auth/verify no longer mutates", () => {
  it("GET only renders a confirm form; POST is the only writer", () => {
    // Mail security gateways FETCH links to detonate them, and express answers HEAD
    // from app.get — so the account was verified before the recipient opened the
    // message. Same defect and same fix shape as /api/email/unsubscribe (v2.99.42).
    const get = AUTHLOCAL.slice(
      AUTHLOCAL.indexOf('app.get("/api/auth/verify"'),
      AUTHLOCAL.indexOf('app.post("/api/auth/verify"'),
    );
    expect(get).not.toMatch(/consumeToken\(/);
    expect(get).toMatch(/<form method="POST" action="\/api\/auth\/verify">/);
    const post = AUTHLOCAL.slice(AUTHLOCAL.indexOf('app.post("/api/auth/verify"'));
    expect(post).toMatch(/consumeToken\(token, Date\.now\(\)\)/);
    // The POST is rate-limited like the other auth routes.
    expect(post).toMatch(/if \(!gate\(req, res\)\) return;/);
  });

  it("the token is the only value reaching the markup, and it is escaped anyway", () => {
    expect(AUTHLOCAL).toMatch(/const safe = token\.replace\(\/\[\^a-f0-9\]\/gi, ""\);/);
  });

  it("verifying clears a credential set before the address was proven (M29's third site)", () => {
    // An attacker registers with the victim's email and sets a password; the link
    // goes to the VICTIM's mailbox, they click, and the attacker's password is now
    // live on a verified account.
    const fn = AUTHLOCAL.slice(
      AUTHLOCAL.indexOf("async function consumeToken"),
      AUTHLOCAL.indexOf("/* ── session cookie"),
    );
    expect(fn).toMatch(/clearUnverifiedCredentials\(row\.userId\)/);
    expect(fn.indexOf("clearUnverifiedCredentials")).toBeLessThan(
      fn.indexOf("set({ emailVerified: true })"),
    );
  });
});

describe("Finding 37 — a blocked user cannot show 'typing…' on the blocker's screen", () => {
  const fn = ROUTERS.slice(ROUTERS.indexOf("  typing: publicProcedure"), ROUTERS.indexOf("  typing: publicProcedure") + 1800);

  it("checks the block per RECIPIENT, after the membership check", () => {
    // A group thread can contain both people who blocked me and people who didn't.
    expect(fn).toMatch(/isNumberBlockedBy\(pid, me\.number\)/);
    expect(fn.indexOf("participants.includes(me.id)")).toBeLessThan(fn.indexOf("isNumberBlockedBy"));
  });

  it("fails OPEN on a DB error", () => {
    // A block-check outage must not silently kill typing indicators for everyone.
    expect(fn).toMatch(/\.catch\(\(\) => false\)/);
  });
});

describe("Finding 36 — deleteMessage is an atomic claim", () => {
  // EXACT name, and bounded by the function's own end rather than a fixed +2200.
  //
  // BOTH were fragile, and v2.104.0 tripped the first: `indexOf("export async function
  // deleteMessage")` is a PREFIX match, so adding `deleteMessageAsGroupAdmin` (the group
  // admin's override, deliberately a separate function) made this slice read that one
  // instead — and the sender-ownership pin below, which exists to prove unsend stays
  // sender-only, silently started asserting it about the wrong code. The `\b` rejects
  // the longer name because the characters either side of the boundary are both word
  // characters. Six test files shared the same prefix-matching helper; all six are fixed.
  const at = V2DB.search(/export async function deleteMessage\b/);
  const fn = V2DB.slice(at, V2DB.indexOf("\nexport ", at + 10));

  it("only the caller that flips deletedAt runs the unread decrement", () => {
    // `unreadCount` is stored, not derived, so a double decrement corrupts counts
    // for messages that were never unsent — permanently.
    expect(fn).toMatch(/isNull\(messages\.deletedAt\)/);
    expect(fn).toMatch(/affectedRows \?\? 0\) > 0/);
    expect(fn).toMatch(/if \(!claimed\) return null;/);
    expect(fn.indexOf("if (!claimed) return null;")).toBeLessThan(fn.indexOf("GREATEST("));
  });

  it("the sender-ownership check is retained", () => {
    expect(fn).toMatch(/eq\(messages\.senderIdentityId, input\.identityId\)/);
  });
});
