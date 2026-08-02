import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createRegistry,
  handleMessage,
  roomPartyCap,
  ROOM_MAX,
  type RelayRegistry,
  type RelaySocket,
} from "./relay";

/**
 * #170 — THE TRANSPORT SEAM.
 *
 * Every "how many other people are on this call" question in `relayClient.ts`
 * read `peers`, the MESH peer-connection map. That is the right answer only
 * while the media is a mesh: under mediasoup the participants are consumers on
 * a node and `peers` is EMPTY for a live six-party call, so `aloneInCall()`
 * answers "alone" and the teardown gates hanging off it — the 1:1 auto-end, the
 * fatal-error teardown, the group-dial bootstrap — fire mid-call.
 *
 * The seam ships BEFORE any call is allowed onto a node, which is why the tests
 * here are mostly about a transport nothing can select yet. Two halves:
 *
 *   • THE SERVER announces the cap it will actually refuse at, on every frame
 *     that puts somebody in a room. Driven against the real registry, because
 *     "does every entry path carry it" is exactly what a source read cannot
 *     answer — there are twelve emitters.
 *
 *   • THE CLIENT counts through one function. Its decision is re-declared and
 *     driven below (a source pin cannot say whether a mediasoup call with a
 *     populated roster reads as "alone"), with a parity assertion that the
 *     shipped source really is the function being driven.
 */

const CLIENT = readFileSync(
  resolve(__dirname, "../client/src/lib/relayClient.ts"),
  "utf8",
);
const SERVER = readFileSync(resolve(__dirname, "relay.ts"), "utf8");

/** Source with comment SPANS removed — this file's own prose names the very
 *  identifiers several assertions forbid. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * A function's body, bounded by its own end rather than a fixed slice.
 *
 * The opening brace is the first one reached with the PARAMETER list closed AND
 * no generic open — otherwise `function f(): Array<{…}>` yields its return type
 * and `function g(o: {…})` its parameter object, which is the trap this repo
 * has now hit five times (v2.105.9, v2.105.27, v2.106.4, v2.106.48, v2.106.59)
 * and which it hit again writing this file: two assertions failed against
 * perfectly correct source because they were reading a type annotation.
 */
function fnBody(src: string, decl: string): string {
  const at = src.indexOf(decl);
  expect(at, `${decl} not found`).toBeGreaterThan(-1);
  let paren = 0;
  let angle = 0;
  let i = at + decl.length - 1;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "<") angle++;
    else if (c === ">" && src[i - 1] !== "=") angle = Math.max(0, angle - 1);
    else if (c === "{" && paren <= 0 && angle === 0) break;
  }
  expect(i, `no body brace for ${decl}`).toBeLessThan(src.length);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error(`unterminated ${decl}`);
}

/** The single line a `const NAME = …;` declaration occupies. */
function declLine(src: string, name: string): string {
  const at = src.indexOf(name);
  expect(at, `${name} not found`).toBeGreaterThan(-1);
  const end = src.indexOf(";", at);
  expect(end).toBeGreaterThan(at);
  return src.slice(at, end + 1);
}

type Sent = Record<string, unknown>;
class FakeConn {
  outbox: Sent[] = [];
  pin: string | null = null;
  socket: RelaySocket;
  constructor() {
    this.socket = { send: (o: unknown) => this.outbox.push(o as Sent), close: () => {} };
  }
  setPin = (p: string) => { this.pin = p; };
  ofType(t: string): Sent[] { return this.outbox.filter(m => m.type === t); }
  asConn() { return { socket: this.socket, pin: this.pin, setPin: this.setPin, cid: undefined }; }
}
function register(reg: RelayRegistry, name: string, pin: string) {
  const c = new FakeConn();
  handleMessage(reg, c.asConn(), { type: "register", name, pin });
  return c;
}

/* ──────────────────────────────────────────────────────────────────────────
 * THE SERVER STATES THE CAP IT WILL REFUSE AT
 * ────────────────────────────────────────────────────────────────────────── */
