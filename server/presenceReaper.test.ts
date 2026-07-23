import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.99.3 — presence consistency.
 *
 * The reported bug: the same user (e.g. "Maja") showed ONLINE on one surface
 * and OFFLINE on another. Root cause was two-sided:
 *   1. The 60s stale-presence reaper flipped crashed/closed users offline in
 *      the DB but emitted NO SSE event, so SSE-fed surfaces (Contacts,
 *      Messages, the profile popup) kept them GREEN until their own poll while
 *      poll-fed surfaces (History) read the reaped DB and showed grey.
 *   2. The client's SSE `presence` handler didn't invalidate the batch presence
 *      queries (`directory.presenceMany`, `directory.presence`) — pinned in
 *      `client/src/app/useRealtime.test.ts`.
 *
 * This file pins the SERVER half: `reapStalePresence` now RETURNS the reaped
 * identities and the boot reaper broadcasts an offline presence event to each
 * one's audience. Behavior is source-pinned (the reaper self-starts at boot and
 * needs a live DB), matching the repo's established convention for
 * boot-wired/express behavior (see v2offline.test.ts).
 */

const V2DB = fs.readFileSync(path.resolve(__dirname, "v2db.ts"), "utf8");
const SERVER_INDEX = fs.readFileSync(path.resolve(__dirname, "_core", "index.ts"), "utf8");

describe("reapStalePresence returns the reaped identities (v2.99.3)", () => {
  // Isolate the function body so a match elsewhere in v2db can't pass it.
  const fnStart = V2DB.indexOf("export async function reapStalePresence(");
  const fnBody = V2DB.slice(fnStart, V2DB.indexOf("\n}", fnStart) + 2);

  it("declares a Promise<Array<{ id; number }>> return type (not a bare count)", () => {
    expect(fnBody).toMatch(/Promise<Array<\{\s*id:\s*number;\s*number:\s*string\s*\}>>/);
  });
  it("SELECTs the soon-to-be-reaped rows (id + number) BEFORE the UPDATE", () => {
    // The select must join identities for the number and filter the same
    // online+stale predicate the update uses.
    expect(fnBody).toMatch(/\.select\(\{\s*id:\s*identities\.id,\s*number:\s*identities\.number\s*\}\)/);
    expect(fnBody).toMatch(/\.innerJoin\(identities,/);
  });
  it("returns the captured victims (and [] when there is no DB)", () => {
    expect(fnBody).toMatch(/return victims;/);
    expect(fnBody).toMatch(/if \(!db\) return \[\];/);
  });
  it("still flips the stale rows offline", () => {
    expect(fnBody).toMatch(/\.update\(presence\)\s*\.set\(\{\s*isOnline:\s*false\s*\}\)/);
  });
});

describe("boot reaper broadcasts an offline SSE event per reaped user (v2.99.3)", () => {
  it("imports the audience resolver + presence publisher", () => {
    expect(SERVER_INDEX).toMatch(/getPresenceAudienceIds/);
    expect(SERVER_INDEX).toMatch(/publishPresenceTo/);
  });
  it("iterates the reaped users and publishes offline (false) to each audience", () => {
    // The reaper .then() receives the reaped array and fans an offline event out.
    const reaperStart = SERVER_INDEX.indexOf("reapStalePresence(120)");
    const reaperBlock = SERVER_INDEX.slice(reaperStart, reaperStart + 700);
    expect(reaperBlock).toMatch(/\.then\(async \(reaped\) =>/);
    expect(reaperBlock).toMatch(/for \(const r of reaped\)/);
    expect(reaperBlock).toMatch(/getPresenceAudienceIds\(r\.id,\s*r\.number\)/);
    expect(reaperBlock).toMatch(/publishPresenceTo\(audience,\s*r\.number,\s*false/);
  });
  it("swallows per-user errors so one bad audience never breaks the sweep", () => {
    const reaperStart = SERVER_INDEX.indexOf("reapStalePresence(120)");
    const reaperBlock = SERVER_INDEX.slice(reaperStart, reaperStart + 700);
    expect(reaperBlock).toMatch(/catch \{/);
  });
});
