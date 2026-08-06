/* ============================================================
   v2.107.51 — OWNER BATCH 4: the group-call grid, per the 5-person reference.

   Owner (from the reference screenshot): the participant boxes in a group
   video call should be organized — the ACTIVE SPEAKER large on top, the other
   participants in a grid below, and people who were INVITED but haven't
   answered yet visible as their own tiles.

   Two halves, pinned here:
   1. GEOMETRY — layoutGrid() applies the pure spotlightGridTemplate()
      (callLayout.ts, unit-tested there) instead of the old single 22%
      filmstrip row, so 2+ non-focus tiles form a real 2-4 column grid under
      the speaker while a 1:1 call keeps the slim strip.
   2. INVITED TILES — every group invitee holds a dimmed, dash-bordered
      placeholder (data-ph) with an "Invited…" pill from the moment their
      phone is rung, replaced by the real tile on join and removed on
      decline / busy / unreachable, with a 75s backstop.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

const root = path.resolve(__dirname, "..", "..", "..");
const read = (...p: string[]) => fs.readFileSync(path.resolve(root, ...p), "utf8");

const RELAY = codeOnly(read("client", "src", "lib", "relayClient.ts"));
const CSS = read("client", "src", "lib", "relayAssets.ts");
const DICT = read("client", "src", "app", "dict", "calls.ts");

describe("1 — the spotlight applies the tested geometry, not a hand-rolled filmstrip", () => {
  it("layoutGrid uses spotlightGridTemplate for both axes", () => {
    expect(RELAY).toMatch(/import \{ computeLayout, spotlightGridTemplate \} from "\.\/callLayout"/);
    const fn = RELAY.slice(
      RELAY.indexOf("function layoutGrid()"),
      RELAY.indexOf("function onGridClick"),
    );
    expect(fn).toMatch(/const tpl = spotlightGridTemplate\(plan\.thumbIds\.length, maxNow\);/);
    expect(fn).toMatch(/g\.style\.gridTemplateColumns = tpl\.columns;/);
    expect(fn).toMatch(/g\.style\.gridTemplateRows = tpl\.rows;/);
    // The old inline geometry is gone — one source of truth, in callLayout.ts.
    expect(fn).not.toMatch(/"minmax\(0,1fr\) 22%"/);
  });

  it("only a LONE thumb is pinned to row 2; 2+ auto-flow under the full-width speaker", () => {
    const fn = RELAY.slice(
      RELAY.indexOf("function layoutGrid()"),
      RELAY.indexOf("function onGridClick"),
    );
    expect(fn).toMatch(/if \(plan\.thumbIds\.length === 1\) t\.style\.gridRow = "2";/);
    // The spotlight still spans every column of row 1 — that full occupation is
    // what makes auto-placement start the thumbs at row 2.
    expect(fn).toMatch(/spot\.style\.gridColumn = "1 \/ -1";/);
  });
});

describe("2 — invited tiles exist, ride the placeholder machinery, and resolve", () => {
  it("ensureInvitedTile wraps ensurePlaceholderTile and marks the tile", () => {
    const fn = RELAY.slice(
      RELAY.indexOf("function ensureInvitedTile"),
      RELAY.indexOf("function resolveInvitedTile"),
    );
    expect(fn.length).toBeGreaterThan(100);
    // Rides the SAME placeholder path the hold/return repair uses, so the real
    // tile replaces it on join via addTile → dropPlaceholderTile.
    expect(fn).toMatch(/ensurePlaceholderTile\(pin, nameOf\(pin\)\);/);
    expect(fn).toMatch(/dataset\.ph !== "1"/);
    expect(fn).toMatch(/classList\.add\("invited"\)/);
    // The pill goes through the engine translator with an honest fallback.
    expect(fn).toMatch(/T\("calls\.invited", "Invited…"\)/);
    // Someone already CONNECTED never gets an Invited tile over their real one.
    expect(fn).toMatch(/\|\| peers\[pin\]\) return;/);
  });

  it("a 75s backstop clears a tile whose resolution never carried a pin — and can't touch a later call's tile", () => {
    const fn = RELAY.slice(
      RELAY.indexOf("function ensureInvitedTile"),
      RELAY.indexOf("function resolveInvitedTile"),
    );
    expect(fn).toMatch(/75_000/);
    // The ELEMENT is captured, and both liveness checks gate the removal.
    expect(fn).toMatch(/el\.isConnected && el\.dataset\.ph === "1"/);
  });

  it("resolveInvitedTile removes ONLY an invited placeholder, never a real tile", () => {
    const fn = RELAY.slice(
      RELAY.indexOf("function resolveInvitedTile"),
      RELAY.indexOf("function addTile(id: string"),
    );
    expect(fn).toMatch(/dataset\.ph === "1" && el\.classList\.contains\("invited"\)/);
  });
});

describe("3 — every invite path creates the tile; every resolution removes it", () => {
  it("a group dial marks every not-yet-connected invitee at dial time", () => {
    expect(RELAY).toMatch(
      /clean\.forEach\(t => \{ if \(!peers\[t\]\) ensureInvitedTile\(t\); \}\);/,
    );
  });

  it("an invite sent from INSIDE a call (an add) marks the addee — on both dial paths", () => {
    // The pad path and programmaticDial each capture the pre-dial inCall state…
    expect((RELAY.match(/const wasInCall = inCall;/g) || []).length).toBe(2);
    // …and fire only for adds, right after their sends (a fresh 1:1 dial is
    // covered by the dial card, not a tile).
    expect((RELAY.match(/if \(wasInCall\) ensureInvitedTile\(target\);/g) || []).length).toBe(2);
  });

  it("decline, busy, group-dial unreachable, and a parked-call reach error all resolve the tile", () => {
    expect(RELAY).toMatch(/groupInviteeResolved\(m\.from, "Everyone declined\."\);\s*\n\s*resolveInvitedTile\(m\.from\);/);
    expect(RELAY).toMatch(/groupInviteeResolved\(m\.from, "Nobody was available\."\);\s*\n\s*resolveInvitedTile\(m\.from\);/);
    expect(RELAY).toMatch(/groupDialOutstanding\.delete\(m\.pin\);\s*\n\s*resolveInvitedTile\(m\.pin\);/);
    expect(RELAY).toMatch(/if \(reachErr && inParkedCall\(\)\) \{ resolveInvitedTile\(m\.pin\); break; \}/);
  });

  it("a placeholder can't be pinned big by a tap", () => {
    const fn = RELAY.slice(
      RELAY.indexOf("function onGridClick"),
      RELAY.indexOf("function resetSpeakerView"),
    );
    expect(fn).toMatch(/if \(tile\.dataset\.ph === "1"\) return;/);
  });
});

describe("4 — the invited tile is visibly PENDING, and the pill is translated", () => {
  it("the tile is dimmed and dash-bordered, the pill readable", () => {
    expect(CSS).toMatch(/\.relay-tile\.invited\{opacity:\.72;border-style:dashed/);
    expect(CSS).toMatch(/\.relay-tile\.invited \.connecting\{color:#cbd5e1\}/);
  });

  it("calls.invited exists in the dictionary in BOTH languages", () => {
    expect(DICT).toMatch(/"calls\.invited": \{ en: "Invited…", ar: "[^"]+…" \}/);
  });
});
