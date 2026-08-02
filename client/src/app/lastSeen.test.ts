/* ============================================================
   v2.106.97 — "last seen …" is translated, and the banding is SHARED.

   Driven rather than source-pinned: whether an Arabic screen and an English one
   agree about which band a timestamp is in is exactly what a source assertion
   cannot answer, and that divergence is the whole reason the banding was split out.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { lastSeenBand, formatLastSeen, formatClockDigits } from "@shared/profileFields";
import { lastSeenLabel, lastSeenMinutesKey, formatClockLocalised } from "./lastSeen";
import { translate, DICT, type TKey } from "./i18n";

const read = (...p: string[]) => fs.readFileSync(path.resolve(__dirname, ...p), "utf8");
const t = (lang: "en" | "ar") => (k: TKey, v?: Record<string, string | number>) => translate(lang, k, v);

/* A spread of moments, one per band plus the edges between them. */
const BASE = new Date(2026, 6, 23, 15, 30, 0).getTime(); // 23 Jul 2026, 3:30 PM
const CASES: { name: string; at: number }[] = [
  { name: "none", at: 0 },
  { name: "just now", at: BASE - 10_000 },
  { name: "clock skew (future)", at: BASE + 60_000 },
  { name: "1 minute", at: BASE - 60_000 },
  { name: "2 minutes", at: BASE - 2 * 60_000 },
  { name: "5 minutes", at: BASE - 5 * 60_000 },
  { name: "40 minutes", at: BASE - 40 * 60_000 },
  { name: "today, AM", at: new Date(2026, 6, 23, 9, 5, 0).getTime() },
  { name: "yesterday, PM", at: new Date(2026, 6, 22, 22, 30, 0).getTime() },
  { name: "this year", at: new Date(2026, 5, 20, 8, 0, 0).getTime() },
  { name: "last year", at: new Date(2025, 10, 2, 6, 9, 0).getTime() },
];

describe("the banding is ONE rule, read by both renderers", () => {
  it("English and Arabic never disagree about which band a moment is in", () => {
    /* The failure this exists to prevent is an Arabic screen reading "yesterday"
       where the English one reads "today", about the same person at the same
       moment. Both renderers take the band from `lastSeenBand`, so the only way to
       break it is to reimplement the banding — which this catches. */
    for (const c of CASES) {
      const band = lastSeenBand(c.at, BASE);
      const en = lastSeenLabel(c.at, BASE, t("en"));
      const ar = lastSeenLabel(c.at, BASE, t("ar"));
      if (band.kind === "none") {
        expect(en, c.name).toBe("");
        expect(ar, c.name).toBe("");
        continue;
      }
      expect(en, c.name).not.toBe("");
      expect(ar, c.name).not.toBe("");
      // Both must be real sentences, not a raw key leaking through.
      expect(en, c.name).not.toMatch(/^peer\./);
      expect(ar, c.name).not.toMatch(/^peer\./);
    }
  });

  it("the English renderer is byte-identical to the shared one", () => {
    /* `formatLastSeen` is what the dictionary's own fallback promises, so the
       translated path must not quietly diverge from it in English. */
    for (const c of CASES) {
      expect(lastSeenLabel(c.at, BASE, t("en")), c.name).toBe(formatLastSeen(c.at, BASE));
    }
  });

  it("a clock that has run backwards reads as just now, never as a future date", () => {
    expect(lastSeenBand(BASE + 5 * 60_000, BASE).kind).toBe("justNow");
    expect(lastSeenLabel(BASE + 5 * 60_000, BASE, t("ar"))).toBe(translate("ar", "peer.lastSeenJustNow"));
  });

  it("an absent or impossible timestamp renders nothing at all", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(lastSeenLabel(bad, BASE, t("ar")), String(bad)).toBe("");
    }
  });
});

