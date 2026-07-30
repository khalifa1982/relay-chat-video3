/* ──────────────────────────────────────────────────────────────────────────
 * BOARD 5c — the call-quality readout's HUE, and the three constraints that
 * make the readout safe to have at all.
 *
 * WHAT THIS FILE IS FOR. The readout itself shipped in v2.105.21 and its
 * geometry is already pinned in `callStats.test.ts`. What 5c adds is the
 * board's accent-for-good / warning-for-bad state, and the ONE way that can
 * fail silently is a CSS rule for a class nobody sets (or a class nobody
 * styles) — both render exactly nothing with every existing test green. So the
 * load-bearing assertion here is a CROSS-FILE one: every class string the
 * writer can assign must be defined by a rule, and every state rule's class
 * must be reachable from the writer.
 *
 * The tone MAPPING is driven behaviourally rather than pinned, because the
 * property that matters is not "the function exists" — it is that a summary
 * with NO measured data does not come out accent. `callStatsVerdict` answers
 * "ok" for an empty report on purpose (absence is not evidence of a bad call),
 * so a source pin cannot tell you whether the pill would light up during a
 * ring. Only driving it can.
 * ────────────────────────────────────────────────────────────────────────── */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { summarizeStats, callQualityTone, callStatsVerdict, type StatEntry } from "./callStats";

const R = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", "..", "..", p), "utf8");
const ASSETS_RAW = R("client/src/lib/relayAssets.ts");
const ASSETS = codeOnly(ASSETS_RAW);
const CLIENT = codeOnly(R("client/src/lib/relayClient.ts"));

/** A succeeded candidate pair plus its two candidate ends (mirrors callStats.test.ts). */
function pair(localType: string, remoteType: string, rttSec: number | null): StatEntry[] {
  return [
    {
      id: "cp1",
      type: "candidate-pair",
      state: "succeeded",
      nominated: true,
      localCandidateId: "lc",
      remoteCandidateId: "rc",
      ...(rttSec === null ? {} : { currentRoundTripTime: rttSec }),
    },
    { id: "lc", type: "local-candidate", candidateType: localType },
    { id: "rc", type: "remote-candidate", candidateType: remoteType },
  ];
}

/**
 * Every rule in the stylesheet whose selector mentions `.call-qual`, as
 * `{selector, body}`.
 *
 * A SWEEP rather than a list, deliberately: the pre-existing backdrop-filter pin
 * read only the FIRST rule (`css.slice(0, css.indexOf("}"))`), so the state rules
 * this frame adds — and any rule added later — could have carried a blur with that
 * test perfectly green. Comments are stripped first so a rule's own prose about
 * `backdrop-filter` cannot satisfy or break the sweep.
 */
