import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "./testing/codeOnly";
import {
  createRegistry,
  handleMessage,
  roleOf,
  snapshotRoom,
  applyHydratedRooms,
  type RelayRegistry,
  type RelaySocket,
} from "./relay";
import {
  mintGroupCallSeed,
  verifyGroupCallSeed,
  GROUP_SEED_TTL_MS,
} from "./groupCallSeed";
import { isPersistedRoom } from "./roomStore";

const R = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const RELAY = R("server/relay.ts");
const ROUTERS = R("server/v2routers.ts");
const SEED = R("server/groupCallSeed.ts");
const MSG = R("client/src/pages/app/Messages.tsx");
const CLIENT = R("client/src/lib/relayClient.ts");

/* ── a minimal signaling harness, mirroring relay.test.ts ─────────────────── */
class FakeConn {
  outbox: Record<string, unknown>[] = [];
  pin: string | null = null;
  cid = Math.random().toString(36).slice(2);
  socket: RelaySocket = {
    send: (o: Record<string, unknown>) => { this.outbox.push(o); },
    close: () => {},
    alive: () => true,
  } as unknown as RelaySocket;
  setPin = (p: string) => { this.pin = p; };
  asConn() {
    return { socket: this.socket, pin: this.pin, setPin: this.setPin, cid: this.cid };
  }
  last(type: string) {
    return [...this.outbox].reverse().find((m) => m.type === type);
  }
}

function register(reg: RelayRegistry, name: string, pin?: string) {
  const c = new FakeConn();
  handleMessage(reg, c.asConn(), { type: "register", name, pin });
  return c;
}

/**
 * #113 — a group's ADMINS become CO-HOSTS of a call started for that group.
 *
 * Owner, on the previously-declined list: *"DO IT"*.
 *
 * THE PRECONDITION DID NOT EXIST, and that is the first thing this release had to
 * build: a group conversation had NO call button at all (both header buttons are
 * gated on `!isGroup && peerNumber`), and the Group Call screen dials arbitrary
 * NUMBERS with no conversation attached — so there was no way to start a call AS a
 * group and therefore nothing for group roles to seed.
 *
 * THE DIRECTION IS ONE-WAY, and that is the whole safety argument. See the header
 * of `server/groupCallSeed.ts`: every mechanism that hands out hostship — dialling,
 * host succession, knock-approve, a joinable party line — would otherwise become a
 * route to group adminship.
 */
