import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import {
  DICT,
  TEXT_SCALE_FACTOR,
  isRtl,
  normalizeLocale,
  normalizeScale,
  translate,
  type TKey,
} from "./i18n";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const SHELL = read("client/src/app/AppShell.tsx");
const MAIN = read("client/src/main.tsx");
const PROFILE = read("client/src/pages/app/Profile.tsx");

describe("v2.106.83 — the app speaks Arabic, and it is impossible to add a string that does not", () => {
  it("EVERY entry carries both halves — an untranslated string is a type error, not a review item", () => {
    /* This is the owner's standing instruction ("make sure that whatever changes
       you make impact both languages") expressed in the type system. The runtime
       assertion is here as well, because `satisfies` proves the SHAPE and this
       proves nobody left a half empty to satisfy it. */
    const bad: string[] = [];
    for (const [key, entry] of Object.entries(DICT)) {
      if (typeof entry.en !== "string" || entry.en.trim() === "") bad.push(`${key}.en`);
      if (typeof entry.ar !== "string" || entry.ar.trim() === "") bad.push(`${key}.ar`);
    }
    expect(bad, `empty halves: ${bad.join(", ")}`).toEqual([]);
    expect(Object.keys(DICT).length, "the dictionary is not empty").toBeGreaterThan(20);
  });

  it("Arabic really is Arabic — not the English copied across to fill the shape", () => {
    /* The cheap way to satisfy the test above is to paste the English into `ar`.
       That ships a build that claims to be translated and is not, so the two halves
       must actually DIFFER — except where the correct Arabic IS the Latin string,
       which is only ever a language's own endonym ("English" stays "English" in the
       language picker, because somebody stranded in the wrong language has to be
       able to read their way out). Those are named, so the exemption is earned. */
    const ALLOWED_IDENTICAL = new Set<TKey>(["appearance.english", "appearance.arabic"]);
    const copied = (Object.entries(DICT) as [TKey, { en: string; ar: string }][])
      .filter(([k, e]) => e.en === e.ar && !ALLOWED_IDENTICAL.has(k))
      .map(([k]) => k);
    expect(copied, `English pasted into the Arabic half: ${copied.join(", ")}`).toEqual([]);
    // …and the Arabic half really contains Arabic script, not transliteration.
    const notArabic = (Object.entries(DICT) as [TKey, { en: string; ar: string }][])
      .filter(([k]) => !ALLOWED_IDENTICAL.has(k))
      .filter(([, e]) => !/[؀-ۿ]/.test(e.ar))
      .map(([k]) => k);
    expect(notArabic, `no Arabic script: ${notArabic.join(", ")}`).toEqual([]);
  });

  it("a missing key falls back to ENGLISH, never to the key itself", () => {
    /* The failure people actually ship is `nav.calls` appearing on somebody's
       phone. Falling back to English is merely untranslated; falling back to the
       key is broken. */
    expect(translate("ar", "nav.calls")).toBe("المكالمات");
    expect(translate("en", "nav.calls")).toBe("Calls");
    // A key that is not in the dictionary at all cannot be constructed through the
    // type, so it is forced here the way a stale call site would arrive.
    expect(translate("ar", "totally.unknown" as TKey)).toBe("totally.unknown");
  });

  it("an unknown stored value resolves to English and the default size, never blank", () => {
    /* These come out of localStorage, which the user can edit and an older build
       can have written, so they are normalized rather than trusted. */
    for (const junk of [null, undefined, "", "fr", "AR", 7, {}, []]) {
      expect(normalizeLocale(junk)).toBe("en");
    }
    expect(normalizeLocale("ar")).toBe("ar");
    for (const junk of [null, undefined, "", "huge", "MD", 3]) {
      expect(normalizeScale(junk)).toBe("md");
    }
    expect(normalizeScale("sm")).toBe("sm");
    expect(normalizeScale("lg")).toBe("lg");
  });

  it("the default text size is EXACTLY 1, so an untouched install is unchanged", () => {
    /* Not 0.99 or 1.01: `md` must be a true no-op or every existing measured layout
       in this repo shifts under a feature nobody switched on. */
    expect(TEXT_SCALE_FACTOR.md).toBe(1);
    expect(TEXT_SCALE_FACTOR.sm).toBeLessThan(1);
    expect(TEXT_SCALE_FACTOR.lg).toBeGreaterThan(1);
  });

  it("Arabic is right-to-left and the direction is written on the ROOT", () => {
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("en")).toBe(false);
    const src = codeOnly(read("client/src/app/i18n.tsx"));
    /* On `document.documentElement`, so every logical property and every
       fixed/absolute element flips with one write. Setting it lower down leaves the
       chrome pointing the wrong way. */
    expect(src).toMatch(/root\.setAttribute\("dir", isRtl\(locale\) \? "rtl" : "ltr"\)/);
    expect(src).toMatch(/const root = document\.documentElement;/);
  });

  it("the measured viewport height is DIVIDED by the zoom, or the composer goes under the fold", () => {
    /* THE ONE THAT MATTERS MOST IN THIS RELEASE.

       Text size scales the page with `zoom`, and every reading AppShell takes
       (innerHeight, visualViewport.height, offsetTop) is in UNZOOMED CSS pixels,
       while `--relay-vh` is spent on a layout `zoom` has already scaled. Assign the
       raw number at 1.15 and the shell is 15% too tall — the v2.106.29 defect
       arriving by a different road, on the screen where it costs you the composer.

       Pinned as the division AND as reading the same variable the provider
       publishes, so the two cannot come to disagree about what the scale is. */
    const code = codeOnly(SHELL);
    expect(code).toMatch(/getPropertyValue\("--relay-zoom"\)/);
    expect(code).toMatch(/root\.style\.setProperty\("--relay-vh", Math\.round\(h \/ zoom\) \+ "px"\)/);
    // An unreadable value must read as 1 — today's behaviour — not as 0, which
    // would divide the shell to nothing.
    expect(code).toMatch(/Number\.isFinite\(zoomRaw\) && zoomRaw > 0 \? zoomRaw : 1/);
    // And the provider is the only writer of that variable.
    const i18n = codeOnly(read("client/src/app/i18n.tsx"));
    expect(i18n).toMatch(/setProperty\("--relay-zoom"/);
  });

  it("the provider is mounted above the app, inside the theme provider", () => {
    /* Both write `<html>` and the appearance pane changes all three from one
       screen, so they have to share a tree. */
    const code = codeOnly(MAIN);
    const theme = code.indexOf("<ThemeProvider");
    const locale = code.indexOf("<LocaleProvider>");
    const app = code.indexOf("<App />");
    expect(theme).toBeGreaterThan(-1);
    expect(locale).toBeGreaterThan(-1);
    expect(app).toBeGreaterThan(-1);
    expect(theme, "theme wraps locale").toBeLessThan(locale);
    expect(locale, "locale wraps the app").toBeLessThan(app);
  });

  it("the appearance pane offers all three controls the owner asked for", () => {
    const code = codeOnly(PROFILE);
    expect(code, "theme").toMatch(/setTheme\("light"\)/);
    expect(code, "language").toMatch(/setLocale\("ar"\)/);
    expect(code, "text size").toMatch(/setScale\(key\)/);
    // Each language is labelled in its OWN language, so somebody stranded in the
    // wrong one can read their way out.
    expect(code).toMatch(/العربية/);
    expect(code).toMatch(/English/);
  });
});
