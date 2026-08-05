/* ============================================================
   v2.107.46 — per-contact "send calls to voicemail" routing.

   The owner can mark ONE contact so that, when THAT person calls,
   the owner appears offline FOR CALLS and the caller reaches
   voicemail — while chat, status, and presence stay completely
   normal. This is deliberately SEPARATE from `blocked` (which
   severs contact both ways); it only ever gates the ring.

   These tests drive the real signaling path (`handleMessage`)
   through a fake capturing socket and assert the caller-visible
   outcome, because the whole value of the feature is what the
   CALLER experiences: an honest "offline" reply (which raises
   their leave-a-message card) instead of the callee's phone
   ringing. The routing check is async (a DB lookup behind a
   hook), so each test flushes microtasks before asserting.

   PERMANENT GUARD: the hook is wired positionally through
   attachRelay; a future refactor that drops or misorders it would
   silently turn every voicemail-routed contact back into a normal
   ring, and only an end-to-end test like this would notice.
   ============================================================ */
import { describe, expect, it, beforeEach } from "vitest";
import {
  createRegistry,
  handleMessage,
  type RelayRegistry,
  type RelaySocket,
  type CallRoutingHook,
} from "./relay";

type Sent = unknown;
class FakeConn {
  outbox: Sent[] = [];
  pin: string | null = null;
  socket: RelaySocket;
  constructor() {
    this.socket = {
      send: (obj: unknown) => {
        this.outbox.push(obj);
      },
      close: () => {},
    };
  }
  setPin = (p: string) => {
    this.pin = p;
  };
  last(): Sent | undefined {
    return this.outbox[this.outbox.length - 1];
  }
  asConn() {
    return { socket: this.socket, pin: this.pin, setPin: this.setPin, cid: undefined };
  }
}

function register(reg: RelayRegistry, name: string) {
  const c = new FakeConn();
  handleMessage(reg, c.asConn(), { type: "register", name });
  return c;
}
const pinOf = (c: FakeConn) => (c.last() as { pin: string }).pin;
const frame = (c: FakeConn, type: string) =>
  c.outbox.find(
    (m): m is Record<string, unknown> =>
      typeof m === "object" && m !== null && (m as { type?: string }).type === type
  );
/** Flush the microtask queue so the hook's `.then` continuation runs. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("per-contact voicemail routing (v2.107.46)", () => {
  let reg: RelayRegistry;
  beforeEach(() => {
    reg = createRegistry();
  });

  it("diverts a reachable callee to offline+voicemail when the hook says voicemail", async () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const aPin = pinOf(a);
    const bPin = pinOf(b);
    a.outbox.length = 0;
    b.outbox.length = 0;

    const missed: Array<{ calleePin: string; callerPin: string }> = [];
    const routeToVoicemail: CallRoutingHook = async () => "voicemail";

    handleMessage(
      reg,
      a.asConn(),
      { type: "invite", to: bPin },
      undefined,
      (info) => missed.push(info), // onMissedCall
      undefined, // onPageCallee (absent ⇒ registered target is reachable)
      undefined, // onResolveDial
      routeToVoicemail // onCheckCallRouting
    );
    await flush();

    // The callee's phone must NOT ring — that is the whole point.
    expect(frame(b, "ring")).toBeUndefined();
    // The caller gets an honest offline reply naming this invitee, which is
    // exactly what raises their leave-a-message (voicemail) card.
    const err = frame(a, "error") as { code?: string; pin?: string } | undefined;
    expect(err?.code).toBe("offline");
    expect(err?.pin).toBe(bPin);
    // And the miss is recorded (History + missed-call), attributed correctly.
    expect(missed).toHaveLength(1);
    expect(missed[0]).toMatchObject({ calleePin: bPin, callerPin: aPin });
  });

  it("rings normally when the hook says null (contact NOT routed to voicemail)", async () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const bPin = pinOf(b);
    a.outbox.length = 0;
    b.outbox.length = 0;

    const ringNormally: CallRoutingHook = async () => null;
    handleMessage(
      reg,
      a.asConn(),
      { type: "invite", to: bPin },
      undefined,
      undefined,
      undefined,
      undefined,
      ringNormally
    );
    await flush();

    // Untouched call path: the callee rings, no offline error to the caller.
    expect(frame(b, "ring")).toBeDefined();
    const err = frame(a, "error") as { code?: string } | undefined;
    expect(err).toBeUndefined();
  });

  it("rings (fails open) when the routing hook REJECTS — a DB hiccup must never eat a call", async () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const bPin = pinOf(b);
    a.outbox.length = 0;
    b.outbox.length = 0;

    const hookThrows: CallRoutingHook = async () => {
      throw new Error("db down");
    };
    handleMessage(
      reg,
      a.asConn(),
      { type: "invite", to: bPin },
      undefined,
      undefined,
      undefined,
      undefined,
      hookThrows
    );
    await flush();

    expect(frame(b, "ring")).toBeDefined();
    expect(frame(a, "error")).toBeUndefined();
  });

  it("with NO routing hook wired, the call path is byte-for-byte the old ring", async () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const bPin = pinOf(b);
    a.outbox.length = 0;
    b.outbox.length = 0;

    // Exactly the pre-v2.107.46 arity — no onCheckCallRouting argument.
    handleMessage(reg, a.asConn(), { type: "invite", to: bPin });
    await flush();

    expect(frame(b, "ring")).toBeDefined();
    expect(frame(a, "error")).toBeUndefined();
  });
});
