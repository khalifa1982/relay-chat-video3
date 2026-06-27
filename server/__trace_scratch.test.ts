import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import {
  createRegistry,
  handleMessage,
  attachRelay,
  multiDeviceEnabled,
  type RelayRegistry,
  type RelaySocket,
} from "./relay";

type Sent = any;
class FakeConn {
  outbox: Sent[] = [];
  pin: string | null = null;
  socket: RelaySocket;
  cid: string | undefined;
  constructor(cid?: string) {
    this.cid = cid;
    this.socket = {
      send: (obj: unknown) => { this.outbox.push(obj); },
      close: () => {},
    };
  }
  setPin = (p: string) => { this.pin = p; };
  asConn() {
    return { socket: this.socket, pin: this.pin, setPin: this.setPin, cid: this.cid };
  }
}

describe("multidevice trace", () => {
  let reg: RelayRegistry;
  beforeEach(() => { reg = createRegistry(); process.env.MULTI_DEVICE_RING = "1"; });
  afterEach(() => { delete process.env.MULTI_DEVICE_RING; });

  it("SCENARIO A: registered reply pin to secondary device when primary in call", () => {
    // primary registers and gets into a call (simulate roomId set)
    const d1 = new FakeConn("dev1");
    handleMessage(reg, d1.asConn(), { type: "register", name: "Callee" });
    const number = d1.pin!;
    // put d1 in a call
    reg.clients.get(number)!.roomId = "rABC";

    // d2 registers same number while d1 is in-call
    const d2 = new FakeConn("dev2");
    handleMessage(reg, d2.asConn(), { type: "register", name: "Callee", pin: number });
    const reply = d2.outbox.find((m) => m.type === "registered");
    console.log("D2 registered reply pin:", reply?.pin, "d2.pin:", d2.pin);
    // primary should remain d1
    console.log("primary cid after d2 register:", reg.clients.get(number)!.cid);
    expect(reg.clients.get(number)!.cid).toBe("dev1"); // keepPrimary held
    // both devices tracked?
    console.log("devices for number:", Array.from(reg.devices.get(number)!.keys()));
  });

  it("SCENARIO B: promotion on primary disconnect via real attachRelay", async () => {
    const app = express();
    app.use(express.json());
    const reg2 = attachRelay(app);
    // We can't easily drive SSE here; instead directly exercise the grace timer
    // by simulating. Use handleMessage on reg2's connections.
    // Simpler: just trace promotion logic on `reg` with manual grace simulation.
    // (covered in SCENARIO C)
    expect(typeof reg2).toBe("object");
  });

  it("SCENARIO C: stale cidToPin after promotion", () => {
    // two devices on one number
    const d1 = new FakeConn("dev1");
    handleMessage(reg, d1.asConn(), { type: "register", name: "X" });
    const number = d1.pin!;
    const d2 = new FakeConn("dev2");
    handleMessage(reg, d2.asConn(), { type: "register", name: "X", pin: number });

    expect(reg.cidToPin.get("dev1")).toBe(number);
    expect(reg.cidToPin.get("dev2")).toBe(number);
    expect(reg.clients.get(number)!.cid).toBe("dev2"); // last register became primary (idle)

    // Now simulate: dev2 (primary) disconnects. Emulate cleanup+grace promotion.
    // deviceRemove(dev2) then promote survivor dev1.
    // Manually replicate cleanup body for cid=dev2:
    const cid = "dev2";
    const pin = number;
    // deviceRemove
    const m = reg.devices.get(pin)!;
    m.delete(cid);
    // grace timer body:
    const c = reg.clients.get(pin)!;
    c.graceT = setTimeout(() => {}, 0) as any; // pretend grace set
    // promotion:
    const devs = reg.devices.get(pin);
    const survivor = devs && Array.from(devs.entries()).find(([dcid]) => dcid !== cid);
    expect(survivor![0]).toBe("dev1");
    c.graceT = null;
    c.socket = survivor![1];
    c.cid = survivor![0];
    // After promotion, cidToPin still has BOTH dev1->number and dev2->number
    console.log("cidToPin dev1:", reg.cidToPin.get("dev1"));
    console.log("cidToPin dev2 (stale?):", reg.cidToPin.get("dev2"));
    // dev2 is gone but its cidToPin entry remains
    expect(reg.cidToPin.get("dev2")).toBe(number); // STALE - never cleaned
  });

  it("SCENARIO D: call-waiting / 2nd inbound while primary in call - do all devices ring?", () => {
    const caller1 = new FakeConn("c1");
    handleMessage(reg, caller1.asConn(), { type: "register", name: "C1" });
    const caller2 = new FakeConn("c2");
    handleMessage(reg, caller2.asConn(), { type: "register", name: "C2" });

    const d1 = new FakeConn("dev1");
    handleMessage(reg, d1.asConn(), { type: "register", name: "Callee" });
    const number = d1.pin!;
    const d2 = new FakeConn("dev2");
    handleMessage(reg, d2.asConn(), { type: "register", name: "Callee", pin: number });

    // caller1 rings -> both devices ring
    handleMessage(reg, caller1.asConn(), { type: "invite", to: number });
    const ring1 = d1.outbox.find((m) => m.type === "ring") as any;
    // d2 answers
    handleMessage(reg, d2.asConn(), { type: "accept", roomId: ring1.roomId });
    // now callee.roomId set, primary = dev2
    expect(reg.clients.get(number)!.roomId).toBe(ring1.roomId);
    expect(reg.clients.get(number)!.cid).toBe("dev2");

    // caller2 now rings the number (call-waiting). target.roomId is set, so
    // the multi-device ring-all branch is SKIPPED (requires !target.roomId).
    // Falls to safeSend(target.socket) = the PRIMARY (dev2) only.
    d1.outbox.length = 0; d2.outbox.length = 0;
    handleMessage(reg, caller2.asConn(), { type: "invite", to: number });
    console.log("call-waiting: d1 got ring?", d1.outbox.some((m) => m.type === "ring"));
    console.log("call-waiting: d2 got ring?", d2.outbox.some((m) => m.type === "ring"));
    // Expect only the primary (dev2) gets the call-waiting ring
    expect(d2.outbox.some((m) => m.type === "ring")).toBe(true);
    expect(d1.outbox.some((m) => m.type === "ring")).toBe(false);
  });

  it("SCENARIO E: ring-cancel reaches the IDLE devices even if one device is the caller's own number? n/a; check device that did NOT answer but is the caller", () => {
    // Edge: what if the 'other device' of the callee is ALSO mid different call.
    // Just confirm ring-cancel uses callerPin and is delivered to non-accepting cids.
    const caller = new FakeConn("caller");
    handleMessage(reg, caller.asConn(), { type: "register", name: "Caller" });
    const callerPin = caller.pin!;
    const d1 = new FakeConn("dev1");
    handleMessage(reg, d1.asConn(), { type: "register", name: "Callee" });
    const number = d1.pin!;
    const d2 = new FakeConn("dev2");
    handleMessage(reg, d2.asConn(), { type: "register", name: "Callee", pin: number });
    handleMessage(reg, caller.asConn(), { type: "invite", to: number });
    const ring = d1.outbox.find((m) => m.type === "ring") as any;
    d1.outbox.length = 0; d2.outbox.length = 0;
    handleMessage(reg, d2.asConn(), { type: "accept", roomId: ring.roomId });
    const cancel = d1.outbox.find((m) => m.type === "ring-cancel") as any;
    expect(cancel.from).toBe(callerPin);
  });

  it("SCENARIO F: caller's ringing set tracks the NUMBER, accept on secondary deletes ring for primary pin only", () => {
    // After d2 accepts, caller.ringing should no longer contain `number`.
    const caller = new FakeConn("caller");
    handleMessage(reg, caller.asConn(), { type: "register", name: "Caller" });
    const callerPin = caller.pin!;
    const d1 = new FakeConn("dev1");
    handleMessage(reg, d1.asConn(), { type: "register", name: "Callee" });
    const number = d1.pin!;
    const d2 = new FakeConn("dev2");
    handleMessage(reg, d2.asConn(), { type: "register", name: "Callee", pin: number });
    handleMessage(reg, caller.asConn(), { type: "invite", to: number });
    expect(reg.clients.get(callerPin)!.ringing.has(number)).toBe(true);
    const ring = d1.outbox.find((m) => m.type === "ring") as any;
    handleMessage(reg, d2.asConn(), { type: "accept", roomId: ring.roomId });
    console.log("caller.ringing after accept:", Array.from(reg.clients.get(callerPin)!.ringing));
    // In accept, members.forEach deletes ringing for newcomerPin=number.
    expect(reg.clients.get(callerPin)!.ringing.has(number)).toBe(false);
  });
});
