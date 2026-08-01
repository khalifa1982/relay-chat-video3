/**
 * design_handoff_relay_app — PHASE 2a, the NAVIGATION layer.
 *
 * The board's shell is five tabs — Calls · History · Messages · Groups · Contacts — with
 * the active one drawn as a 40×25 pill on the cycling accent. Groups is the fifth, and it
 * is the Messages page NARROWED to group threads rather than a second thread list: the
 * board's own Messages frame still lists group threads, so this is a second entry point,
 * and sharing the component means the rows, swipe actions, search, presence and story
 * rings cannot drift between the two.
 *
 * THE DEFECT THIS SUITE EXISTS FOR, because it is invisible and I wrote it once already:
 * narrowing by SELECTING CATEGORIES leaks archived DIRECT threads into a tab called
 * Groups, because "Archived" is defined as `t.archived` regardless of kind. The narrowing
 * therefore has to be applied to the INPUT, and every "is there anything here" question
 * — the empty state, the search box — has to be asked of the narrowed list, or the Groups
 * tab of an account with DMs and no groups renders `No conversations match “”`.
 *
 * WHAT IS MEASURED RATHER THAN PINNED: the five-across geometry. A source pin cannot tell
 * you whether a 9px label fits a 64px column, and this bar has broken twice
 * (v2.103.1, v2.99.94), so it was measured in headless Chromium against the real built
 * stylesheet at 320/360/375/390/430 with the longest labels lit and both badges at their
 * widest — 50/50 clean, tightest slack 10.8px at 320px, and the bar came out 47.5px tall
 * against the ~68px it replaces. The assertions here pin the PRECONDITIONS that
 * measurement rests on, so a change that invalidates it fails rather than going quiet.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const SHELL = read("client/src/app/AppShell.tsx");
const APP = read("client/src/App.tsx");
const MESSAGES = read("client/src/pages/app/Messages.tsx");
const CSS = read("client/src/index.css");

/** Comment-stripped source. This repo has matched its own prose 18+ times. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}
const SHELL_CODE = code(SHELL);
const APP_CODE = code(APP);
const MESSAGES_CODE = code(MESSAGES);
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of a named function, located by brace matching. */
function fnAt(src: string, anchor: string): string {
  const at = src.indexOf(anchor);
  expect(at, `anchor not found: ${anchor}`).toBeGreaterThanOrEqual(0);
  // Seed the depths FROM THE ANCHOR: an anchor containing `(` (a signature) otherwise
  // leaves paren depth negative and the first `{` found is a destructured parameter or a
  // `Promise<{…}>` return type — the trap that bit in v2.105.9, v2.105.27 and v2.105.29.
  let paren = 0;
  let angle = 0;
  for (const ch of anchor) {
    if (ch === "(") paren++;
    else if (ch === ")") paren--;
    else if (ch === "<") angle++;
    else if (ch === ">") angle--;
  }
  let i = at + anchor.length;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "<") angle++;
    else if (c === ">") angle--;
    else if (c === "{" && paren === 0 && angle === 0) break;
  }
  expect(i, `no body brace after ${anchor}`).toBeLessThan(src.length);
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced body for ${anchor}`);
}

/**
 * The body of an arrow CALLBACK, e.g. `useMemo(() => { … })`.
 *
 * `fnAt` cannot serve this: for `function f(` the parameter list CLOSES before the body,
 * so the body brace sits at paren depth 0, while for `useMemo(` the callback body is
 * INSIDE the call's own still-open paren. One rule cannot find both, and pretending it
 * can is what returned a destructured parameter in v2.105.9.
 */
function arrowBodyAt(src: string, anchor: string): string {
  const at = src.indexOf(anchor);
  expect(at, `anchor not found: ${anchor}`).toBeGreaterThanOrEqual(0);
  const arrow = src.indexOf("=> {", at + anchor.length);
  expect(arrow, `no arrow body after ${anchor}`).toBeGreaterThan(at);
  let depth = 0;
  const start = arrow + 3;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced arrow body for ${anchor}`);
}

