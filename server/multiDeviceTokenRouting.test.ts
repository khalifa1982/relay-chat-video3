import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  createRegistry,
  handleMessage,
  type RelayRegistry,
  type RelaySocket,
} from "./relay";

/**
 * v2.106.48 — THE SFU JOIN TOKEN WENT TO THE WRONG DEVICE.
 *
 * The owner: "I tested the calls, and still i can't calling I can't" → "Connects
 * but no audio" → "Every single call" → "Also inspect that no video active".
 * Zero media, both directions, deterministic.
 *
 * THE MECHANISM. Almost everything in the signaling registry is addressed by
 * PIN, and `reg.clients.get(pin)` holds exactly ONE socket. But a number can
 * hold SEVERAL devices (`reg.devices`), and `MULTI_DEVICE_RING: "1"` is baked
 * into ecosystem.config.cjs, so it is live on the fleet. The register handler
 * makes the LATEST REGISTRATION primary — which has nothing to do with which
 * device its owner is calling from; an SSE reconnect on an idle laptop is enough
 * to take primary from the phone in your hand.
 *
 * `pushLivekitToken` addressed the NUMBER while all twelve of its call sites sit
 * directly after a `safeSend(<specific socket>, { room | joined | rejoin })`. So
 * when the dialling device was not the primary, the room frame went to the right
 * device and its join token went to a DIFFERENT one. `joinLivekit` then returns
 * early at "waiting for token": nothing published, nothing subscribed, in both
 * directions — while ring, accept, roster and the in-call UI all succeed. That
 * is exactly "the call connects and there is no audio and no video".
 *
 * The `accept` handler has promoted the answering device since v2.99.5. The
 * CALLER side was simply left out, and that asymmetry is the defect.
 *
 * These are BEHAVIOURAL tests against the real registry and the real
 * `handleMessage`, because which SOCKET a frame lands on is precisely what a
 * source pin cannot tell you — and it is the whole bug.
 *
 * NOT CLAIMED: that this is the cause of the owner's silent calls. It is a
 * deterministic total-media failure for anyone signed in on two devices, which
 * fits the report, and it is fixed. Only a real two-device call settles it.
 */

type Sent = Record<string, unknown>;
class FakeConn {
  outbox: Sent[] = [];
  pin: string | null = null;
  socket: RelaySocket;
  cid: string;
  constructor(cid: string) {
    this.cid = cid;
    this.socket = { send: (o: unknown) => { this.outbox.push(o as Sent); }, close: () => {} };
  }
  setPin = (p: string) => { this.pin = p; };
  asConn() { return { socket: this.socket, pin: this.pin, setPin: this.setPin, cid: this.cid }; }
  ofType(t: string): Sent[] { return this.outbox.filter(m => m.type === t); }
  has(t: string): boolean { return this.ofType(t).length > 0; }
}

function reg2(reg: RelayRegistry, cid: string, name: string, pin?: string) {
  const c = new FakeConn(cid);
  handleMessage(reg, c.asConn(), { type: "register", name, pin });
  return c;
}

