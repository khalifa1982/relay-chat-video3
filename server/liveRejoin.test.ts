import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.99.9 — rejoin a live call from History (knock → host approval → join).
 * The signaling behavior is covered in relay.test.ts; these pins cover the
 * tRPC surface, the privacy gate, and the client wiring.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const RELAY = read("server/relay.ts");
const ROUTERS = read("server/v2routers.ts");
const CLIENT = read("client/src/lib/relayClient.ts");
const ENGINE = read("client/src/app/RelayEngine.tsx");
const HISTORY = read("client/src/pages/app/History.tsx");

describe("liveRoomInfo — privacy-safe registry read", () => {
  const fn = RELAY.slice(RELAY.indexOf("export function liveRoomInfo"), RELAY.indexOf("export function liveRoomFor"));
  it("only returns a room the requester was PREVIOUSLY in (roster gate — no enumeration oracle)", () => {
    expect(fn).toMatch(/if \(requester !== meta\.hostPin && !meta\.roster\.has\(requester\)\) return null;/);
  });
  it("only a live (accepted, ≥1 connected) room qualifies, and never one you're already in", () => {
    expect(fn).toMatch(/if \(!meta\.accepted \|\| roomConnectedCount\(reg, rid\) < 1\) return null;/);
    expect(fn).toMatch(/if \(room\.has\(requester\) && reg\.clients\.get\(requester\)\?\.roomId === rid\) return null;/);
  });
  it("liveRoomFor degrades to null off the signaling node (activeRegistry unset)", () => {
    const outer = RELAY.slice(RELAY.indexOf("export function liveRoomFor"), RELAY.indexOf("export function liveRoomFor") + 250);
    expect(outer).toMatch(/const reg = activeRegistry;\s*\n\s*if \(!reg\) return null;/);
  });
});

describe("knock signaling authorization (server)", () => {
  it("knock resolves the room via liveRoomInfo (roster-gated) and alerts the host + co-hosts", () => {
    const c = RELAY.slice(RELAY.indexOf('case "knock": {'), RELAY.indexOf('case "knock-approve"'));
    expect(c).toMatch(/const info = liveRoomInfo\(reg, toNum, conn\.pin\)/);
    expect(c).toMatch(/meta\.knocks\.set\(conn\.pin/);
    expect(c).toMatch(/safeSend\(host\.socket, knockMsg\)/);
    expect(c).toMatch(/meta\.cohosts\.forEach/);
  });
  it("approve/deny requires a moderator AND a pending knock (no forged admit)", () => {
    const c = RELAY.slice(RELAY.indexOf('case "knock-approve":'), RELAY.indexOf('case "refresh-ice"'));
    expect(c).toMatch(/if \(!meta \|\| !room \|\| !isModerator\(meta, conn\.pin\)\) break;/);
    expect(c).toMatch(/if \(!meta\.knocks \|\| !meta\.knocks\.has\(knockerPin\)\) break;/);
    expect(c).toMatch(/admitToRoom\(reg, knockerPin, roomId\)/);
  });
  it("admitToRoom joins without a ring (host approval is the authz) + fans out peer-joined", () => {
    const fn = RELAY.slice(RELAY.indexOf("function admitToRoom"), RELAY.indexOf("function admitToRoom") + 1800);
    expect(fn).toMatch(/joinRoomMember\(reg, roomId, pin\)/);
    expect(fn).toMatch(/type: "joined"/);
    expect(fn).toMatch(/type: "peer-joined"/);
  });
});

describe("directory.liveRoom tRPC (caller-roster-gated, names only)", () => {
  const q = ROUTERS.slice(ROUTERS.indexOf("liveRoom: publicProcedure"), ROUTERS.indexOf("geoSelf: publicProcedure"));
  it("gates on the caller's own number and returns names only (no dialable pins)", () => {
    expect(q).toMatch(/liveRoomFor\(input\.number, me\.number\)/);
    expect(q).toMatch(/members: info\.members\.map\(\(m\) => \(\{ name: m\.name, role: m\.role \}\)\)/);
    expect(q).not.toMatch(/pin: m\.pin/);
  });
});

describe("client wiring", () => {
  it("engine exposes knock / approveKnock / denyKnock / setOnKnock", () => {
    expect(CLIENT).toMatch(/knock: \(number: string\) => void/);
    expect(CLIENT).toMatch(/approveKnock: \(roomId: string, pin: string\) => void/);
    expect(CLIENT).toMatch(/setOnKnock:/);
    expect(CLIENT).toMatch(/case "knock":        onKnock\(m\); break;/);
    expect(CLIENT).toMatch(/case "knock-result": onKnockResult\(m\); break;/);
  });
  it("RelayEngine renders a host approval prompt and exposes knock() on the context", () => {
    expect(ENGINE).toMatch(/setKnockReq\(\{ pin, name, roomId \}\)/);
    expect(ENGINE).toMatch(/approveKnock\(knockReq\.roomId, knockReq\.pin\)/);
    expect(ENGINE).toMatch(/denyKnock\(knockReq\.roomId, knockReq\.pin\)/);
    expect(ENGINE).toMatch(/knock: \(n\) =>/);
  });
  it("History shows a Live-now Join card that knocks", () => {
    expect(HISTORY).toMatch(/function LiveRejoinCard/);
    expect(HISTORY).toMatch(/trpc\.directory\.liveRoom\.useQuery/);
    expect(HISTORY).toMatch(/engine\.knock\(number\)/);
  });
});
