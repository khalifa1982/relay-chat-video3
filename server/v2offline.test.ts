import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseOfflineBody } from "./v2offline";

/**
 * v2.89 — instant offline presence (backlog #19).
 *
 * The client fires `navigator.sendBeacon("/api/v2/offline")` on pagehide /
 * visibilitychange→hidden so contacts' presence LEDs flip grey immediately
 * instead of waiting out the 2-minute reaper (which stays as the backstop).
 * The pure body parser is unit-tested directly; the route/client wiring is
 * pinned as source contracts (the repo's established pattern for
 * express/DOM-driven behavior).
 */

const V2OFFLINE = fs.readFileSync(path.resolve(__dirname, "v2offline.ts"), "utf8");
const SERVER_INDEX = fs.readFileSync(path.resolve(__dirname, "_core", "index.ts"), "utf8");
const PRESENCE_MANAGER = fs.readFileSync(
  path.resolve(__dirname, "..", "client", "src", "app", "PresenceManager.tsx"),
  "utf8",
);

describe("parseOfflineBody — beacon payload extraction", () => {
  it("parses a JSON string (sendBeacon posts text/plain)", () => {
    expect(parseOfflineBody(JSON.stringify({ deviceId: "a".repeat(32) }))).toEqual({
      deviceId: "a".repeat(32),
    });
  });
  it("parses an already-parsed object (a client that posted real JSON)", () => {
    expect(parseOfflineBody({ deviceId: "0123456789abcdef" })).toEqual({
      deviceId: "0123456789abcdef",
    });
  });
  it("parses a Buffer body", () => {
    const buf = Buffer.from(JSON.stringify({ deviceId: "deadbeefdeadbeef" }), "utf8");
    expect(parseOfflineBody(buf)).toEqual({ deviceId: "deadbeefdeadbeef" });
  });
  it("normalizes case like the x-relay-device-id header", () => {
    expect(parseOfflineBody({ deviceId: "DEADBEEFDEADBEEF" })).toEqual({
      deviceId: "deadbeefdeadbeef",
    });
  });
  it("rejects malformed ids (shape rule: hex, 8-64 chars)", () => {
    expect(parseOfflineBody({ deviceId: "short" })).toEqual({ deviceId: null });
    expect(parseOfflineBody({ deviceId: "not-hex-not-hex!" })).toEqual({ deviceId: null });
    expect(parseOfflineBody({ deviceId: "a".repeat(65) })).toEqual({ deviceId: null });
    expect(parseOfflineBody({ deviceId: 42 })).toEqual({ deviceId: null });
  });
  it("survives garbage bodies without throwing", () => {
    expect(parseOfflineBody("not json at all")).toEqual({ deviceId: null });
    expect(parseOfflineBody(undefined)).toEqual({ deviceId: null });
    expect(parseOfflineBody(null)).toEqual({ deviceId: null });
    expect(parseOfflineBody(7)).toEqual({ deviceId: null });
  });
});

describe("POST /api/v2/offline — route shape", () => {
  it("registers the route with a small SCOPED body parser (beacons post text/plain)", () => {
    expect(V2OFFLINE).toMatch(/app\.use\(\s*["']\/api\/v2\/offline["']\s*,\s*express\.text\(/);
    expect(V2OFFLINE).toMatch(/limit:\s*["']4kb["']/);
    expect(V2OFFLINE).toMatch(/app\.post\(\s*["']\/api\/v2\/offline["']/);
  });
  it("resolves identity via the SHARED createContext (like v2events/upload), with the deviceId body fallback", () => {
    expect(V2OFFLINE).toMatch(/import\s*\{\s*createContext\s*\}\s*from\s*["']\.\/_core\/context["']/);
    expect(V2OFFLINE).toMatch(/createContext\(\{\s*req,\s*res\s*\}/);
    expect(V2OFFLINE).toMatch(/getIdentityByDeviceId\(deviceId\)/);
  });
  it("reuses the heartbeat/goOffline path: markOffline + scoped presence publish", () => {
    expect(V2OFFLINE).toMatch(/markOffline\(identity\.id\)/);
    expect(V2OFFLINE).toMatch(/getPresenceAudienceIds\(identity\.id,\s*identity\.number\)/);
    expect(V2OFFLINE).toMatch(/publishPresenceTo\(audience,\s*identity\.number,\s*false/);
  });
  it("401s when no identity resolves (never marks strangers offline)", () => {
    expect(V2OFFLINE).toMatch(/status\(401\)/);
  });
  it("is mounted at boot next to the SSE bus", () => {
    expect(SERVER_INDEX).toMatch(/import\s*\{\s*registerV2Offline\s*\}\s*from\s*["']\.\.\/v2offline["']/);
    expect(SERVER_INDEX).toMatch(/registerV2Offline\(app\)/);
  });
  it("keeps the 2-minute stale-presence reaper as the backstop", () => {
    expect(SERVER_INDEX).toMatch(/reapStalePresence\(120\)/);
  });
});

describe("PresenceManager — client beacon wiring", () => {
  it("fires sendBeacon at /api/v2/offline with the deviceId fallback in the body", () => {
    expect(PRESENCE_MANAGER).toMatch(/navigator\.sendBeacon\?\.\(\s*["']\/api\/v2\/offline["']/);
    expect(PRESENCE_MANAGER).toMatch(/JSON\.stringify\(\{\s*deviceId:\s*getDeviceId\(\)\s*\}\)/);
  });
  it("fires on pagehide AND visibilitychange→hidden (mobile Safari often skips pagehide)", () => {
    expect(PRESENCE_MANAGER).toMatch(/addEventListener\(\s*["']pagehide["']\s*,\s*onLeave/);
    expect(PRESENCE_MANAGER).toMatch(/addEventListener\(\s*["']visibilitychange["']\s*,\s*onVisibility/);
    expect(PRESENCE_MANAGER).toMatch(/visibilityState\s*===\s*["']hidden["']/);
  });
  it("heartbeats immediately on return-to-visible so a tab switch flips right back online", () => {
    expect(PRESENCE_MANAGER).toMatch(/else if \(!cancelled\) heartbeat\.mutate\(\)/);
  });
  it("keeps the tRPC goOffline as the non-beacon fallback and removes every listener on cleanup", () => {
    expect(PRESENCE_MANAGER).toMatch(/goOffline\.mutate\(\)/);
    expect(PRESENCE_MANAGER).toMatch(/removeEventListener\(\s*["']visibilitychange["']\s*,\s*onVisibility/);
  });
});
