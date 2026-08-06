import { describe, it, expect } from "vitest";
import {
  computeLayout,
  resolveFocus,
  rankTiles,
  pickScreenShareTile,
  spotlightGridTemplate,
  type LayoutInput,
} from "./callLayout";

const base: LayoutInput = {
  tileIds: ["tile-self", "tile-111111", "tile-222222"],
  manualSpotlightId: null,
  screenShareIds: [],
  activeSpeakerId: null,
  speakerOrder: [],
  compact: false,
};

describe("pickScreenShareTile", () => {
  it("returns null when nobody is sharing", () => {
    expect(pickScreenShareTile(base.tileIds, [])).toBeNull();
  });
  it("prefers a REMOTE share over our own", () => {
    expect(
      pickScreenShareTile(base.tileIds, ["tile-self", "tile-222222"]),
    ).toBe("tile-222222");
  });
  it("falls back to our own share when no remote share exists", () => {
    expect(pickScreenShareTile(base.tileIds, ["tile-self"])).toBe("tile-self");
  });
  it("ignores share ids not present as tiles", () => {
    expect(pickScreenShareTile(base.tileIds, ["tile-999999"])).toBeNull();
  });
});

describe("resolveFocus — precedence manual > screen > active", () => {
  it("manual pin wins over a screen share and active speaker", () => {
    expect(
      resolveFocus({
        ...base,
        manualSpotlightId: "tile-111111",
        screenShareIds: ["tile-222222"],
        activeSpeakerId: "tile-222222",
      }),
    ).toBe("tile-111111");
  });
  it("screen share wins over active speaker when no manual pin", () => {
    expect(
      resolveFocus({
        ...base,
        screenShareIds: ["tile-222222"],
        activeSpeakerId: "tile-111111",
      }),
    ).toBe("tile-222222");
  });
  it("active speaker is used when there is no pin or share", () => {
    expect(resolveFocus({ ...base, activeSpeakerId: "tile-111111" })).toBe(
      "tile-111111",
    );
  });
  it("ignores a manual pin / active speaker whose tile has left", () => {
    expect(
      resolveFocus({ ...base, manualSpotlightId: "tile-gone", activeSpeakerId: "tile-also-gone" }),
    ).toBeNull();
  });
});

describe("rankTiles", () => {
  it("orders focus first, then speakers, then DOM order, self last", () => {
    const order = rankTiles(
      ["tile-self", "tile-111111", "tile-222222", "tile-333333"],
      "tile-222222",
      ["tile-333333"],
    );
    expect(order).toEqual([
      "tile-222222", // focus
      "tile-333333", // loudest after focus
      "tile-111111", // remaining DOM order
      "tile-self", // self always last
    ]);
  });
  it("dedupes and drops unknown ids", () => {
    const order = rankTiles(["tile-a", "tile-b"], "tile-a", ["tile-a", "tile-x"]);
    expect(order).toEqual(["tile-a", "tile-b"]);
  });
});

describe("computeLayout", () => {
  it("returns an equal grid when nobody is talking/sharing/pinned", () => {
    const r = computeLayout(base);
    expect(r.mode).toBe("grid");
    expect(r.focusId).toBeNull();
    expect(r.shownIds).toEqual(base.tileIds);
  });

  it("spotlights the active speaker (1 big + thumbs)", () => {
    const r = computeLayout({ ...base, activeSpeakerId: "tile-111111" });
    expect(r.mode).toBe("spotlight");
    expect(r.focusId).toBe("tile-111111");
    expect(r.thumbIds).toEqual(["tile-self", "tile-222222"]);
  });

  it("auto-focuses a shared screen over the active speaker", () => {
    const r = computeLayout({
      ...base,
      screenShareIds: ["tile-222222"],
      activeSpeakerId: "tile-111111",
    });
    expect(r.mode).toBe("spotlight");
    expect(r.focusId).toBe("tile-222222");
  });

  it("compact view shows only the top-2 active tiles", () => {
    const r = computeLayout({
      ...base,
      compact: true,
      activeSpeakerId: "tile-111111",
      speakerOrder: ["tile-111111", "tile-222222"],
    });
    expect(r.mode).toBe("compact");
    expect(r.shownIds).toHaveLength(2);
    expect(r.shownIds).toEqual(["tile-111111", "tile-222222"]);
    // The self tile (3rd) is hidden in the minimized 2-up.
    expect(r.shownIds).not.toContain("tile-self");
  });

  it("compact with a single participant shows just one tile", () => {
    const r = computeLayout({ ...base, tileIds: ["tile-self"], compact: true });
    expect(r.mode).toBe("compact");
    expect(r.shownIds).toEqual(["tile-self"]);
  });

  it("handles an empty grid without throwing", () => {
    const r = computeLayout({ ...base, tileIds: [] });
    expect(r.mode).toBe("grid");
    expect(r.shownIds).toEqual([]);
  });
});

