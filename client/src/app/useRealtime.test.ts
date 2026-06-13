import { describe, it, expect } from "vitest";
import { shouldAlertForMessage } from "./useRealtime";

/**
 * The server fans the `message` SSE event out to EVERY participant, including
 * the sender (so the sender's other tabs stay in sync). The client must not
 * raise a chime / "New message" notification for the user's own outgoing
 * messages — otherwise every send beeps at you and pops a notification on any
 * backgrounded tab. `shouldAlertForMessage` is the gate.
 */
describe("shouldAlertForMessage", () => {
  it("alerts for a message from someone else", () => {
    expect(shouldAlertForMessage(42, 7)).toBe(true);
  });

  it("does NOT alert for the user's own message", () => {
    expect(shouldAlertForMessage(7, 7)).toBe(false);
  });

  it("fails open when our own identity id isn't known yet", () => {
    // Better to over-notify (rare, only before whoami resolves) than to drop a
    // genuine incoming message.
    expect(shouldAlertForMessage(42, null)).toBe(true);
    expect(shouldAlertForMessage(42, undefined)).toBe(true);
  });
});
