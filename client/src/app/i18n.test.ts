import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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

describe("v2.106.83/84 — the app speaks Arabic, and it is impossible to add a string that does not", () => {
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

  it("no two dictionary modules declare the same key — a spread would silently drop one", () => {
    /* `dict/index.ts` composes the per-surface modules with `...`, so a key
       declared twice does not error: the LAST spread quietly wins and the other
       module's translation is unreachable. That is invisible in every other test
       here, because both halves would be present and both would be Arabic — the
       wrong string simply renders. One module per surface is what makes several
       contributors able to work at once, and this is the cost of that decision
       being paid rather than discovered.

       Read from disk rather than from the imported objects, because by the time
       they are spread the collision has already happened. */
    const dir = resolve(process.cwd(), "client/src/app/dict");
    const modules = readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !["index.ts", "types.ts"].includes(f)
    );
    expect(modules.length, "the sweep found modules to check").toBeGreaterThan(3);
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const f of modules) {
      const src = codeOnly(read(`client/src/app/dict/${f}`));
      // Keys are always quoted at the start of a line inside the object literal.
      for (const m of src.matchAll(/^\s{2}"([\w.]+)":/gm)) {
        const key = m[1];
        const prev = owner.get(key);
        if (prev) clashes.push(`${key} (${prev} + ${f})`);
        else owner.set(key, f);
      }
    }
    expect(clashes, `duplicate keys: ${clashes.join(", ")}`).toEqual([]);
    // …and the parse really found the keys, rather than the regex silently
    // matching nothing and declaring victory.
    expect(owner.size, "keys found by the file scan").toBe(Object.keys(DICT).length);
  });

  it("the screens the owner named — registration and login — go through the translator", () => {
    /* Owner, verbatim: "During registration and login, ensure everything is in
       Arabic with a proper, professional translation suitable for apps."

       Pinned as the ABSENCE of the specific English literals rather than as a
       count of `t(` calls, because a count says nothing about whether the strings
       a person actually reads were converted — it would stay green with one label
       translated and forty left behind. Each of these is a sentence a user sees on
       the way in. */
    const SURFACES: [string, string[]][] = [
      [
        "client/src/app/AuthPanel.tsx",
        ["Keep me signed in", "Enter your code", "Verify & continue", "Send verification code"],
      ],
      [
        "client/src/app/LoginScreen.tsx",
        ["Your identity is six digits.", "Create private account", "Verify &amp; sign in", "Register a new account"],
      ],
      [
        "client/src/app/OnboardingGate.tsx",
        ["Enter as guest", "Your display name", "Continue with email"],
      ],
    ];
    for (const [file, literals] of SURFACES) {
      const code = codeOnly(read(file));
      for (const lit of literals) {
        // The literal may legitimately survive inside a comment explaining the
        // change, which is why this runs on comment-stripped source.
        expect(code, `${file} still hardcodes "${lit}"`).not.toContain(`"${lit}"`);
        expect(code, `${file} still renders "${lit}" as text`).not.toContain(`>${lit}<`);
      }
      expect(code, `${file} reaches the translator`).toMatch(/\bt\(["']\w+\./);
    }
  });

  it("the four in-app tabs go through the translator too", () => {
    /* v2.106.85. Same shape as the sign-in sweep above and for the same reason: a
       COUNT of `t(` calls would stay green with one label converted and forty left
       behind, so each entry is a sentence somebody actually reads on that screen.

       The alias matters. `Messages.tsx`'s swipe-action builder binds the THREAD to
       `t`, so its translator is `tr` — a sweep that only knew `t` would report a
       correctly-swept file as untranslated, which is a guard crying wolf. */
    const TABS: [string, string[]][] = [
      [
        "client/src/pages/app/Dialer.tsx",
        ["MY NUMBER", "Erase last digit", "No RELAY user with this number"],
      ],
      [
        "client/src/pages/app/Contacts.tsx",
        ["Search by name or number", "Everyone else", "Remove contact?", "No contacts yet"],
      ],
      [
        "client/src/pages/app/History.tsx",
        ["Search calls by name or number", "Clear your entire call history?", "No answer"],
      ],
      [
        "client/src/pages/app/Messages.tsx",
        ["Type a message", "Unsend this message?", "Delete this chat for you?", "Forward to…"],
      ],
    ];
    for (const [file, literals] of TABS) {
      const code = codeOnly(read(file));
      for (const lit of literals) {
        expect(code, `${file} still hardcodes "${lit}"`).not.toContain(`"${lit}"`);
        expect(code, `${file} still renders "${lit}" as text`).not.toContain(`>${lit}<`);
      }
      expect(code, `${file} reaches the translator`).toMatch(/\b(?:t|tr)\(["']\w+\./);
    }
  });

  it("a label held in a module-level constant is a KEY, never a finished string", () => {
    /* Contacts' tag meta, History's filter tabs and the Messages sections are all
       built OUTSIDE the render, and a module-level constant cannot call a hook. The
       tempting fix is a `text → key` map at each render site, which is exactly what
       this dictionary's own rule forbids: a copy edit would silently drop the
       translation, and two entries sharing an English word would be forced to share
       an Arabic one. So the constant carries the key and the render site translates. */
    for (const [file, marker] of [
      ["client/src/pages/app/Contacts.tsx", "labelKey: TKey"],
      ["client/src/pages/app/History.tsx", "labelKey: TKey"],
      ["client/src/pages/app/Messages.tsx", "labelKey: TKey"],
    ] as const) {
      const code = codeOnly(read(file));
      expect(code, `${file} lost its keyed label`).toContain(marker);
      // …and the old shape is really gone, so this cannot pass beside a survivor.
      expect(code, `${file} still carries a finished label string`).not.toMatch(
        /\blabel: "[A-Z]/,
      );
    }
  });

  it("the language switch is on the ENTRY screen, not only behind the gate", () => {
    /* The Appearance pane lives in Profile, which is BEHIND the onboarding gate —
       so without a switch on the gate itself, somebody who lands in a language they
       cannot read has no way through. This is the one placement in the feature that
       is a correctness property rather than a preference. */
    const code = codeOnly(read("client/src/app/OnboardingGate.tsx"));
    expect(code, "the gate can set the locale").toMatch(/setLocale\(/);
    // Each language labelled in its OWN language — "Arabic" written in English is
    // exactly the label that fails the person it is for.
    expect(code).toMatch(/العربية/);
    expect(code).toMatch(/"English"/);
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