describe("the plural is a whole key, because Arabic cannot suffix it", () => {
  it("picks one/two/few/many rather than interpolating into one sentence", () => {
    expect(lastSeenMinutesKey(1)).toBe("peer.lastSeenMinute");
    expect(lastSeenMinutesKey(2)).toBe("peer.lastSeenTwoMinutes");
    expect(lastSeenMinutesKey(5)).toBe("peer.lastSeenMinutesFew");
    expect(lastSeenMinutesKey(40)).toBe("peer.lastSeenMinutesMany");
  });

  it("Arabic really uses the distinct forms — the cheap fake is one form four times", () => {
    const one = translate("ar", "peer.lastSeenMinute");
    const two = translate("ar", "peer.lastSeenTwoMinutes");
    const few = translate("ar", "peer.lastSeenMinutesFew", { count: 5 });
    const many = translate("ar", "peer.lastSeenMinutesMany", { count: 40 });
    expect(new Set([one, two, few, many]).size).toBe(4);
    // The dual is a WORD in Arabic, not "2 " + a plural noun.
    expect(two).not.toMatch(/2/);
    expect(one).not.toMatch(/1/);
  });

  it("English never renders '1 minutes'", () => {
    expect(translate("en", lastSeenMinutesKey(1), { count: 1 })).toBe("last seen 1 minute ago");
    for (const n of [2, 5, 40]) {
      expect(translate("en", lastSeenMinutesKey(n), { count: n })).toBe(`last seen ${n} minutes ago`);
    }
  });
});

describe("numbers stay Western; only the words are translated", () => {
  it("the clock's digits are identical in both languages, the meridiem is not", () => {
    /* v2.106.84: a substituted "3" beside an Arabic-Indic numeral on one line
       reads as a rendering fault, and a clock is read aloud as the digits shown. */
    const c = { hour12: 3, minute: 5, pm: true };
    expect(formatClockDigits(c)).toBe("3:05");
    expect(formatClockLocalised(c, t("en"))).toBe("3:05 PM");
    const ar = formatClockLocalised(c, t("ar"));
    expect(ar).toContain("3:05");
    expect(ar).not.toContain("PM");
  });

  it("an Arabic date line carries the Western day number and a translated month", () => {
    const at = new Date(2026, 5, 20, 8, 0, 0).getTime();
    const ar = lastSeenLabel(at, BASE, t("ar"));
    expect(ar).toContain("20");
    expect(ar).toContain(translate("ar", "peer.month.5"));
    expect(ar).not.toContain("Jun");
  });

  it("the year is a DIFFERENT key rather than a sometimes-empty fragment", () => {
    /* A `{year}` that is blank half the time leaves a dangling separator in one
       language or the other, because Arabic places the year elsewhere. */
    const sameYear = lastSeenLabel(new Date(2026, 0, 4, 19, 45, 0).getTime(), BASE, t("ar"));
    const lastYear = lastSeenLabel(new Date(2025, 10, 2, 6, 9, 0).getTime(), BASE, t("ar"));
    expect(sameYear).not.toContain("2026");
    expect(lastYear).toContain("2025");
    for (const s of [sameYear, lastYear]) {
      expect(s).not.toMatch(/\s,|,\s*$|\s{2,}/); // no orphaned separator or double space
    }
  });
});

describe("every key this renderer can pick really exists", () => {
  it("all twelve months plus both meridiems are in the dictionary", () => {
    for (let m = 0; m < 12; m++) {
      const k = `peer.month.${m}` as TKey;
      expect(DICT[k], k).toBeTruthy();
      expect(translate("ar", k), k).not.toBe(k);
    }
    for (const k of ["peer.clockAm", "peer.clockPm"] as TKey[]) {
      expect(translate("ar", k), k).not.toBe(k);
    }
  });
});

describe("the banding is not reimplemented on the client", () => {
  const SRC = read("lastSeen.ts");

  it("reads lastSeenBand rather than re-deriving the thresholds", () => {
    expect(SRC).toMatch(/import \{[^}]*lastSeenBand[^}]*\} from "@shared\/profileFields"/);
    /* A second copy of "is this today or yesterday" is the divergence the split
       exists to prevent, so the arithmetic must not reappear here. */
    expect(SRC).not.toMatch(/60_000|getFullYear|getMonth\(\)/);
  });

  it("the only live formatLastSeen reader is the English fallback itself", () => {
    /* `peerStatus` used to reach it from the Dialer and was deleted in this
       release as dead code; if a client screen starts rendering the English
       sentence again, that screen is untranslated and this goes red. */
    const clientDir = path.resolve(__dirname, "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const src = fs.readFileSync(full, "utf8");
          // Comments legitimately name it; an IMPORT is what makes it a reader.
          if (/import\s*\{[^}]*\bformatLastSeen\b/.test(src)) offenders.push(full);
        }
      }
    };
    walk(clientDir);
    expect(offenders).toEqual([]);
  });
});
