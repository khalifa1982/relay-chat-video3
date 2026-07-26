/* ============================================================
   v2.99.71 — the live network figures are PUSHED, not polled.

   Owner: "the statistics of number of users, active users, messages, calls — the one
   on the main page and on the login page — it should be dynamic. While I'm seeing the
   page, if somebody logs in, it will automatically update. No need for me to refresh
   the page. These numbers are read from the database, for all five."

   WHAT WAS ALREADY TRUE: all five were already live database counts and both surfaces
   already refreshed without a reload. WHAT WAS NOT: the landing page polled every 30s
   with refetchOnWindowFocus OFF, so a visitor could watch numbers half a minute stale
   and coming back to the tab did not refresh them; the sign-in screen polled at 15s.
   And polling scaled the wrong way — every viewer independently ran six COUNT(*)s,
   one of them over `messages`, the largest table in the schema.

   These tests drive the REAL Express route over a real socket. A source pin cannot
   tell you whether a stream actually delivers a second frame when a number moves,
   and that is the entire feature.
   ============================================================ */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";

// Drive the feed's real timers in MILLISECONDS. Without this the tests would have to
// sleep past a 2s production tick, which is both slow and timing-raced — and a raced
// test of "does a tick push a frame" is worthless. Set before importing the module,
// since the cadences are read at module load.
process.env.RELAY_STATS_FAST_MS = "400";
process.env.RELAY_STATS_SLOW_MS = "3000";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

// The route reads the two db helpers; stub them so the numbers are ours to move.
const stats = {
  registeredUsers: 10,
  guestsServed: 20,
  totalParties: 30,
  messagesSent: 40,
  onlineNow: 5,
};
let onlineCount: number | null = 5;
let fullReads = 0;
let onlineReads = 0;
/** The presence hook the feed registers (v2.99.72) — captured so a test can fire it. */
let presenceHook: (() => void) | null = null;

vi.mock("./v2db", () => ({
  getPublicStats: async () => {
    fullReads++;
    return { ...stats, onlineNow: onlineCount ?? stats.onlineNow };
  },
  getOnlineCount: async () => {
    onlineReads++;
    return onlineCount;
  },
  setPresenceChangeHook: (fn: (() => void) | null) => {
    presenceHook = fn;
  },
}));

const { registerStatsFeed, statsFeedState } = await import("./statsFeed");

type Frame = { kind?: string; onlineNow?: number; registeredUsers?: number };

/** Open the SSE route and collect parsed data frames until `stop()`. */
function openStream(port: number): {
  frames: Frame[];
  raw: () => string;
  status: () => number | undefined;
  stop: () => void;
} {
  const frames: Frame[] = [];
  let buf = "";
  let status: number | undefined;
  const req = http.get(
    { host: "127.0.0.1", port, path: "/api/stats/stream" },
    (res) => {
      status = res.statusCode;
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buf += chunk;
        // SSE frames are separated by a blank line; `: comment` lines are ignored.
        let i: number;
        while ((i = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          for (const line of block.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              frames.push(JSON.parse(line.slice(6)) as Frame);
            } catch {
              /* not our frame */
            }
          }
        }
      });
    }
  );
  req.on("error", () => {});
  return { frames, raw: () => buf, status: () => status, stop: () => req.destroy() };
}

const waitFor = async (pred: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
};

let server: http.Server;
let port = 0;

beforeEach(async () => {
  fullReads = 0;
  onlineReads = 0;
  onlineCount = 5;
  const app = express();
  registerStatsFeed(app);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
  // The feed's client set is MODULE state shared by every test in this file, and the
  // previous test's sockets are reaped asynchronously. Wait for it to drain so a
  // leftover subscriber cannot make the next test's counts mean something else.
  await waitFor(() => statsFeedState().subscribers === 0, 2000);
});

afterEach(async () => {
  await new Promise<void>((r) => {
    server.closeAllConnections?.();
    server.close(() => r());
  });
});