describe("#113 — the seed is a capability, not an assertion", () => {
  const KEY = "test-fleet-secret-for-group-call-seed";
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.REDIS_BUS_SECRET;
    process.env.REDIS_BUS_SECRET = KEY;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.REDIS_BUS_SECRET;
    else process.env.REDIS_BUS_SECRET = prev;
  });

  it("round-trips the admin set for the caller it was minted for", () => {
    const seed = mintGroupCallSeed(7, "111111", ["222222", "333333"]);
    expect(seed).toBeTruthy();
    const claim = verifyGroupCallSeed(seed, "111111");
    expect(claim?.conversationId).toBe(7);
    expect(claim?.adminPins.sort()).toEqual(["222222", "333333"]);
  });

  it("is USELESS to a different pin — the subject comes from the connection", () => {
    // The property that makes a leaked seed harmless: the signaling side takes the
    // subject from the CONNECTION, never from the message, so somebody who
    // intercepts a seed cannot present it as themselves.
    const seed = mintGroupCallSeed(7, "111111", ["222222"]);
    expect(verifyGroupCallSeed(seed, "999999")).toBeNull();
  });

  it("refuses a seed whose admin list was edited", () => {
    // The escalation this exists to prevent: adding your own pin to the list.
    const seed = mintGroupCallSeed(7, "111111", ["222222"])!;
    const [exp, cid, , mac] = seed.split(".");
    expect(verifyGroupCallSeed(`${exp}.${cid}.222222-111111.${mac}`, "111111")).toBeNull();
  });

  it("refuses a seed re-pointed at another group", () => {
    const seed = mintGroupCallSeed(7, "111111", ["222222"])!;
    const [exp, , pins, mac] = seed.split(".");
    expect(verifyGroupCallSeed(`${exp}.8.${pins}.${mac}`, "111111")).toBeNull();
  });

  it("expires", () => {
    const now = 1_000_000;
    const seed = mintGroupCallSeed(7, "111111", ["222222"], now);
    expect(verifyGroupCallSeed(seed, "111111", now + GROUP_SEED_TTL_MS - 1)).toBeTruthy();
    expect(verifyGroupCallSeed(seed, "111111", now + GROUP_SEED_TTL_MS + 1)).toBeNull();
  });

  it("mints nothing for a group with NO admins", () => {
    // A token that authorizes nothing invites a reader to think it did something.
    expect(mintGroupCallSeed(7, "111111", [])).toBeNull();
    expect(mintGroupCallSeed(7, "111111", ["12345", "abcdef"])).toBeNull();
  });

  it("is order-independent, so the same set always verifies", () => {
    // Without the canonical sort, two equivalent sets would sign differently.
    const a = mintGroupCallSeed(7, "111111", ["333333", "222222"], 5_000);
    const b = mintGroupCallSeed(7, "111111", ["222222", "333333"], 5_000);
    expect(a).toBe(b);
  });

  it("refuses everything with no fleet secret — the feature does not exist unauthenticated", () => {
    const seed = mintGroupCallSeed(7, "111111", ["222222"])!;
    delete process.env.REDIS_BUS_SECRET;
    expect(mintGroupCallSeed(7, "111111", ["222222"])).toBeNull();
    expect(verifyGroupCallSeed(seed, "111111")).toBeNull();
  });

  it("VERIFY refuses independently of MINT when there is no secret", () => {
    /* A REAL, IF NARROW, HOLE FOUND BY THE MUTATION RUN. A mutation that gave only
       VERIFY a fallback key survived, because the test above observes mint and
       verify together and mint was still gated — so the pair looked closed while
       verification alone would accept anything signed with a guessable constant.
       Each side must refuse on its own. */
    delete process.env.REDIS_BUS_SECRET;
    for (const guess of ["fallback", "", "secret", "relay"]) {
      process.env.REDIS_BUS_SECRET = guess;
      const forged = mintGroupCallSeed(7, "111111", ["222222"])!;
      delete process.env.REDIS_BUS_SECRET;
      expect(verifyGroupCallSeed(forged, "111111")).toBeNull();
    }
  });

  it("the subject comes from the CONNECTION — a pin in the message is ignored", () => {
    // The signaling side passes `callerPin`, which register bound to a verified
    // number. A seed minted for that pin must not become usable by naming a
    // different one anywhere in the frame.
    const seed = mintGroupCallSeed(7, "111111", ["222222"])!;
    expect(verifyGroupCallSeed(seed, "222222")).toBeNull();
    expect(verifyGroupCallSeed(seed, "111111")).toBeTruthy();
    // …and the room-creation site really reads the connection's pin.
    const site = RELAY.slice(RELAY.indexOf("groupAdminPins: seededGroupAdmins("));
    expect(site.slice(0, 120)).toMatch(
      /groupAdminPins: seededGroupAdmins\(callerPin, \(msg as \{ seed\?: unknown \}\)\.seed\)/,
    );
  });

  it("never throws on hostile input", () => {
    for (const bad of [null, undefined, 42, {}, [], "", ".".repeat(600), "a.b.c.d", "1.2.3", "x".repeat(513)]) {
      expect(() => verifyGroupCallSeed(bad, "111111")).not.toThrow();
      expect(verifyGroupCallSeed(bad, "111111")).toBeNull();
    }
  });
});

