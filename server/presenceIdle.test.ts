/* ============================================================
   v2.99.92 — minimising the app is IDLE, not offline.

   Owner: "Whenever you minimize the app, the user showing offline, not the idle."

   `PresenceManager` fired the go-offline beacon on `visibilitychange → hidden` as
   well as on `pagehide`, so switching apps for five seconds told every contact you
   had left.

   THE HARD PART IS NOT THE THIRD STATE — IT IS THAT `isOnline` ANSWERED TWO
   DIFFERENT QUESTIONS. "What LED do I draw?" and "should I push, because they
   cannot see this in the open app?" were the same boolean, so keeping `isOnline`
   true while backgrounded would have SILENTLY STOPPED notifying a minimised app —
   making the owner's complaint worse, in a way nothing on screen would show. Hence
   one shared `presenceNeedsNotification`, used at every site that asks the second
   question, and a test that enumerates them.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { effectiveStatus } from "@shared/profileFields";
import { presenceNeedsNotification, type PresenceLite } from "./v2db";
import { presenceDot } from "../client/src/app/presenceDot";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const V2DB = read("server/v2db.ts");
const ROUTERS = read("server/v2routers.ts");
const MANAGER = read("client/src/app/PresenceManager.tsx");
const SCHEMA = read("drizzle/schema.ts");

function codeOnly(src: string): string {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

/** A named function's body, bounded by its own end. */
function fn(src: string, decl: string): string {
  const at = src.indexOf(decl);
  expect(at, `${decl} exists`).toBeGreaterThan(-1);
  const body = src.slice(at, src.indexOf("\n}", at) + 2);
  expect(body.length, `${decl} body is not empty`).toBeGreaterThan(120);
  return body;
}

const P = (o: Partial<PresenceLite>): PresenceLite => ({
  identityId: 1,
  isOnline: false,
  lastSeenAt: null,
  idle: false,
  idleSince: null,
  ...o,
});

/* ── the rule that stops idle becoming a silent notification outage ────────── */

