/**
 * design_handoff_relay_app — FRAME 1h, IN-CALL VIDEO CHROME.
 *
 * MISSING-FRAMES.md records 1h as "partial — bar, accent and tiles done; the frame's own
 * chrome is not", and lists exactly three things: the top chip (name + tier badge + mono
 * timer + lock), the signal-bars chip, and the self view as a 92x126 PiP labelled YOU.
 * The bar, the accent and the tiles are NOT rebuilt here.
 *
 * This file reads `relayAssets.ts` as TEXT and imports nothing from it, which is deliberate
 * and load-bearing — see the backtick guard at the bottom. A backtick inside a CSS comment
 * terminates the template literal, and the PARSED value can never contain one, so an
 * assertion against the import could not report the very break it exists to catch.
 *
 * THREE THINGS ARE DELIBERATELY NOT WHAT THE FRAME DRAWS, each because the frame is a mock
 * and the app has a fact the mock does not:
 *
 *   1. THE TIMER STAYS JetBrains Mono. The frame specifies IBM Plex Mono; `client/index.html`
 *      loads JetBrains Mono and Space Mono and does NOT load IBM Plex, so naming it would
 *      silently fall through to the system mono. (The same is already true of `.call-qual`,
 *      which asks for IBM Plex today and does not get it — reported, not changed here,
 *      because that value belongs to frame 5c.)
 *   2. THE SIGNAL CHIP IS HIDDEN UNTIL THERE IS A READING. The frame draws 3 of 4 bars lit
 *      as static chrome. Those bars would be a fabricated measurement: the engine only
 *      computes quality while Stats is on. So the chip is driven by the SAME tone classes
 *      the 5c readout uses and renders nothing without them — the rule
 *      `.call-qual.is-good` already follows ("a bright pill asserting a healthy call on
 *      zero evidence would be worse than a plain one").
 *   3. THE HEAD STAYS IN FLOW. Full-bleed video under the chips needs `#call` to become a
 *      positioned ancestor, and `.filter-dock` is a direct child of `#call` that anchors to
 *      `.relay-root` today. Re-anchoring a shipped surface is not this frame's business.
 *
 * THE SLOTS ARE WRITTEN NOW (v2.107.1). This header used to end by recording that nothing
 * filled `#callWho` / `#callWhoRole` — which meant the chip shipped with its markup and CSS
 * complete and rendered exactly the status + timer it always had, so the frame's headline
 * ("who am I talking to") was invisible while every source pin passed. That is a class of
 * gap no assertion about `relayAssets.ts` can catch, because the defect was the ABSENCE of a
 * write in a different file; the pins below now cover the write itself.
 *
 * The collapse pins STAY, because the empty state is still reachable and still correct: a
 * conference has no single subject, so the chip must fall back to status-only rather than
 * name one of N people.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(process.cwd(), "client/src/lib/relayAssets.ts"), "utf8");
const CLIENT = readFileSync(resolve(process.cwd(), "client/src/lib/relayClient.ts"), "utf8");

/** A named template literal's raw interior, straight out of the source text. */
function literal(name: string): string {
  const at = SRC.indexOf(`export const ${name}`);
  expect(at, name).toBeGreaterThan(0);
  const open = SRC.indexOf("`", at);
  const close = SRC.indexOf("\n`;", open);
  expect(close, `${name}: unterminated`).toBeGreaterThan(open);
  return SRC.slice(open + 1, close);
}
const MARKUP = literal("RELAY_MARKUP");
const CSS = literal("RELAY_CSS");
/** Comments stripped — this repo has matched its own prose 18+ times. */
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const MARKUP_CODE = MARKUP.replace(/<!--[\s\S]*?-->/g, "");

/** The 1h block: everything from its banner to the end of the stylesheet. */
const BLOCK = (() => {
  const at = CSS_CODE.indexOf(".relay-root .call-head{padding:10px 16px");
  expect(at, "the 1h block must exist").toBeGreaterThan(0);
  return CSS_CODE.slice(at);
})();