describe("#113 — an admin who joins becomes a co-host (behavioural)", () => {
  const KEY = "test-fleet-secret-for-group-call-seed";
  let reg: RelayRegistry;
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.REDIS_BUS_SECRET;
    process.env.REDIS_BUS_SECRET = KEY;
    reg = createRegistry();
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.REDIS_BUS_SECRET;
    else process.env.REDIS_BUS_SECRET = prev;
  });

  /** Dial `to` from `caller`, optionally carrying a seed, and have `to` accept. */
  function dialAndAccept(
    caller: FakeConn,
    callee: FakeConn,
    seed?: string | null,
  ): string {
    handleMessage(reg, caller.asConn(), {
      type: "invite",
      to: callee.pin!,
      ...(seed ? { seed } : {}),
    });
    const room = caller.last("room") as { roomId: string } | undefined;
    expect(room?.roomId, "the caller got no room").toBeTruthy();
    handleMessage(reg, callee.asConn(), { type: "accept", roomId: room!.roomId });
    return room!.roomId;
  }

  it("a seeded admin joining the room is promoted to co-host", () => {
    const host = register(reg, "Host", "111111");
    const admin = register(reg, "Admin", "222222");
    const seed = mintGroupCallSeed(7, "111111", ["222222"]);
    const rid = dialAndAccept(host, admin, seed);
    const meta = reg.roomMeta.get(rid);
    expect(roleOf(meta, "111111")).toBe("host");
    expect(roleOf(meta, "222222")).toBe("cohost");
  });

  it("a member who is NOT an admin gets nothing", () => {
    const host = register(reg, "Host", "111111");
    const plain = register(reg, "Plain", "444444");
    const seed = mintGroupCallSeed(7, "111111", ["222222"]);
    const rid = dialAndAccept(host, plain, seed);
    expect(roleOf(reg.roomMeta.get(rid), "444444")).toBeUndefined();
  });

  it("WITHOUT a seed nothing is promoted — byte-identical to before the feature", () => {
    const host = register(reg, "Host", "111111");
    const admin = register(reg, "Admin", "222222");
    const rid = dialAndAccept(host, admin);
    const meta = reg.roomMeta.get(rid);
    expect(meta?.groupAdminPins).toBeUndefined();
    expect(roleOf(meta, "222222")).toBeUndefined();
  });

  it("a FORGED seed promotes nobody, and does not fail the dial", () => {
    // The call must still connect: the seeding is a refinement, and a bad token
    // must never cost anybody a call.
    const host = register(reg, "Host", "111111");
    const admin = register(reg, "Admin", "222222");
    const rid = dialAndAccept(host, admin, "9999999999999.7.222222.deadbeefdeadbeefdeadbeefdeadbeef");
    expect(reg.roomMeta.get(rid)?.groupAdminPins).toBeUndefined();
    expect(roleOf(reg.roomMeta.get(rid), "222222")).toBeUndefined();
    // …and the call is real.
    expect(reg.rooms.get(rid)?.has("222222")).toBe(true);
  });

  it("a seed minted for SOMEBODY ELSE is refused at the room, not merely unused", () => {
    // The scenario: an attacker who obtained a member's seed dials their own call
    // hoping to have that group's admins moderate it (and to learn who they are by
    // watching who is promoted).
    const attacker = register(reg, "Attacker", "555555");
    const victimAdmin = register(reg, "Admin", "222222");
    const stolen = mintGroupCallSeed(7, "111111", ["222222"]); // minted for 111111
    const rid = dialAndAccept(attacker, victimAdmin, stolen);
    expect(reg.roomMeta.get(rid)?.groupAdminPins).toBeUndefined();
    expect(roleOf(reg.roomMeta.get(rid), "222222")).toBeUndefined();
  });

  it("the HOST is never demoted to co-host by its own seed", () => {
    // Seeding is additive; the creator started the call and stays its host, and
    // host outranks co-host in `roleOf`.
    const host = register(reg, "Host", "111111");
    const other = register(reg, "Other", "222222");
    const seed = mintGroupCallSeed(7, "111111", ["111111", "222222"]);
    const rid = dialAndAccept(host, other, seed);
    const meta = reg.roomMeta.get(rid);
    expect(roleOf(meta, "111111")).toBe("host");
    expect(meta?.cohosts.has("111111")).toBe(false);
  });

  it("`roleOf` gives host precedence, so seeding can never demote anybody", () => {
    /* A SURVIVOR REPORTED RATHER THAN COUNTED, and the honest reading of it.
       A mutation that set `hostPin = null` inside `seedCohostOnJoin` survived, and
       chasing it turned up two facts worth recording:

       1. THE CREATOR DOES NOT PASS THROUGH THAT FUNNEL AT CREATION. `ensureDialRoom`
          calls `joinRoomMember` BEFORE `roomMeta.set`, so `roomMeta.get(rid)` is
          undefined at that moment and the seeding returns immediately. The
          `hostPin === pin` guard is therefore reachable only via `rejoin-recreate`,
          which needs a minted room capability to drive.
       2. IT IS A TIDINESS GUARD, NOT A SAFETY ONE. `roleOf` returns "host" before it
          ever looks at `cohosts`, so even a host wrongly added to that set still
          reads as host everywhere. The guard avoids a meaningless entry and a
          needless `markRoomDirty`, nothing more.

       So the property worth pinning is the PRECEDENCE, which is what actually makes
       demotion impossible — and there is no inbound `rejoin` message at all (it is
       outbound only), which is why a first version of this test "passed" by doing
       nothing. */
    const meta = {
      hostPin: "111111",
      cohosts: new Set(["111111", "222222"]),
    } as unknown as Parameters<typeof roleOf>[0];
    expect(roleOf(meta, "111111")).toBe("host");
    expect(roleOf(meta, "222222")).toBe("cohost");
    // And the guard is where it says it is.
    const fn = RELAY.slice(
      RELAY.indexOf("function seedCohostOnJoin("),
      RELAY.indexOf("/** Fully tear down a room"),
    );
    expect(fn).toMatch(/if \(meta\.hostPin === pin\) return;/);
    expect(fn).toMatch(/meta\.cohosts\.add\(pin\)/);
    // It only ever ADDS: no removal, and no host REASSIGNMENT (the `===`
    // comparison is not an assignment, so the needle must exclude it).
    expect(codeOnly(fn)).not.toMatch(/\.delete\(/);
    expect(codeOnly(fn)).not.toMatch(/hostPin\s*=[^=]/);
  });

  it("promotion happens for EVERY route into the room, not just accept", () => {
    // It lives in `joinRoomMember`, through which every route into a room passes —
    // accept, admit-after-knock, rejoin — so no path can forget it. Asserted
    // structurally because the alternative is testing three protocol flows for one
    // line's placement.
    const join = RELAY.slice(
      RELAY.indexOf("function joinRoomMember("),
      RELAY.indexOf("/** Fully tear down a room"),
    );
    expect(join.length).toBeGreaterThan(200);
    expect(join).toMatch(/seedCohostOnJoin\(reg, roomId, pin\)/);
    // And it is the ONLY call site, so there is one place this can be wrong.
    expect((RELAY.match(/seedCohostOnJoin\(/g) ?? []).length).toBe(2); // definition + call
  });
});

