import { describe, it, expect } from "vitest";
import { signalDisposition } from "./relayClient";

/**
 * v2.99.57 finding 2 — which room authorized a relayed `signal` decides whether
 * it may touch the live call's media.
 *
 * The bypass: A is in call H with V. V answers a second call, so V parks H —
 * every peer of H moves into `heldPeers` and out of `peers`. A hand-crafts a
 * `signal` to V. The server's gate passes (V is still in H's member set), V's
 * client finds no `peers[A]`, and `createPeer` attaches `processedStream ||
 * localStream` — V's LIVE mic from the call with C — plus the camera, because
 * `createPeer` flips `callIsGroup` when another peer exists, which makes
 * `consentOk` true. A receives audio and video from a call they were never in.
 */
describe("signalDisposition", () => {
  const base = { roomId: "rACTIVE", heldRoomId: "rHELD", hasHeldPeer: true };

  it("a signal from our ACTIVE room is handled normally", () => {
    expect(signalDisposition({ ...base, frameRoom: "rACTIVE" })).toBe("current");
  });

  it("a signal from a HELD room never reaches the live call", () => {
    // The whole finding: this used to be indistinguishable from "current".
    expect(signalDisposition({ ...base, frameRoom: "rHELD" })).toBe("held");
  });

  it("a held-room signal with no parked peer is dropped outright", () => {
    expect(signalDisposition({ ...base, frameRoom: "rHELD", hasHeldPeer: false })).toBe("drop");
  });

  it("a signal from a room we are in NEITHER of is dropped", () => {
    expect(signalDisposition({ ...base, frameRoom: "rSOMEONE_ELSE" })).toBe("drop");
  });

  it("fails OPEN on an unstamped frame (older server / direct call)", () => {
    // One bundle serves both halves, but refusing every unstamped frame would tear
    // down every in-flight call on the deploy that introduces the field.
    expect(signalDisposition({ ...base, frameRoom: undefined })).toBe("current");
    expect(signalDisposition({ ...base, frameRoom: null })).toBe("current");
    expect(signalDisposition({ ...base, frameRoom: "" })).toBe("current");
  });

  it("does not gate the ACTIVE room on a client-side roster", () => {
    // The server already established the sender shares our active room. A roster
    // check here would refuse legitimate mesh offers that arrive before the
    // `room`/`peer-joined` ack — the regression class this repo has shipped before.
    // With no peer and no member knowledge, an active-room signal still proceeds.
    expect(signalDisposition({ roomId: "r1", heldRoomId: null, hasHeldPeer: false, frameRoom: "r1" })).toBe("current");
  });

  it("with no active call, only a held-room match can be routed", () => {
    expect(signalDisposition({ roomId: null, heldRoomId: "rH", hasHeldPeer: true, frameRoom: "rH" })).toBe("held");
    expect(signalDisposition({ roomId: null, heldRoomId: null, hasHeldPeer: false, frameRoom: "rX" })).toBe("drop");
  });
});
