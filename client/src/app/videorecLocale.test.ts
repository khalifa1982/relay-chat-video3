import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { copyOnScreen, keysForEnglish } from "../../../server/testing/copyOnScreen";
import { VIDEOREC } from "./dict/videorec";

/**
 * THE IN-APP CAMERA SHEET SPEAKS ARABIC.
 *
 * Three things a localisation sweep gets wrong quietly, and what this file does about
 * each:
 *
 *  1. A SWEEP, NOT A LIST. "These eleven strings are translated" stays green with the
 *     twelfth left behind, which is how a screen ends up 90% Arabic. The rule below
 *     reads the component and fails on ANY user-visible English literal, so the string
 *     somebody adds next is covered rather than exempt — and it is shown BITING on
 *     constructed fixtures, because a sweep widened until it stops flagging correct
 *     code is exactly the kind that ends up flagging nothing.
 *
 *  2. DIRECTION IS NOT A FIND-AND-REPLACE. Two sites here must stay PHYSICAL and one
 *     must become direction-aware, and a blanket `pl-→ps-` pass gets all three wrong.
 *     Both directions are asserted, because a rule that only forbids the physical form
 *     would happily accept a "fixed" mirror that no longer mirrors.
 *
 *  3. A KEY IS NOT A TRANSLATION. `translate()` falls back to the key when it does not
 *     know it, so a typo renders `videorec.retkae` on somebody's screen rather than
 *     throwing. Every key this component asks for is checked to exist, and every key
 *     this module publishes is checked to have a reader.
 */
const ROOT = path.resolve(__dirname, "../../..");
const SRC = fs.readFileSync(path.join(ROOT, "client/src/app/VideoRecordSheet.tsx"), "utf8");

/* Comment-stripped, and NOT for tidiness. This component's own header transcribes board
   4j — *"after stop Retake pill … and a SOLID-accent 'Use video' pill"* — so a search of
   the raw file for those words matches the PROSE. That is not hypothetical: the two
   v2.96.2 pins in `server/v2962VideoRecorder.test.ts` were passing on exactly that text,
   and were still passing against a build whose Retake button had been gutted (verified
   by mutation while writing this file). Every rule here reads `CODE`. */
const CODE = codeOnly(SRC);

/** The rendered half, so TypeScript generics and the module header cannot be read as
 *  screen text. */
/* v2.107.33: the sheet now returns THROUGH a portal (the stacking-context fix),
   so the render-side slice starts at the portal call. */
const JSX = CODE.slice(CODE.indexOf("\n  return createPortal("));

/**
 * Every string a PERSON would read, if it were written as a literal rather than fetched
 * from the dictionary: JSX text nodes, the attributes a screen reader or tooltip
 * surfaces, and the imperative shouts.
 *
 * The text-node pattern refuses `{` and `}` inside the run, which is what confines a
 * match to ONE JSX text node — an expression, a nested element or a CSS template all
 * contain braces or angle brackets and end the run.
 */
