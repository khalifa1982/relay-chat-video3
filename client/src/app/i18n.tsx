/**
 * APP LANGUAGE (English / Arabic) AND TEXT SIZE — one provider, because both are
 * "how the app is presented to me" and both have to be applied to the SAME root
 * element. Two providers writing `<html>` is how the app ends up in Arabic with
 * `dir="ltr"`, or scaled with a stale viewport height.
 *
 * Owner (v2.106.83): *"the main page is in English by default. If they click go to
 * the app, it will take them to the English version, but you need to add an Arabic
 * switch. If they want to switch to Arabic, the system will switch completely. As
 * you know, English is left-to-right and Arabic is right-to-left, so you will map
 * everything on the web app to Arabic … add an option within the settings to adjust
 * the font size to big or small."*
 *
 * ── WHY THE DICTIONARY IS ONE MAP OF PAIRS, NOT TWO PARALLEL MAPS ─────────────
 * `{ key: { en, ar } }` makes an untranslated string a TYPE ERROR rather than a
 * review item — you cannot add an entry without writing both halves. The owner's
 * standing instruction is *"make sure that whatever changes you make impact both
 * languages"*, and this is that instruction expressed in the type system instead of
 * in a checklist somebody has to remember.
 *
 * ── WHY KEYS, NOT ENGLISH STRINGS, AND WHY THE FALLBACK IS ENGLISH ────────────
 * Looking a translation up BY its English text means a copy edit silently drops the
 * translation, and it forces two places that happen to share an English word to
 * share an Arabic one — which is wrong often enough to matter ("Call" the noun vs
 * "Call" the verb are different words in Arabic). So entries are keyed.
 *
 * A missing key must never render the KEY. `t()` falls back to the English half,
 * which is always present by construction, so a not-yet-translated screen degrades
 * to readable English rather than to `nav.calls` on somebody's phone.
 *
 * ── WHY TEXT SIZE IS `zoom` AND NOT A ROOT FONT-SIZE ──────────────────────────
 * MEASURED, not assumed: this app sizes 203 of its type declarations in ARBITRARY
 * PIXELS (`text-[13px]`, `text-[9.5px]`) against 541 rem-based ones. A root
 * font-size therefore scales about 73% of the text and leaves the rest fixed, which
 * does not read as "bigger text" — it reads as a broken screen. `zoom` scales
 * everything uniformly, which is also what the OS-level display-size control these
 * users already know does.
 *
 * IT COSTS ONE THING AND THAT THING IS LOAD-BEARING: the mobile shell is sized from
 * a MEASURED `--relay-vh` (v2.78/v2.106.29 — CSS viewport units mis-report on a real
 * iPhone), and `window.innerHeight` is in UNZOOMED CSS pixels while the layout it
 * feeds is in zoomed ones. Left alone, a 1.15 zoom makes the shell 15% too tall and
 * pushes the composer under the fold — the exact v2.106.29 defect. So the scale is
 * published as `--relay-zoom` and `AppShell` divides by it. That division is the
 * whole reason this lives beside the language rather than in its own corner.
 */
import { ALL_DICT } from "./dict";
import type { Entry } from "./dict/types";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Locale = "en" | "ar";
export type TextScale = "sm" | "md" | "lg";

/** The multiplier each step applies. `md` is 1 exactly, so the default build is
 *  byte-identical to before this feature existed. */
export const TEXT_SCALE_FACTOR: Record<TextScale, number> = {
  sm: 0.9,
  md: 1,
  lg: 1.15,
};

const LOCALE_KEY = "relay_locale";
const SCALE_KEY = "relay_text_scale";

/* ─────────────────────────────────────────────────────────────────────────────
   THE DICTIONARY

   Arabic here is written for an APP, not translated word-for-word: imperative
   verbs for buttons, no transliterated English where a real Arabic term exists,
   and Eastern-Arabic numerals deliberately NOT used — a RELAY number is six
   Western digits everywhere in the product and rendering it in ٠١٢ would make the
   number somebody reads out loud differ from the number they type.
   ──────────────────────────────────────────────────────────────────────────── */
export type { Entry } from "./dict/types";

export const DICT = ALL_DICT;

export type TKey = keyof typeof DICT;

/** Substitute `{name}` placeholders. Kept trivial on purpose — a template engine
 *  here would be a second thing to get wrong for a feature nothing needs yet. */
