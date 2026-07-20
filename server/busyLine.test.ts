/* ============================================================
   v2.88 — carrier-style busy line ("On a call" before you dial).

   `pinsInCall` is a PURE READ of the relay's in-memory registry:
   a pin counts as in-call when its primary client sits in a room
   (clients.get(pin).roomId != null). The tRPC layer folds the
   verdict into directory.lookup / directory.presenceMany /
   contacts.list as an `inCall` boolean. Single-instance by design
   (the same instance serves the SSE signaling), like the rest of
   server/relay.ts.
   ============================================================ */
import { describe, it, expect, afterEach } from "vitest";
import {
  createRegistry,
  pinsInCall,
  _setActiveRegistryForTests,
  type RelayClient,
  type RelaySocket,
} from "./relay";

const noopSocket: RelaySocket = { send: () => {}, close: () => {} };

function makeClient(roomId: string | null): RelayClient {
  return {
    socket: noopSocket,
    name: "Test",
    roomId,
    cid: "cid-" + Math.random().toString(36).slice(2, 8),
    graceT: null,
    ringing: new Set(),
  };
}

afterEach(() => _setActiveRegistryForTests(null));

describe("pinsInCall (v2.88 busy line)", () => {
  it("returns the empty set when no registry is attached (tests / cold paths)", () => {
    _setActiveRegistryForTests(null);
    expect(pinsInCall(["111111", "222222"]).size).toBe(0);
  });

  it("flags ONLY the pins whose client is in a room", () => {
    const reg = createRegistry();
    reg.clients.set("111111", makeClient("r-abc")); // in an ANSWERED call
    reg.roomMeta.set("r-abc", { accepted: true } as never); // review v2.88: a
    // caller alone in a still-RINGING dial room must not read as "on a call"
    reg.clients.set("222222", makeClient(null)); // registered, idle
    // 333333: not even registered
    _setActiveRegistryForTests(reg);

    const busy = pinsInCall(["111111", "222222", "333333"]);
    expect(busy.has("111111")).toBe(true);
    expect(busy.has("222222")).toBe(false);
    expect(busy.has("333333")).toBe(false);
    expect(busy.size).toBe(1);
  });

  it("a caller alone in an unanswered dial room is NOT busy (review v2.88)", () => {
    const reg2 = createRegistry();
    reg2.clients.set("444444", makeClient("r-dial"));
    _setActiveRegistryForTests(reg2);
    expect(pinsInCall(["444444"]).has("444444")).toBe(false);
  });

  it("reflects hang-up immediately (roomId cleared → no longer busy)", () => {
    const reg = createRegistry();
    const client = makeClient("r-live");
    reg.clients.set("444444", client);
    reg.roomMeta.set("r-live", { accepted: true } as never);
    _setActiveRegistryForTests(reg);
    expect(pinsInCall(["444444"]).has("444444")).toBe(true);

    client.roomId = null; // leaveRoom() clears this on hang-up
    expect(pinsInCall(["444444"]).has("444444")).toBe(false);
  });
});

describe("busy-line presence field surface (shape pins)", () => {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const ROUTERS = fs.readFileSync(path.resolve(__dirname, "v2routers.ts"), "utf8");

  it("directory.lookup, directory.presenceMany, and contacts.list all return inCall", () => {
    // lookup + presenceMany + contacts.list each fold the registry read in,
    // hidden-guest privacy still wins (a hidden guest is never shown busy).
    // v2.91: the read is the TIERED async variant — local registry on the
    // signaling node, the Redis mirror on API-tier instances (REDIS_URL set,
    // no local relay clients). Same verdict semantics either way.
    const inCallFields = ROUTERS.match(/inCall: hidden \? false : /g) || [];
    expect(inCallFields.length).toBeGreaterThanOrEqual(3);
    expect(ROUTERS).toMatch(/await pinsInCallAsync\(\[id\.number\]\)/); // lookup (single)
    expect(ROUTERS).toMatch(/await pinsInCallAsync\(idents\.map\(\(i\) => i\.number\)\)/); // batches
    // The sync single-instance read must NOT sneak back into the routers —
    // it lies on the API tier of a scaled-out deploy.
    expect(ROUTERS).not.toMatch(/[^\w]pinsInCall\(/);
  });
});