describe("five tabs, in the board's order", () => {
  it("TABS holds exactly five entries with Groups between Messages and Contacts", () => {
    const arr = SHELL_CODE.slice(
      SHELL_CODE.indexOf("const TABS = ["),
      SHELL_CODE.indexOf("] as const;", SHELL_CODE.indexOf("const TABS = [")),
    );
    expect(arr.length).toBeGreaterThan(200);
    const keys = [...arr.matchAll(/key:\s*"([a-z]+)"/g)].map((m) => m[1]);
    expect(keys).toEqual(["dialer", "history", "messages", "groups", "contacts"]);
  });

  it("every tab still carries a light-theme shade, so a sixth cannot ship without one", () => {
    // The accent is dark-only (it is ~1.7:1 on a light card). If a tab has no `shade`,
    // its active label in light theme renders `undefined` — i.e. inherits, and the
    // active state stops being visible on exactly the theme the accent cannot serve.
    const arr = SHELL_CODE.slice(
      SHELL_CODE.indexOf("const TABS = ["),
      SHELL_CODE.indexOf("] as const;", SHELL_CODE.indexOf("const TABS = [")),
    );
    const rows = arr.split("\n").filter((l) => /key:\s*"/.test(l));
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r, r).toMatch(/color:\s*"#[0-9a-f]{6}"/i);
      expect(r, r).toMatch(/shade:\s*"#[0-9a-f]{6}"/i);
    }
  });

  it("the mobile bar is a FIVE column grid — the measurement's precondition", () => {
    expect(SHELL_CODE).toMatch(/grid grid-cols-5/);
    expect(SHELL_CODE).not.toMatch(/grid grid-cols-4/);
  });

  it("the pill is the board's 40×25 at radius 11, and the label 9px", () => {
    // Measured geometry: a change here invalidates the 320px result above.
    expect(SHELL_CODE).toMatch(/w-10 h-\[25px\] rounded-\[11px\]/);
    expect(SHELL_CODE).toMatch(/text-\[9px\]/);
  });

  it("the Groups glyph is four dots and takes currentColor", () => {
    // currentColor is what lets `.rnav-pill`'s `color: var(--rb)` drive the glyph — a
    // hardcoded stroke would leave the icon a fixed hue while its label cycles.
    const fn = fnAt(SHELL, "function GroupsDots(");
    expect((fn.match(/<circle/g) ?? []).length).toBe(4);
    expect(fn).toMatch(/stroke="currentColor"/);
  });
});