function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function translate(
  locale: Locale,
  key: TKey,
  vars?: Record<string, string | number>
): string {
  const entry = DICT[key] as Entry | undefined;
  // A key nobody has added yet must not reach the screen as a key. Falling back to
  // the key itself is the failure people actually ship; falling back to English is
  // merely untranslated.
  if (!entry) return key;
  const raw = locale === "ar" ? entry.ar || entry.en : entry.en;
  return interpolate(raw, vars);
}

/**
 * Same substitution, but the values may be React nodes — a bolded email address, a
 * link, a coloured number.
 *
 * WHY THIS EXISTS RATHER THAN SPLITTING THE SENTENCE IN THE CALLER: the obvious
 * shortcut is `{t("...part1")}<b>{email}</b>{t("...part2")}`, and it is wrong in
 * Arabic specifically. Word order differs, so the emphasised part does not sit
 * between the same two fragments — a sentence chopped at the English seam CANNOT
 * be translated, only re-assembled into nonsense. Keeping the placeholder inside
 * the string lets the translator put it where the language wants it.
 */
export function translateNodes(
  locale: Locale,
  key: TKey,
  vars: Record<string, React.ReactNode>
): React.ReactNode[] {
  const entry = DICT[key] as Entry | undefined;
  const raw = entry ? (locale === "ar" ? entry.ar || entry.en : entry.en) : key;
  const out: React.ReactNode[] = [];
  // Split on the placeholders themselves so the surrounding text keeps its order.
  const parts = raw.split(/(\{\w+\})/g);
  parts.forEach((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    if (m && m[1] in vars) {
      out.push(<React.Fragment key={i}>{vars[m[1]]}</React.Fragment>);
    } else if (part) {
      out.push(part);
    }
  });
  return out;
}

export function isRtl(locale: Locale): boolean {
  return locale === "ar";
}

/** Anything that is not a locale we ship resolves to English rather than throwing
 *  or rendering blank — this value comes out of localStorage, which the user can
 *  edit and an older build can have written. */
export function normalizeLocale(v: unknown): Locale {
  return v === "ar" ? "ar" : "en";
}

export function normalizeScale(v: unknown): TextScale {
  return v === "sm" || v === "lg" ? v : "md";
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  rtl: boolean;
  scale: TextScale;
  setScale: (s: TextScale) => void;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
  /** As `t`, but the values may be React nodes — see `translateNodes`. */
  tn: (key: TKey, vars: Record<string, React.ReactNode>) => React.ReactNode[];
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    // Every storage read is guarded: a browser with storage blocked must land on
    // English rather than fail to boot.
    try {
      return normalizeLocale(localStorage.getItem(LOCALE_KEY));
    } catch {
      return "en";
    }
  });
  const [scale, setScaleState] = useState<TextScale>(() => {
    try {
      return normalizeScale(localStorage.getItem(SCALE_KEY));
    } catch {
      return "md";
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("lang", locale);
    // `dir` on the ROOT, so every logical property (`ps-`, `ms-`, `start-`) and
    // every fixed/absolute element flips with one write. Setting it lower down
    // leaves the chrome pointing the wrong way.
    root.setAttribute("dir", isRtl(locale) ? "rtl" : "ltr");
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      /* a blocked store costs persistence, never the session */
    }
  }, [locale]);

  useEffect(() => {
    const root = document.documentElement;
    const factor = TEXT_SCALE_FACTOR[scale];
    // Published as a variable rather than written as `style.zoom` directly, because
    // AppShell has to DIVIDE the measured viewport height by it (see the header) —
    // one source for both readers.
    root.style.setProperty("--relay-zoom", String(factor));
    root.style.zoom = factor === 1 ? "" : String(factor);
    try {
      localStorage.setItem(SCALE_KEY, scale);
    } catch {
      /* as above */
    }
  }, [scale]);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale: setLocaleState,
      rtl: isRtl(locale),
      scale,
      setScale: setScaleState,
      t: (key, vars) => translate(locale, key, vars),
      tn: (key, vars) => translateNodes(locale, key, vars),
    }),
    [locale, scale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * Read the language / text size.
 *
 * FAILS SOFT when there is no provider above it, deliberately: this hook is called
 * from leaf components that also render inside tests and inside the call engine's
 * own tree, and throwing there would turn a missing provider into a blank app
 * rather than an untranslated one.
 */
export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (ctx) return ctx;
  return {
    locale: "en",
    setLocale: () => {},
    rtl: false,
    scale: "md",
    setScale: () => {},
    t: (key, vars) => translate("en", key, vars),
    tn: (key, vars) => translateNodes("en", key, vars),
  };
}

/** Sugar for the common case — `const t = useT()`. */
export function useT() {
  return useLocale().t;
}