function userVisibleLiterals(jsx: string, rest = ""): string[] {
  const out: string[] = [];
  for (const m of jsx.matchAll(/>\s*([^<>{}]*?[A-Za-z]{2}[^<>{}]*?)\s*</g)) out.push(m[1].trim());
  for (const m of (jsx + rest).matchAll(
    /\b(?:aria-label|title|placeholder|alt)="([^"]*[A-Za-z]{2}[^"]*)"/g,
  )) {
    out.push(m[1]);
  }
  for (const m of (jsx + rest).matchAll(/\b(?:toast|alert|confirm)\(\s*"([^"]*[A-Za-z]{2}[^"]*)"/g)) {
    out.push(m[1]);
  }
  return out.filter((s) => s.length > 0);
}

describe("the camera sheet is translated", () => {
  it("the slices this file reasons about are real (guards a vacuous pass)", () => {
    /* Every rule below is scoped to a slice. A stale anchor makes the slice empty and
       every `not.toMatch` in it pass while proving nothing — the collapsed-slice trap
       this repo has recorded more than once. */
    expect(CODE.length).toBeGreaterThan(4_000);
    expect(JSX.length).toBeGreaterThan(3_000);
    expect(JSX).toContain("dark relay-v2 fixed inset-0");
    // …and the strip really removed the prose that would otherwise answer for the code.
    expect(SRC).toContain('"Use video" pill');
    expect(CODE).not.toContain('"Use video" pill');
  });

  it("renders NO hardcoded user-visible English — the sweep, not a list of eleven strings", () => {
    const leftovers = userVisibleLiterals(JSX, CODE);
    expect(
      leftovers,
      `these reach a screen as English literals — put them in dict/videorec.ts:\n` +
        leftovers.map((s) => `  ${JSON.stringify(s)}`).join("\n"),
    ).toEqual([]);
  });

  it("…and that sweep really bites", () => {
    /* Constructed rather than assumed. A rule narrowed until it stops flagging correct
       code has to be shown still catching the thing it exists for. */
    expect(userVisibleLiterals(`<div>Camera unavailable</div>`)).toEqual(["Camera unavailable"]);
    expect(userVisibleLiterals(`<button aria-label="Stop and send" />`)).toEqual(["Stop and send"]);
    expect(userVisibleLiterals(``, `toast("Recording failed.")`)).toEqual(["Recording failed."]);
    // …and it passes the translated forms, so it is not merely "flags everything".
    expect(userVisibleLiterals(`<div>{t("videorec.retake")}</div>`)).toEqual([]);
    expect(userVisibleLiterals(`<button aria-label={t("videorec.stopAndSend")} />`)).toEqual([]);
    // The timer's ` / ` separator is punctuation, not copy, and must not be flagged.
    expect(userVisibleLiterals(`<span>{clock(a)} / {clock(b)}</span>`)).toEqual([]);
  });

  it("the provider reaches the translator, and nothing shadows it", () => {
    expect(CODE).toMatch(/import \{ useLocale, type TKey \} from "\.\/i18n"/);
    expect(CODE).toMatch(/const \{ t, rtl \} = useLocale\(\);/);
    /* `const t = setTimeout(...)` / `const t = setInterval(...)` would shadow the
       translator and hand a later edit a Timeout where it expected a function. The
       repo's precedent is to REMOVE the shadow rather than alias around it. This file
       does run an interval, so the risk is real rather than theoretical. */
    expect(CODE).not.toMatch(/\bconst t = set(?:Interval|Timeout)/);
  });

  it("the notice is held as a KEY, not as a translated sentence", () => {
    /* A string frozen in state is stale the moment the language changes, and storing one
       would also drag `t` into an effect closure whose dependency list does not include
       it. So state holds `TKey` and `t` is applied at render — asserted at both ends,
       because doing only one half is what leaves a raw key on somebody's screen. */
    expect(CODE).toMatch(/useState<TKey \| null>\(null\)/);
    expect(CODE).not.toMatch(/setErrKey\(\s*"[A-Z]/);
    expect(CODE).toMatch(/const notice = noticeKey \? t\(noticeKey\) : null;/);
  });
});

describe("dict/videorec.ts — every key is read, every reference exists", () => {
  const KEYS = Object.keys(VIDEOREC);

  it("publishes a real module (guards a vacuous pass)", () => {
    expect(KEYS.length).toBeGreaterThanOrEqual(12);
    expect(KEYS.every((k) => k.startsWith("videorec."))).toBe(true);
  });

  it("every key this module publishes is actually reached by the sheet", () => {
    /* `dictCoverage.test.ts` asks this app-wide; asking it locally is what stops THIS
       module accumulating keys for copy that was later deleted. Membership rather than a
       `t(` call, because two of these are stored in state and translated at render. */
    const dead = KEYS.filter((k) => !CODE.includes(`"${k}"`));
    expect(dead, `keys with no reader in VideoRecordSheet.tsx:\n${dead.join("\n")}`).toEqual([]);
  });

  it("every videorec.* key the sheet asks for exists — a typo would render the KEY", () => {
    const asked = [...CODE.matchAll(/"(videorec\.[\w]+)"/g)].map((m) => m[1]);
    expect(asked.length).toBeGreaterThanOrEqual(12);
    const missing = asked.filter((k) => !(k in VIDEOREC));
    expect(missing, `asked for but not defined: ${missing.join(", ")}`).toEqual([]);
  });

  it("both halves are real, and the Arabic is Arabic rather than transliteration", () => {
    for (const [k, e] of Object.entries(VIDEOREC)) {
      expect(e.en.trim().length, `${k}: empty English`).toBeGreaterThan(0);
      expect(e.ar.trim().length, `${k}: empty Arabic`).toBeGreaterThan(0);
      expect(e.ar, `${k}: the Arabic half is a copy of the English`).not.toBe(e.en);
      expect(/[؀-ۿ]/.test(e.ar), `${k}: no Arabic script in the Arabic half`).toBe(true);
    }
  });

  it("numbers stay WESTERN, even inside Arabic prose", () => {
    /* The countdown's seconds are interpolated raw. An Arabic-Indic numeral beside a
       substituted Western one on the same line reads as a rendering fault (v2.106.84). */
    const indic = Object.entries(VIDEOREC).filter(([, e]) => /[٠-٩۰-۹]/.test(e.ar));
    expect(indic.map(([k]) => k)).toEqual([]);
  });

  it("the countdown keeps its placeholder in BOTH halves — a dropped one loses the number", () => {
    /* Substitution is by NAME, so Arabic may put `{seconds}` where the language wants it;
       what it may not do is lose it, which would leave a countdown that never counts. */
    expect(VIDEOREC["videorec.autoStops"].en).toContain("{seconds}");
    expect(VIDEOREC["videorec.autoStops"].ar).toContain("{seconds}");
    expect(CODE).toMatch(/t\("videorec\.autoStops", \{ seconds: /);
  });
});

describe("the vocabulary distinctions survive the translation", () => {
  it("STOP-TO-REVIEW and STOP-AND-SEND stay two different phrases", () => {
    /* Two buttons in the SAME row, both of which end the take: the shutter hands you a
       review screen, the accent circle sets `sendOnStopRef` and skips it. One phrase for
       both gives a screen-reader user a coin flip between looking at the clip and handing
       it over irreversibly. */
    expect(VIDEOREC["videorec.stop"].en).not.toBe(VIDEOREC["videorec.stopAndSend"].en);
    expect(VIDEOREC["videorec.stop"].ar).not.toBe(VIDEOREC["videorec.stopAndSend"].ar);
    // …and the sheet really wires them to the two different controls.
    expect(JSX).toMatch(/phase === "rec" \? t\("videorec\.stop"\) : t\("videorec\.start"\)/);
    expect(JSX).toMatch(/onClick=\{stopAndSend\}\s*\n\s*aria-label=\{t\("videorec\.stopAndSend"\)\}/);
  });

  it("STARTING and RETAKING are two different phrases", () => {
    /* Retake DISCARDS a take and returns to live; Start begins one. Collapsed, the review
       screen's escape hatch reads as though it merely records again. */
    expect(VIDEOREC["videorec.start"].ar).not.toBe(VIDEOREC["videorec.retake"].ar);
  });

  it("the SURFACE's name is not the SHUTTER's label", () => {
    /* «تسجيل فيديو» names this screen; «بدء التسجيل» is what the button does. Careless
       Arabic renders both as the first, and a screen reader then announces the dialog and
       its primary control identically. */
    expect(VIDEOREC["videorec.title"].ar).not.toBe(VIDEOREC["videorec.start"].ar);
    expect(VIDEOREC["videorec.title"].ar).not.toBe(VIDEOREC["videorec.rec"].ar);
  });

  it("USE VIDEO does not claim to SEND", () => {
    /* `onUse` hands the clip to the CALLER. In Messages that makes it a pendingUpload, so
       the caption and the disappearing timer still apply before anything is sent — the
       component header says so. An Arabic «إرسال» here would promise a send that has not
       happened, which is the class of lie this repo keeps removing. The send WORD is
       legitimately used by the stop-and-send control, so this is scoped to the one string
       that must not borrow it. */
    expect(VIDEOREC["videorec.useVideo"].ar).not.toContain("إرسال");
    expect(VIDEOREC["videorec.useVideo"].ar).toContain("استخدام");
    // The control that really does hand it straight out is where the send word belongs.
    expect(VIDEOREC["videorec.stopAndSend"].ar).toContain("إرسال");
  });

  it("the two notices stay two different failures", () => {
    /* "Camera unavailable" is a conflict the user can resolve — turn the call's camera
       off. "Not supported by this browser" is one they cannot. One sentence for both
       sends somebody to fix a thing that is not the problem. */
    expect(VIDEOREC["videorec.cameraUnavailable"].en).not.toBe(VIDEOREC["videorec.unsupported"].en);
    expect(VIDEOREC["videorec.cameraUnavailable"].ar).not.toBe(VIDEOREC["videorec.unsupported"].ar);
    // The remedy is what makes the first one worth having; it must survive translation.
    expect(VIDEOREC["videorec.cameraUnavailable"].ar).toContain("مكالمة فيديو");
    // Both are reachable, and from the two places that can each only report their own.
    expect(CODE).toMatch(/setErrKey\("videorec\.cameraUnavailable"\)/);
    expect(CODE).toMatch(/setErrKey\("videorec\.unsupported"\)/);
  });

  it("the gallery is called what the story composer already calls it", () => {
    /* «المعرض» is `status.library`'s word. Two words for one place is how a user ends up
       unsure whether the two shortcuts open the same thing. Pinned as this module's own
       content rather than by reading the other module, so a sweep of THAT screen cannot
       turn this red for a reason that has nothing to do with this one. */
    expect(VIDEOREC["videorec.library"].ar).toContain("المعرض");
  });

  it("the copy the owner reviewed still reaches this screen", () => {
    /* `copyOnScreen` asks the property these pins always stood for — this sentence is on
       this screen — satisfied by the literal OR by a key whose English half carries it.
       Strictly stronger than a literal search, because reaching the dictionary also
       proves an Arabic half exists (`Entry` requires both). */
    for (const line of ["Retake", "Use video", "Flip camera", "Stop and send", "Record a video"]) {
      expect(copyOnScreen(CODE, line), `"${line}" no longer reaches the camera sheet`).toBe(true);
    }
    /* The two notices reach the screen through `setErrKey("…")` rather than a `t("…")`
       call, and `copyOnScreen` looks for the translator call specifically (deliberately —
       a bare mention would match an import or a comment). Same property, asked directly.
       This is a genuine limitation of `copyOnScreen` against a key-in-state design, not a
       looser test: it still fails if the sentence leaves the dictionary OR the sheet stops
       referencing it. */
    for (const line of ["turn the call's camera off first", "isn't supported by this browser"]) {
      const keys = keysForEnglish(line);
      expect(keys, `"${line}" is not in the dictionary at all`).not.toEqual([]);
      expect(
        keys.some((k) => CODE.includes(`"${k}"`)),
        `the dictionary carries "${line}" (${keys.join("/")}) but the sheet does not reach it`,
      ).toBe(true);
    }
  });
});

describe("direction: logical where it is reading order, physical where it is not", () => {
  it("reading-order spacing is logical", () => {
    expect(JSX, "physical padding/margin — use ps-/pe-/ms-/me-").not.toMatch(/\b-?(?:pl|pr|ml|mr)-/);
    expect(JSX, "physical text alignment — use text-start/text-end").not.toMatch(
      /\btext-(?:left|right)\b/,
    );
    /* The countdown used to be anchored with the `left-0 right-0` PAIR. That is
       geometrically `inset-x-0` and direction-independent either way, but written as two
       physical edges it reads as something anchored to a side and invites a half-
       conversion. Both halves are pinned so a blanket sweep cannot produce a `start-0`
       with a stray `right-0` still on it. */
    expect(JSX).toContain("absolute inset-x-0 bottom-3");
    expect(JSX).not.toMatch(/\b(?:left|right)-0\b/);
  });

  it("the REC chip's timer is ONE LTR island, not two", () => {
    /* `0:07 / 1:00` is two numeric runs with a separator between them. In an RTL
       paragraph the bidi algorithm resolves that separator to the paragraph direction
       (UAX#9 N1, numbers acting as R for the purpose of adjacent neutrals), so the two
       runs are laid out right-to-left relative to each other and the chip claims the cap
       has elapsed. Isolating each clock SEPARATELY does not help — the isolates are still
       ordered by the RTL run between them — so the island must span both times AND their
       separator, which is also why this is not a single dictionary string. */
    const chip = JSX.slice(JSX.indexOf('t("videorec.rec")'), JSX.indexOf("{phase !== \"review\""));
    expect(chip.length, "the chip slice collapsed").toBeGreaterThan(100);
    expect(chip).toMatch(/dir="ltr"/);
    expect(chip).toMatch(/\[unicode-bidi:isolate\]/);
    // ONE island holding both clocks — not one per clock.
    expect([...chip.matchAll(/unicode-bidi:isolate/g)].length).toBe(1);
    expect(chip).toMatch(/\{clock\(elapsedMs\)\} \/ \{clock\(maxMs\)\}/);
  });

  it("the progress hairline fills from the READING start", () => {
    /* `transform` is physical, so `origin-left` grows a right-to-left screen backwards —
       the bar would drain instead of fill. Two COMPLETE literals rather than a composed
       class, because a runtime-assembled Tailwind class is invisible to the JIT and comes
       out unstyled. Both directions pinned: a "fix" that only ever uses origin-right is as
       wrong as one that only ever uses origin-left. */
    expect(JSX).toContain("origin-right");
    expect(JSX).toContain("origin-left");
    expect(JSX).toMatch(/rtl\s*\n?\s*\?\s*"block h-full origin-right/);
  });

  it("the SELFIE MIRROR stays physical — it is a camera fact, not a reading order", () => {
    /* `scaleX(-1)` on the front-camera preview makes a selfie feel natural. It must not
       follow `dir`, and it must not be "corrected" by a direction sweep: flipping it in
       Arabic would un-mirror the preview for every Arabic speaker. */
    expect(JSX).toMatch(/facing === "user" \? \{ transform: "scaleX\(-1\)" \}/);
    expect(JSX).not.toMatch(/rtl[^\n]*scaleX/);
  });

  it("letter-spacing is dropped in Arabic, because Arabic is cursive", () => {
    /* The board's mono 0.18em tracking is a Latin treatment; applied to Arabic it pulls
       the cursive joins apart. `uppercase` is already a no-op there for the same reason.
       Scoped to the ONE tracked line on this surface — the REC chip carries no tracking,
       so this is not a blanket ban. */
    expect(JSX).toContain("tracking-[0.18em]");
    const tracked = [...JSX.matchAll(/tracking-\[0\.18em\]/g)].length;
    expect(tracked, "a second tracked line appeared and was not given the RTL branch").toBe(1);
    expect(JSX).toMatch(/rtl\s*\n?\s*\?\s*"absolute inset-x-0 bottom-3 text-center font-mono text-\[10px\] text-white\/60"/);
  });

  it("no class name is assembled from a composed value", () => {
    /* Interpolating a CHOICE between complete literals is fine — both appear in source so
       the JIT sees them. Composing one is not, and comes out unstyled. Two direction
       branches were added here, so this is the moment that rule matters. */
    for (const m of JSX.matchAll(/className=\{`([^`]*)`\}/g)) {
      for (const inner of m[1].matchAll(/\$\{([^}]*)\}/g)) {
        const expr = inner[1].trim();
        expect(/["']/.test(expr) || /^[A-Z][A-Z0-9_]*$/.test(expr), expr.slice(0, 60)).toBe(true);
      }
    }
  });
});