/**
 * A named function's own body, bounded by its own closing brace.
 *
 * THE BODY BRACE IS THE ONE REACHED WITH PARENS CLOSED, and that is not pedantry — this
 * repo has hit the same trap five times (v2.105.9, v2.105.27, v2.106.4, v2.106.48,
 * v2.106.59). Taking "the first `{` after the name" gets you the DESTRUCTURED PARAMETER
 * for `function f({ a, b })` and the RETURN TYPE for `function f(): Promise<{…}>`, so the
 * assertions then read the signature and pass for a reason that has nothing to do with
 * the code they name.
 */
function fnBody(src: string, anchor: string): string {
  const at = src.indexOf(anchor);
  expect(at, `no such function: ${anchor}`).toBeGreaterThan(-1);
  // Seed the depths FROM the anchor, which already contains its own open paren.
  let paren = 0;
  let i = at;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "{" && paren === 0) break;
  }
  expect(i, `${anchor}: no body brace`).toBeLessThan(src.length);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(i, j + 1);
  }
  throw new Error(`${anchor}: unterminated body`);
}

/** A rule's own body, bounded by its own closing brace. */
function rule(sel: string, from: string = CSS_CODE): string {
  const at = from.indexOf(sel);
  expect(at, `no such rule: ${sel}`).toBeGreaterThan(-1);
  const open = from.indexOf("{", at);
  return from.slice(open + 1, from.indexOf("}", open));
}

/** The `.call-head` element's own markup, bounded by its own closing div. */
const HEAD = (() => {
  const at = MARKUP_CODE.indexOf(`<div class="call-head">`);
  expect(at, "the call head must exist").toBeGreaterThan(0);
  const end = MARKUP_CODE.indexOf("</div>\n    </div>", at);
  expect(end, "the call head must close").toBeGreaterThan(at);
  return MARKUP_CODE.slice(at, end);
})();

/* ── the top chip ─────────────────────────────────────────────────────────────── */

describe("board 1h — the top chip", () => {
  it("carries all four things the frame lists, in the frame's order", () => {
    /* The PROPERTY is that one pill holds who / badge / duration / encrypted, not the
       exact spelling of any of them — so this asserts the ORDER of the four carriers
       rather than freezing their markup. */
    const order = ["hchip-who", "hchip-role", `id="timer"`, "hchip-lock"].map((s) => HEAD.indexOf(s));
    for (let i = 0; i < order.length; i++) expect(order[i], String(i)).toBeGreaterThan(-1);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  });

  it("wears the frame's own pill material and geometry", () => {
    const ct = rule(".relay-root .call-head .ct{", BLOCK);
    expect(ct).toContain("border-radius:16px");
    expect(ct).toContain("padding:7px 13px");
    expect(ct).toContain("gap:9px");
    expect(ct).toContain("background:rgba(10,14,16,.92)");
    expect(ct).toContain("border:1px solid rgba(255,255,255,.12)");
  });

  it("the head itself stops being a bar — no divider, no fill", () => {
    const head = rule(".relay-root .call-head{padding:10px 16px", BLOCK);
    expect(head).toContain("border-bottom:none");
    expect(head).toContain("background:none");
  });

  it("the timer is mono, accent and CANNOT shrink", () => {
    /* A truncated duration is a WRONG number rather than a shortened one, which is why
       this is flex:0 0 auto rather than merely styled. */
    const t = rule(".relay-root .call-head .ct .timer{", BLOCK);
    expect(t).toContain("flex:0 0 auto");
    expect(t).toContain("color:var(--accent)");
    expect(t).toContain("font-variant-numeric:tabular-nums");
  });

  it("names no font the app does not load", () => {
    /* THE FINDING THAT CHANGED THE VALUE: index.html loads JetBrains Mono and Space Mono
       and no IBM Plex, so the frame's face would silently fall through. Asserted against
       index.html rather than against a literal, so it cannot go stale if the link changes. */
    const html = readFileSync(resolve(process.cwd(), "client/index.html"), "utf8");
    expect(html).toContain("JetBrains+Mono");
    expect(html).not.toContain("IBM+Plex+Mono");
    expect(BLOCK).not.toContain("IBM Plex Mono");
    // The timer inherits .call-head .timer's JetBrains stack; the 1h block must not
    // re-declare a family at all, or the two could come to disagree.
    expect(rule(".relay-root .call-head .ct .timer{", BLOCK)).not.toContain("font-family");
  });

  it("the lock is unconditional, because DTLS-SRTP is a property of the transport", () => {
    /* It is the one glyph here that needs no engine — so it must NOT be hidden behind a
       state class, and it must carry a name for a screen reader (it is an image with
       meaning, not decoration). */
    const lock = HEAD.slice(HEAD.indexOf("hchip-lock"));
    expect(lock).toContain(`aria-label="Encrypted call"`);
    expect(lock).not.toContain(`style="display:none"`);
    expect(rule(".relay-root .call-head .hchip-lock{", BLOCK)).toContain("color:var(--accent)");
  });

  it("but does NOT claim encryption before there is a transport to encrypt", () => {
    /* DTLS-SRTP is a property of an ESTABLISHED transport. During pre-connect the call is
       still being placed, so a lock there asserts a guarantee that has not been made —
       and the connection sequence already has its own Encryption step for that phase. */
    expect(BLOCK).toContain(".relay-root #call.pre-connect .call-head .hchip-lock{display:none}");
    expect(MARKUP_CODE).toContain(`data-i="1"`);
  });

  it("the name and badge slots COLLAPSE while empty, so today's pill is unchanged", () => {
    /* Nothing writes them yet. The degraded state has to be the correct state, or this
       ships two blank gaps into the chip on every call. */
    expect(CSS_CODE).toContain(".relay-root .call-head .hchip-who:empty{display:none}");
    expect(HEAD).toMatch(/id="callWhoRole"[^>]*style="display:none"/);
    expect(HEAD).toMatch(/<span class="hchip-who" id="callWho"><\/span>/);
  });

  it("the name may truncate and the badge may not", () => {
    /* v2.103.3's gutter rule: the thing that must stay legible is the one that does not
       shrink. A half-drawn tier seal says nothing; a shortened name still identifies. */
    const who = rule(".relay-root .call-head .hchip-who{", BLOCK);
    expect(who).toContain("text-overflow:ellipsis");
    expect(who).toContain("min-width:0");
    expect(rule(".relay-root .call-head .hchip-role{", BLOCK)).toContain("flex:0 0 auto");
  });

  it("does NOT take the reconnecting colour away from the status label", () => {
    /* .ct.st-reconnecting recolours the whole chip's text and predates this frame. Giving
       #callRoomLbl its own colour would silently kill that signal, so the 1h block must
       set no colour on .ct and none on the status label. */
    expect(rule(".relay-root .call-head .ct{", BLOCK)).not.toContain("color:");
    expect(BLOCK).not.toContain("#callRoomLbl");
    expect(CSS_CODE).toContain(".relay-root .call-head .ct.st-reconnecting{color:#ff7a7a}");
  });
});