describe("the stream delivers, and keeps delivering", () => {
  it("sends the current numbers immediately — a new viewer never waits for a tick", async () => {
    const s = openStream(port);
    const got = await waitFor(() => s.frames.length > 0);
    expect(got).toBe(true);
    expect(s.frames[0].kind).toBe("stats");
    expect(s.frames[0].registeredUsers).toBe(10);
    expect(s.frames[0].onlineNow).toBe(5);
    s.stop();
  });

  it("pushes a NEW frame when somebody comes online — the owner's actual ask", async () => {
    const s = openStream(port);
    expect(await waitFor(() => s.frames.length > 0)).toBe(true);
    const before = s.frames.length;

    // Somebody signs in.
    onlineCount = 6;

    expect(await waitFor(() => s.frames.length > before)).toBe(true);
    expect(s.frames[s.frames.length - 1].onlineNow).toBe(6);
    s.stop();
  });

  it("sends NOTHING while the numbers are unchanged", async () => {
    const s = openStream(port);
    // Wait for the feed to SETTLE first. The snapshot is module state, so it may
    // still hold a previous test's value when this stream opens — in which case the
    // first tick correctly pushes a corrective frame. That is the feature working,
    // not noise, so the quiet window has to start after it.
    expect(await waitFor(() => s.frames[s.frames.length - 1]?.onlineNow === 5)).toBe(true);
    const after = s.frames.length;
    // Now several fast ticks must pass with NO new frame — a quiet network costs only
    // heartbeat comments, which is what makes this cheaper than polling.
    await new Promise((r) => setTimeout(r, 1000)); // two fast ticks
    expect(s.frames.length).toBe(after);
    s.stop();
  });

  it("reaches EVERY open viewer from one shared computation", async () => {
    const a = openStream(port);
    const b = openStream(port);
    expect(await waitFor(() => a.frames.length > 0 && b.frames.length > 0)).toBe(true);
    const readsBefore = onlineReads;
    onlineCount = 9;
    expect(
      await waitFor(
        () =>
          a.frames[a.frames.length - 1]?.onlineNow === 9 &&
          b.frames[b.frames.length - 1]?.onlineNow === 9
      )
    ).toBe(true);
    // Two viewers, but the change was discovered by ONE read — this is the property
    // that makes the feed cheaper than per-visitor polling, so it is asserted rather
    // than assumed. (Allow a couple of ticks' worth of reads, not two per viewer.)
    expect(onlineReads - readsBefore).toBeLessThanOrEqual(3);
    a.stop();
    b.stop();
  });
});