describe("the accent nav is dark-only, and derived from ONE read", () => {
  it("accentNav is ONE derivation, read by both navs, never re-derived inside them", () => {
    // Two independent reads of the theme is how you get an accent pill on a light card.
    // NOT a count over the whole file: the sidebar's own Dark/Light toggle legitimately
    // reads `theme === "dark"` twice, so a count would fail on correct code — the same
    // mistake this suite's first draft made and phase 1's before it. Scoped to the two
    // nav regions instead, which is where the property actually lives.
    //
    // REWRITTEN AT v2.106.92. It used to require `const accentNav = liveBackground;`, on
    // the reasoning that the two "can never disagree about which design is live" — and
    // that held only while the canvas was DARK-ONLY. One boolean was answering two
    // different questions, so making the background run in light too (#158) would have
    // silently turned the accent nav on over a pale surface and reinstated the measured
    // 1.7:1 contrast failure v2.106.2 exists to avoid. The property is that the nav's
    // accent is a DARK-THEME decision derived exactly once.
    expect(SHELL_CODE).toMatch(/const accentNav = theme === "dark";/);
    expect(SHELL_CODE.match(/const accentNav =/g) ?? []).toHaveLength(1);
    const bottomNav = SHELL_CODE.slice(
      SHELL_CODE.indexOf("relay-appshell-chrome md:hidden"),
      SHELL_CODE.indexOf("</nav>", SHELL_CODE.indexOf("relay-appshell-chrome md:hidden")),
    );
    expect(bottomNav.length).toBeGreaterThan(1000);
    expect(bottomNav).toMatch(/accentNav/);
    expect(bottomNav).not.toMatch(/theme === "dark"/);
    const sideNav = SHELL_CODE.slice(
      SHELL_CODE.indexOf('<nav className="px-3 flex-1">'),
      SHELL_CODE.indexOf("</nav>", SHELL_CODE.indexOf('<nav className="px-3 flex-1">')),
    );
    expect(sideNav.length).toBeGreaterThan(500);
    expect(sideNav).toMatch(/accentNav/);
    expect(sideNav).not.toMatch(/theme === "dark"/);
  });

  it("light theme keeps the per-tab shade in BOTH navs", () => {
    /* A REAL GAP IN THIS TEST, found by mutation: a bare `toMatch` over the whole file was
       satisfied by the DESKTOP SIDEBAR's copy of this expression while the BOTTOM BAR's
       was gutted — so the mobile active label could have gone back to the raw accent hue
       on a light card (~1.7:1) with the pin still green. The pin-the-presence-not-the-use
       shape. Asserted per region, with the count, so neither copy can hide behind the
       other. */
    const both = SHELL_CODE.match(/theme === "light" \? tab\.shade : tab\.color/g) ?? [];
    expect(both).toHaveLength(2);
    const bottomNav = SHELL_CODE.slice(
      SHELL_CODE.indexOf("relay-appshell-chrome md:hidden"),
      SHELL_CODE.indexOf("</nav>", SHELL_CODE.indexOf("relay-appshell-chrome md:hidden")),
    );
    expect(bottomNav.length).toBeGreaterThan(1000);
    expect(bottomNav).toMatch(/theme === "light" \? tab\.shade : tab\.color/);
    const sideNav = SHELL_CODE.slice(
      SHELL_CODE.indexOf('<nav className="px-3 flex-1">'),
      SHELL_CODE.indexOf("</nav>", SHELL_CODE.indexOf('<nav className="px-3 flex-1">')),
    );
    expect(sideNav.length).toBeGreaterThan(500);
    expect(sideNav).toMatch(/theme === "light" \? tab\.shade : tab\.color/);
  });

  it("the accent path never composes a Tailwind class at runtime", () => {
    // The JIT compiler cannot see a class name assembled at render time, so
    // `bg-[${c}]` comes out unstyled — the trap recorded for the old tab accents and
    // the status picker. Every accent value therefore arrives via a named utility or a
    // CSS var. Assert no template-interpolated class fragment mentions rb.
    expect(SHELL_CODE).not.toMatch(/["'`][a-z-]*\[\$\{/);
    expect(SHELL_CODE).not.toMatch(/\$\{[^}]*rb[^}]*\}/);
  });
});