/* ── the engine contract ──────────────────────────────────────────────────────── */

describe("regrouping the chip did not move anything the engine reaches for", () => {
  it("#callRoomLbl and #timer keep their ids and .ct keeps its place", () => {
    /* setCallStatus() finds the label and the timer BY ID and the status classes by
       querying ".call-head .ct". All three still resolve, which is the whole reason the
       regrouping is safe without touching relayClient.ts. */
    expect(CLIENT).toContain(`$("callRoomLbl")`);
    expect(CLIENT).toContain(`$("timer")`);
    expect(CLIENT).toContain(`.call-head .ct`);
    expect(MARKUP_CODE).toContain(`id="callRoomLbl"`);
    expect(MARKUP_CODE).toContain(`id="timer"`);
    expect(HEAD.indexOf(`class="ct"`)).toBeGreaterThan(-1);
    // The timer moved INTO .ct, so it must still be inside the head — and inside .ct.
    const ctEnd = HEAD.indexOf("</div>");
    expect(HEAD.indexOf(`id="timer"`)).toBeLessThan(ctEnd);
  });

  it("every id this frame adds is unique in the markup", () => {
    for (const id of ["callWho", "callWhoRole", "callSignal"]) {
      const n = MARKUP_CODE.split(`id="${id}"`).length - 1;
      expect(n, id).toBe(1);
    }
  });
});

/* ── the signal-bars chip ─────────────────────────────────────────────────────── */