describe("#113 — ONE-WAY: a call host never becomes a group admin", () => {
  it("the signaling layer cannot write a group role at all", () => {
    // The takeover routes this closes: whoever dials is host; succession promotes
    // the longest-standing connected member; knock-approve admits a stranger; a
    // party line is joinable by number. If any of those wrote a group role, it
    // would be a takeover primitive.
    const code = codeOnly(RELAY);
    expect(code).not.toMatch(/setGroupRole/);
    expect(code).not.toMatch(/conversationParticipants/);
    expect(code).not.toMatch(/groupRole/);
    // The seed reader is a pure signature read: no database, no writes.
    const helper = RELAY.slice(
      RELAY.indexOf("function seededGroupAdmins("),
      RELAY.indexOf("function seedCohostOnJoin("),
    );
    expect(helper.length).toBeGreaterThan(100);
    expect(codeOnly(helper)).not.toMatch(/await|getDb|db\./);
  });

  it("the seed module reaches no database and writes nothing", () => {
    /* NOTE, corrected after this assertion failed on the real file: `.update(` also
       matches crypto's own HMAC call, so the original needle was wrong ABOUT THE
       CODE rather than finding a defect. The property is "reaches no database", so
       that is what is named — a DB-specific vocabulary, not a verb that any builder
       API might share. */
    const code = codeOnly(SEED);
    expect(code).not.toMatch(/getDb|drizzle|v2db|statuses|conversationParticipants/);
    expect(code).not.toMatch(/\bawait\b/); // wholly synchronous
    // Only crypto and the shared fleet secret.
    expect(SEED).toMatch(/from "crypto"/);
    expect(SEED).toMatch(/from "\.\/redisBus"/);
  });

  it("host SUCCESSION still never consults group roles", () => {
    /* And it needs no change, which is the elegant part: `pickSuccessor` already
       prefers a CONNECTED co-host, and group admins are now co-hosts — so a
       departing host hands the room to an admin who is actually present, for free.
       Consulting group roles here would risk promoting an admin who is absent. */
    const at = RELAY.indexOf("function promoteHostIfVacant(");
    expect(at).toBeGreaterThan(0);
    // Bounded by its OWN closing brace (a line that is nothing but `}`), not by
    // "the next top-level function" — the next declaration is 30 lines of prose
    // away, and the intervening comment legitimately names `groupAdminPins`.
    const rest = RELAY.slice(at);
    const body = rest.slice(0, rest.indexOf("\n}\n") + 3);
    expect(body.length).toBeGreaterThan(200);
    expect(body.length).toBeLessThan(2000);
    expect(codeOnly(body)).not.toMatch(/groupAdminPins|groupRole/);
    // The co-host preference is real, which is what makes seeding reach succession
    // for free — an admin who is PRESENT is preferred, one who is absent is not.
    expect(body).toMatch(/meta\.cohosts\.has\(p\)/);
  });
});

