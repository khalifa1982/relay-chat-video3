/**
 * v2.97.1 — call-hold overhaul, client-side contract pins.
 *
 * THE BUG (owner: "when you answer the other call, the first call drops"):
 * on the SFU path, putting a call on hold tears down the holder's LiveKit
 * connection — the HELD party's client read that disconnect as "they left"
 * and ran the 1:1 auto-end, killing the parked call. The `peer-hold` signal
 * exists but was never consulted, and can even arrive AFTER the disconnect.
 *
 * THE FIX, pinned here:
 *  - `peersHoldingUs` gates every auto-end path; the held tile stays (marked
 *    on-hold) instead of being removed;
 *  - a bare solo-1:1 SFU disconnect arms a 1.6s GRACE fuse instead of ending
 *    instantly — a late peer-hold (or a rejoin) defuses it;
 *  - the parked party hears light HOLD MUSIC and sees an "on hold" banner;
 *  - a REAL leave (peer-left — e.g. the holder hung up entirely) clears the
 *    hold state so the call still ends honestly;
 *  - the holder can now END THE HELD LINE specifically (new heldBar button →
 *    server `end-held` → releaseHeldRoom), alongside Swap / Merge / the
 *    hang-up button's existing end-active-resume-held behavior.
 * (The end-held server behavior itself has a BEHAVIORAL test in relay.test.ts.)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

const CLIENT = read("client/src/lib/relayClient.ts");
const ASSETS = read("client/src/lib/relayAssets.ts");
const SERVER = read("server/relay.ts");

describe("held 1:1 must NOT drop (v2.97.1)", () => {
  it("peersHoldingUs gates the SFU tile-removal auto-end (the reported drop)", () => {
    expect(CLIENT).toMatch(/const peersHoldingUs = new Set<string>\(\);/);
    const rm = CLIENT.slice(CLIENT.indexOf("function removeLkTile"));
    expect(rm.slice(0, 700)).toMatch(/if \(peersHoldingUs\.has\(id\)\) \{/);
    expect(rm.slice(0, 700)).toMatch(/classList\.add\("on-hold"\);\s*\n\s*layoutGrid\(\);\s*\n\s*return;/);
  });
  it("a bare solo-1:1 disconnect arms a grace fuse instead of ending instantly", () => {
    expect(CLIENT).toMatch(/function armSoloEndGrace\(nm: string\)/);
    expect(CLIENT).toMatch(/\}, 1600\);/);
    // The fuse re-checks: still solo, nobody holding us, no rejoin.
    expect(CLIENT).toMatch(/if \(peersHoldingUs\.size > 0\) return;/);
    expect(CLIENT).toMatch(/if \(!aloneInCall\(\)\) return;/);
    // …and a landing peer-hold defuses it.
    expect(CLIENT).toMatch(/peersHoldingUs\.add\(pin\);\s*\n[\s\S]{0,120}cancelSoloEndGrace\(\);/);
  });
  it("the SFU race is healed in BOTH orders: a late hold restores the removed tile", () => {
    expect(CLIENT).toMatch(/if \(livekitEnabled && !document\.getElementById\("tile-" \+ pin\)\) addLkTile\(pin, nm\);/);
  });
  it("a REAL leave clears the hold state so a holder's full hang-up still ends the call", () => {
    const pl = CLIENT.slice(CLIENT.indexOf('case "peer-left"'));
    expect(pl.slice(0, 600)).toMatch(/peersHoldingUs\.delete\(goneP\);/);
    expect(pl.slice(0, 600)).toMatch(/if \(livekitEnabled && lkParticipantTiles\[goneP\]\) removeLkTile\(goneP\);/);
  });
  it("being-held state dies with the call (cleanup + destroy)", () => {
    expect(CLIENT).toMatch(/peersHoldingUs\.clear\(\);\s*\n\s*cancelSoloEndGrace\(\);\s*\n\s*stopHoldMusic\(\);/);
    const destroy = CLIENT.slice(CLIENT.indexOf("destroy() {"));
    expect(destroy.slice(0, 400)).toMatch(/stopHoldMusic\(\);/);
  });
});

describe("hold music + on-hold banner (v2.97.1, owner spec)", () => {
  it("the parked party gets a light looped motif — started on hold, stopped on resume", () => {
    expect(CLIENT).toMatch(/function startHoldMusic\(\)/);
    expect(CLIENT).toMatch(/function stopHoldMusic\(\)/);
    expect(CLIENT).toMatch(/holdMusicBar\(cueCtx\);\s*\n\s*holdMusicTimer = setInterval/);
    // Queued oscillators are stopped too (the ringtone suspended-context lesson).
    expect(CLIENT).toMatch(/holdMusicNodes\.forEach\(n => \{ try \{ n\.stop\(\); \} catch/);
    expect(CLIENT).toMatch(/if \(held\) startHoldMusic\(\); else stopHoldMusic\(\);/);
  });
  it("music/banner apply to 1:1 holds only (group holds just mark the tile)", () => {
    expect(CLIENT).toMatch(/const held = inCall && !callIsGroup && peersHoldingUs\.size > 0;/);
  });
  it("the banner markup + styles exist (with the double-bar stacking rule)", () => {
    expect(ASSETS).toContain('id="onHoldBar"');
    expect(ASSETS).toContain('id="onHoldName"');
    expect(ASSETS).toMatch(/\.onhold-bar\.show\{display:flex\}/);
    expect(ASSETS).toMatch(/\.held-bar\.show ~ \.onhold-bar\.show\{top:82px\}/);
  });
});

describe("End-held — pick which call to drop (v2.97.1)", () => {
  it("the heldBar offers Swap / Merge / End held", () => {
    expect(ASSETS).toMatch(/id="heldSwap"/);
    expect(ASSETS).toMatch(/id="heldMerge"/);
    expect(ASSETS).toMatch(/id="heldEnd"[\s\S]{0,140}End held/);
    expect(ASSETS).toMatch(/\.held-bar \.held-end\{background:rgba\(255,92,114/);
  });
  it("endHeldLine closes the frozen peers and releases the held room server-side", () => {
    expect(CLIENT).toMatch(/function endHeldLine\(\) \{\s*\n\s*if \(!heldRoomId\)/);
    expect(CLIENT).toMatch(/dropHeld\(\);\s*\n\s*sendWS\(\{ type: "end-held" \}\);/);
    expect(CLIENT).toMatch(/\("heldEnd" as .*\)\?\.addEventListener\("click", endHeldLine\)|\$\("heldEnd"\) as HTMLElement \| null\)\?\.addEventListener\("click", endHeldLine\)/);
    expect(SERVER).toMatch(/case "end-held": \{/);
    expect(SERVER).toMatch(/releaseHeldRoom\(reg, conn\.pin\);\s*\n\s*safeSend\(conn\.socket, \{ type: "held-ended" \}\);/);
  });
});