describe("the board's bar and pill recipes live in CSS, once", () => {
  it(".rtabbar carries the gradient, the 18px blur and the hairline", () => {
    const rule = CSS_CODE.slice(
      CSS_CODE.indexOf(".relay-v2 .rtabbar"),
      CSS_CODE.indexOf("}", CSS_CODE.indexOf(".relay-v2 .rtabbar")),
    );
    expect(rule.length).toBeGreaterThan(80);
    expect(rule).toMatch(/linear-gradient\(180deg, rgba\(10, 14, 16, 0\.55\), rgba\(5, 8, 10, 0\.85\)\)/);
    expect(rule).toMatch(/backdrop-filter: blur\(18px\)/);
    expect(rule).toMatch(/border-top: 1px solid rgba\(255, 255, 255, 0\.08\)/);
  });

  it(".rnav-pill is the accent tint + glow + accent text, and is SHARED by both navs", () => {
    const rule = CSS_CODE.slice(
      CSS_CODE.indexOf(".relay-v2 .rnav-pill"),
      CSS_CODE.indexOf("}", CSS_CODE.indexOf(".relay-v2 .rnav-pill")),
    );
    expect(rule).toMatch(/background: rgba\(var\(--rb-rgb\), 0\.17\)/);
    expect(rule).toMatch(/box-shadow: 0 0 16px rgba\(var\(--rb-rgb\), 0\.25\)/);
    expect(rule).toMatch(/color: var\(--rb\)/);
    // Both the bottom bar and the desktop sidebar row apply it — two ideas of "you are
    // here" is how the two navs come to disagree.
    expect((SHELL_CODE.match(/rnav-pill/g) ?? []).length).toBe(2);
  });

  it(".rbadge-accent is the board's on-accent pair, and carries NO glow", () => {
    const rule = CSS_CODE.slice(
      CSS_CODE.indexOf(".relay-v2 .rbadge-accent"),
      CSS_CODE.indexOf("}", CSS_CODE.indexOf(".relay-v2 .rbadge-accent")),
    );
    expect(rule).toMatch(/background: var\(--rb\)/);
    expect(rule).toMatch(/color: #04211a/);
    expect(rule).not.toMatch(/box-shadow/);
  });

  it("the tab bar is NOT `.rbar` — the two recipes genuinely differ", () => {
    // `.rbar` is a flat fill for the top bar and the composer; this one is a gradient
    // that grounds itself against the screen edge. Reusing one name for both is how the
    // bottom bar quietly loses its gradient.
    const rbar = CSS_CODE.slice(
      CSS_CODE.indexOf(".relay-v2 .rbar {"),
      CSS_CODE.indexOf("}", CSS_CODE.indexOf(".relay-v2 .rbar {")),
    );
    expect(rbar).not.toMatch(/linear-gradient/);
  });
});

describe("badges follow the board", () => {
  it("History is red, and Messages and Groups each count what they CONTAIN", () => {
    /* v2.106.64 — this used to require Groups to carry NO badge, and its recorded reason
       was that "the Messages list still contains every group thread, so its count is the
       complete one". That reason stopped being true the moment groups left Messages (the
       owner's ask), so the pin was forbidding the fix while saying nothing about the rule
       it stood for.

       The rule is that a tab's badge counts the threads that tab HOLDS. With the two
       lists disjoint, a single total on Messages would light a badge for a group message
       the Messages tab no longer contains — you tap it and find nothing, which is the
       silent-no-op class. Asserted as the two counts being DERIVED and disjoint rather
       than as either literal. */
    expect(SHELL_CODE).toMatch(/tab\.key === "history" && missedCount > 0/);
    // One derivation, two disjoint buckets — never two independent reduces that can drift.
    expect(SHELL_CODE).toMatch(/unreadTotal:\s*direct \+ groups/);
    expect(SHELL_CODE).toMatch(/t\.kind === "group"\) groups \+= n/);
    // Both tabs read the split, and NEITHER renders the whole-account total.
    const badgeSites = SHELL_CODE.match(/tab\.key === "messages" \? unreadDirect : unreadGroups/g) ?? [];
    expect(badgeSites.length).toBe(4); // 2 navs × (gate + value)
    expect(SHELL_CODE).not.toMatch(/tab\.key === "messages" && unreadTotal > 0/);
    // The accent badge goes through the utility, never an inline colour.
    expect((SHELL_CODE.match(/rbadge-accent/g) ?? []).length).toBe(2);
  });

  it("the missed badge stays destructive-red in BOTH themes", () => {
    // Red is the board's own choice for missed calls and it is readable on either
    // theme, so unlike the unread badge it does not need an accent variant.
    expect(SHELL_CODE).toMatch(/bg-destructive text-white/);
  });
});

describe("the owner's reclaimed bottom gap survives the redesign", () => {
  it("the bar's bottom padding is the real safe-area inset, never the board's 18px", () => {
    // v2.99.94, verbatim: "at the bottom after the bottom bar there's a still gap space
    // so I stick the bottom down because I need the space for the middle frame." The
    // board writes `padding:6px 4px 18px`; its 18px is a stand-in for the home
    // indicator, which we compute — re-adding it as a floor would undo that request on
    // every phone that has no indicator.
    expect(SHELL_CODE).toMatch(/paddingBottom: "env\(safe-area-inset-bottom\)"/);
    expect(SHELL_CODE).toMatch(/paddingTop: 6, paddingLeft: 4, paddingRight: 4/);
    expect(SHELL_CODE).not.toMatch(/paddingBottom:\s*(18|"18px")/);
  });
});

