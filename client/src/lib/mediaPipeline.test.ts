import { describe, expect, it } from "vitest";
import { FILTERS, findFilter, type FilterId } from "./mediaPipeline";

/**
 * Pipeline tests focused on the filter registry — the part that's pure logic
 * and free of DOM/MediaPipe deps. The full canvas pipeline requires a real
 * <video> element, getUserMedia, and a browser; that's exercised via manual
 * verification in the dev preview.
 */
describe("mediaPipeline filter registry", () => {
  it("exposes the canonical filter set the UI dock depends on", () => {
    const ids = FILTERS.map(f => f.id);
    expect(ids).toEqual([
      "none",
      "blur-bg",
      "vivid",
      "warm",
      "cool",
      "bw",
      "sepia",
      "sunglasses",
      "dog",
      "hearts",
    ]);
  });

  it("every filter has a label and a non-empty emoji glyph for the picker UI", () => {
    for (const f of FILTERS) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.emoji.length).toBeGreaterThan(0);
    }
  });

  it("color filters carry a non-empty cssFilter string the canvas applies via ctx.filter", () => {
    const colorIds: FilterId[] = ["vivid", "warm", "cool", "bw", "sepia"];
    for (const id of colorIds) {
      const f = findFilter(id);
      expect(f.cssFilter, `${id} must declare a cssFilter`).toBeTruthy();
      expect(typeof f.cssFilter).toBe("string");
    }
    // "none" must NOT carry a cssFilter so the pipeline copies frames untouched
    expect(findFilter("none").cssFilter).toBeUndefined();
  });

  it("background-blur filter is flagged so the pipeline knows to load the segmenter", () => {
    expect(findFilter("blur-bg").backgroundBlur).toBe(true);
    // none of the color filters should accidentally ask for the segmenter
    for (const id of ["vivid", "warm", "cool", "bw", "sepia", "none"] as FilterId[]) {
      expect(findFilter(id).backgroundBlur).toBeFalsy();
    }
  });

  it("face-overlay filters declare their overlay kind so the pipeline knows to load the face detector", () => {
    expect(findFilter("sunglasses").faceOverlay).toBe("sunglasses");
    expect(findFilter("dog").faceOverlay).toBe("dog");
    expect(findFilter("hearts").faceOverlay).toBe("hearts");
  });

  it("findFilter falls back to the first registered filter when given an unknown id", () => {
    const unknown = findFilter("not-a-real-filter" as FilterId);
    expect(unknown.id).toBe("none");
  });
});
