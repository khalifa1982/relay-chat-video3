import { describe, expect, it } from "vitest";

import { canAutoRestart, parseRelayMessage } from "../lib/call-messages";

describe("parseRelayMessage", () => {
  it("parses a version message", () => {
    const m = parseRelayMessage(
      JSON.stringify({ type: "relay-version", version: "v2.51.0" }),
    );
    expect(m).toEqual({ type: "version", version: "v2.51.0" });
  });

  it("parses an active video call message", () => {
    const m = parseRelayMessage(
      JSON.stringify({ type: "relay-call", active: true, hasVideo: true }),
    );
    expect(m).toEqual({ type: "call", active: true, hasVideo: true });
  });

  it("coerces missing call fields to false", () => {
    const m = parseRelayMessage(JSON.stringify({ type: "relay-call" }));
    expect(m).toEqual({ type: "call", active: false, hasVideo: false });
  });

  it("parses a ringing message with caller", () => {
    const m = parseRelayMessage(
      JSON.stringify({ type: "relay-ring", ringing: true, caller: "Sara" }),
    );
    expect(m).toEqual({ type: "ring", ringing: true, caller: "Sara" });
  });

  it("parses a ringing-stopped message with null caller", () => {
    const m = parseRelayMessage(
      JSON.stringify({ type: "relay-ring", ringing: false }),
    );
    expect(m).toEqual({ type: "ring", ringing: false, caller: null });
  });

  it("parses an incoming-message event", () => {
    const m = parseRelayMessage(
      JSON.stringify({ type: "relay-message", count: 3 }),
    );
    expect(m).toEqual({ type: "message", count: 3 });
  });

  it("defaults message count to 0 when invalid", () => {
    const m = parseRelayMessage(
      JSON.stringify({ type: "relay-message", count: "x" }),
    );
    expect(m).toEqual({ type: "message", count: 0 });
  });

  it("returns unknown for malformed / non-string / empty version", () => {
    expect(parseRelayMessage("{not json").type).toBe("unknown");
    expect(parseRelayMessage(42 as unknown).type).toBe("unknown");
    expect(parseRelayMessage(JSON.stringify({ type: "other" })).type).toBe(
      "unknown",
    );
    expect(
      parseRelayMessage(JSON.stringify({ type: "relay-version", version: "" }))
        .type,
    ).toBe("unknown");
  });
});

describe("canAutoRestart", () => {
  it("allows restart only when idle, ready, and enabled", () => {
    expect(
      canAutoRestart({ autoRestart: true, updateReady: true, callActive: false }),
    ).toBe(true);
  });

  it("blocks restart during an active call", () => {
    expect(
      canAutoRestart({ autoRestart: true, updateReady: true, callActive: true }),
    ).toBe(false);
  });

  it("blocks restart when no update is ready or autoRestart is off", () => {
    expect(
      canAutoRestart({ autoRestart: true, updateReady: false, callActive: false }),
    ).toBe(false);
    expect(
      canAutoRestart({ autoRestart: false, updateReady: true, callActive: false }),
    ).toBe(false);
  });
});