describe("/app/groups routes to the Messages page, narrowed", () => {
  it("the route exists and sits between messages and contacts", () => {
    const iMsg = APP_CODE.indexOf('path={"/app/messages"}');
    const iGrp = APP_CODE.indexOf('path={"/app/groups"}');
    const iCon = APP_CODE.indexOf('path={"/app/contacts"}');
    expect(iMsg).toBeGreaterThan(0);
    expect(iGrp).toBeGreaterThan(iMsg);
    expect(iCon).toBeGreaterThan(iGrp);
  });

  it("it renders the SAME component, with only=groups", () => {
    expect(APP_CODE).toMatch(/tab === "messages" \|\| tab === "groups" \? Messages/);
    expect(APP_CODE).toMatch(/only: "groups" as const/);
  });

  it("only the groups tab passes the prop — Messages stays byte-identical", () => {
    expect(APP_CODE).toMatch(/tab === "groups" \? \{ only: "groups" as const \} : \{\}/);
  });
});

describe("the narrowing is applied to the INPUT, not by picking categories", () => {
  it("scopedThreads is its own memo, and the scope PARTITIONS on kind", () => {
    /* v2.106.64 — the else-arm was `all`, i.e. Messages contained everything including
       groups. The owner asked for the split ("from the messages section, remove the group
       message and just keep it in the group section"), so both arms filter now — and the
       PROPERTY is that the two arms are complements, so no thread can be in both tabs or
       in neither. Pinned as the complement rather than as either literal. */
    const fn = MESSAGES_CODE.slice(
      MESSAGES_CODE.indexOf("const scopedThreads = useMemo("),
      MESSAGES_CODE.indexOf("const threadCategories = useMemo("),
    );
    expect(fn.length).toBeGreaterThan(60);
    expect(fn).toMatch(/only === "groups"/);
    expect(fn).toMatch(/all\.filter\(\(t\) => t\.kind === "group"\)/);
    expect(fn).toMatch(/all\.filter\(\(t\) => t\.kind !== "group"\)/);
    // The scope is still taken on the INPUT (the reason this memo exists at all), so a
    // kind-agnostic section like Archived cannot leak the other tab's threads.
    expect(fn).toMatch(/\[threads\.data, only\]/);
  });

  it("threadCategories reads scopedThreads, never threads.data directly", () => {
    // THE DEFECT: selecting the groups + archived CATEGORIES leaks archived DMs, because
    // `archived` is `t.archived` regardless of kind. Filtering the input is what makes
    // every section — Archived included — correctly group-only.
    const fn = arrowBodyAt(MESSAGES_CODE, "const threadCategories = useMemo(");
    expect(fn).toMatch(/const scoped = scopedThreads;/);
    expect(fn).not.toMatch(/threads\.data/);
    // …and it must not have grown a category filter of its own instead.
    expect(fn).toMatch(/return cats\.filter\(\(c\) => c\.rows\.length > 0\);/);
    expect(fn).not.toMatch(/cats\.filter\([^)]*key ===/);
  });

  it("the Archived section is still kind-agnostic, which is WHY the input is filtered", () => {
    // If this ever became `t.archived && t.kind === "group"` the input filter would look
    // redundant, and removing it would then silently break the empty state instead.
    const fn = arrowBodyAt(MESSAGES_CODE, "const threadCategories = useMemo(");
    expect(fn).toMatch(/rows: list\.filter\(\(t\) => t\.archived\)/);
  });
});

