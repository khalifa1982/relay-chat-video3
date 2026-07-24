import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const src = read("client/src/pages/app/Status.tsx");

/**
 * v2.99.29 — heavy-QA sweep fixes, batch 7 (status stories).
 *
 *   M15 (MED): a video/audio status always ran the flat 5s DEFAULT_ITEM_MS —
 *              the viewer already read item.durationMs, but the composer never
 *              captured or sent it. Now the composer reads the media's true
 *              length (loadedmetadata) and passes durationMs to status.post.
 *   M16 (MED): the poster-side copy said statuses are "visible to your
 *              contacts" (people you saved) — but statusAudienceAuthorized
 *              gates on the VIEWER having saved the owner, so a status is
 *              actually seen by people who saved YOU. Copy aligned to the
 *              (coherent) enforcement; no visibility change.
 *   L5  (LOW): the left/right tap-zone onClick fired even after a press-and-
 *              hold (which pauses), so holding then releasing navigated — on
 *              the first item prev() restarted it. Navigation is now suppressed
 *              when the press lasted longer than HOLD_MS.
 *
 * Source-pinned: Status.tsx has no DOM test env (mirrors status.test.ts).
 */
describe("v2.99.29 QA M15 — video/audio status runs its true length", () => {
  it("the composer reads the media duration and sends durationMs to status.post", () => {
    expect(src).toMatch(/function readMediaDurationMs\(file: File\)/);
    // loadedmetadata drives it; the Infinity-WebM seek nudge is present.
    expect(src).toMatch(/onloadedmetadata/);
    expect(src).toMatch(/currentTime = 1e101/);
    // submit() passes durationMs (only computed for video/audio).
    expect(src).toMatch(/const ms = await readMediaDurationMs\(file\)/);
    expect(src).toMatch(/durationMs,/);
  });
  it("the viewer already honours durationMs (regression guard)", () => {
    expect(src).toMatch(/item\.durationMs && item\.durationMs > 0/);
  });
});

describe("v2.99.29 QA M16 — status audience copy matches the enforcement", () => {
  it("no longer claims 'visible to your contacts' (wrong direction)", () => {
    expect(src).not.toMatch(/visible to your contacts/);
  });
  it("says the audience is people who have you saved", () => {
    expect(src).toMatch(/anyone who has you in their contacts/);
  });
});

describe("v2.99.29 QA L5 — press-hold pauses without navigating", () => {
  it("records the press start and gates tap-zone navigation on HOLD_MS", () => {
    expect(src).toMatch(/const pressStartRef = useRef<number>\(0\)/);
    expect(src).toMatch(/const HOLD_MS = 220/);
    expect(src).toMatch(/pressStartRef\.current = Date\.now\(\); setPaused\(true\)/);
    // both tap zones only navigate on a quick tap
    expect(src).toMatch(/Date\.now\(\) - pressStartRef\.current < HOLD_MS\) prev\(\)/);
    expect(src).toMatch(/Date\.now\(\) - pressStartRef\.current < HOLD_MS\) next\(\)/);
  });
});