describe("spotlightGridTemplate — the owner's 5-person reference (v2.107.51)", () => {
  it("a maximized screen share fills everything, whatever the count", () => {
    expect(spotlightGridTemplate(4, true)).toEqual({ columns: "1fr", rows: "1fr", thumbRows: 0 });
  });

  it("no other tiles → the spotlight alone", () => {
    expect(spotlightGridTemplate(0)).toEqual({ columns: "1fr", rows: "1fr", thumbRows: 0 });
  });

  it("ONE other tile (a 1:1 call) keeps the slim 22% strip exactly as before", () => {
    expect(spotlightGridTemplate(1)).toEqual({
      columns: "1fr",
      rows: "minmax(0,1fr) 22%",
      thumbRows: 1,
    });
  });

  it("2 others sit side by side under a tall speaker (one thumb row)", () => {
    expect(spotlightGridTemplate(2)).toEqual({
      columns: "repeat(2,minmax(0,1fr))",
      rows: "minmax(0,2.2fr) repeat(1,minmax(0,1fr))",
      thumbRows: 1,
    });
  });

  it("THE REFERENCE: 5 on the call = the speaker on top, the other 4 in a 2×2 grid", () => {
    expect(spotlightGridTemplate(4)).toEqual({
      columns: "repeat(2,minmax(0,1fr))",
      rows: "minmax(0,2.2fr) repeat(2,minmax(0,1fr))",
      thumbRows: 2,
    });
  });

  it("5-9 others widen to 3 columns; the mesh cap's worst case (5 others) is 3×2", () => {
    expect(spotlightGridTemplate(5)).toEqual({
      columns: "repeat(3,minmax(0,1fr))",
      rows: "minmax(0,2.2fr) repeat(2,minmax(0,1fr))",
      thumbRows: 2,
    });
    expect(spotlightGridTemplate(9)).toEqual({
      columns: "repeat(3,minmax(0,1fr))",
      rows: "minmax(0,3.3fr) repeat(3,minmax(0,1fr))",
      thumbRows: 3,
    });
  });

  it("10+ others use 4 columns", () => {
    expect(spotlightGridTemplate(10)).toEqual({
      columns: "repeat(4,minmax(0,1fr))",
      rows: "minmax(0,3.3fr) repeat(3,minmax(0,1fr))",
      thumbRows: 3,
    });
  });

  it("the speaker holds about half the height once the thumbs need 2+ rows", () => {
    /* 2.2fr over 2×1fr = 52.4%; 3.3fr over 3×1fr = 52.4% — adding people
       shrinks the thumbs, never the person talking. Asserted numerically so a
       future fraction tweak that breaks the invariant is caught here. */
    for (const t of [3, 4, 5, 9, 10]) {
      const m = spotlightGridTemplate(t).rows.match(/^minmax\(0,([\d.]+)fr\) repeat\((\d+),/);
      expect(m, `rows template for ${t} thumbs`).not.toBeNull();
      const spotFr = Number(m![1]);
      const rows = Number(m![2]);
      const share = spotFr / (spotFr + rows);
      expect(share).toBeGreaterThan(0.5);
      expect(share).toBeLessThan(0.56);
    }
  });

  it("fractions render with ONE decimal — never 3.3000000000000003fr", () => {
    for (let t = 2; t <= 16; t++) {
      expect(spotlightGridTemplate(t).rows).toMatch(/^minmax\(0,\d+(\.\d)?fr\) /);
    }
  });
});