describe("a presence change pushes IMMEDIATELY, not on the next tick", () => {
  it("registers a presence hook at all", () => {
    // Owner: "make it live, not after 30 seconds". The 2s tick was already close, but
    // a tick is a tick — signing in could take two seconds to show.
    expect(typeof presenceHook).toBe("function");
  });

  it("a poke delivers the new number FASTER than the tick could have", async () => {
    // The discrimination is the whole point, and the first version of this test did
    // not have it: it claimed in a comment to slow the tick down and then did not,
    // so a coincidental tick would have satisfied it and proved nothing. The tick is
    // 400ms here and the poke coalesces at 150ms, so a frame inside ~300ms can only
    // have come from the poke.
    const s = openStream(port);
    expect(await waitFor(() => s.frames[s.frames.length - 1]?.onlineNow === 5)).toBe(true);
    const before = s.frames.length;
    onlineCount = 42;
    const t0 = Date.now();
    presenceHook?.();
    expect(await waitFor(() => s.frames.length > before, 1500)).toBe(true);
    const latency = Date.now() - t0;
    expect(s.frames[s.frames.length - 1].onlineNow).toBe(42);
    expect(latency).toBeLessThan(350);
    s.stop();
  });

  it("coalesces a burst into ONE read — a sweep must not become a read storm", async () => {
    const s = openStream(port);
    expect(await waitFor(() => s.frames[s.frames.length - 1]?.onlineNow === 5)).toBe(true);
    const readsBefore = onlineReads;
    // Fifty people sign in at once. Presence writes genuinely arrive in bursts like
    // this (a heartbeat sweep, a call ending, the reaper), and one database read per
    // event would be far worse than the polling this replaced.
    for (let i = 0; i < 50; i++) presenceHook?.();
    await new Promise((r) => setTimeout(r, 300));
    expect(onlineReads - readsBefore).toBeLessThanOrEqual(8);
    s.stop();
  });

  it("is a no-op when nobody is watching", async () => {
    expect(await waitFor(() => statsFeedState().subscribers === 0)).toBe(true);
    const readsBefore = onlineReads;
    for (let i = 0; i < 10; i++) presenceHook?.();
    await new Promise((r) => setTimeout(r, 300));
    expect(onlineReads).toBe(readsBefore);
    // NOTE, recorded rather than quietly counted as a pass: the mutation run showed
    // this property is defended TWICE — removing the audience check from pokeStatsFeed
    // does not break it, because refresh() returns early on an empty client set as
    // well. The check in pokeStatsFeed is still worth keeping (presence writes happen
    // whether or not anyone is watching, so without it every burst allocates a timer),
    // but the invariant itself rests on refresh().
    expect(fs.readFileSync(path.resolve(__dirname, "statsFeed.ts"), "utf8")).toMatch(
      /async function refresh\(full: boolean\): Promise<void> \{\s*\n\s*if \(clients\.size === 0\) return;/
    );
  });

  it("the notify lives INSIDE the presence writes, not at their call sites", () => {
    // This file mocks ./v2db, so the real markOnline/markOffline are unreachable from
    // here — the mutation run proved that by leaving both silent with every test still
    // green. Pinned at the source instead, because the property that matters is
    // structural: there are four callers of these writes today and forgetting one is
    // the exact class of bug this codebase keeps re-learning.
    const db = fs.readFileSync(path.resolve(__dirname, "v2db.ts"), "utf8");
    const online = db.slice(db.indexOf("export async function markOnline"), db.indexOf("export async function markOffline"));
    const offline = db.slice(db.indexOf("export async function markOffline"), db.indexOf("export async function markOffline") + 700);
    // A real transition notifies; a mere heartbeat from someone already online must
    // NOT, or every open tab costs a database read every 30s.
    expect(online).toMatch(/if \(!wasOnline\) notifyPresenceChanged\(\);/);
    expect(offline).toMatch(/notifyPresenceChanged\(\);/);
    // And the hook can never throw into a presence write.
    expect(db).toMatch(/function notifyPresenceChanged\(\): void \{\s*\n\s*try \{/);
  });
});

describe("cost — an idle instance must do no database work", () => {
  it("runs no timers until somebody is watching, and stops when they leave", async () => {
    expect(statsFeedState().subscribers).toBe(0);
    expect(statsFeedState().timersRunning).toBe(false);

    const s = openStream(port);
    expect(await waitFor(() => statsFeedState().subscribers === 1)).toBe(true);
    expect(statsFeedState().timersRunning).toBe(true);

    s.stop();
    // The last unsubscribe must stop them, or an instance nobody is looking at keeps
    // counting rows forever — a regression against the polling it replaced.
    expect(await waitFor(() => statsFeedState().subscribers === 0)).toBe(true);
    expect(statsFeedState().timersRunning).toBe(false);
  });

  it("stops reading the database once the last viewer is gone", async () => {
    const s = openStream(port);
    expect(await waitFor(() => s.frames.length > 0)).toBe(true);
    s.stop();
    expect(await waitFor(() => statsFeedState().subscribers === 0)).toBe(true);
    const quiet = onlineReads;
    await new Promise((r) => setTimeout(r, 1000)); // two fast ticks would have fired
    expect(onlineReads).toBe(quiet);
  });

  it("re-reads the CHEAP figure often and the expensive totals rarely", async () => {
    // Counting `messages` every 2s to watch a number that changes hourly would be
    // indefensible, so the two cadences are separate and the fast one must be the
    // index-scan-only read.
    const s = openStream(port);
    expect(await waitFor(() => s.frames.length > 0)).toBe(true);
    const f0 = fullReads;
    await new Promise((r) => setTimeout(r, 1000)); // two fast ticks, no slow one
    expect(onlineReads).toBeGreaterThan(0);
    expect(fullReads).toBe(f0); // no second full read inside the slow window
    s.stop();
  });
});

describe("it degrades rather than misleads", () => {
  it("keeps the last good numbers when the online read fails", async () => {
    const s = openStream(port);
    expect(await waitFor(() => s.frames.length > 0)).toBe(true);
    const seen = s.frames[s.frames.length - 1].onlineNow;
    // A blip. Reporting "0 online" on the front page because a query failed would be
    // a visible lie, so null must hold the previous value rather than zero it.
    onlineCount = null;
    await new Promise((r) => setTimeout(r, 400));
    const last = s.frames[s.frames.length - 1].onlineNow;
    expect(last).toBe(seen);
    expect(last).not.toBe(0);
    s.stop();
  });

  it("tells a refused client how long to wait before reconnecting", async () => {
    // EventSource ignores a JSON body and reconnects on its own schedule, so a bare
    // 429 invites a reconnect storm from exactly the clients being refused.
    const src = fs.readFileSync(path.resolve(__dirname, "statsFeed.ts"), "utf8");
    expect(src).toMatch(/res\.write\(`retry: \$\{CLIENT_RETRY_MS\}\\n`\)/);
    const refused = src.slice(src.indexOf("if (!rateLimitOff())"), src.indexOf("res.status(200)"));
    expect(refused).toMatch(/text\/event-stream/);
    expect(refused).toMatch(/retry: \$\{CLIENT_RETRY_MS\}/);
  });

  it("carries counts ONLY — never a name, a number, or an identity", async () => {
    const s = openStream(port);
    expect(await waitFor(() => s.frames.length > 0)).toBe(true);
    const keys = Object.keys(s.frames[0]).sort();
    expect(keys).toEqual(
      ["guestsServed", "kind", "messagesSent", "onlineNow", "registeredUsers", "totalParties"].sort()
    );
    s.stop();
  });
});

describe("wiring", () => {
  const SRC = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

  it("is registered on the app beside the other SSE routes", () => {
    const idx = SRC("server/_core/index.ts");
    expect(idx).toMatch(/import \{ registerStatsFeed \} from "\.\.\/statsFeed";/);
    expect(idx).toMatch(/registerStatsFeed\(app\);/);
  });

  it("BOTH surfaces read the same hook, so neither can be staler than the other", () => {
    const home = SRC("client/src/pages/Home.tsx");
    const login = SRC("client/src/app/LiveStats.tsx");
    expect(home).toMatch(/const live = useLiveStats\(\);/);
    expect(login).toMatch(/const d = useLiveStats\(\);/);
    // The old independent polls are gone from both.
    expect(home).not.toMatch(/trpc\.stats\.public\.useQuery\(undefined, \{\s*\n\s*refetchInterval: 30_000/);
    expect(login).not.toMatch(/trpc\.stats\.public\.useQuery/);
  });

  it("the hook keeps a poll as a backstop rather than trusting the stream alone", () => {
    // A proxy can hold an event-stream open while buffering it, which looks identical
    // to a quiet network from the client's side. A slow poll is what catches that.
    const hook = SRC("client/src/app/useLiveStats.ts");
    expect(hook).toMatch(/const FALLBACK_POLL_MS = 15_000;/);
    expect(hook).toMatch(/const BACKSTOP_POLL_MS = 120_000;/);
    expect(hook).toMatch(/refetchInterval: streaming \? BACKSTOP_POLL_MS : FALLBACK_POLL_MS/);
    // …and it must not hand-roll a reconnect loop on top of EventSource's own.
    expect(hook).not.toMatch(/setTimeout\([^)]*open/);
    expect(hook).toMatch(/EventSource reconnects by itself/);
  });

  it("renders nothing rather than a wall of zeros", () => {
    const hook = SRC("client/src/app/useLiveStats.ts");
    expect(hook).toMatch(/return pushed \?\? query\.data \?\? null;/);
    expect(SRC("client/src/app/LiveStats.tsx")).toMatch(/if \(!d\) return null;/);
  });
});
