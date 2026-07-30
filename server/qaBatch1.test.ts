import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { createRegistry, handleMessage, type RelayRegistry, type RelaySocket } from "./relay";

/**
 * v2.99.22 — heavy-QA sweep fixes, batch 1.
 *   H1 (HIGH): a DECLINE during a group dial reaped the caller's room while
 *              other invitees were still ringing → they got error{gone} on
 *              accept and the conference silently died (server/relay.ts reject).
 *   H7/H8/M1 (HIGH): onMissedCall had no block check → a blocked caller could
 *              push/email/history-spam an offline callee (server/_core/index.ts).
 *   H3 (HIGH): the Messages thread-search memo omitted threadSearch from its
 *              deps, so search did nothing (client/src/pages/app/Messages.tsx).
 *   M8 (MED):  the v2.99.19 session reaper's 95-day idle cutoff was shorter than
 *              the 365-day cookie TTL → premature force-logout (server/_core).
 */

type Sent = Record<string, unknown>;
class FakeConn {
  outbox: Sent[] = [];
  pin: string | null = null;
  socket: RelaySocket;
  cid: string | undefined;
  alive = true;
  constructor(cid?: string) {
    this.cid = cid;
    this.socket = {
      send: (obj: unknown) => this.outbox.push(obj as Sent),
      close: () => { this.alive = false; },
      alive: () => this.alive,
    };
  }
  setPin = (p: string) => { this.pin = p; };
  ofType(type: string): Sent[] { return this.outbox.filter((m) => m.type === type); }
  asConn() { return { socket: this.socket, pin: this.pin, setPin: this.setPin, cid: this.cid }; }
}
function register(reg: RelayRegistry, name: string, pin?: string, cid?: string) {
  const c = new FakeConn(cid);
  handleMessage(reg, c.asConn(), { type: "register", name, pin });
  return c;
}
const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");

describe("v2.99.22 QA H1 — a group-dial decline must not collapse the whole conference", () => {
  let reg: RelayRegistry;
  beforeEach(() => { reg = createRegistry(); });

  it("declining ONE invitee while another still rings leaves the room live + the other can still join", () => {
    const caller = register(reg, "Caller", "111111", "cA");
    const a = register(reg, "Ann", "222222", "cB");
    const b = register(reg, "Bo", "333333", "cC");
    // Group dial: ring A (creates the room), then ring B (reuses it). Nobody has
    // accepted, so the caller's room is size 1 and both A+B are in caller.ringing.
    handleMessage(reg, caller.asConn(), { type: "invite", to: "222222" });
    handleMessage(reg, caller.asConn(), { type: "invite", to: "333333" });
    const roomId = String(caller.ofType("room")[0]?.roomId);
    expect(reg.rooms.has(roomId)).toBe(true);
    expect(a.ofType("ring").length).toBe(1);
    expect(b.ofType("ring").length).toBe(1);
    // Ann declines.
    handleMessage(reg, a.asConn(), { type: "reject", to: "111111" });
    // The room MUST survive — Bo is still ringing.
    expect(reg.rooms.has(roomId)).toBe(true);
    // Bo can still accept and join — no error{gone}.
    handleMessage(reg, b.asConn(), { type: "accept", roomId });
    expect(b.ofType("error").length).toBe(0);
    expect(b.ofType("joined").length).toBe(1);
    expect(caller.ofType("peer-joined").some((m) => m.pin === "333333")).toBe(true);
  });

  it("declining the ONLY ringing invitee still reaps the solo dial room (unchanged 1:1 behaviour)", () => {
    const caller = register(reg, "Caller", "111111", "cA");
    const a = register(reg, "Ann", "222222", "cB");
    handleMessage(reg, caller.asConn(), { type: "invite", to: "222222" });
    const roomId = String(caller.ofType("room")[0]?.roomId);
    expect(reg.rooms.has(roomId)).toBe(true);
    handleMessage(reg, a.asConn(), { type: "reject", to: "111111" });
    // No one else is ringing → the throwaway dial room is reaped as before.
    expect(reg.rooms.has(roomId)).toBe(false);
  });
});

describe("v2.99.22 QA source pins — H7/H8/M1, H3, M8", () => {
  it("H7/H8/M1: onMissedCall skips a blocked caller (block guard before the record/push/email)", () => {
    const core = read("./_core/index.ts");
    // the guard sits inside the onMissedCall body, before recordMissedCall
    const idx = core.indexOf("// onMissedCall:");
    const seg = core.slice(idx, idx + 1800);
    expect(seg).toMatch(/isNumberBlockedBy\(callee\.id, info\.callerPin\)/);
    // and it returns BEFORE recording the miss
    const guardAt = core.indexOf("isNumberBlockedBy(callee.id, info.callerPin)");
    const recordAt = core.indexOf("recordMissedCall({", idx);
    expect(guardAt).toBeGreaterThan(0);
    expect(guardAt).toBeLessThan(recordAt);
  });

  it("H3: the thread-search memo depends on threadSearch (search actually filters)", () => {
    /* REWRITTEN TO THE PROPERTY (v2.106.2). This froze the exact dep list
       `[threads.data, me, threadSearch]`, so it broke the moment the source list became
       its own memo (`scopedThreads`, for the Groups tab) while saying nothing about what
       it exists for: that typing in the box really re-runs the filter. The original H3
       bug was `threadSearch` MISSING from the deps — react-query's structural sharing
       keeps `threads.data` referentially stable, so the memo returned its cached
       unfiltered list and search silently did nothing.

       So: `threadSearch` must be a dep of the categories memo, and the list it filters
       must itself be memoized on `threads.data`, which is what makes new messages appear
       at all. Both halves asserted, neither frozen as a literal argument list. */
    const msgs = read("../client/src/pages/app/Messages.tsx");
    const catAt = msgs.indexOf("const threadCategories = useMemo(");
    expect(catAt).toBeGreaterThan(0);
    const catDeps = msgs.slice(catAt, msgs.indexOf("]);", catAt) + 3);
    expect(catDeps).toMatch(/\}, \[[^\]]*\bthreadSearch\b[^\]]*\]\);/);
    // …and the list it reads is refreshed by new data.
    const scopedAt = msgs.indexOf("const scopedThreads = useMemo(");
    expect(scopedAt).toBeGreaterThan(0);
    expect(scopedAt).toBeLessThan(catAt);
    const scopedDeps = msgs.slice(scopedAt, msgs.indexOf("]);", scopedAt) + 3);
    expect(scopedDeps).toMatch(/\}, \[[^\]]*\bthreads\.data\b[^\]]*\]\);/);
  });

  it("M8: the session reaper's idle cutoff outlives the 365-day cookie TTL", () => {
    const core = read("./_core/index.ts");
    expect(core).toMatch(/reapStaleSessions\(30 \* 60_000, 372 \* 24 \* 60 \* 60_000\)/);
  });
});