describe("board 1h — the signal chip reports a measurement, never decoration", () => {
  it("is hidden by default", () => {
    expect(rule(".relay-root .call-head .sig{", BLOCK)).toContain("display:none");
  });

  it("is revealed ONLY by the engine's own quality verdict", () => {
    /* ONE measurement, two renderings: the tone classes are written by renderCallQuality
       from callQualityTone, so this chip and the 5c readout cannot come to disagree about
       the call. A rule that showed the chip on anything else would be inventing a signal. */
    const reveals = BLOCK.split("\n").filter((l) => /\.sig\{display:flex\}/.test(l));
    expect(reveals.length, "the chip must have exactly two reveal rules").toBe(2);
    for (const r of reveals) expect(r).toMatch(/:has\(\.call-qual\.is-(good|warn)\)/);
    expect(CLIENT).toContain(`"call-qual is-good"`);
    expect(CLIENT).toContain(`"call-qual is-warn"`);
  });

  it("cannot report the PREVIOUS call's quality while a new one is ringing", () => {
    /* The tone class survives the end of a call — .pre-connect hides the readout with
       display:none but never clears its className. Without this guard the chip would carry
       a stale verdict through the whole of the next dial. */
    for (const r of BLOCK.split("\n").filter((l) => l.includes(":has(.call-qual"))) {
      expect(r).toContain("#call:not(.pre-connect)");
    }
    expect(CSS_CODE).toContain(".relay-root #call.pre-connect .call-qual{display:none}");
  });

  it("a good call fills more bars than a degraded one, and warn uses the warn hue", () => {
    /* The frame draws a fixed 3-of-4. Mapping the fill to the real verdict is the honest
       version of the same glance: two tones, two fills. */
    const good = BLOCK.split("\n").find((l) => /is-good.*\.sig i\{/.test(l)) ?? "";
    const warn = BLOCK.split("\n").find((l) => /is-warn.*\.sig i/.test(l)) ?? "";
    expect(good).toContain("background:var(--accent)");
    expect(good).not.toContain("nth-child");
    expect(warn).toContain("background:var(--warn)");
    expect(warn).toContain("nth-child(-n+2)");
  });

  it("keeps the frame's four bars at the frame's four heights", () => {
    const heights = [1, 2, 3, 4].map((n) => rule(`.relay-root .call-head .sig i:nth-child(${n}){`, BLOCK));
    expect(heights).toEqual(["height:5px", "height:8px", "height:11px", "height:14px"]);
    expect((MARKUP_CODE.match(/<span class="sig"[^>]*>(<i><\/i>){4}<\/span>/) ?? [])[0]).toBeTruthy();
  });

  it("an engine without :has() degrades to NO claim rather than a false one", () => {
    /* An unknown pseudo-class invalidates the whole selector, so the rule is dropped and
       the chip keeps its default display:none. That only holds while the reveal rules are
       their OWN rules — put them in a comma-list with the base rule and the base rule dies
       with them, which would leave four grey bars asserting nothing on every call. */
    const base = BLOCK.slice(BLOCK.indexOf(".relay-root .call-head .sig{"));
    expect(base.slice(0, base.indexOf("{"))).not.toContain(",");
    expect(base.slice(0, base.indexOf("{"))).not.toContain(":has(");
  });
});

/* ── the self PiP ─────────────────────────────────────────────────────────────── */

/** Every 1h rule that scopes itself to the two-tile default grid. */
const PIP_RULES = BLOCK.split("\n").filter((l) => l.includes("#videoGrid:not(.spotlight)"));

describe("board 1h — the self PiP", () => {
  it("is the frame's 92x126 card with the frame's border and shadow", () => {
    const pip = rule("> .relay-tile.you{", BLOCK);
    expect(pip).toContain("width:92px");
    expect(pip).toContain("height:126px");
    expect(pip).toContain("border-radius:16px");
    expect(pip).toContain("border:1.5px solid rgba(255,255,255,.25)");
    expect(pip).toContain("box-shadow:0 12px 34px rgba(0,0,0,.5)");
    expect(pip).toContain("justify-self:end");
    expect(pip).toContain("align-self:end");
  });

  it("applies to EXACTLY the 1:1 grid and to no other layout", () => {
    /* Spotlight, compact and screen-max keep whatever layoutGrid() computed. Every rule
       here carries the same guard, so a later edit cannot widen one of them by accident. */
    expect(PIP_RULES.length).toBeGreaterThanOrEqual(5);
    for (const r of PIP_RULES) {
      expect(r).toContain(":not(.spotlight)");
      expect(r).toContain(":not(.compact)");
      expect(r).toContain(":has(> .relay-tile:nth-child(2))");
      expect(r).toContain(":not(:has(> .relay-tile:nth-child(3)))");
    }
    // …and those really are the classes layoutGrid() toggles.
    expect(CLIENT).toContain(`g.classList.add("spotlight")`);
    expect(CLIENT).toContain(`g.classList.add("compact")`);
  });

  it("stacks with grid-area and never escapes the grid with position:absolute", () => {
    /* .grid sets no position, so an absolutely-positioned tile would resolve against
       .relay-root and could then sit on top of the control bar. A grid item cannot leave
       its container. */
    expect(rule("> .relay-tile{", BLOCK)).toContain("grid-area:1/1");
    for (const r of PIP_RULES) expect(r).not.toContain("position:absolute");
    expect(BLOCK).not.toContain("position:absolute");
  });

  it("the !important is confined to the two template properties layoutGrid writes inline", () => {
    /* layoutGrid() writes gridTemplateColumns/Rows INLINE, and only !important outranks
       that. Per-tile placement needs none, because the default branch already resets
       gridColumn/gridRow to "" — so any further !important here would be fighting
       something that is not there. */
    const bangs = BLOCK.match(/[a-z-]+:[^;{}]*!important/g) ?? [];
    expect(bangs.sort()).toEqual(["grid-template-columns:1fr!important", "grid-template-rows:1fr!important"]);
    expect(CLIENT).toContain("g.style.gridTemplateColumns");
    expect(CLIENT).toContain(`t.style.gridColumn = ""`);
  });

  it("labels the PiP from the tile's OWN band rather than adding a second label", () => {
    /* Two labels is how two labels come to disagree. The band already carries whatever
       the engine put there; this only retreats it to the frame's corner type. */
    const nm = rule("> .relay-tile.you .nm{", BLOCK);
    expect(nm).toContain("font-size:8.5px");
    expect(nm).toContain("font-weight:700");
    expect(nm).toContain("letter-spacing:.06em");
    expect(nm).toContain("left:6px");
    expect(nm).toContain("bottom:5px");
    expect(nm).toContain("text-transform:uppercase");
    // Bare letters over live video need the shadow the frame's dark gradient gave it.
    expect(nm).toContain("text-shadow");
    // No second "YOU" anywhere in the markup.
    expect(MARKUP_CODE).not.toMatch(/>\s*YOU\s*</);
    expect(CLIENT).toContain(`tileContentHTML("You"`);
  });

  it("drops the digits and the info chip at 92px, exactly as a spotlight thumb does", () => {
    /* .nm is nowrap + overflow:hidden, so keeping the six digits would eat the name. This
       is the established treatment for a small tile, not a new rule — and it costs no
       capability, since both render on every other layout and on the remote tile. */
    /* Matched with a boundary, not `includes`: a mutation renaming the class to
       `.nm-pinX` SURVIVED an includes() check, because the real name is a substring of
       the broken one. Pinning a substring is not pinning the selector. */
    const drop = PIP_RULES.filter((l) => /\.nm \.nm-pin(?![\w-])/.test(l) || /\.tile-info(?![\w-])/.test(l));
    expect(drop.length).toBe(2);
    // …and they really do resolve to a hide.
    expect(BLOCK.slice(BLOCK.indexOf(drop[0]))).toMatch(/^[^{]*\{\s*display:none\}/m);
    expect(CSS_CODE).toContain(".relay-root #videoGrid.compact .relay-tile .nm .nm-pin{display:none}");
  });

  it("takes nothing away that the self tile could do before", () => {
    /* The self tile has no menu, no maximize and no add-pill to lose — tileContentHTML is
       called with no pin for self, which is what withholds them. Its mirroring and its
       tap-to-spotlight both survive, so the PiP is a move rather than a reduction. */
    /* NOTE: `[^)]*` cannot reach the pin here — the argument list contains
       `detectDeviceType()`, whose own paren ends the class. Read the call's own LINE
       instead; the 4th argument is the pin and it is `undefined`. */
    const selfCall = CLIENT.slice(CLIENT.indexOf(`tileContentHTML("You"`));
    expect(selfCall.slice(0, selfCall.indexOf("\n"))).toContain("undefined");
    expect(CSS_CODE).toContain(".relay-root .relay-tile{cursor:pointer}");
    for (const r of PIP_RULES) expect(r).not.toContain("pointer-events");
  });
});

/* ── house rules ──────────────────────────────────────────────────────────────── */

describe("board 1h respects the call surface's standing rules", () => {
  it("adds no animation at all", () => {
    /* Every one of these sits over LIVE VIDEO, where nothing behind them can be cached,
       and the frame draws all three at rest. No motion is the cheapest correct reading of
       the transform/opacity rule — and the one that cannot be got wrong later. */
    expect(BLOCK).not.toContain("@keyframes");
    expect(BLOCK).not.toMatch(/\banimation\b/);
    expect(BLOCK).not.toMatch(/\btransition\b/);
  });

  it("adds no backdrop-filter over live video", () => {
    /* v2.99.84 counted 36 such layers over a call grid and removed all of them on phones.
       The PiP band explicitly turns the band's inherited blur OFF rather than keeping it. */
    expect(BLOCK).not.toMatch(/backdrop-filter:(?!none)/);
    expect(rule("> .relay-tile.you .nm{", BLOCK)).toContain("backdrop-filter:none");
  });

  it("spends no fixed hue where the cycling accent belongs, and no green on anything but the tier seal", () => {
    /* Green means ONLINE — except the tier badge, whose registered green is the app's own
       established mark (v2.99.6) and sits here for the same reason it sits on the ring
       card. Everything else accent-coloured reads var(--accent) / var(--warn). */
    const greens = BLOCK.match(/#22c55e/g) ?? [];
    expect(greens.length).toBe(1);
    expect(rule(".relay-root .call-head .hchip-role{", BLOCK)).toContain("#22c55e");
    // No hardcoded teal/cyan standing in for the accent.
    expect(BLOCK).not.toMatch(/#3FE0C5|#6EE7FF/i);
  });

  it("keeps the chips' hit targets honest", () => {
    /* The PiP is the only tappable thing this frame adds and it is far past 44px. The two
       chips are readouts, not controls, so they carry a role/aria-label instead. */
    expect(rule("> .relay-tile.you{", BLOCK)).toContain("width:92px");
    expect(HEAD).toMatch(/class="sig"[^>]*role="img"[^>]*aria-label="Call quality"/);
    expect(HEAD).toMatch(/class="hchip-lock"[^>]*role="img"/);
  });

  it("is declared LAST, because these overrides are decided by order", () => {
    /* .call-head .timer and .relay-tile .nm are refined at the same specificity, so a
       later edit that moves this block above them silently un-does it — v2.99.84 measured
       exactly that failure while the CSS read as correct. */
    expect(CSS_CODE.indexOf(".relay-root .call-head{padding:10px 16px"))
      .toBeGreaterThan(CSS_CODE.indexOf(`.relay-root .call-head .timer{font-family`));
    expect(CSS_CODE.indexOf("> .relay-tile.you .nm{"))
      .toBeGreaterThan(CSS_CODE.indexOf(".relay-root .relay-tile .nm{position:absolute"));
    expect(BLOCK.trim().length).toBeGreaterThan(600);
  });

  it("SOMETHING WRITES THE SLOTS — the gap this frame shipped with, closed", () => {
    /* THE WHOLE POINT. Every other assertion in this file inspects `relayAssets.ts`, and
       the markup and CSS there were complete from the start — so the frame's headline
       could be entirely absent while this suite stayed green. The defect was the missing
       write, in a different file, which is exactly what a source pin on the markup cannot
       see. Pin the write. */
    expect(CLIENT).toMatch(/function paintCallIdentity\(/);
    const body = fnBody(CLIENT, "function paintCallIdentity(");
    expect(body).toMatch(/\$\("callWho"\)/);
    expect(body).toMatch(/\$\("callWhoRole"\)/);
    // It really assigns, rather than merely naming the elements.
    expect(body).toMatch(/who\.textContent\s*=/);
  });

  it("the chip NEVER names the person — group name, else headcount, else nothing", () => {
    /* v2.107.67–68 (owner): the chip stopped naming the callee. It carries the call STATUS
       (the live-dot colour), the timer, and a middle slot that shows the GROUP'S name when
       the call was dialled from a named group, the live HEADCOUNT for an ad-hoc conference,
       and nothing for a 1:1 (`.hchip-who:empty` collapses it). Each piece is load-bearing:
       drop the group test and a two-party call shows "2"; drop the `+1` (which counts YOU)
       and a full room undercounts; drop `callGroupName` and "Family" reverts to a number. */
    const body = fnBody(CLIENT, "function paintCallIdentity(");
    expect(body).toMatch(/callIsGroup\s*\|\|\s*pins\.length > 1/);
    expect(body).toMatch(/String\(pins\.length \+ 1\)/);
    expect(body).toMatch(/callGroupName/);
  });

  it("the chip reads no name source — no peer name, no seen-name cache, no pin", () => {
    /* The name is GONE (v2.107.67), so every path that used to resolve it must be too: a
       leftover `peers[pin].name` or `peerNamesSeen` read would put a name back into a chip
       that now carries only status, headcount and the timer. */
    const body = fnBody(CLIENT, "function paintCallIdentity(");
    expect(body).not.toMatch(/peerNamesSeen/);
    expect(body).not.toMatch(/peers\[[^\]]+\]\?\.name/);
    expect(body).not.toMatch(/nameOf\(/);
  });

  it("the write is re-decided wherever the subject can change, and cleared on teardown", () => {
    /* FOUR CALL SITES, and each is a point at which the answer changes: a peer arriving
       (which is also the line that can flip the call to a conference), a peer leaving,
       the call going live by a path that created no peer (a rejoin), and hang-up. Fewer
       than four and the chip goes stale in one of those directions — the worst being the
       last, which would open the NEXT call wearing the previous person's name. */
    const calls = CLIENT.split("paintCallIdentity()").length - 1;
    expect(calls, "call sites").toBeGreaterThanOrEqual(4);
    // The teardown one specifically, and AFTER the group flag is reset so the one funnel
    // decides it rather than a second copy of the rule.
    const reset = CLIENT.indexOf("videoApproved = false; callIsGroup = false;");
    expect(reset).toBeGreaterThan(0);
    expect(CLIENT.indexOf("paintCallIdentity()", reset)).toBeGreaterThan(reset);
  });

  it("the tier rule has exactly ONE implementation", () => {
    /* It was written out TWICE — the ring card and the dial card — before this frame
       needed it a third time, and a third copy is how one person comes to be described
       three ways in one call. The literal colour map is the tell: if it reappears, so has
       the duplication. */
    expect(CLIENT).toMatch(/function tierOf\(/);
    expect(CLIENT.split("#4c9bff").length - 1, "the tier colour map").toBe(1);
    /* The fallback chain, whose two halves are each load-bearing and each easy to drop:
       a truthy `verified` from an older server means Registered, while an EXPLICIT null
       role means the directory resolved something that is not a person at all (a party
       line) and must render NO badge rather than defaulting to Guest. */
    expect(CLIENT.split(`if (d.verified) return "registered";`).length - 1).toBe(1);
    expect(CLIENT.split(`return d.role === null ? null : "guest";`).length - 1).toBe(1);
  });

  it("the chip makes no directory lookup — the tier badge went with the name", () => {
    /* v2.107.67 (owner): with no name to sit beside, the tier seal went too. So the chip
       does NOT look anyone up — no `directory.lookup`, no tier paint — and the role slot
       stays hidden. `tierOf` and its cache survive for the ring and dial cards (the test
       above still pins their single implementation); they are simply no longer read HERE. */
    const body = fnBody(CLIENT, "function paintCallIdentity(");
    expect(body).not.toMatch(/directory\.lookup/);
    expect(body).not.toMatch(/paintTier/);
    expect(body).not.toMatch(/TIER_META/);
    expect(body).toMatch(/roleEl\.style\.display\s*=\s*"none"/);
  });

  it("neither RELAY_CSS nor RELAY_MARKUP contains an interior backtick", () => {
    /* THE REASON THIS FILE IMPORTS NOTHING FROM relayAssets. A backtick inside a CSS
       comment terminates the literal, and this repo has been bitten five times. The
       PARSED value can never contain one — the literal just ends early — so only a read
       of the SOURCE can report it. */
    for (const [name, body] of [["RELAY_CSS", CSS], ["RELAY_MARKUP", MARKUP]] as const) {
      expect(body.includes("`"), `${name}: a backtick inside the literal`).toBe(false);
    }
  });
});
