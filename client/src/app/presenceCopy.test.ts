/* ============================================================
   v2.106.97 — "last seen …" is translated, and the banding is SHARED.

   Driven rather than source-pinned: whether an Arabic screen and an English one
   agree about which band a timestamp is in is exactly what a source assertion
   cannot answer, and that divergence is the whole reason the banding was split out.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  lastSeenBand,
  formatLastSeen,
  formatClockDigits,
  compactAgoBand,
  peerPresenceState,
  describePeerPresence,
  type PeerPresenceInput,
} from "@shared/profileFields";
import {
  lastSeenLabel,
  lastSeenMinutesKey,
  formatClockLocalised,
  presenceLabel,
  lineCountKey,
  compactAgoLabel,
  agoKey,
} from "./presenceCopy";
import { intlLocale, formatDateIn, formatDateTimeIn, formatNumberIn } from "./dateLocale";
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
  const SRC = read("presenceCopy.ts");

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

/* ============================================================
   v2.106.98 — the presence line and the compact "…ago" row, translated, and
   dates/numbers following the APP's language rather than the browser's.
   ============================================================ */

describe("the presence line is ONE decision with two renderers", () => {
  const CASES: { name: string; input: PeerPresenceInput }[] = [
    { name: "party line", input: { partyLine: true, memberCount: 3 } },
    { name: "empty line", input: { partyLine: true, memberCount: 0 } },
    { name: "suppressed", input: { presenceHidden: true, isOnline: true } },
    { name: "in a call", input: { inCall: true, isOnline: true } },
    { name: "idle", input: { isOnline: true, idle: true } },
    { name: "online", input: { isOnline: true } },
    { name: "last seen", input: { isOnline: false, lastSeenAt: BASE - 3 * 86_400_000 } },
    { name: "offline", input: { isOnline: false } },
  ];

  it("English is byte-identical to the shared renderer", () => {
    /* `describePeerPresence` is the dictionary's own English fallback, so the
       translated path must not quietly diverge from it. */
    for (const c of CASES) {
      expect(presenceLabel(c.input, t("en"), { locale: "en" }), c.name).toBe(
        describePeerPresence(c.input),
      );
    }
  });

  it("Arabic and English agree about the STATE, never about the words", () => {
    for (const c of CASES) {
      const state = peerPresenceState(c.input);
      const en = presenceLabel(c.input, t("en"), { locale: "en" });
      const ar = presenceLabel(c.input, t("ar"), { locale: "ar" });
      if (state.kind === "hidden") {
        /* A suppressed presence renders NOTHING in both. "Offline" would be a claim
           about somebody the server deliberately declined to describe (v2.95), and
           it is the easy mistake here because every other state has a word. */
        expect(en, c.name).toBe("");
        expect(ar, c.name).toBe("");
        continue;
      }
      expect(en, c.name).not.toBe("");
      expect(ar, c.name).not.toBe("");
      expect(ar, c.name).not.toMatch(/^peer\./);
      expect(ar, c.name).not.toBe(en);
    }
  });

  it("has no dictionary key for the suppressed state at all", () => {
    /* The ABSENCE is the guard: a later contributor "fixing" the blank by adding a
       word would undo the privacy rule, and the type would not stop them. */
    for (const k of Object.keys(DICT)) {
      expect(k, k).not.toMatch(/^peer\.presenceHidden/);
    }
  });

  it("a line's occupancy is banded, and Arabic's dual is a word", () => {
    expect(lineCountKey(0)).toBe("peer.lineNobody");
    expect(lineCountKey(1)).toBe("peer.lineOne");
    expect(lineCountKey(2)).toBe("peer.lineTwo");
    expect(lineCountKey(5)).toBe("peer.lineFew");
    expect(lineCountKey(40)).toBe("peer.lineMany");
    expect(translate("ar", "peer.lineTwo")).not.toMatch(/2|٢/);
  });
});

