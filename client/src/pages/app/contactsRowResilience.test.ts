/**
 * ONE ROW'S BAD TIMESTAMP MUST NOT TAKE DOWN THE WHOLE ADDRESS BOOK.
 *
 * WHY THIS FILE EXISTS, and it is a measurement rather than a worry. The owner
 * reported "the contact is not showing". Four theories were ruled out by test
 * (section membership exhaustively, collapse state, section metadata, the v2.78
 * `h-full` collapse trap), so the real bundle was driven in a real browser with a
 * stubbed tRPC layer — and a single row whose `lastSeenAt` was a NUMBER produced:
 *
 *     An unexpected error occurred.
 *     TypeError: c.getTime is not a function
 *
 * with ZERO contacts rendered. `relativeTime` is called from inside a row, so the
 * throw unwound the entire page and the error boundary replaced the whole screen.
 * That is precisely the reported symptom.
 *
 * SAID PLAINLY: THAT WAS THE HARNESS, NOT PRODUCTION. `presence.lastSeenAt` is a
 * Drizzle `timestamp`, so the server sends a real Date and superjson revives it as
 * one; the stub sent a raw number with no superjson meta. The throwing path is not
 * reachable through the ordinary wire today, and this file does NOT claim it is.
 *
 * What it pins is the BLAST RADIUS, which was absurd either way: a whole screen
 * resting on one field's runtime type. One row losing its "last seen" line is
 * cosmetic; an empty address book is the thing somebody reports as broken. The
 * sibling formatter in `shared/profileFields.ts` has always been total
 * (`!Number.isFinite(lastSeenMs)` → ""), so this only brings the two into line.
 *
 * Driven, not source-pinned: whether a value throws is exactly what a source pin
 * cannot answer.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
/* v2.106.98 moved `relativeTime` beside its band in `shared/profileFields.ts` — an
   English renderer of a shared decision is the dictionary's fallback, not a page's
   private helper. Every assertion below is unchanged, which is the point. */
import { relativeTime } from "@shared/profileFields";
import { formatLastSeen } from "../../../../shared/profileFields";
import { codeOnly } from "../../../../server/testing/codeOnly";