describe("the empty state and the search box ask the SCOPED list", () => {
  it("both read scopedThreads.length, not threads.data.length", () => {
    // `threads.data.length` counts DMs. On the Groups tab of an account with DMs and no
    // groups it reads non-zero, the page skips the empty state, and the
    // no-search-matches branch renders `No conversations match “”` — a message about a
    // search nobody ran.
    expect(MESSAGES_CODE).toMatch(/\{scopedThreads\.length > 0 && \(/);
    expect(MESSAGES_CODE).toMatch(/\) : scopedThreads\.length === 0 \? \(/);
    expect(MESSAGES_CODE).not.toMatch(/\(threads\.data\?\.length \?\? 0\)/);
  });

  it("the empty copy names GROUPS on the groups tab", () => {
    expect(MESSAGES_CODE).toMatch(/only === "groups" \? \(/);
    expect(MESSAGES_CODE).toMatch(/No groups yet\./);
    expect(MESSAGES_CODE).toMatch(/No messages yet\./);
  });

  it("the header title names the tab", () => {
    expect(MESSAGES_CODE).toMatch(/only === "groups" \? "Groups" : "Messages"/);
  });
});

describe("in-page navigation returns to the tab it came from", () => {
  it("useTabBasePath derives the path from the location", () => {
    const fn = fnAt(MESSAGES_CODE, "function useTabBasePath()");
    expect(fn).toMatch(/loc\.startsWith\("\/app\/groups"\) \? "\/app\/groups" : "\/app\/messages"/);
  });

  it("NO navigation hardcodes /app/messages any more", () => {
    // Hardcoding it moves the user to the Messages tab the instant they open a group, so
    // the bottom bar's active tab changes under a tap that only meant "open this
    // conversation". Seven call sites across three components.
    expect(MESSAGES_CODE).not.toMatch(/setLocation\((`|")\/app\/messages/);
    /* v2.106.65 — 4 became 3. Creating a GROUP is the one navigation that must NOT keep
       the current tab: the sheet's Direct/Group toggle is reachable from Messages, so a
       `basePath` there landed the user on `/app/messages?c=<groupId>` — a group
       conversation on a tab whose list, since v2.106.64, cannot contain it. The
       destination genuinely is a groups-tab object, so that ONE site names the tab and the
       rule is asserted as "every OTHER conversation navigation keeps its tab". */
    expect((MESSAGES_CODE.match(/setLocation\(`\$\{basePath\}\?c=/g) ?? []).length).toBe(3);
    expect((MESSAGES_CODE.match(/setLocation\(`\/app\/groups\?c=/g) ?? []).length).toBe(1);
    expect((MESSAGES_CODE.match(/setLocation\(basePath\)/g) ?? []).length).toBe(3);
  });

  it("all three components that navigate hold their own basePath", () => {
    expect((MESSAGES_CODE.match(/const basePath = useTabBasePath\(\);/g) ?? []).length).toBe(3);
  });
});

describe("the + opens the side the tab is about", () => {
  it("NewMessageDialog takes a defaultMode and the Groups tab passes group", () => {
    expect(MESSAGES_CODE).toMatch(/defaultMode = "dm"/);
    expect(MESSAGES_CODE).toMatch(/useState<"dm" \| "group">\(defaultMode\)/);
    expect(MESSAGES_CODE).toMatch(/defaultMode=\{only === "groups" \? "group" : "dm"\}/);
  });

  it("resetAll returns to that default, not a hardcoded dm", () => {
    // Otherwise closing the sheet on the Groups tab silently leaves it on the DM side
    // for the next open.
    const fn = fnAt(MESSAGES_CODE, "function resetAll()");
    expect(fn).toMatch(/setMode\(defaultMode\);/);
    expect(fn).not.toMatch(/setMode\("dm"\)/);
  });

  it("both modes stay reachable — the default is a landing side, not a removal", () => {
    expect(MESSAGES_CODE).toMatch(/onClick=\{\(\) => setMode\("dm"\)\}/);
    expect(MESSAGES_CODE).toMatch(/onClick=\{\(\) => setMode\("group"\)\}/);
  });
});