function callQualRules(): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]*\.call-qual[^{}]*)\{([^}]*)\}/g;
  for (let m = re.exec(ASSETS); m; m = re.exec(ASSETS)) {
    out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

describe("board 5c — the readout's rules are swept, not listed", () => {
  it("the sweep finds every rule and the comment strip did not eat them", () => {
    // A vacuous sweep is worse than none: if `codeOnly` swallowed the CSS the
    // forbidden-pattern assertions below would all pass on an empty string.
    expect(ASSETS).toContain(".relay-root .call-qual{");
    const rules = callQualRules();
    // base + is-good + is-warn + the pre-connect hide.
    expect(rules.length).toBeGreaterThanOrEqual(4);
    for (const r of rules) expect(r.body.length).toBeGreaterThan(0);
  });

  it("NO rule adds a backdrop-filter over live video", () => {
    // v2.99.84 measured 36 such layers over a live call grid and removed all of
    // them on phones — nothing behind a blur can be cached when the backdrop
    // changes every frame, and this pill sits directly over the video.
    for (const r of callQualRules()) {
      expect(r.body, `rule ${r.selector}`).not.toMatch(/backdrop-filter/);
    }
  });

  it("NO rule gives it a z-index, so it can never paint over the host panel", () => {
    // It is pointer-events:none, so lifting it above the z-index:35 overlays (host
    // panel, add-pad, tile menu, filter dock) would float a decoration over
    // controls somebody is trying to use.
    for (const r of callQualRules()) {
      expect(r.body, `rule ${r.selector}`).not.toMatch(/z-index/);
    }
  });

  it("NO rule animates it, and no keyframe targets it", () => {
    // It re-renders every 2s over live video; motion there is the exact cost class
    // v2.99.84 removed, and a box-shadow keyframe is forbidden outright by a
    // standing guard. The hue change is static.
    for (const r of callQualRules()) {
      expect(r.body, `rule ${r.selector}`).not.toMatch(/\banimation\b/);
      expect(r.body, `rule ${r.selector}`).not.toMatch(/\btransition\b/);
    }
  });

  it("the base rule still cannot break the control bar it sits above", () => {
    // Restated here because the state rules are new neighbours of these three:
    // out of flow so it can never become a flex ITEM of `.controls` and push a
    // chip off a 320px screen, and non-interactive so it cannot swallow a tap
    // meant for hang-up.
    // The base rule is the UNQUALIFIED one: it ends at the class with no state
    // suffix and no `#id` screen qualifier. My first cut was just
    // `/\.call-qual$/`, which the pre-connect rule (`#call.pre-connect
    // .call-qual`) also satisfies — and that rule is DECLARED EARLIER in the
    // stylesheet, so `find` returned `display:none` and the assertion failed on
    // correct code.
    const base = callQualRules().find(
      (r) => r.selector.trim().endsWith(".call-qual") && !r.selector.includes("#"),
    );
    expect(base, "the un-suffixed base rule must exist").toBeTruthy();
    expect(base!.body).toMatch(/position:absolute/);
    expect(base!.body).toMatch(/bottom:100%/);
    expect(base!.body).toMatch(/pointer-events:none/);
  });
});

describe("board 5c — the readout is absent on the pre-connect dial screen", () => {
  it("is hidden while an outgoing dial is in flight", () => {
    // A SHIPPED DEFECT this frame fixes: `#call.pre-connect .ctrl-bar .ctrl` hides
    // every control, and the readout is neither a `.ctrl` nor inside `.ctrl-bar`.
    // Stats is remembered in localStorage and the collector runs from dial time,
    // so anybody who had ever switched it on saw a "measuring…" pill above End
    // Call for the whole ring — on the one screen board 3a says shows End Call
    // only, reporting a number that cannot exist before a candidate pair does.
    const rule = callQualRules().find((r) => /pre-connect/.test(r.selector));
    expect(rule, "a pre-connect rule for .call-qual must exist").toBeTruthy();
    expect(rule!.selector).toMatch(/#call\.pre-connect/);
    expect(rule!.body.replace(/\s+/g, "")).toBe("display:none");
  });
});

describe("board 5c — every class the writer sets is styled, and vice versa", () => {
  /** The complete class-string literals `renderCallQuality` can assign. */
  function writerClassLiterals(): string[] {
    const at = CLIENT.indexOf("function renderCallQuality(");
    expect(at, "renderCallQuality must exist").toBeGreaterThan(-1);
    const end = CLIENT.indexOf("\n  }", at);
    expect(end).toBeGreaterThan(at);
    const body = CLIENT.slice(at, end);
    const lits = body.match(/"call-qual[^"]*"/g) ?? [];
    return lits.map((s) => s.slice(1, -1));
  }

  it("assigns exactly three complete literal class strings — never a composed one", () => {
    // A runtime-composed class name is invisible to every grep and to the build,
    // and a class nobody defines renders unstyled with all tests green.
    const lits = writerClassLiterals();
    expect(new Set(lits)).toEqual(new Set(["call-qual", "call-qual is-good", "call-qual is-warn"]));
    const at = CLIENT.indexOf("function renderCallQuality(");
    const body = CLIENT.slice(at, CLIENT.indexOf("\n  }", at));
    // No template literal and no concatenation building the class name.
    expect(body).not.toMatch(/className\s*=\s*`/);
    expect(body).not.toMatch(/className\s*=\s*[^;]*\+/);
  });

  it("CROSS-FILE: every one of those classes has a rule in RELAY_CSS", () => {
    // This is the pin that catches the half-shipped shape in BOTH directions: a
    // hue rule for a class nobody sets, or a class set with no rule behind it.
    const selectors = callQualRules().map((r) => r.selector);
    for (const lit of writerClassLiterals()) {
      const extra = lit.split(/\s+/).filter((c) => c !== "call-qual");
      const wanted = extra.length ? `.call-qual.${extra.join(".")}` : ".call-qual";
      expect(
        selectors.some((s) => s.includes(wanted)),
        `no rule defines ${wanted} (writer assigns "${lit}")`,
      ).toBe(true);
    }
  });

  it("CROSS-FILE: every state class a rule defines is reachable from the writer", () => {
    const lits = writerClassLiterals().join(" ");
    for (const r of callQualRules()) {
      const state = /\.call-qual((?:\.[a-z][\w-]*)+)/.exec(r.selector);
      if (!state) continue;
      for (const cls of state[1].split(".").filter(Boolean)) {
        expect(lits, `.call-qual.${cls} is styled but nothing sets it`).toContain(cls);
      }
    }
  });

  it("writes its text as textContent, never innerHTML", () => {
    const at = CLIENT.indexOf("function renderCallQuality(");
    const body = CLIENT.slice(at, CLIENT.indexOf("\n  }", at));
    expect(body).toMatch(/\.textContent\s*=/);
    expect(body).not.toMatch(/innerHTML/);
  });

  it("the tone defaults to neutral, so a caller with nothing measured cannot claim good", () => {
    const at = CLIENT.indexOf("function renderCallQuality(");
    const body = CLIENT.slice(at, CLIENT.indexOf("\n  }", at));
    expect(body).toMatch(/tone[^=]*=\s*"neutral"/);
  });

  it("the collector passes the derived tone rather than re-deriving a hue", () => {
    const at = CLIENT.indexOf("async function collectCallQuality()");
    expect(at).toBeGreaterThan(-1);
    const body = CLIENT.slice(at, CLIENT.indexOf("\n  function toggleCallStats", at));
    expect(body).toMatch(/callQualityTone\(stats\)/);
    // The hue decision lives in exactly one place — the pure helper — so it cannot
    // come to disagree with the glyph beside it.
    expect(body).not.toMatch(/is-good|is-warn/);
  });

  it("the readout still costs nothing while switched off, and cannot disturb a call", () => {
    const at = CLIENT.indexOf("async function collectCallQuality()");
    const body = CLIENT.slice(at, CLIENT.indexOf("\n  function toggleCallStats", at));
    expect(body.slice(0, 200)).toMatch(/if \(!statsShown \|\| !inCall\) return;/);
    expect(body).toMatch(/catch \{ \/\* the readout is decoration|catch \{/);
  });

  it("the element keeps its LTR isolation", () => {
    // It is all numbers and units, which an RTL locale would otherwise reorder.
    expect(ASSETS_RAW).toMatch(/id="callQual"[^>]*dir="ltr"/);
  });
});

describe("board 5c — the colour vocabulary", () => {
  const rule = (cls: string) => {
    const r = callQualRules().find((x) => x.selector.includes(`.call-qual.${cls}`));
    expect(r, `.call-qual.${cls} must have a rule`).toBeTruthy();
    return r!.body;
  };

  it("the good state is the CYCLING ACCENT, never the presence green", () => {
    // Green means ONLINE in this app and nothing else — it is what every presence
    // LED is drawn with, which is why v2.99.86, v2.106.9, v2.106.11, v2.106.12 and
    // v2.106.18 each had to move something off it. A quality readout is not a
    // presence statement.
    const good = rule("is-good");
    expect(good).toMatch(/color:var\(--accent\)/);
    expect(good).toMatch(/rgba\(var\(--accent-rgb\)/);
    expect(good).not.toMatch(/--relay-online/);
    expect(good).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("the bad state is the call surface's own warning hue, not gold and not danger", () => {
    // GOLD (#e8c94a / #facc15) means admin / owner / locked, and #hostBtn puts
    // moderator gold on a chip 8px below this pill. RED (--danger) means MUTED MIC
    // on this very bar, so a red pill above a red mic chip would read as a mic
    // fault — and it would over-state a relayed call, which works fine.
    const warn = rule("is-warn");
    expect(warn).toMatch(/color:var\(--warn\)/);
    expect(warn).toMatch(/rgba\(var\(--warn-rgb\)/);
    expect(warn).not.toMatch(/e8c94a|facc15/i);
    expect(warn).not.toMatch(/--danger/);
    expect(warn).not.toMatch(/--relay-online/);
  });

  it("neither state fills the pill or re-blurs it — it stays a readout", () => {
    // An accent FILL would make it read as a second `.ctrl.on` chip sitting above
    // the control bar. The opaque background is declared once, on the base rule.
    for (const cls of ["is-good", "is-warn"]) {
      expect(rule(cls)).not.toMatch(/background/);
    }
  });

  it("reads the --accent* tokens rather than var(--rb, …) directly", () => {
    // `var(--rb, var(--rb))` is a custom-property CYCLE: it resolves to the
    // guaranteed-invalid value and the browser DROPS the declaration, so the pill
    // would render with NO colour at all (the v2.106.7 trap). The --accent tokens
    // already carry literal fallbacks at their declaration, so reading them is
    // both correct and cycle-proof.
    for (const cls of ["is-good", "is-warn"]) {
      expect(rule(cls)).not.toMatch(/var\(--rb/);
    }
  });

  it("--warn-rgb is the same colour as --warn", () => {
    // Two spellings of one hue is how they come to disagree. Compared
    // NUMERICALLY rather than as text, because that is the actual property.
    const hex = /--warn:\s*#([0-9a-f]{6})/i.exec(ASSETS);
    const rgb = /--warn-rgb:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(ASSETS);
    expect(hex, "--warn must be declared as a 6-digit hex").toBeTruthy();
    expect(rgb, "--warn-rgb must be declared").toBeTruthy();
    const fromHex = [0, 2, 4].map((i) => parseInt(hex![1].slice(i, i + 2), 16));
    expect([+rgb![1], +rgb![2], +rgb![3]]).toEqual(fromHex);
  });
});

describe("board 5c — the tone mapping, driven", () => {
  it("a summary with NO measured data is never the accent", () => {
    // THE assertion this frame turns on. `callStatsVerdict` answers "ok" for an
    // empty report deliberately — unknown values must never read as poor — so
    // "ok" means NOT FLAGGED rather than MEASURED HEALTHY. A bright pill asserting
    // a good call on zero evidence would be a confidently wrong number, which is
    // exactly what this readout exists to stop.
    const { stats } = summarizeStats([], { nowMs: 0 });
    expect(callStatsVerdict(stats)).toBe("ok"); // the premise, stated
    expect(stats.path).toBe("unknown");
    expect(callQualityTone(stats)).toBe("neutral");
  });

  it("a real healthy reading IS the accent", () => {
    const { stats } = summarizeStats([pair("host", "host", 0.04)], { nowMs: 0 });
    expect(callQualityTone(stats)).toBe("good");
  });

  it("a relayed call warns whatever the numbers say", () => {
    const { stats } = summarizeStats([pair("relay", "host", 0.01)], { nowMs: 0 });
    expect(callQualityTone(stats)).toBe("warn");
  });

  it("high RTT, loss or jitter each warn", () => {
    const base = summarizeStats([pair("host", "host", 0.05)], { nowMs: 0 }).stats;
    expect(callQualityTone({ ...base, rttMs: 400 })).toBe("warn");
    expect(callQualityTone({ ...base, lossPct: 8 })).toBe("warn");
    expect(callQualityTone({ ...base, jitterMs: 90 })).toBe("warn");
  });

  it("a measured path with no figures yet does not warn — absence is not evidence", () => {
    const base = summarizeStats([pair("host", "host", null)], { nowMs: 0 }).stats;
    expect(base.path).toBe("direct");
    expect(base.rttMs).toBeNull();
    expect(callQualityTone(base)).not.toBe("warn");
  });

  it("reads the shared verdict rather than restating its thresholds", () => {
    // The thresholds must live in exactly one place, or the hue and the ⚠/▲ glyph
    // beside it can come to disagree about the same reading.
    const src = codeOnly(R("client/src/lib/callStats.ts"));
    const at = src.indexOf("export function callQualityTone(");
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf("\n}", at));
    expect(body).toMatch(/callStatsVerdict\(/);
    expect(body).not.toMatch(/300|\bjitterMs\b|\blossPct\b/);
  });
});