describe("presenceNeedsNotification — one rule, behaviourally", () => {
  it("a foreground app does NOT need one", () => {
    expect(presenceNeedsNotification(P({ isOnline: true }))).toBe(false);
  });

  it("a BACKGROUNDED app DOES — this is the whole trap", () => {
    // It is `isOnline` now, which is what stopped minimising reading as offline. But
    // it cannot draw an in-page toast, so without this it would silently stop being
    // notified at all.
    expect(presenceNeedsNotification(P({ isOnline: true, idle: true }))).toBe(true);
  });

  it("an offline app does", () => {
    expect(presenceNeedsNotification(P({ isOnline: false }))).toBe(true);
  });

  it("an UNKNOWN identity does — it fails toward telling them", () => {
    // Failing the other way loses the notification entirely, which is worse than a
    // notification somebody did not strictly need.
    expect(presenceNeedsNotification(undefined)).toBe(true);
    expect(presenceNeedsNotification(null)).toBe(true);
  });

  it("every site that asks the question uses it", () => {
    // Three sites wrote `!presence.isOnline` inline before this release. Enumerated
    // rather than listed by hand: a fourth added later has to come through here.
    const asks = [...ROUTERS.matchAll(/presenceNeedsNotification\(/g)];
    expect(asks.length).toBeGreaterThanOrEqual(2);
    // No site still decides "should I notify" straight off isOnline.
    const code = codeOnly(ROUTERS);
    expect(code).not.toMatch(/offlinePeerIds = peerIds\.filter\(\(pid\) => !presenceById/);
    expect(code).not.toMatch(/!pres\?\.isOnline && \(await pushReachable/);
  });

  it("the AUTO-REPLY deliberately does NOT use it", () => {
    // It posts a line in somebody else's name saying they are away and will reply
    // later. Somebody who switched apps for ten seconds may reply immediately, so
    // firing it on idle would make the auto-reply a lie — the same over-reaction to
    // minimising this release exists to remove, in message form.
    const at = ROUTERS.indexOf("// Offline auto-reply (1:1 only");
    const block = ROUTERS.slice(at, ROUTERS.indexOf("\n      } catch {", at));
    expect(block.length).toBeGreaterThan(400);
    expect(block).toMatch(/const offline = !pres\?\.isOnline;/);
    expect(codeOnly(block)).not.toMatch(/presenceNeedsNotification/);
  });
});

/* ── the writers ──────────────────────────────────────────────────────────── */

describe("the presence writers agree about idle", () => {
  it("markIdle keeps isOnline TRUE and refreshes lastSeenAt, on BOTH paths", () => {
    // Both are load-bearing: `isOnline` false is the bug being fixed, and a stale
    // `lastSeenAt` would let the 2-minute reaper take a minimised-but-open app
    // offline — which is also the bug being fixed.
    //
    // COUNTED, not merely matched. The first version of this test asserted each
    // string appeared SOMEWHERE in the function, and the mutation run showed that
    // passes with either path broken: `markIdle` is an upsert, so `isOnline: true`
    // and `lastSeenAt: now` each occur twice — once in the INSERT (a first-ever
    // presence row) and once in the UPDATE (every beat after that). Breaking the
    // UPDATE is the worse of the two, because it is the path that keeps a minimised
    // app out of the reaper's way, and it was the one the loose assertion missed.
    const body = fn(V2DB, "export async function markIdle(");
    expect([...body.matchAll(/isOnline: true/g)]).toHaveLength(2);
    expect([...body.matchAll(/lastSeenAt: now/g)]).toHaveLength(2);
    expect(body).toMatch(/\.values\(\{ identityId, isOnline: true, lastSeenAt: now, idleSince: now \}\)/);
    // …and the UPDATE half explicitly, so neither can be dropped silently.
    const set = body.slice(body.indexOf("set: {"));
    expect(set).toMatch(/isOnline: true,/);
    expect(set).toMatch(/lastSeenAt: now,/);
  });

  it("markIdle records the FIRST idle moment, not the latest beat", () => {
    // A bare `now` would reset the clock every 60s and the person would never read
    // as "away for a while" — which the offline-message email's rule 2 depends on.
    const body = fn(V2DB, "export async function markIdle(");
    expect(body).toMatch(/idleSince: sql`COALESCE\(\$\{presence\.idleSince\}, \$\{now\}\)`/);
  });

  it("returning to the FOREGROUND clears idle, in the same write", () => {
    const body = fn(V2DB, "export async function markOnline(");
    expect([...body.matchAll(/idleSince: null/g)].length).toBe(2); // insert + update
  });

  it("going offline clears idle", () => {
    // `idle` is derived as `isOnline && idleSince != null`, so a leftover timestamp
    // is harmless today and a trap the moment anyone reads the column alone.
    const body = fn(V2DB, "export async function markOffline(");
    expect([...body.matchAll(/idleSince: null/g)].length).toBe(2);
  });

  it("the reaper clears idle with the flip", () => {
    const body = fn(V2DB, "export async function reapStalePresence(");
    expect(body).toMatch(/\.set\(\{ isOnline: false, idleSince: null \}\)/);
  });

  it("markIdle does NOT poke the live-stats feed", () => {
    // An idle identity still counts as online, so no headline number changes; a poke
    // per background/foreground flip would be pure database load.
    const body = fn(V2DB, "export async function markIdle(");
    expect(codeOnly(body)).not.toMatch(/notifyPresenceChanged/);
  });

  it("the column is additive and nullable, so every existing row reads correctly", () => {
    expect(SCHEMA).toMatch(/idleSince: timestamp\("idleSince"\)/);
    expect(V2DB).toMatch(/\{ table: "presence", column: "idleSince", ddl: "ADD COLUMN `idleSince` timestamp NULL" \}/);
    // NULL means foreground — exactly the reading a pre-release row needs, so the
    // migration is a no-op until a client starts reporting idle.
    expect(presenceNeedsNotification(P({ isOnline: true, idleSince: null }))).toBe(false);
  });
});

describe("idle is derived in exactly ONE place", () => {
  it("getPresenceForIds computes it, and an offline row is never idle", () => {
    // Every presence read in the routers comes through this function, so the rule
    // here reaches all of them at once — and no consumer can combine the two fields
    // wrongly because none of them sees the raw pair.
    const body = V2DB.slice(V2DB.indexOf("export async function getPresenceForIds("));
    const slice = body.slice(0, body.indexOf("\n}") + 2);
    expect(slice).toMatch(/idle: r\.isOnline && idleSince != null/);
    // The default for an identity with no row.
    expect(slice).toMatch(/idle: false,\n\s*idleSince: null,/);
  });

  it("every wire projection carries idle beside isOnline, never instead of it", () => {
    // Additive, so an older client simply ignores it and keeps today's reading.
    const projections = [
      /idle: hidden \? false : \(pres\?\.idle \?\? false\)/,
      /\{ \.\.\.p, isOnline: false, idle: false, lastSeenAt: null \}/,
      /peerIdle: presenceHidden \? false : \(p\?\.idle \?\? false\)/,
    ];
    for (const re of projections) expect(ROUTERS).toMatch(re);
    // And guest-privacy suppression covers idle too: a hidden presence must not leak
    // "away" when it is withholding everything else.
    const suppressed = [...ROUTERS.matchAll(/idle: hidden \? false/g)];
    expect(suppressed.length).toBeGreaterThanOrEqual(3);
  });
});

/* ── the display ──────────────────────────────────────────────────────────── */

describe("effectiveStatus maps idle onto the EXISTING away", () => {
  it("backgrounded reads as away", () => {
    expect(effectiveStatus(true, "", true)).toBe("away");
  });

  it("foreground reads as online, offline as offline", () => {
    expect(effectiveStatus(true, "", false)).toBe("online");
    expect(effectiveStatus(false, "", true)).toBe("offline");
    expect(effectiveStatus(false, "", false)).toBe("offline");
  });

  it("a MANUAL override still wins over an automatic idle", () => {
    // Somebody who set "travelling" said so on purpose; an automatic signal must not
    // overwrite a deliberate one.
    expect(effectiveStatus(true, "travel", true)).toBe("travel");
    expect(effectiveStatus(false, "travel", false)).toBe("travel");
    expect(effectiveStatus(true, "away", true)).toBe("away");
  });

  it("idle DEFAULTS to false, which is the safety property", () => {
    // A caller not yet taught about idle degrades to the pre-v2.99.92 reading
    // (online) rather than to the wrong-way failure of showing somebody offline.
    expect(effectiveStatus(true, "")).toBe("online");
    expect(effectiveStatus(false, "")).toBe("offline");
  });
});

describe("one LED rule for every dot", () => {
  it("idle is the online green FADED, with no glow", () => {
    // Not a new hue: amber already means "on a call" here and "Do Not Disturb" in
    // the top bar, and a third meaning would make colour stop carrying information.
    // The glow is what makes green read as "active right now", so idle loses it.
    const d = presenceDot({ isOnline: true, idle: true });
    expect(d.label).toBe("Away");
    expect(d.glow).toBe("");
    expect(d.live).toBe(true);
    expect(d.color).toContain("--relay-online");

    const on = presenceDot({ isOnline: true });
    expect(on.label).toBe("Online");
    expect(on.glow).not.toBe("");
  });

  it("on a call outranks everything, and offline is grey not red", () => {
    expect(presenceDot({ isOnline: true, idle: true, inCall: true }).label).toBe("On a call");
    expect(presenceDot({ isOnline: false, inCall: true }).label).toBe("On a call");
    const off = presenceDot({ isOnline: false });
    expect(off.label).toBe("Offline");
    expect(off.live).toBe(false);
    expect(off.color).not.toMatch(/red|#ef4444|#f87171/);
  });

  it("every screen that draws a dot reads the shared rule", () => {
    // Eight dots across four screens had to learn the third state; eight copies is
    // how two surfaces end up disagreeing about one person (v2.99.77 was exactly
    // that bug, one rule applied in four places and forgotten in a fifth).
    for (const f of [
      "client/src/pages/app/Contacts.tsx",
      "client/src/pages/app/Messages.tsx",
    ]) {
      expect(read(f), `${f} imports presenceDot`).toMatch(
        /import \{ presenceDot \} from "@\/app\/presenceDot"/
      );
    }
  });
});

/* ── the client ───────────────────────────────────────────────────────────── */

describe("PresenceManager: hidden is idle, only a close is offline", () => {
  it("visibilitychange → hidden marks IDLE, and no longer beacons offline", () => {
    const at = MANAGER.indexOf("const onVisibility =");
    const body = MANAGER.slice(at, MANAGER.indexOf("\n    };", at));
    expect(body).toMatch(/document\.visibilityState === "hidden"\) idleTick\(\)/);
    expect(codeOnly(body)).not.toMatch(/onLeave\(/);
  });

  it("pagehide and beforeunload still beacon offline", () => {
    expect(MANAGER).toMatch(/const onClose = \(\) => onLeave\(\);/);
    expect(MANAGER).toMatch(/window\.addEventListener\("pagehide", onClose\)/);
    expect(MANAGER).toMatch(/window\.addEventListener\("beforeunload", onClose\)/);
    const at = MANAGER.indexOf("const onLeave =");
    expect(MANAGER.slice(at, MANAGER.indexOf("\n    };", at))).toMatch(/beaconOffline\(\)/);
  });

  it("the idle beat is a SEPARATE endpoint from the heartbeat", () => {
    // `heartbeat` calls `markOnline`, which clears idle AND can fire the "X is back
    // online" watcher push. Reusing it while hidden is the v2.99.25/H6 bug, and this
    // loop would have reintroduced it.
    expect(MANAGER).toMatch(/trpc\.directory\.markIdle\.useMutation\(\)/);
    const at = MANAGER.indexOf("const idleTick =");
    const body = MANAGER.slice(at, MANAGER.indexOf("\n    };", at));
    expect(body).toMatch(/markIdle\.mutate\(\)/);
    expect(codeOnly(body)).not.toMatch(/heartbeat\.mutate/);
  });

  it("the idle beat runs ONLY while hidden, and is cleaned up", () => {
    const at = MANAGER.indexOf("const idleTick =");
    const body = MANAGER.slice(at, MANAGER.indexOf("\n    };", at));
    expect(body).toMatch(/document\.visibilityState !== "hidden"\) return;/);
    expect(MANAGER).toMatch(/const idleInterval = window\.setInterval\(idleTick, 60_000\)/);
    expect(MANAGER).toMatch(/window\.clearInterval\(idleInterval\)/);
  });

  it("another VISIBLE tab of the same identity suppresses idle", () => {
    // Otherwise burying one tab would report the whole identity away while the
    // person is looking at RELAY in another. Same M12 ref-count as the beacon.
    const at = MANAGER.indexOf("const idleTick =");
    const body = MANAGER.slice(at, MANAGER.indexOf("\n    };", at));
    expect(body).toMatch(/if \(otherTabsAlive\(id, tabId, Date\.now\(\)\)\) return;/);
  });

  it("the 30s heartbeat still refuses to run while hidden", () => {
    // v2.99.25/H6, and it matters MORE now: a blind beat would clear the idle state
    // this manager just set and tell every watcher somebody came back who never left.
    const at = MANAGER.indexOf("const tick =");
    const body = MANAGER.slice(at, MANAGER.indexOf("\n    };", at));
    expect(body).toMatch(/document\.visibilityState === "hidden"\) return;/);
    expect(body.indexOf("hidden")).toBeLessThan(body.indexOf("heartbeat.mutate"));
  });

  it("the markIdle endpoint fans no presence SSE event", () => {
    // `isOnline` has not changed, so publishing `true` again is a no-op costing an
    // audience query per app switch — and publishing `false` would be the bug.
    const at = ROUTERS.indexOf("  markIdle: publicProcedure");
    expect(at).toBeGreaterThan(-1);
    const body = ROUTERS.slice(at, ROUTERS.indexOf("\n  }),", at));
    expect(body).toMatch(/await markIdle\(me\.id\)/);
    expect(codeOnly(body)).not.toMatch(/publishPresenceTo|getPresenceAudienceIds/);
  });
});

describe("how long they have been away survives a refreshing lastSeenAt", () => {
  it("awayForMs measures from idleSince while idle", () => {
    // A backgrounded app keeps heartbeating, so `lastSeenAt` would report a few
    // seconds forever and the offline-message email's rule 2 would never fire.
    const body = fn(ROUTERS, "function awayForMs(");
    expect(body).toMatch(/if \(!presence\.idle \|\| !presence\.idleSince\) return null;/);
    expect(body).toMatch(/new Date\(presence\.idleSince\)\.getTime\(\)/);
    // Still falls back to lastSeenAt for a genuinely offline person.
    expect(body).toMatch(/presence\.lastSeenAt \? new Date\(presence\.lastSeenAt\)\.getTime\(\)/);
  });
});