describe("#113 — the procedure resolves what the client must not assert", () => {
  const proc = (() => {
    const at = ROUTERS.indexOf("  startGroupCall: publicProcedure");
    expect(at).toBeGreaterThan(0);
    const end = ROUTERS.indexOf("  list: publicProcedure", at);
    expect(end).toBeGreaterThan(at);
    const out = ROUTERS.slice(at, end);
    expect(out.length).toBeGreaterThan(400);
    return out;
  })();

  it("checks MEMBERSHIP before resolving anything about the group, AND acts on it", () => {
    /* THE ORDER ALONE WAS NOT ENOUGH, and the mutation run proved it: replacing the
       refusal with `if (false)` left the call and the ordering intact, so a pin that
       checked only those stayed green while any caller could name any group and
       learn its admin set. Pin the USE, not the declaration. */
    const gateAt = proc.indexOf("checkGroupPermission(");
    const rolesAt = proc.indexOf("getGroupRoles(");
    expect(gateAt).toBeGreaterThan(-1);
    expect(rolesAt).toBeGreaterThan(gateAt);
    // …and it checks the capability whose NAME says what is being checked. Both
    // `start-call` and `post-story` are unconditional for members, so borrowing the
    // story capability would behave identically today and lie about what the gate is
    // for — a later reader could not tell whether restricting stories also
    // restricted calling.
    expect(proc).toMatch(/checkGroupPermission\(input\.conversationId, me\.id, "start-call"\)/);
    // The refusal is real, reached before the role read, and throws.
    expect(proc).toMatch(/if \(!gate\.ok\) \{/);
    const refusalAt = proc.indexOf("if (!gate.ok) {");
    expect(refusalAt).toBeGreaterThan(gateAt);
    expect(refusalAt).toBeLessThan(rolesAt);
    expect(proc.slice(refusalAt, rolesAt)).toMatch(/throw new TRPCError/);
  });

  it("refuses a DM by name, and answers 'not a member' like 'no such group'", () => {
    expect(proc).toMatch(/gate\.reason === "not-a-group"/);
    expect(proc).toMatch(/direct chat/);
    expect(proc).toMatch(/That group isn't yours to call\./);
    const branch = proc.slice(proc.indexOf("const message ="), proc.indexOf("throw new TRPCError"));
    expect(branch).not.toMatch(/not-a-member/);
    expect(branch).not.toMatch(/not-found/);
  });

  it("fails CLOSED on an unreadable group", () => {
    expect(proc).toMatch(/gate\.reason === "unavailable" \? "INTERNAL_SERVER_ERROR" : "FORBIDDEN"/);
  });

  it("mints the seed from the SERVER's own role read, never from input", () => {
    expect(proc).toMatch(/mintGroupCallSeed\(input\.conversationId, me\.number, adminPins\)/);
    expect(proc).toMatch(/roles\.roleById\.get\(id\) === "admin" \|\| roles\.ownerIdentityId === id/);
    // Nothing about adminship comes from the request.
    expect(proc).not.toMatch(/input\.admin|input\.host|input\.pins/);
  });

  it("drops a member whose number is malformed rather than dialling it", () => {
    expect(proc).toMatch(/\/\^\\d\{6\}\$\/\.test\(i\.number\)/);
    expect(proc).toMatch(/i\.id !== me\.id/);
  });

  it("writes nothing — it is a read that returns a token", () => {
    const code = codeOnly(proc);
    expect(code).not.toMatch(/setGroupRole|\.update\(|\.insert\(|\.delete\(/);
  });
});

describe("#113 — the client, and the missing precondition it fills", () => {
  it("a GROUP conversation now has call buttons at all", () => {
    // The header's two existing buttons are gated on `!isGroup && peerNumber`, so
    // before this a group thread had none — the reason the ask had no precondition.
    expect(MSG).toMatch(/\{isGroup && thread && \(/);
    expect(MSG).toMatch(/title=\{t\("msg\.callGroup"\)\}/);
    expect(MSG).toMatch(/title=\{t\("msg\.videoCallGroup"\)\}/);
  });

  it("the client asks the SERVER who to ring, rather than dialling from its cache", () => {
    expect(MSG).toMatch(/trpc\.messages\.startGroupCall\.useMutation\(\)/);
    expect(MSG).toMatch(/res\.targets\.map\(\(t\) => t\.number\)/);
    expect(MSG).toMatch(/seed: res\.hostSeed/);
  });

  it("the dial goes ahead when there is no seed", () => {
    // A group with no admin, or a fleet with no signing secret, must still be
    // callable: the call is the point and the seeding is the refinement.
    const fn = MSG.slice(MSG.indexOf("async function startGroupCall("), MSG.indexOf("const [groupInfoOpen"));
    const body = MSG.slice(
      MSG.indexOf("async function startGroupCall("),
      MSG.indexOf("async function startGroupCall(") + 1200,
    );
    expect(body).toMatch(/engine\.dialGroup\(/);
    // No branch refuses to dial on a null seed.
    expect(codeOnly(body)).not.toMatch(/if \(!res\.hostSeed\)/);
    void fn;
  });

  it("the seed rides ONLY the invite that creates the room", () => {
    // The room is created once, so the later invites of a group dial have nothing
    // to seed; sending it on each would be a token repeated for no reason.
    const dial = CLIENT.slice(
      CLIENT.indexOf("async function programmaticGroupDial("),
      CLIENT.indexOf("// ---------- incoming ----------"),
    );
    expect(dial.length).toBeGreaterThan(400);
    expect((dial.match(/opts\?\.seed/g) ?? []).length).toBe(1);
    /* THE PROPERTY, not the literal line: the seed is spread CONDITIONALLY onto the
       invite addressed at `first` — the one that creates the room. Pinning the whole
       one-line `sendWS({...})` froze the message's field list, so it broke the moment
       v2.106.59 added `parties` beside it while saying nothing about the rule. */
    const firstInvite = dial.slice(dial.indexOf('type: "invite", to: first'));
    expect(firstInvite.length).toBeGreaterThan(60);
    expect(firstInvite.slice(0, 300)).toMatch(/\.\.\.\(opts\?\.seed \? \{ seed: opts\.seed \} : \{\}\)/);
    // The add-person path (a room that already exists) sends no seed.
    const addPath = dial.slice(dial.indexOf("if (alreadyInRoom)"), dial.indexOf("} else {"));
    expect(addPath).not.toMatch(/seed/);
  });
});

describe("#113 — the seeding survives a leader change", () => {
  const KEY = "test-fleet-secret-for-group-call-seed";
  let reg: RelayRegistry;
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.REDIS_BUS_SECRET;
    process.env.REDIS_BUS_SECRET = KEY;
    reg = createRegistry();
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.REDIS_BUS_SECRET;
    else process.env.REDIS_BUS_SECRET = prev;
  });

  it("an admin's co-hostship SURVIVES a leader change", () => {
    /* THE PROPERTY THAT MATTERS: moderation must not evaporate when the leader
       dies. Both halves are persisted — the promotion itself (`cohosts`) and the
       seed's admin set (`groupAdminPins`), so somebody who joins the hydrated room
       later is still promotable.

       A FIRST VERSION OF THIS TEST DROVE A PATH THAT DOES NOT HAPPEN, and it is
       recorded rather than quietly rewritten: it snapshotted BEFORE the admin
       accepted and then had them `accept` against the new leader. An accept must
       name the room the ring carried (v2.99.43/M45) and a fresh registry has no
       pending ring, so that accept was always going to be refused — and in reality
       a ring lost with the leader means the CALLER redials, not that the callee
       accepts into a hydrated room. What a returning member actually receives is a
       `rejoin` (verified by probing the real registry). */
    const host = register(reg, "Host", "111111");
    const admin = register(reg, "Admin", "222222");
    const seed = mintGroupCallSeed(7, "111111", ["222222"]);
    handleMessage(reg, host.asConn(), { type: "invite", to: "222222", seed });
    const rid = (host.last("room") as { roomId: string }).roomId;
    handleMessage(reg, admin.asConn(), { type: "accept", roomId: rid });
    expect(roleOf(reg.roomMeta.get(rid), "222222")).toBe("cohost");

    const snap = snapshotRoom(reg, rid)!;
    expect(snap.groupAdminPins).toEqual(["222222"]);
    expect(snap.cohosts).toContain("222222");
    // The record must survive its own validator, or hydration drops it whole.
    expect(isPersistedRoom(snap)).toBe(true);

    const next = createRegistry();
    expect(applyHydratedRooms(next, [snap])).toBe(1);
    // Both halves came back: the role, and the set that makes a LATER join
    // promotable rather than silently unmoderated.
    expect(roleOf(next.roomMeta.get(rid), "222222")).toBe("cohost");
    expect(next.roomMeta.get(rid)?.groupAdminPins?.has("222222")).toBe(true);
    // And the returning member is told to rejoin, which is the real path.
    const admin2 = register(next, "Admin", "222222");
    expect(admin2.last("rejoin")).toBeTruthy();
  });

  it("a room with no seeding serializes exactly as before", () => {
    const host = register(reg, "Host", "111111");
    register(reg, "Other", "222222"); // an UNregistered target is never rung, so no room
    handleMessage(reg, host.asConn(), { type: "invite", to: "222222" });
    const rid = (host.last("room") as { roomId: string }).roomId;
    const snap = snapshotRoom(reg, rid)!;
    expect("groupAdminPins" in snap).toBe(false);
  });

  it("a record with a MALFORMED admin list is dropped whole, not partially applied", () => {
    // Hydration feeds this into the live registry where it GRANTS moderation.
    const base = {
      roomId: "r1",
      members: [{ pin: "111111", name: "A" }],
      hostPin: "111111",
      cohosts: [],
      startedAt: 1,
      answeredAt: null,
      lastActiveAt: 1,
      dialedNumber: null,
      accepted: false,
      roster: [["111111", "A"]] as Array<[string, string]>,
    };
    expect(isPersistedRoom(base)).toBe(true); // absent is fine (a pre-#113 record)
    expect(isPersistedRoom({ ...base, groupAdminPins: ["222222"] })).toBe(true);
    expect(isPersistedRoom({ ...base, groupAdminPins: ["22222"] })).toBe(false);
    expect(isPersistedRoom({ ...base, groupAdminPins: "222222" })).toBe(false);
    expect(isPersistedRoom({ ...base, groupAdminPins: [222222] })).toBe(false);
    expect(isPersistedRoom({ ...base, groupAdminPins: new Array(33).fill("222222") })).toBe(false);
  });
});
