import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AUDIENCE_OPTIONS } from "@/app/statusAudience";
import { DICT } from "@/app/i18n";

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

describe("v2.99.29/33 QA M16 — status audience copy matches the enforcement", () => {
  // v2.99.33 (owner) switched status to EITHER-DIRECTION visibility — a status
  // reaches your contacts AND anyone who saved you — so "your contacts" is now
  // ACCURATE poster-side copy (it was wrong-direction only under the old
  // saved-you-only model).
  //
  // v2.99.55 added a SECOND audience ("everyone"), so a single hardcoded string
  // in the composer would now be wrong half the time. The copy moved into
  // client/src/app/statusAudience.ts, one entry per option, and the composer
  // picks the one matching what it actually sent. The invariant is stronger than
  // before — it used to be "this literal appears somewhere in the file", which a
  // second audience would have satisfied while showing the wrong text.
  it("the strip/poster copy says a status reaches your contacts", () => {
    expect(AUDIENCE_OPTIONS[0].posted).toMatch(/your contacts/);
  });
  it("the toast also mentions the anyone-who-saved-you direction", () => {
    expect(AUDIENCE_OPTIONS[0].posted).toMatch(/your contacts and anyone who's saved you/);
  });
  it("the confirmation is derived from the audience actually posted, not hardcoded", () => {
    /* THIS PIN FROZE THE DEFECT, twice over. The expression it required was
       `Status posted — ${audienceOption(effectiveAudience).posted}`, which (a) called a
       STORY a "status", the vocabulary the owner corrected three times, and (b) built a
       sentence by gluing a stem to an interpolated tail — untranslatable, because Arabic
       does not put that qualifier where English does, so the halves can only be
       re-assembled into nonsense.

       The property it always stood for is that the confirmation is CHOSEN BY the
       audience actually posted rather than hardcoded, which is now one WHOLE key per
       outcome (the `guestExpiryKey` rule). Both are asserted, and the two sentences are
       required to differ — a single key for both would be "not hardcoded" in form and
       hardcoded in effect. */
    expect(src).toMatch(/t\(audienceKeys\(effectiveAudience\)\.posted\)/);
    expect(DICT["status.postedContacts"].en).not.toBe(DICT["status.postedEveryone"].en);
    expect(DICT["status.postedContacts"].ar).not.toBe(DICT["status.postedEveryone"].ar);
    for (const k of ["status.postedContacts", "status.postedEveryone"] as const) {
      expect(DICT[k].en.toLowerCase(), `${k} must say story, not status`).not.toContain("status");
    }
    // …and the value sent is the one the picker showed.
    expect(src).toMatch(/audience: effectiveAudience/);
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