describe("the SFU join token reaches the device that is actually in the call", () => {
  let reg: RelayRegistry;
  const prev = {
    url: process.env.LIVEKIT_URL,
    key: process.env.LIVEKIT_API_KEY,
    secret: process.env.LIVEKIT_API_SECRET,
    multi: process.env.MULTI_DEVICE_RING,
  };

  beforeEach(() => {
    reg = createRegistry();
    // Mirror the fleet: LiveKit configured AND multi-device ring on, which is
    // what ecosystem.config.cjs bakes in.
    process.env.LIVEKIT_URL = "wss://sfu.example.test";
    process.env.LIVEKIT_API_KEY = "APIkeytest";
    process.env.LIVEKIT_API_SECRET = "secrettestsecrettestsecrettest00";
    process.env.MULTI_DEVICE_RING = "1";
  });
  afterEach(() => {
    for (const [k, v] of [
      ["LIVEKIT_URL", prev.url], ["LIVEKIT_API_KEY", prev.key],
      ["LIVEKIT_API_SECRET", prev.secret], ["MULTI_DEVICE_RING", prev.multi],
    ] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  /** The token is minted asynchronously, so let the microtask queue drain. */
  const settle = () => new Promise(r => setTimeout(r, 0));

  it("a dial from the NON-PRIMARY device delivers the token to THAT device", async () => {
    // Two devices on one number. The laptop registers LAST, so it is primary —
    // which is what an idle background tab reconnecting does in production.
    const phone = reg2(reg, "cid-phone", "Owner", "777777");
    const laptop = reg2(reg, "cid-laptop", "Owner", "777777");
    expect(phone.pin).toBe("777777");
    expect(laptop.pin).toBe("777777");
    expect(reg.clients.get("777777")!.cid).toBe("cid-laptop");

    const callee = reg2(reg, "cid-callee", "Callee", "555555");
    expect(callee.pin).toBe("555555");

    // Dial from the PHONE.
    handleMessage(reg, phone.asConn(), { type: "invite", to: "555555" });
    await settle();

    // The room ack went to the phone (this was always right)…
    expect(phone.has("room")).toBe(true);
    // …and so must the join token. THE BUG: it went to the laptop.
    expect(phone.has("livekit-token"), "the dialling device must get its token").toBe(true);
    expect(laptop.has("livekit-token"), "the idle device must NOT get it").toBe(false);
  });

  it("the token names the room the dialling device was actually given", async () => {
    const phone = reg2(reg, "cid-phone", "Owner", "777777");
    reg2(reg, "cid-laptop", "Owner", "777777");
    reg2(reg, "cid-callee", "Callee", "555555");
    handleMessage(reg, phone.asConn(), { type: "invite", to: "555555" });
    await settle();
    const room = phone.ofType("room")[0];
    const tok = phone.ofType("livekit-token")[0];
    expect(tok.roomId).toBe(room.roomId);
    expect(String(tok.token || "").length).toBeGreaterThan(20);
    expect(tok.url).toBe("wss://sfu.example.test");
  });

  it("dialling promotes the device to primary, so the mesh signal relay reaches it too", async () => {
    // `signal` routes via reg.clients.get(to) — one socket per number — so the
    // token fix alone would leave the mesh half of this broken, which matters
    // now that a failed SFU falls back to the mesh.
    const phone = reg2(reg, "cid-phone", "Owner", "777777");
    reg2(reg, "cid-laptop", "Owner", "777777");
    expect(reg.clients.get("777777")!.cid).toBe("cid-laptop");
    reg2(reg, "cid-callee", "Callee", "555555");

    handleMessage(reg, phone.asConn(), { type: "invite", to: "555555" });
    await settle();
    expect(reg.clients.get("777777")!.cid).toBe("cid-phone");
    expect(reg.clients.get("777777")!.socket).toBe(phone.socket);
  });

  it("it does NOT steal primary from a device that is mid-call", async () => {
    // Second-line situation: the laptop is in a call, the phone dials out.
    // Taking primary here would break the laptop's live call, which is exactly
    // what the register handler's keepPrimary rule exists to prevent.
    const laptop = reg2(reg, "cid-laptop", "Owner", "777777");
    const other = reg2(reg, "cid-other", "Other", "444444");
    handleMessage(reg, laptop.asConn(), { type: "invite", to: "444444" });
    await settle();
    const rid = String(laptop.ofType("room")[0].roomId);
    handleMessage(reg, other.asConn(), { type: "accept", roomId: rid, from: "777777" });
    await settle();
    expect(reg.clients.get("777777")!.roomId).toBe(rid);

    const phone = reg2(reg, "cid-phone", "Owner", "777777");
    // Registering a second device must not have taken primary either (the live
    // call is on the laptop).
    expect(reg.clients.get("777777")!.cid).toBe("cid-laptop");
    handleMessage(reg, phone.asConn(), { type: "invite", to: "555555" });
    await settle();
    // Still the laptop: the live call's routing is untouched.
    expect(reg.clients.get("777777")!.cid).toBe("cid-laptop");
  });

  it("the ANSWERING device gets its own token, not the number's primary (v2.99.5, re-pinned)", async () => {
    const caller = reg2(reg, "cid-caller", "Caller", "111222");
    // The callee's two devices; the laptop is primary.
    const cPhone = reg2(reg, "cid-cphone", "Callee", "555555");
    const cLaptop = reg2(reg, "cid-claptop", "Callee", "555555");
    expect(reg.clients.get("555555")!.cid).toBe("cid-claptop");

    handleMessage(reg, caller.asConn(), { type: "invite", to: "555555" });
    await settle();
    const rid = String(caller.ofType("room")[0].roomId);

    // Answer on the PHONE.
    handleMessage(reg, cPhone.asConn(), { type: "accept", roomId: rid, from: "111222" });
    await settle();
    expect(cPhone.has("joined")).toBe(true);
    expect(cPhone.has("livekit-token"), "the answering device must get its token").toBe(true);
    // The laptop is told the call was answered elsewhere, and gets no token.
    expect(cLaptop.has("livekit-token")).toBe(false);
  });

  it("both parties end up with a token for the SAME room", async () => {
    const caller = reg2(reg, "cid-caller", "Caller", "111222");
    reg2(reg, "cid-claptop", "Callee", "555555");
    const cPhone = reg2(reg, "cid-cphone", "Callee", "555555");
    handleMessage(reg, caller.asConn(), { type: "invite", to: "555555" });
    await settle();
    const rid = String(caller.ofType("room")[0].roomId);
    handleMessage(reg, cPhone.asConn(), { type: "accept", roomId: rid, from: "111222" });
    await settle();
    // Without both of these the SFU room has one participant and nobody hears
    // anybody — the reported symptom.
    expect(caller.ofType("livekit-token").some(m => m.roomId === rid)).toBe(true);
    expect(cPhone.ofType("livekit-token").some(m => m.roomId === rid)).toBe(true);
  });

  it("refresh-livekit re-mints to the ASKING device, not to the primary", async () => {
    // This is the client's only recovery when a token is lost, so sending it to
    // the wrong device made the failure permanent rather than transient.
    const phone = reg2(reg, "cid-phone", "Owner", "777777");
    const laptop = reg2(reg, "cid-laptop", "Owner", "777777");
    reg2(reg, "cid-callee", "Callee", "555555");
    handleMessage(reg, phone.asConn(), { type: "invite", to: "555555" });
    await settle();
    const before = laptop.ofType("livekit-token").length;

    handleMessage(reg, phone.asConn(), { type: "refresh-livekit" });
    await settle();
    expect(phone.ofType("livekit-token").length).toBeGreaterThanOrEqual(2);
    expect(laptop.ofType("livekit-token").length).toBe(before);
  });

  it("a single-device number is completely unaffected", async () => {
    const solo = reg2(reg, "cid-solo", "Solo", "777777");
    reg2(reg, "cid-callee", "Callee", "555555");
    handleMessage(reg, solo.asConn(), { type: "invite", to: "555555" });
    await settle();
    expect(solo.has("room")).toBe(true);
    expect(solo.has("livekit-token")).toBe(true);
    expect(reg.clients.get("777777")!.cid).toBe("cid-solo");
  });

  it("with LiveKit unconfigured no token is pushed at all, and the dial still works", async () => {
    delete process.env.LIVEKIT_URL;
    const phone = reg2(reg, "cid-phone", "Owner", "777777");
    reg2(reg, "cid-laptop", "Owner", "777777");
    reg2(reg, "cid-callee", "Callee", "555555");
    handleMessage(reg, phone.asConn(), { type: "invite", to: "555555" });
    await settle();
    expect(phone.has("room")).toBe(true);
    expect(phone.has("livekit-token")).toBe(false);
    // The mesh path still promotes the dialling device — that is what the mesh
    // signal relay needs, and it is not an SFU-only concern.
    expect(reg.clients.get("777777")!.cid).toBe("cid-phone");
  });

  it("with the multi-device flag OFF, two devices never share a number in the first place", async () => {
    process.env.MULTI_DEVICE_RING = "0";
    const phone = reg2(reg, "cid-phone", "Owner", "777777");
    const laptop = reg2(reg, "cid-laptop", "Owner", "777777");
    // The register handler honours an explicit pin only when it is free, already
    // this cid's, or — WITH THE FLAG ON — held by another device of the same
    // number. Flag off, the pin is taken by a different cid, so the second
    // device is given a FRESH one. (That is the v2.99.5 report: one profile
    // showing two different numbers on two devices.) So the whole misrouting
    // class cannot arise: there is no shared number to be primary FOR.
    expect(phone.pin).toBe("777777");
    expect(laptop.pin).not.toBe("777777");
    expect(reg.clients.get("777777")!.cid).toBe("cid-phone");

    reg2(reg, "cid-callee", "Callee", "555555");
    handleMessage(reg, phone.asConn(), { type: "invite", to: "555555" });
    await settle();
    expect(phone.has("livekit-token")).toBe(true);
    expect(laptop.has("livekit-token")).toBe(false);
    // And the claim is a no-op on this path: register already owns the decision.
    expect(reg.clients.get("777777")!.cid).toBe("cid-phone");
  });
});

/**
 * REPORTED HONESTLY, BECAUSE THE MUTATION RUN SAID SO. Reinstating the original
 * by-pin token addressing VERBATIM survives every behavioural test above — and
 * it should, because `claimPrimaryForCall` makes the dialling device the primary,
 * so on the two reachable hot paths `reg.clients.get(pin).socket` and the named
 * socket are the SAME object. The promotion MASKS the misrouting.
 *
 * So the behavioural tests measure the promotion, not the addressing, and there
 * is no reachable path here on which they can be told apart: a secondary device
 * is deliberately denied the primary's live-call rejoin (v2.99.5), which is where
 * a non-primary in-call socket would otherwise arise.
 *
 * Both fixes are KEPT, and this is not defence-in-depth theatre: the promotion is
 * what repairs the reported failure, while the required `socket` parameter is what
 * makes the invariant hold BY CONSTRUCTION at the ten other call sites and at
 * whichever site is added next — the twelfth site is how this arose in the first
 * place. Since only source can distinguish them, that half is pinned in source,
 * and this comment records that the distinction is a structural claim rather than
 * an observed behavioural difference.
 */
describe("the token addressing itself, pinned in source because behaviour cannot separate it", () => {
  const SRC = fs.readFileSync(path.resolve(__dirname, "relay.ts"), "utf8");
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  /** Brace-matched, and SEEDED FROM THE ANCHOR's open paren — otherwise the first
   *  `{` after `function claimPrimaryForCall(` is its inline PARAMETER TYPE, not
   *  its body (the trap this repo has hit at v2.105.9, v2.105.27 and v2.106.4). */
  function fnBody(anchor: string): string {
    const at = code.indexOf(anchor);
    expect(at, `anchor must exist: ${anchor}`).toBeGreaterThan(0);
    let i = at + anchor.length;
    let paren = (anchor.match(/\(/g) || []).length - (anchor.match(/\)/g) || []).length;
    while (i < code.length) {
      const c = code[i];
      if (c === "(") paren++;
      else if (c === ")") paren--;
      else if (c === "{" && paren <= 0) break;
      i++;
    }
    const start = i;
    let depth = 0;
    for (; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") { depth--; if (depth === 0) break; }
    }
    const body = code.slice(start, i + 1);
    expect(body.length).toBeGreaterThan(20);
    return body;
  }

  it("pushLivekitToken sends to its `socket` parameter and never to a registry lookup", () => {
    const body = fnBody("function pushLivekitToken(");
    expect(body).toMatch(/safeSend\(socket, \{ type: "livekit-token"/);
    // The defect: resolving the destination from the registry at send time.
    expect(body).not.toMatch(/safeSend\(c\.socket/);
    expect(body).not.toMatch(/safeSend\(client\.socket/);
    expect(body).not.toMatch(/safeSend\(reg\.clients/);
  });

  it("the socket is REQUIRED, so a forgotten site is a compile error not a dead call", () => {
    expect(code).toMatch(
      /function pushLivekitToken\(\s*reg: RelayRegistry,\s*pin: string,\s*roomId: string,\s*socket: RelaySocket,?\s*\)/,
    );
    // A default would silently preserve the bug at any site somebody forgets, so
    // the ban is scoped to THIS signature (an unrelated `const socket: RelaySocket
    // = {` legitimately exists elsewhere in the file).
    const sig = code.slice(code.indexOf("function pushLivekitToken("));
    const upTo = sig.slice(0, sig.indexOf(")") + 1);
    expect(upTo).not.toMatch(/socket: RelaySocket\s*=/);
    expect(upTo).not.toMatch(/socket\?: RelaySocket/);
  });

  it("EVERY call site names a socket — the count is the guard against a twelfth", () => {
    const calls = code.match(/pushLivekitToken\(reg,[^)]*\)/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(11);
    for (const c of calls) {
      // reg, pin, room, socket — four arguments, so three commas.
      expect((c.match(/,/g) || []).length, `must name a socket: ${c}`).toBe(3);
      expect(c, `the 4th argument must be a socket: ${c}`).toMatch(/[Ss]ocket\)$/);
    }
  });

  it("no call site re-derives its socket from the registry, INCLUDING via `self`", () => {
    const calls = code.match(/pushLivekitToken\(reg,[^)]*\)/g) || [];
    for (const c of calls) {
      expect(c, `a registry lookup defeats the point: ${c}`).not.toMatch(/reg\.clients/);
      // `self` IS `reg.clients.get(conn.pin)` — the same primary record under
      // another name, and the whole defect is that it can be a DIFFERENT device
      // from the connection we are answering. Found because a mutation swapping
      // `conn.socket` for `self.socket` in refresh-livekit SURVIVED the
      // behavioural tests: by then the dial has promoted this device to primary,
      // so the two are the same object and no behaviour can separate them.
      expect(c, `\`self\` is the primary record, not this connection: ${c}`).not.toMatch(/self\.socket/);
    }
    // `pc.socket` IS registry-derived and is CORRECT: that one is the merge
    // fan-out to OTHER members, where their primary is the only answer we have.
    expect(code).toMatch(/pushLivekitToken\(reg, p, activeRid, pc\.socket\)/);
  });

  it("claimPrimaryForCall yields to a primary that is mid-call, and bumps no epoch", () => {
    const body = fnBody("function claimPrimaryForCall(");
    expect(body).toMatch(/if \(!multiDeviceEnabled\(\)\) return;/);
    expect(body).toMatch(/if \(!prev \|\| prev\.roomId\) return;/);
    expect(body).toMatch(/if \(prev\.socket === conn\.socket\) return;/);
    // Bumping would abort the very dial we are placing.
    expect(body).not.toMatch(/Epoch/);
  });
});
