/**
 * v2.97.1 — call-hold overhaul, client-side contract pins.
 *
 * THE BUG (owner: "when you answer the other call, the first call drops"):
 * putting a call on hold takes the holder's media away, and the HELD party's
 * client read that quiet transport as "they left" and ran the 1:1 auto-end,
 * killing the parked call. The `peer-hold` signal exists but was never
 * consulted, and can even arrive AFTER the transport goes quiet.
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
  it("peersHoldingUs gates the ONLY 1:1 auto-end, so a holder is never read as gone", () => {
    /* v2.106.53 removed the SFU-specific tile remover this used to read, and the
       property is now stronger for it: there is exactly ONE place a 1:1 can decide
       the other side has left, and it consults `peersHoldingUs` before doing so.
       Two paths were how the reported "answering a second call kills the first"
       happened — a holder's transport going quiet on one of them read as a
       departure. */
    expect(CLIENT).toMatch(/const peersHoldingUs = new Set<string>\(\);/);
    /* THE FUSE is the path a quiet transport takes, and it is the one that has to
       consult the set: a holder's media stops without their leaving. */
    const fuse = CLIENT.slice(
      CLIENT.indexOf("function armSoloEndGrace("),
      CLIENT.indexOf("}, 1600);"),
    );
    expect(fuse.length, "the fuse slice must be real").toBeGreaterThan(80);
    expect(fuse).toMatch(/if \(peersHoldingUs\.size > 0\) return;/);
    /* THE OTHER auto-end sits at `removePeer`'s tail and needs no such guard,
       which is worth stating rather than leaving as an apparent gap: on the mesh a
       hold FREEZES media and keeps the peer connection, so a holder is never
       removed — the grace-timeout removals are all gated on `!peer.gotStream`,
       i.e. a peer whose media never arrived at all. The guard that used to live
       here was specific to a transport that removed a tile when its tracks went
       away (v2.106.53). */
    const graces = CLIENT.match(/removePeer\(pin\);/g) || [];
    expect(graces.length).toBeGreaterThanOrEqual(2);
    expect(CLIENT).toMatch(/if \(\(c2 === "failed" \|\| c2 === "disconnected"\) && !peer\.gotStream\)/);
    // …and a departure that IS real still clears the state.
    expect(CLIENT).toMatch(/peersHoldingUs\.delete\(pin\);/);
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
  it("a late hold restores the removed tile, whatever the transport", () => {
    // v2.99.67 widened this. The original only healed one transport's race, so in a
    // MESH conference the held peer's tile stayed gone: the owner reported hearing
    // someone whose picture had vanished. The property is unchanged and now
    // stronger — a hold always leaves a tile — but it is transport-agnostic,
    // and `ensurePlaceholderTile` is itself a no-op when a tile exists.
    const hold = CLIENT.slice(CLIENT.indexOf("function onPeerHold"), CLIENT.indexOf("function onRoleChange"));
    expect(hold).toMatch(/peersHoldingUs\.add\(pin\);[\s\S]{0,600}?ensurePlaceholderTile\(pin, nm\);/);
    // No transport gate may stand between a hold and its tile again.
    expect(hold).not.toMatch(/if \(livekitEnabled/);
    // And the way BACK restores it too, which is the half that was missing.
    const back = hold.slice(hold.indexOf("peersHoldingUs.delete(pin);"));
    expect(back).toMatch(/ensurePlaceholderTile\(pin, nm\);/);
  });
  it("a REAL leave clears the hold state so a holder's full hang-up still ends the call", () => {
    // Bounded by the CASE's own end rather than a fixed character count: a fixed
    // window silently goes stale the moment a line is added above the target (it did
    // — v2.106.48 inserted `sigRoster.delete(goneP)` here), and then the assertion
    // fails for a reason that has nothing to do with the property.
    const at = CLIENT.indexOf('case "peer-left"');
    expect(at).toBeGreaterThan(0);
    const pl = CLIENT.slice(at, CLIENT.indexOf("\n      }", at));
    expect(pl.length, "the case slice must be real").toBeGreaterThan(80);
    expect(pl).toMatch(/peersHoldingUs\.delete\(goneP\);/);
    expect(pl).toMatch(/removePeer\(goneP\);/);
    // The SFU's own tile remover is gone (v2.106.53); one removal path now.
    expect(pl).not.toMatch(/removeLkTile/);
  });
  it("being-held state dies with the call (cleanup + destroy)", () => {
    expect(CLIENT).toMatch(/peersHoldingUs\.clear\(\);\s*\n\s*cancelSoloEndGrace\(\);\s*\n\s*stopHoldMusic\(\);/);
    /* BOUNDED BY destroy()'s OWN END, not by a fixed 400 characters. The old
       window went stale the moment a line was added above its target — which is
       exactly what happened when v2.106.56 put a comment there — so it failed on
       correct source while saying nothing about the property, that a teardown
       stops the hold music. (The v2.99.78 fixed-slice fragility.) */
    const at = CLIENT.indexOf("    destroy() {");
    expect(at, "destroy() must exist").toBeGreaterThan(0);
    const after = CLIENT.slice(at);
    const end = after.indexOf("\n    },");
    const destroy = after.slice(0, end > 0 ? end : after.length);
    expect(destroy.length, "the destroy slice must be real").toBeGreaterThan(200);
    expect(destroy).toMatch(/stopHoldMusic\(\);/);
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
    expect(ASSETS).toContain('id="onHoldTitle"');
    expect(ASSETS).toMatch(/\.onhold-bar\.show\{display:flex\}/);
    expect(ASSETS).toMatch(/\.held-bar\.show ~ \.onhold-bar\.show\{top:82px\}/);
  });
});

describe("End-held — pick which call to drop (v2.97.1)", () => {
  it("the heldBar offers Swap / Merge / End held", () => {
    expect(ASSETS).toMatch(/id="heldSwap"/);
    expect(ASSETS).toMatch(/id="heldMerge"/);
    expect(ASSETS).toMatch(/id="heldEnd"[\s\S]{0,260}End held/);
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