describe("#170 the server announces the cap on every room-entry ack", () => {
  let reg: RelayRegistry;
  beforeEach(() => { reg = createRegistry(); });

  it("stamps maxParty on the dial's own `room` ack", () => {
    const host = register(reg, "Host", "100000");
    register(reg, "Callee", "100001");
    host.outbox.length = 0;
    handleMessage(reg, host.asConn(), { type: "invite", to: "100001" });
    const room = host.ofType("room")[0];
    expect(room).toBeTruthy();
    expect(room.maxParty).toBe(roomPartyCap());
  });

  it("stamps maxParty on the accepter's `joined` ack", () => {
    const host = register(reg, "Host", "100000");
    const callee = register(reg, "Callee", "100001");
    handleMessage(reg, host.asConn(), { type: "invite", to: "100001" });
    const roomId = (host.ofType("room")[0] as { roomId?: string }).roomId;
    callee.outbox.length = 0;
    handleMessage(reg, callee.asConn(), { type: "accept", roomId });
    const joined = callee.ofType("joined")[0];
    expect(joined).toBeTruthy();
    expect(joined.maxParty).toBe(roomPartyCap());
  });

  it("covers all five entry types, and EVERY emitter goes through the stamp", () => {
    // `resumed`, `merged` and a party-line `joined` need a database or a
    // second live call to drive, so this proves them the other way: the stamp
    // lives in the ONE sender, and every emitter of an entry frame reaches it.
    // That is a stronger claim than a per-type behavioural test would be —
    // there are TWELVE emitters and it accounts for all of them.
    const set = declLine(SERVER, "const ROOM_ENTRY_ACKS");
    for (const t of ["room", "joined", "rejoin", "resumed", "merged"]) {
      expect(set, `ROOM_ENTRY_ACKS omits ${t}`).toContain(`"${t}"`);
    }

    const lines = SERVER.split("\n");
    let emitters = 0;
    lines.forEach((line, i) => {
      if (!/type: "(room|joined|rejoin|resumed|merged)"/.test(line)) return;
      emitters++;
      // The literal is either on the safeSend line itself or inside a call
      // opened a few lines above it.
      const ctx = lines.slice(Math.max(0, i - 7), i + 1).join("\n");
      expect(ctx, `an entry ack near line ${i + 1} bypasses safeSend`).toContain("safeSend");
    });
    expect(emitters, "expected every room-entry emitter to be seen").toBeGreaterThanOrEqual(12);

    // …and the stamp really is inside that sender.
    const send = fnBody(SERVER, "function safeSend(");
    expect(send).toContain("ROOM_ENTRY_ACKS.has(t)");
    expect(send).toContain("maxParty: roomPartyCap()");
  });

  it("leaves every OTHER frame type untouched", () => {
    const host = register(reg, "Host", "100000");
    const callee = register(reg, "Callee", "100001");
    handleMessage(reg, host.asConn(), { type: "invite", to: "100001" });
    // The ring, the ringing ack and the registration reply are not room entry.
    for (const box of [host.outbox, callee.outbox]) {
      for (const m of box) {
        if (["room", "joined", "rejoin", "resumed", "merged"].includes(String(m.type))) continue;
        expect(m.maxParty, `${m.type} must not be stamped`).toBeUndefined();
      }
    }
  });

  it("announces the SAME number it refuses at", () => {
    // The whole point: the picker can never offer a party the accept bounces.
    // Fill a room to the cap and check the refusal quotes the announced number.
    const host = register(reg, "Host", "100000");
    let roomId = "";
    for (let i = 1; i < roomPartyCap(); i++) {
      const c = register(reg, `M${i}`, `10000${i}`);
      host.outbox.length = 0;
      handleMessage(reg, host.asConn(), { type: "invite", to: c.pin! });
      roomId = (host.ofType("room")[0] as { roomId?: string } | undefined)?.roomId
        ?? reg.pinRoom.get(host.pin!)!;
      handleMessage(reg, c.asConn(), { type: "accept", roomId });
    }
    expect(reg.rooms.get(roomId)?.size).toBe(roomPartyCap());

    const extra = register(reg, "Extra", "199999");
    host.outbox.length = 0;
    handleMessage(reg, host.asConn(), { type: "invite", to: extra.pin! });
    const err = host.ofType("error")[0];
    expect(err?.code).toBe("full");
    expect(String(err?.message)).toContain(String(roomPartyCap()));
  });

  it("the cap is ONE function, used by every enforcement site", () => {
    const code = codeOnly(SERVER);
    // Nothing may read the raw constant to decide a refusal — that is how the
    // announcement and the enforcement come apart.
    const refusalSites = code.match(/const (?:cap|inviteCap|acceptCap) = [A-Za-z_]+/g) || [];
    expect(refusalSites.length).toBeGreaterThanOrEqual(4);
    for (const s of refusalSites) {
      expect(s, "a refusal still reads ROOM_MAX directly").toContain("roomPartyCap");
    }
  });

  it("is NOT transport-aware yet, and says why", () => {
    // Returning the mediasoup number for a room that merely CARRIES an
    // assignment would put ten people on a mesh call.
    const body = fnBody(SERVER, "export function roomPartyCap()");
    expect(body).toContain("ROOM_MAX");
    expect(body).not.toContain("transportCap");
    expect(body).not.toContain("voip");
    expect(roomPartyCap()).toBe(ROOM_MAX);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * THE CLIENT COUNTS THROUGH ONE FUNCTION
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The shipped decision, re-declared so it can be DRIVEN. Whether a mediasoup
 * call with a populated roster reads as "alone" is the entire correctness
 * claim of this release, and no source assertion can answer it.
 *
 * Trustworthy only while it matches the original — pinned immediately below.
 */
function remoteParticipantsCopy(
  callTransport: "mesh" | "mediasoup",
  peers: Record<string, { name: string }>,
  sigRoster: Map<string, string>,
): Array<{ pin: string; name: string }> {
  if (callTransport === "mesh") {
    return Object.keys(peers).map(pin => ({ pin, name: peers[pin].name || "Guest" }));
  }
  return Array.from(sigRoster, ([pin, name]) => ({ pin, name: name || "Guest" }));
}

describe("#170 remoteParticipants decides who is on the call", () => {
  it("the driven copy matches the shipped source", () => {
    const shipped = fnBody(CLIENT, "function remoteParticipants()");
    const strip = (s: string) => s.replace(/\s+/g, "");
    // Compare only the BODY logic — the copy takes its state as parameters
    // where the original closes over it.
    expect(strip(shipped)).toContain(
      strip(`if (callTransport === "mesh") {
      return Object.keys(peers).map(pin => ({ pin, name: peers[pin].name || "Guest" }));
    }
    return Array.from(sigRoster, ([pin, name]) => ({ pin, name: name || "Guest" }));`),
    );
  });

  it("MESH is byte-identical to the old behaviour: it counts the peer map", () => {
    const peers = { "100001": { name: "A" }, "100002": { name: "B" } };
    const roster = new Map([["999999", "Nobody"]]);
    const out = remoteParticipantsCopy("mesh", peers, roster);
    expect(out.map(p => p.pin).sort()).toEqual(["100001", "100002"]);
    // The roster is NOT consulted on the mesh — a peer whose media died is
    // removed from `peers` while the server still lists them, and letting the
    // roster decide there would change how a working transport tears down.
    expect(out.some(p => p.pin === "999999")).toBe(false);
  });

  it("MEDIASOUP: a live six-party call is NOT alone even with no mesh peers", () => {
    // THE BUG. Under mediasoup `peers` is empty by construction.
    const roster = new Map([
      ["100001", "A"], ["100002", "B"], ["100003", "C"],
      ["100004", "D"], ["100005", "E"],
    ]);
    const out = remoteParticipantsCopy("mediasoup", {}, roster);
    expect(out.length).toBe(5);
    expect(out.length === 0, "aloneInCall() would fire every teardown gate").toBe(false);
  });

  it("MEDIASOUP: an empty roster really is alone", () => {
    expect(remoteParticipantsCopy("mediasoup", {}, new Map()).length).toBe(0);
  });

  it("names a member the roster has no name for rather than rendering blank", () => {
    const out = remoteParticipantsCopy("mediasoup", {}, new Map([["100001", ""]]));
    expect(out[0].name).toBe("Guest");
  });
});

describe("#170 the seam's readers", () => {
  const code = codeOnly(CLIENT);

  it("aloneInCall goes through the seam, not the peer map", () => {
    const body = fnBody(code, "function aloneInCall()");
    expect(body).toContain("remoteParticipantCount() === 0");
    expect(body).not.toContain("Object.keys(peers)");
  });

  it("the add-person occupancy check goes through the seam", () => {
    const body = fnBody(code, "async function addToCall()");
    expect(body).toContain("const n = remoteParticipantCount();");
    expect(body).not.toContain("Object.keys(peers).length");
  });

  it("getRoster goes through the seam — its comment already claimed both transports", () => {
    const body = fnBody(code, "getRoster()");
    expect(body).toContain("remoteParticipants()");
    expect(body).not.toContain("for (const id in peers)");
  });

  it("the count and the list are ONE implementation", () => {
    // Two would be two answers to "who is on the call".
    const body = fnBody(code, "function remoteParticipantCount()");
    expect(body).toContain("remoteParticipants().length");
  });

  it("transportMax reads the SERVER's number, never a client-side mediasoup cap", () => {
    const body = fnBody(code, "function transportMax()");
    expect(body).toContain("roomPartyMax");
    // A hardcoded 10 here is the picker-vs-accept disagreement this removes.
    expect(body).not.toMatch(/\b10\b/);
    expect(body).not.toContain("callTransport");
  });

  it("the mesh-SPECIFIC counts are deliberately left alone", () => {
    // These three read the mesh peer map because they are ABOUT mesh objects —
    // per-sender bitrate caps, per-peer data channels and per-peer RTP senders.
    // Moving them to the roster would be wrong, so the seam stops here.
    for (const decl of [
      "function applyMeshVideoCaps()",
      "function toggleScreen()",
    ]) {
      if (!code.includes(decl)) continue;
      expect(fnBody(code, decl)).toContain("peers");
    }
    expect(code).toContain("Object.keys(peers).length");
  });
});

describe("#170 the roster follows SIGNALING, not media", () => {
  const code = codeOnly(CLIENT);

  it("is dropped on peer-left and NOT inside removePeer", () => {
    // `removePeer` is also the mesh's media-failure teardown (wedged ICE, a
    // quiet rebuild) — cases where the person is still a room member.
    expect(code).toContain("sigRoster.delete(goneP);");
    expect(fnBody(code, "function removePeer(")).not.toContain("sigRoster");
  });

  it("peer-joined records the member BEFORE the already-have-a-peer early return", () => {
    const body = fnBody(code, "function onPeerJoined(");
    const set = body.indexOf("sigRoster.set(");
    const ret = body.indexOf("if (peers[m.pin!]) return;");
    expect(set).toBeGreaterThan(-1);
    expect(ret).toBeGreaterThan(-1);
    expect(set, "the roster must not inherit the mesh-shaped exit").toBeLessThan(ret);
  });

  it("every room-entry handler goes through the ONE recorder", () => {
    // Five ways into a room; three used to call the device+role recorders and
    // `merged` called neither, so a merged member arrived with no device chip
    // and no role badge. The funnel is what stops the roster being the next
    // thing a sixth path forgets.
    const calls = (code.match(/recordRoomMembers\(m\)/g) || []).length;
    expect(calls, "expected room, joined, rejoin, resumed, merged").toBe(5);
    // …and the two it replaced now have exactly one caller each: the funnel.
    expect((code.match(/recordMemberDevices\(/g) || []).length).toBe(2); // decl + funnel
    expect((code.match(/recordMemberRoles\(/g) || []).length).toBe(2);
  });

  it("a room-entry ack REPLACES the roster rather than merging", () => {
    // A swap, a merge and a resume all move you to a DIFFERENT room; merging
    // would carry the room you left into the one you entered.
    expect(fnBody(code, "function setRoomRoster(")).toContain("sigRoster.clear()");
  });

  it("hangUp clears the whole seam", () => {
    const body = fnBody(code, "function hangUp(");
    expect(body).toContain("sigRoster.clear()");
    expect(body).toContain('callTransport = "mesh"');
    expect(body).toContain("roomPartyMax = MESH_MAX");
  });

  it("an absent or nonsense maxParty leaves the client's own default alone", () => {
    // A rolling deploy serves both bundles; a server that does not send the
    // field must not blank the cap.
    const body = fnBody(code, "function recordRoomMembers(");
    expect(body).toContain('typeof m.maxParty === "number"');
    expect(body).toContain("Number.isFinite(m.maxParty)");
    expect(body).toContain("m.maxParty >= 2");
  });
});

describe("#170 nothing can select mediasoup yet, on purpose", () => {
  const code = codeOnly(CLIENT);

  it("callTransport is only ever assigned the mesh", () => {
    // Deriving it from the recorded node assignment would flip LIVE mesh calls
    // onto the roster branch today, because the pool is up and rooms already
    // carry assignments while every call still runs the mesh.
    const writes = code.match(/callTransport = [^;]+/g) || [];
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) expect(w).toContain('"mesh"');
  });

  it("the client still knows nothing about nodes", () => {
    expect(code).not.toMatch(/\bmediasoupNode\b/);
    expect(code).not.toMatch(/\bvoip\b/i);
  });
});
