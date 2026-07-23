import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { shouldAlertForMessage } from "./useRealtime";

/**
 * Regression (2026-07-23 reliability pass): the SSE effect's `onmessage`
 * closure reads `selfId` (via shouldAlertForMessage), but the effect used to
 * depend on [enabled] only — a stale closure if the resolved identity ever
 * changed without `enabled` flipping. No DOM harness here, so pin the
 * dependency array by source (matches the file's own `// eslint-disable-next-
 * line react-hooks/exhaustive-deps` pattern already used one line above it).
 */
const USE_REALTIME_SRC = fs.readFileSync(path.resolve(__dirname, "useRealtime.ts"), "utf8");
describe("useRealtime — the SSE effect re-subscribes when selfId changes", () => {
  it("depends on both enabled and selfId (not [enabled] alone)", () => {
    expect(USE_REALTIME_SRC).toMatch(/\}, \[enabled, selfId\]\);/);
  });
});

/**
 * v2.99.3 presence consistency — History LEDs read `directory.presenceMany` and
 * the profile popup / batch surfaces read `directory.presence`, but the SSE
 * `presence` handler previously invalidated neither, so those surfaces only
 * refreshed on their own 30s poll while `contacts.list` / `messages.threads`
 * updated instantly — the same user showed online on one surface and offline on
 * another. Pin that the presence case now fans out to BOTH batch queries.
 */
describe("presence SSE handler invalidates every presence-reading query (v2.99.3)", () => {
  // Isolate the `case "presence":` block so a stray match elsewhere can't pass it.
  const presenceCase = USE_REALTIME_SRC.slice(
    USE_REALTIME_SRC.indexOf('case "presence":'),
    USE_REALTIME_SRC.indexOf('case "contact":'),
  );
  it("still invalidates the always-rendered surfaces (contacts + threads + lookup)", () => {
    expect(presenceCase).toMatch(/utils\.contacts\.list\.invalidate\(\)/);
    expect(presenceCase).toMatch(/utils\.messages\.threads\.invalidate\(\)/);
    expect(presenceCase).toMatch(/utils\.directory\.lookup\.invalidate\(\{ number: payload\.number \}\)/);
  });
  it("now ALSO invalidates directory.presenceMany (History LEDs)", () => {
    expect(presenceCase).toMatch(/utils\.directory\.presenceMany\.invalidate\(\)/);
  });
  it("now ALSO invalidates directory.presence (profile popup / batch)", () => {
    expect(presenceCase).toMatch(/utils\.directory\.presence\.invalidate\(\)/);
  });
});

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

/**
 * v2.88 — SSE-gated poll demotion. While the SSE stream is up (it invalidates
 * the messages/threads/history queries on every event), the aggressive 2-4s
 * polls demote to slow safety-net intervals; the moment the stream drops they
 * re-promote. Pure module-level flag + interval factory, testable without DOM.
 */
import { isSseConnected, _setSseConnected, demotablePollInterval } from "./useRealtime";

describe("SSE-gated poll demotion (v2.88)", () => {
  it("starts disconnected (fast polling until the stream proves itself)", () => {
    _setSseConnected(false);
    expect(isSseConnected()).toBe(false);
  });

  it("demotablePollInterval returns the FAST interval while SSE is down", () => {
    _setSseConnected(false);
    const interval = demotablePollInterval(2_000, 20_000);
    expect(interval()).toBe(2_000);
  });

  it("returns the DEMOTED interval while SSE is up, and re-promotes on drop", () => {
    const interval = demotablePollInterval(4_000, 30_000);
    _setSseConnected(true);
    expect(isSseConnected()).toBe(true);
    expect(interval()).toBe(30_000);
    // Stream drops → the very next tick polls fast again (the callback is
    // evaluated per-tick by React Query, so no re-render is needed).
    _setSseConnected(false);
    expect(interval()).toBe(4_000);
  });
});