describe("relativeTime is TOTAL — no input can throw out of a row", () => {
  /* Every one of these would have thrown or printed nonsense under the old
     `Date | string | null` shape, which called `.getTime()` on whatever was not a
     string. The list is deliberately hostile: these are the shapes a wire, a cache
     or a future server change can produce. */
  const hostile: unknown[] = [
    0,
    1,
    Date.now(),
    -1,
    NaN,
    Infinity,
    -Infinity,
    "",
    "not a date",
    "2026-13-45T99:99:99Z",
    null,
    undefined,
    {},
    [],
    { getTime: "not a function" },
    true,
    false,
    Symbol.iterator.toString(),
    new Date("nonsense"),
    9007199254740993,
  ];

  it("never throws, whatever it is handed", () => {
    const threw: string[] = [];
    for (const v of hostile) {
      try {
        relativeTime(v as never);
      } catch (e) {
        threw.push(`${String(v)} -> ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    expect(threw, `these inputs threw: ${threw.join(" | ")}`).toEqual([]);
  });

  it("never returns a string containing 'Invalid Date'", () => {
    // Not throwing is not enough — falling through to `toLocaleDateString()` on an
    // unparseable date prints the literal text "Invalid Date" into the row, which is
    // a different way of being wrong on screen.
    const bad: string[] = [];
    for (const v of hostile) {
      const out = relativeTime(v as never);
      if (/invalid date/i.test(out) || out === "NaN" || out.includes("NaN")) {
        bad.push(`${String(v)} -> ${out}`);
      }
    }
    expect(bad, bad.join(" | ")).toEqual([]);
  });

  it("an absent or unusable value reads as 'never', not as a moment in time", () => {
    // "never" is the honest answer. A fallback of "just now" would assert presence
    // about somebody we know nothing about.
    for (const v of [null, undefined, "", NaN, "not a date", {}, true]) {
      expect(relativeTime(v as never), String(v)).toBe("never");
    }
  });
});

describe("relativeTime is still CORRECT for the shapes that really arrive", () => {
  it("a Date — what the server actually sends", () => {
    // presence.lastSeenAt is a Drizzle timestamp, so this is the production path.
    expect(relativeTime(new Date(Date.now() - 30_000))).toBe("just now");
    expect(relativeTime(new Date(Date.now() - 5 * 60_000))).toBe("5m ago");
    expect(relativeTime(new Date(Date.now() - 3 * 3600_000))).toBe("3h ago");
    expect(relativeTime(new Date(Date.now() - 2 * 86400_000))).toBe("2d ago");
  });

  it("an ISO string — the shape a JSON round-trip without superjson meta produces", () => {
    expect(relativeTime(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5m ago");
  });

  it("epoch milliseconds — the shape its sibling formatter takes", () => {
    // Two functions answering one question with different input types is how a
    // future caller passes the wrong one; accepting both removes the trap.
    expect(relativeTime(Date.now() - 5 * 60_000)).toBe("5m ago");
    expect(relativeTime(Date.now() - 3 * 3600_000)).toBe("3h ago");
  });

  it("a future timestamp does not become a negative age", () => {
    // A clock skewed forward on the server must not render "-4m ago".
    const out = relativeTime(new Date(Date.now() + 60_000));
    expect(out).toBe("just now");
    expect(out).not.toContain("-");
  });

  it("older than a week falls back to a real date string", () => {
    const out = relativeTime(new Date(Date.now() - 30 * 86400_000));
    expect(out).not.toBe("never");
    expect(out).not.toMatch(/ago/);
    expect(out.length).toBeGreaterThan(4);
  });
});

describe("the two last-seen formatters agree about the unusable cases", () => {
  it("both treat a non-finite value as 'nothing to say' rather than throwing", () => {
    // `formatLastSeen` has always been total; this is the property the local one
    // was missing, and the reason the divergence mattered.
    expect(formatLastSeen(NaN, Date.now())).toBe("");
    expect(formatLastSeen(0, Date.now())).toBe("");
    expect(relativeTime(NaN)).toBe("never");
    expect(relativeTime(0)).toBe("never");
  });
});

describe("the guard is structural, not incidental", () => {
  /* v2.106.98 moved the totality rules into `compactAgoBand`, so BOTH the English
     `relativeTime` and the translated `compactAgoLabel` inherit them — which is the
     whole reason to split. These pins follow the rule to where it lives rather than
     freezing the page it used to live on. */
  const SRC = codeOnly(readFileSync("shared/profileFields.ts", "utf8"));
  const BAND = (() => {
    const at = SRC.search(/export function compactAgoBand\(/);
    expect(at, "compactAgoBand not found").toBeGreaterThanOrEqual(0);
    // Bounded by the function's OWN end, never a fixed slice and never `indexOf`
    // unguarded — an absent needle answers -1 and `slice(start, -1)` runs to EOF.
    const end = SRC.indexOf("\n}", at);
    expect(end, "unterminated body").toBeGreaterThan(at);
    const body = SRC.slice(at, end);
    expect(body.length, "slice collapsed").toBeGreaterThan(80);
    return body;
  })();

  it("the finite check is present and precedes the arithmetic", () => {
    // Pinned as an ORDER because a check that runs after the subtraction protects
    // nothing — `diff` would already be NaN.
    const guard = BAND.search(/Number\.isFinite\(ms\)/);
    const math = BAND.search(/nowMs - ms/);
    expect(guard, "no finite guard").toBeGreaterThanOrEqual(0);
    expect(math).toBeGreaterThan(0);
    expect(guard).toBeLessThan(math);
  });

  it("it never calls .getTime() on a value it has not proven is a Date", () => {
    // The exact shape of the defect: `.getTime()` on the raw parameter.
    expect(BAND).toMatch(/d instanceof Date \? d : new Date\(/);
    expect(BAND).not.toMatch(/\bd\.getTime\(\)/);
  });

  it("the two renderers read the band rather than re-deriving it", () => {
    /* The property the split exists for: one decision, two vocabularies. A second
       copy of the thresholds is how the Contacts row and the profile popup come to
       bucket the same moment differently. */
    const EN = SRC.slice(SRC.search(/export function relativeTime\(/));
    expect(EN).toMatch(/compactAgoBand\(d, Date\.now\(\)\)/);
    expect(EN.slice(0, EN.indexOf("\n}"))).not.toMatch(/86400|3600|< 60\b/);
    const COPY = codeOnly(readFileSync("client/src/app/presenceCopy.ts", "utf8"));
    expect(COPY).toMatch(/compactAgoBand\(d, opts\.nowMs \?\? Date\.now\(\)\)/);
    expect(COPY).not.toMatch(/86400|3600/);
  });
});
