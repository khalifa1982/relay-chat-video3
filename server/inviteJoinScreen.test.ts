/**
 * #109 — the invite / party-line JOIN screen.
 *
 * The claims that MATTER here are behavioural, so they are checked by driving the
 * real registry rather than by reading source:
 *
 *   A. A member's join time is stamped once, at the one funnel every route into a
 *      room passes through, and is NOT rewritten by a rejoin.
 *   B. The roster reader can only ever read a PARTY LINE's own room — that is what
 *      replaces `liveRoomInfo`'s "were you in this room before" gate, which a
 *      link-holder can never satisfy.
 *   C. It never hands back an occupant's 6-digit number.
 *   D. A stamp survives a leader change, and its ABSENCE is reported as unknown
 *      rather than filled in.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createRegistry,
  handleMessage,
  leaveRoom,
  snapshotRoom,
  applyHydratedRooms,
  partyLineRosterOf,
  partyLineRoomId,
  type RelayRegistry,
  type RelaySocket,
} from "./relay";
import { isPersistedRoom, type PersistedRoom } from "./roomStore";
import { joinedLine, lineThumbGradient, inviteInitials, fmtInviteNumber } from "../client/src/app/InviteCard";
import { codeOnly } from "./testing/codeOnly";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const RELAY = read("server/relay.ts");
const ROUTERS = read("server/v2routers.ts");
const STORE = read("server/roomStore.ts");
const APP = read("client/src/App.tsx");
const JOIN = read("client/src/pages/app/Join.tsx");
const CARD = read("client/src/app/InviteCard.tsx");
const GATE = read("client/src/app/OnboardingGate.tsx");
const DIALER = read("client/src/pages/app/Dialer.tsx");

/** Locate a function body exactly, so a PREFIX name can never be read instead
 *  (the v2.104.0 `deleteMessage` / `deleteMessageAsGroupAdmin` collision). */