describe("the compact row is the SAME band as the long form", () => {
  it("one decision drives both, so the row and the popup cannot disagree", () => {
    /* The failure: the Contacts row saying "5m ago" while that person's profile
       popup, one tap away, says "last seen just now". Both read `compactAgoBand` /
       `lastSeenBand`, which is what makes it impossible rather than merely unlikely. */
    for (const mins of [0.5, 5, 59, 61, 1500, 60 * 24 * 3, 60 * 24 * 30]) {
      const at = BASE - mins * 60_000;
      const band = compactAgoBand(at, BASE);
      const en = compactAgoLabel(at, t("en"), { locale: "en", nowMs: BASE });
      const ar = compactAgoLabel(at, t("ar"), { locale: "ar", nowMs: BASE });
      expect(en, String(mins)).not.toBe("");
      expect(ar, String(mins)).not.toBe("");
      expect(ar, String(mins)).not.toMatch(/^peer\./);
      expect(band.kind, String(mins)).not.toBe("never");
    }
  });

  it("English is unchanged — the row still reads `5m ago`", () => {
    expect(compactAgoLabel(BASE - 30_000, t("en"), { locale: "en", nowMs: BASE })).toBe("just now");
    expect(compactAgoLabel(BASE - 5 * 60_000, t("en"), { locale: "en", nowMs: BASE })).toBe("5m ago");
    expect(compactAgoLabel(BASE - 3 * 3600_000, t("en"), { locale: "en", nowMs: BASE })).toBe("3h ago");
    expect(compactAgoLabel(BASE - 2 * 86400_000, t("en"), { locale: "en", nowMs: BASE })).toBe("2d ago");
    expect(compactAgoLabel(null, t("en"), { locale: "en", nowMs: BASE })).toBe("never");
  });

  it("every unit bands one/two/few/many, and each Arabic form is distinct", () => {
    for (const unit of ["minutes", "hours", "days"] as const) {
      const forms = [1, 2, 5, 40].map((n) => translate("ar", agoKey(unit, n), { count: n }));
      expect(new Set(forms).size, unit).toBe(4);
      // The dual is a WORD, not "2 " plus a plural noun.
      expect(forms[1], unit).not.toMatch(/2|٢/);
      expect(forms[0], unit).not.toMatch(/1|١/);
    }
  });

  it("an impossible timestamp is `never`, never a date about nobody", () => {
    /* `new Date(true)` is one millisecond after the epoch — the shape that used to
       print "1/1/1970" about somebody with no recorded time. */
    for (const bad of [null, undefined, "", true, {}, [], Number.NaN, 0, -1]) {
      expect(compactAgoBand(bad as never, BASE).kind, String(bad)).toBe("never");
    }
  });
});

describe("dates and numbers follow the APP's language", () => {
  it("Arabic pins Western digits; English pins nothing at all", () => {
    /* English passing `undefined` is the decision, not an oversight: forcing en-US
       would rewrite 02/08/2026 as 8/2/2026 for every British, Australian and Indian
       user who is perfectly happy today. "English" is a language, not a date format. */
    expect(intlLocale("en")).toBeUndefined();
    expect(intlLocale("ar")).toBe("ar-u-nu-latn");
  });

  it("an Arabic date carries no Arabic-Indic numeral", () => {
    const at = Date.UTC(2026, 1, 8, 15, 30, 0);
    for (const s of [formatDateIn("ar", at), formatDateTimeIn("ar", at), formatNumberIn("ar", 1204)]) {
      expect(s).not.toMatch(/[٠-٩۰-۹]/);
      expect(s).toMatch(/\d/);
    }
  });

  it("English output is byte-identical to the empty arglist it replaces", () => {
    /* The whole point is that only the BROKEN half changes. If this ever differs,
       every English user's date format has silently moved. */
    const at = Date.UTC(2026, 1, 8, 15, 30, 0);
    expect(formatDateIn("en", at)).toBe(new Date(at).toLocaleDateString());
    expect(formatDateTimeIn("en", at)).toBe(new Date(at).toLocaleString());
    expect(formatNumberIn("en", 1204)).toBe((1204).toLocaleString());
  });

  it("takes a string as readily as a number — that is what the wire sends", () => {
    const iso = "2026-02-08T15:30:00.000Z";
    expect(formatDateIn("en", iso)).toBe(formatDateIn("en", Date.parse(iso)));
  });
});

describe("no screen formats a date in the BROWSER's language", () => {
  /* The standing guard. The conversions above are finite; the RULE is not — every
     screen added after this reintroduces the question, and "we converted eight sites
     once" is exactly the shape that decays. */
  const EXEMPT = new Map<string, string>([
    // Vendored shadcn: converting diverges from upstream, so every future
    // `shadcn add` silently reinstates the empty arglist with no signal.
    ["client/src/components/ui/chart.tsx", "vendored shadcn"],
    ["client/src/components/ui/calendar.tsx", "vendored shadcn"],
    // A developer diagnostic page with no language switch on it.
    ["client/src/pages/TurnTest.tsx", "dev-only TURN probe"],
  ]);

  it("every locale formatter in a client screen names the app's locale", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(e.name) || /\.test\.tsx?$/.test(e.name)) continue;
        const rel = path.relative(path.resolve(__dirname, "../../.."), full).replace(/\\/g, "/");
        if (EXEMPT.has(rel)) continue;
        // Comments legitimately quote the pattern to explain why it is forbidden.
        const code = fs.readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
        if (/\.toLocale(?:Date|Time)?String\(\s*\)/.test(code)) offenders.push(rel);
      }
    };
    walk(path.resolve(__dirname, ".."));
    expect(offenders, `these format in the browser's locale: ${offenders.join(", ")}`).toEqual([]);
  });

  it("each exemption really still offends, so the list cannot rot into a comment", () => {
    /* A stale exemption is a hiding place: it reads as covered while covering a file
       that no longer needs it, and the next real offender can be added beside it. */
    for (const [rel, why] of EXEMPT) {
      const full = path.resolve(__dirname, "../../..", rel);
      expect(fs.existsSync(full), `${rel} (${why}) no longer exists`).toBe(true);
      const code = fs.readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(/\.toLocale(?:Date|Time)?String\(\s*\)/.test(code), `${rel} is CLEAN now — take it off the list`).toBe(true);
    }
  });
});
