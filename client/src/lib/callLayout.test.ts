import { describe, it, expect } from "vitest";
import {
  computeLayout,
  resolveFocus,
  rankTiles,
  pickScreenShareTile,
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
