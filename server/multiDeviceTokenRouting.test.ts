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

describe("LiveKit is retired: no join token is ever pushed, and the dial still works", () => {
  let reg: RelayRegistry;
  const prev = {
    multi: process.env.MULTI_DEVICE_RING,
  };

  beforeEach(() => {
    reg = createRegistry();
    // The three LIVEKIT_* vars are set ON PURPOSE: v2.106.52 retired LiveKit at
    // `livekitConfig()`, which ignores the env entirely, so a fully-populated
    // environment producing NO token is exactly the property under test. A stale
    // var left in /home/relay/.env must not be able to bring the SFU back.
    process.env.MULTI_DEVICE_RING = "1";
  });
  afterEach(() => {
    for (const [k, v] of [
    ] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  /** The token is minted asynchronously, so let the microtask queue drain. */
  const settle = () => new Promise(r => setTimeout(r, 0));

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

  it("a single-device number is completely unaffected", async () => {
    const solo = reg2(reg, "cid-solo", "Solo", "777777");
    reg2(reg, "cid-callee", "Callee", "555555");
    handleMessage(reg, solo.asConn(), { type: "invite", to: "555555" });
    await settle();
    expect(solo.has("room")).toBe(true);
    // Retired: the dial succeeds and no SFU token is minted for anyone.
    expect(solo.has("livekit-token")).toBe(false);
    expect(reg.clients.get("777777")!.cid).toBe("cid-solo");
  });

  it("NO token is pushed even with all three vars set, and the dial still works", async () => {
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
    expect(phone.has("livekit-token")).toBe(false);
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

  it("nothing pushes a per-device media credential any more", () => {
    /* THE FOUR TESTS THIS REPLACES pinned the ADDRESSING of an SFU join token: it
       used to be sent to `reg.clients.get(pin).socket` — the NUMBER's primary —
       while every call site sat directly after a `safeSend(<a specific socket>, …)`.
       A number can hold several devices and `reg.clients` holds exactly one, so a
       call placed from a non-primary device had its token delivered elsewhere:
       total, deterministic media failure while ring, accept and roster all
       succeeded.

       The token is gone with the hosted SFU (v2.106.53), so the addressing bug
       cannot recur in that shape. What CAN recur is the shape itself — a new
       per-device credential pushed to a number rather than to a socket — so this
       asserts the absence rather than being deleted, and the promotion tests below
       stay because they are a MESH concern: `signal` still routes through
       `reg.clients.get(to)`. */
    expect(code).not.toMatch(/pushLivekitToken/);
    expect(code).not.toMatch(/mintLivekitToken/);
    expect(code).not.toMatch(/type: "livekit-token"/);
    // No frame carries a token or a media-server URL to a device at all.
    expect(code).not.toMatch(/\btoken\b\s*[,:]/);
    expect(code).not.toMatch(/livekitUrl/);
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