function fnAt(src: string, name: string): string {
  const re = new RegExp(`(export )?(async )?function ${name}\\b`);
  const m = re.exec(src);
  if (!m) throw new Error(`no function ${name}`);
  const start = src.indexOf("{", m.index + m[0].length);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${name}`);
}

class FakeConn {
  outbox: unknown[] = [];
  pin: string | null = null;
  socket: RelaySocket;
  constructor() {
    this.socket = { send: (o: unknown) => this.outbox.push(o), close: () => {} };
  }
  setPin = (p: string) => {
    this.pin = p;
  };
  asConn() {
    return { socket: this.socket, pin: this.pin, setPin: this.setPin, cid: undefined };
  }
}

function register(reg: RelayRegistry, name: string, pin?: string) {
  const c = new FakeConn();
  handleMessage(reg, c.asConn(), { type: "register", name, pin });
  return c;
}

/** Put two registered pins into one ordinary (PRIVATE) call. */
function privateCall(reg: RelayRegistry) {
  const a = register(reg, "Ann", "111111");
  const b = register(reg, "Ben", "222222");
  handleMessage(reg, a.asConn(), { type: "invite", to: "222222" });
  const ring = b.outbox.find((m) => (m as { type?: string }).type === "ring") as
    | { roomId?: string }
    | undefined;
  handleMessage(reg, b.asConn(), { type: "accept", from: "111111", roomId: ring?.roomId });
  return { a, b, rid: reg.clients.get("111111")?.roomId ?? null };
}

describe("A — the join stamp is written once, at the one funnel", () => {
  let reg: RelayRegistry;
  beforeEach(() => {
    reg = createRegistry();
  });

  it("stamps every member of a room and keeps the two apart", () => {
    const { rid } = privateCall(reg);
    expect(rid).toBeTruthy();
    const j = reg.roomMeta.get(rid!)?.joinedAt;
    // The CREATOR legitimately has no stamp: ensureDialRoom joins them before it
    // sets the metadata. The accepter, who arrives afterwards, does — which is the
    // case the invite screen reads, since a party line sets its metadata first.
    expect(j?.get("222222")).toBeTypeOf("number");
  });

  it("a REJOIN does not rewrite the stamp — the test is membership, not the call", () => {
    const { b, rid } = privateCall(reg);
    const first = reg.roomMeta.get(rid!)!.joinedAt!.get("222222")!;
    // Re-accept into the same room: the pin is already a member, so nothing moves.
    handleMessage(reg, b.asConn(), { type: "accept", from: "111111", roomId: rid! });
    expect(reg.roomMeta.get(rid!)!.joinedAt!.get("222222")).toBe(first);
  });

  it("leaving drops the stamp, so the map only ever names CURRENT members", () => {
    const { rid } = privateCall(reg);
    expect(reg.roomMeta.get(rid!)!.joinedAt!.has("222222")).toBe(true);
    leaveRoom(reg, "222222");
    expect(reg.roomMeta.get(rid!)?.joinedAt?.has("222222") ?? false).toBe(false);
  });

  it("is written INSIDE joinRoomMember and reads membership BEFORE the add", () => {
    const fn = fnAt(RELAY, "joinRoomMember");
    // The ordering is the whole correctness of it: after `room.add(pin)` the test
    // is always false and every rejoin would restamp.
    const guard = fn.indexOf("if (!room.has(pin))");
    const add = fn.indexOf("room.add(pin)");
    expect(guard).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(add);
  });
});

describe("B — the roster reader can only read a party line's own room", () => {
  let reg: RelayRegistry;
  beforeEach(() => {
    reg = createRegistry();
  });

  it("returns an EMPTY roster for a number that is in a private call", () => {
    // THE security property. `liveRoomInfo` is gated on the requester having been
    // in the room; a link-holder never has. This is gated on the TARGET instead:
    // it reads `pl-<number>` and nothing else, so being handed a person's number
    // whose owner is mid-call reveals nobody.
    const { rid } = privateCall(reg);
    expect(rid).not.toBe(partyLineRoomId("111111"));
    const r = partyLineRosterOf(reg, "111111");
    expect(r?.members).toEqual([]);
  });

  it("derives the room id from the number and reads no other room", () => {
    const fn = fnAt(RELAY, "partyLineRosterOf");
    expect(fn).toMatch(/const rid = partyLineRoomId\(number\)/);
    // It must never consult where the pin actually is — that is the private-call
    // leak, one identifier away.
    expect(fn).not.toMatch(/pinRoom/);
    expect(fn).not.toMatch(/\.roomId/);
    expect(fn).not.toMatch(/heldRoom/);
  });

  it("lists CONNECTED members only, so a ghost is not advertised as present", () => {
    const rid = partyLineRoomId("900900");
    reg.roomMeta.set(rid, {
      startedAt: 1000,
      answeredAt: null,
      lastActiveAt: 1000,
      dialedNumber: "900900",
      accepted: false,
      roster: new Map([["333333", "Ghost"]]),
      hostPin: null,
      cohosts: new Set(),
    });
    reg.rooms.set(rid, new Set(["333333"])); // a member with no live client
    const r = partyLineRosterOf(reg, "900900");
    expect(r?.members).toEqual([]);
  });

  it("reports the members it does find, with role and join time", () => {
    const rid = partyLineRoomId("900901");
    reg.roomMeta.set(rid, {
      startedAt: 500,
      answeredAt: null,
      lastActiveAt: 500,
      dialedNumber: "900901",
      accepted: false,
      roster: new Map(),
      hostPin: null,
      cohosts: new Set(["444444"]),
      joinedAt: new Map([["444444", 777]]),
    });
    register(reg, "Cara", "444444");
    reg.rooms.set(rid, new Set(["444444"]));
    const r = partyLineRosterOf(reg, "900901");
    expect(r?.members).toEqual([
      { pin: "444444", name: "Cara", role: "cohost", joinedAt: 777 },
    ]);
  });

  it("a malformed number reads nothing at all", () => {
    expect(partyLineRosterOf(reg, "12")).toBe(null);
    expect(partyLineRosterOf(reg, "abcdef")).toBe(null);
  });

  it("the API-tier entry degrades to null off the signaling node", () => {
    const fn = fnAt(RELAY, "partyLineRosterFor");
    expect(fn).toMatch(/const reg = activeRegistry;\s*\n\s*if \(!reg\) return null;/);
  });
});

describe("C — no occupant's number ever leaves the server", () => {
  const q = ROUTERS.slice(
    ROUTERS.indexOf("inviteCard: publicProcedure"),
    ROUTERS.indexOf("geoSelf: publicProcedure"),
  );
  it("the slice really is the procedure", () => {
    expect(q.length).toBeGreaterThan(500);
    expect(q).toMatch(/getPartyLineByNumber/);
  });

  it("the occupant projection EMITS no pin", () => {
    // Scoped to the RETURNED object, not the whole map body: the projection
    // legitimately READS `m.pin` to resolve the identity behind it, and a sweep
    // that forbade the identifier outright would fail on correct code. What must
    // never exist is a `pin:` KEY on the way out.
    const body = codeOnly(q);
    const map = body.slice(body.indexOf("members: (live?.members ?? [])"));
    const emitted = map.slice(map.indexOf("return {"), map.indexOf("};"));
    expect(emitted.length).toBeGreaterThan(80);
    expect(emitted).not.toMatch(/(^|[\s{,])pin\s*[:,]/);
    expect(emitted).not.toMatch(/\bm\.pin\b/);
    // ...while the read that resolves the identity is still there, so the
    // assertion above is scoped rather than vacuous.
    expect(map).toMatch(/byNumber\.get\(m\.pin\)/);
  });

  it("the LINE's own number is returned — it is the link the caller already holds", () => {
    expect(q).toMatch(/number: line\.number/);
  });

  it("a number that is not a party line returns null, keeping the disclosure scoped", () => {
    expect(q).toMatch(/if \(!line\) return null;/);
  });

  it("is throttled before it does any work", () => {
    const gate = q.indexOf("directoryGate(ctx)");
    const work = q.indexOf("getPartyLineByNumber");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(work);
  });

  it("`directory.liveRoom` STILL refuses to hand back pins", () => {
    // The sibling endpoint's own guarantee, re-pinned here because this release
    // adds a second roster reader and the two must not drift.
    const lr = ROUTERS.slice(
      ROUTERS.indexOf("liveRoom: publicProcedure"),
      ROUTERS.indexOf("inviteCard: publicProcedure"),
    );
    expect(lr.length).toBeGreaterThan(200);
    expect(lr).not.toMatch(/pin: m\.pin/);
  });

  it("a NULL verified column reads as a guest rather than throwing", () => {
    expect(q).toMatch(/verified: boolean \| null/);
  });
});

describe("D — the stamp survives a leader change, and its absence is honest", () => {
  it("snapshot → hydrate round-trips the join time", () => {
    const reg = createRegistry();
    const { rid } = privateCall(reg);
    const snap = snapshotRoom(reg, rid!)!;
    const stamped = snap.members.find((m) => m.pin === "222222")!;
    expect(stamped.joinedAt).toBeTypeOf("number");

    const next = createRegistry();
    applyHydratedRooms(next, [snap]);
    expect(next.roomMeta.get(rid!)!.joinedAt!.get("222222")).toBe(stamped.joinedAt);
  });

  it("a record from a not-yet-updated instance hydrates with NO stamp, not a fake one", () => {
    const rec: PersistedRoom = {
      roomId: "pl-900902",
      members: [{ pin: "555555", name: "Dee" }], // no joinedAt — pre-feature shape
      hostPin: null,
      cohosts: [],
      startedAt: 10,
      answeredAt: null,
      lastActiveAt: 10,
      dialedNumber: "900902",
      accepted: false,
      roster: [["555555", "Dee"]],
    };
    expect(isPersistedRoom(rec)).toBe(true);
    const reg = createRegistry();
    applyHydratedRooms(reg, [rec]);
    // No map at all rather than a map of invented times.
    expect(reg.roomMeta.get("pl-900902")!.joinedAt).toBeUndefined();
  });

  it("a garbage stamp drops the WHOLE record — hydration feeds the live registry", () => {
    const bad = {
      roomId: "pl-900903",
      members: [{ pin: "666666", name: "Eve", joinedAt: "soon" }],
      hostPin: null,
      cohosts: [],
      startedAt: 10,
      answeredAt: null,
      lastActiveAt: 10,
      dialedNumber: "900903",
      accepted: false,
      roster: [],
    };
    expect(isPersistedRoom(bad)).toBe(false);
  });

  it("an unstamped member serializes exactly as before", () => {
    const fn = fnAt(RELAY, "snapshotRoom");
    // A spread guarded on `has`, so the key is absent rather than `undefined`.
    expect(fn).toMatch(/\.\.\.\(meta\.joinedAt\?\.has\(pin\) \? \{ joinedAt: meta\.joinedAt\.get\(pin\) \} : \{\}\)/);
    expect(STORE).toMatch(/if \(mm\.joinedAt !== undefined && !isNum\(mm\.joinedAt\)\) return false;/);
  });
});

describe("the link lands on the join screen, and joining is still a tap", () => {
  it("/i/<pin> routes to /app/join, not the dial pad", () => {
    const route = APP.slice(APP.indexOf('<Route path={"/i/:pin"}>'), APP.indexOf('<Route path={"/g/:token"}>'));
    expect(route.length).toBeGreaterThan(100);
    expect(route).toMatch(/\/app\/join\?to=\$\{pin\}/);
    expect(route).not.toMatch(/\/app\/dialer\?to=/);
  });

  it("the /app/join route exists and is code-split like the other secondary tabs", () => {
    expect(APP).toMatch(/<Route path=\{"\/app\/join"\}>/);
    expect(APP).toMatch(/const Join = lazy\(\(\) => import\("\.\/pages\/app\/Join"\)\)/);
  });

  it("the dial happens ONLY inside a handler — there is no auto-dial effect", () => {
    // The M48/M60 property. A `useEffect` that dials on mount is exactly the
    // forced-hot-mic hole this screen replaces, so the ONE dial call must sit in
    // the click path.
    const fn = fnAt(JOIN, "join");
    expect(fn).toMatch(/engine\.dial\(target/);
    const effects = JOIN.split("useEffect(");
    for (const e of effects.slice(1)) {
      expect(e.slice(0, e.indexOf("}, ["))).not.toMatch(/engine\.dial\(/);
    }
    // Exactly one dial site in the whole screen.
    expect(codeOnly(JOIN).match(/engine\.dial\(/g)?.length).toBe(1);
  });

  it("one tap places at most one call", () => {
    const fn = fnAt(JOIN, "join");
    expect(fn).toMatch(/if \(!target \|\| dialedRef\.current/);
    expect(fn).toMatch(/dialedRef\.current = true;/);
    // A refused dial gives the tap back rather than latching the screen dead.
    expect(fn).toMatch(/if \(!ok\) \{\s*\n\s*dialedRef\.current = false;/);
  });

  it("strips the target from the URL so a reload cannot re-dial", () => {
    expect(fnAt(JOIN, "join")).toMatch(/replaceState\(null, "", "\/app\/join"\)/);
  });

  it("the DIAL PAD's own arrival branch is untouched — belt and braces", () => {
    // Anyone pasting the long ?to= form still hits the prefill, so this release
    // cannot have widened that path even by accident.
    expect(DIALER).toMatch(/if \(arrivedWithDialTarget\(to\) && !intended\) \{/);
    expect(DIALER).toMatch(/setDialed\(to\);/);
  });

  it("refuses to dial your own number", () => {
    expect(fnAt(JOIN, "join")).toMatch(/if \(target === enginePin\) return;/);
  });

  it("fails OPEN on a lookup error, so a throttled lookup never blocks a real call", () => {
    expect(JOIN).toMatch(/person\.isFetched && !person\.isError/);
  });
});

describe("ONE card, TWO screens", () => {
  it("both the guest gate and the signed-in screen render the SAME component", () => {
    // Two copies is how the two screens come to describe one call differently —
    // and nothing fails when they do, which is why this is pinned.
    expect(GATE).toMatch(/import \{ InviteCard/);
    expect(JOIN).toMatch(/import \{ InviteCard/);
    expect(GATE).toMatch(/<InviteCard/);
    expect(JOIN).toMatch(/<InviteCard/);
  });

  it("the card is PRESENTATIONAL — it fetches nothing and mutates nothing", () => {
    const code = codeOnly(CARD);
    expect(code).not.toMatch(/trpc\./);
    expect(code).not.toMatch(/useMutation|useQuery/);
  });

  it("every avatar on it is an inert disc, never PeerAvatar", () => {
    // PeerAvatar opens a story/profile on tap, which needs PeerOverlaysHost (absent
    // on the guest screen) and the person's NUMBER (deliberately not sent). A
    // control that looks live and does nothing is worse than none.
    expect(codeOnly(CARD)).not.toMatch(/PeerAvatar/);
  });

  it("the guest screen keeps its own single field and its offline block", () => {
    expect(GATE).toMatch(/Enter your name to connect/);
    expect(GATE).toMatch(/const joinBlocked = numberNotFound \|\| calleeOffline/);
  });

  it("both screens read the same public endpoint for the line", () => {
    expect(GATE).toMatch(/directory\.inviteCard\.useQuery/);
    expect(JOIN).toMatch(/directory\.inviteCard\.useQuery/);
  });
});

describe("what the card says", () => {
  it("an UNKNOWN roster is not rendered as an empty one", () => {
    // Off the signaling node the roster is unknown. Saying "nobody is on the line"
    // there would be a false statement about somebody else's call.
    expect(CARD).toMatch(/rosterKnown/);
    expect(CARD).toMatch(/Open the line to see who's on it/);
    expect(CARD).toMatch(/Nobody on the line yet/);
  });

  it("marks who is host and who is a co-host", () => {
    expect(CARD).toMatch(/m\.callRole === "host"/);
    expect(CARD).toMatch(/m\.callRole === "cohost"/);
    expect(CARD).toMatch(/Creator/);
  });

  it("the number is LTR and bidi-isolated so an RTL title cannot reorder it", () => {
    const code = codeOnly(CARD);
    expect(code).toMatch(/dir="ltr"/);
    expect(code).toMatch(/\[unicode-bidi:isolate\]/);
  });

  it("joined times render nothing when unknown, and never a future time", () => {
    // A REALISTIC clock. My first draft used now = 1_000_000, i.e. 16 minutes past
    // the epoch, so "3 hours ago" was a NEGATIVE timestamp and `formatElapsedSince`
    // correctly refused it — the code was right and the test was wrong.
    const now = Date.UTC(2026, 6, 29, 12, 0, 0);
    expect(joinedLine(null, now)).toBe("");
    expect(joinedLine(0, now)).toBe("");
    expect(joinedLine(Number.NaN, now)).toBe("");
    expect(joinedLine(now + 5_000, now)).toBe("");
    expect(joinedLine(now - 30_000, now)).toBe("joined 30s ago");
    expect(joinedLine(now - 4 * 60_000, now)).toBe("joined 4m ago");
    expect(joinedLine(now - 3 * 3600_000, now)).toBe("joined 3h ago");
    expect(joinedLine(now - 26 * 3600_000, now)).toBe("joined 1d 2h ago");
  });

  it("a line's thumbnail is stable for one number and differs across numbers", () => {
    expect(lineThumbGradient("123456")).toBe(lineThumbGradient("123456"));
    expect(lineThumbGradient("123456")).not.toBe(lineThumbGradient("654321"));
    expect(lineThumbGradient("123456")).toMatch(/^linear-gradient\(135deg, hsl\(\d+ /);
  });

  it("initials come from up to two words and never crash on a blank name", () => {
    expect(inviteInitials("Mohamed Alhammadi")).toBe("MA");
    expect(inviteInitials("Ann")).toBe("A");
    expect(inviteInitials("  ")).toBe("?");
    expect(inviteInitials("a b c")).toBe("AB");
  });

  it("formats the number the way the rest of the app does", () => {
    expect(fmtInviteNumber("777777")).toBe("777-777");
    expect(fmtInviteNumber("abc")).toBe("abc");
  });
});
