/* ──────────────────────────────────────────────────────────────────────────
 * v2.105.24 — WHO YOU ARE DIALLING, on the outgoing dial card.
 *
 * Owner, from a screenshot of this screen mid-ring: *"when I'm dialing out why there is no
 * image of his profile it's showing, is the status, my last call when it was, add some
 * information."*
 *
 * ROOT CAUSE OF THE MISSING PHOTO: the card had NO image element at all — five text divs
 * and nothing else — so `avatarUrl`, which `directory.lookup` has always returned, had
 * nowhere to render. The incoming ring card gained a photo in v2.97.0; this one never did.
 *
 * WHAT A SOURCE PIN CANNOT PROVE, and is therefore MEASURED instead (headless Chromium
 * against the real built stylesheet and the real exported markup, five phone widths):
 * whether the extra rows fit. They do — 5/5 clean, and 320px needed a narrow-phone
 * tightening to get there, which is pinned below as a calculation rather than a magic
 * number.
 * ────────────────────────────────────────────────────────────────────────── */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { codeOnly } from "../../../server/testing/codeOnly";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const ASSETS = read("client/src/lib/relayAssets.ts");
const ENGINE = read("client/src/lib/relayClient.ts");

/** The dial card's markup, bounded to itself. */
const CARD = (() => {
  const start = ASSETS.indexOf('<div id="dialCard"');
  expect(start).toBeGreaterThan(-1);
  const end = ASSETS.indexOf('<div class="grid" id="videoGrid">', start);
  expect(end).toBeGreaterThan(start);
  return ASSETS.slice(start, end);
})();

function fnAt(src: string, name: string): string {
  const re = new RegExp(`function ${name}\\b`);
  const m = re.exec(src);
  if (!m) throw new Error(`function not found: ${name}`);
  const open = src.indexOf("{", m.index);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(m.index, i + 1);
    }
  }
  throw new Error(`unterminated: ${name}`);
}

describe("v2.105.24 — the card can render a photo at all", () => {
  it("has an image element, which it previously did not", () => {
    expect(CARD).toMatch(/<img class="dc-av-img" id="dcAvImg"/);
    // Hidden until a photo has actually decoded, so there is never an empty box.
    expect(CARD).toMatch(/id="dcAvImg"[^>]*style="display:none"/);
  });

  it("the image is a SIBLING of the initials disc, never a child", () => {
    /* THE LOAD-BEARING STRUCTURAL RULE. `showDialCard` re-runs during a single dial — the
     * ringing ack carries the callee's real name — and writes `dcAv.textContent`
     * unconditionally. A child image would be DELETED by that write a second into the
     * call, and a background-image on the disc would have "HA" printed on top of it. */
    const av = CARD.indexOf('id="dcAv"');
    const img = CARD.indexOf('id="dcAvImg"');
    const wrapOpen = CARD.indexOf('class="dc-av-wrap"');
    expect(wrapOpen).toBeGreaterThan(-1);
    expect(wrapOpen).toBeLessThan(av);
    expect(av).toBeLessThan(img);
    // The disc's own element must CLOSE before the image opens — i.e. they are siblings.
    const between = CARD.slice(av, img);
    expect(between).toMatch(/<\/div>/);
    // And the disc must not carry a background image...
    expect(CARD).not.toMatch(/id="dcAv"[^>]*background-image/);
    /* ...nor contain an image of ANY id. Found by mutation: planting a second <img> inside
     * the disc satisfied the ordering assertions above, because they only check where the
     * real one sits. The property is that the disc holds TEXT ONLY, since every write to it
     * is `textContent =`, which destroys whatever is inside. */
    const disc = between.slice(0, between.indexOf("</div>") + 6);
    expect(disc).not.toMatch(/<img/);
  });

  it("the wrapper is POSITIONED, or the absolute image escapes to the app root", () => {
    // Neither .dial-card nor .dc-av establishes a containing block.
    expect(ASSETS).toMatch(/\.dc-av-wrap\{position:relative/);
    expect(ASSETS).toMatch(/\.dc-av-img\{position:absolute;inset:0/);
  });

  it("the photo fills the disc exactly, so swapping it in shifts nothing below", () => {
    expect(ASSETS).toMatch(/\.dc-av-img\{[^}]*width:100%;height:100%/);
    expect(ASSETS).toMatch(/\.dc-av-img\{[^}]*object-fit:cover/);
  });
});

describe("v2.105.24 — one fetch per dial, and nothing leaks between dials", () => {
  const show = codeOnly(fnAt(ENGINE, "showDialCard"));

  it("the work is keyed on the PIN CHANGING, not on the function being called", () => {
    /* showDialCard runs at least twice per dial (once at dial, once when the ringing ack
     * brings the name), so keying on the call would fetch twice and visibly re-flicker
     * the photo. */
    expect(show).toMatch(/const fresh = dcPin !== d\.pin/);
    expect(show).toMatch(/if \(fresh\) \{ dcPin = d\.pin; resetDialIdentity\(\); \}/);
  });

  it("a NEW pin blanks the enriched rows before anything is painted", () => {
    const reset = show.indexOf("resetDialIdentity()");
    const paint = show.indexOf('$("dcAv")');
    expect(reset).toBeGreaterThan(-1);
    expect(reset).toBeLessThan(paint);
  });

  it("the fetch fires only for a fresh, non-group dial", () => {
    /* A group dial's "pin" is a head count, so there is no single person to look up. */
    expect(show).toMatch(/if \(fresh && !d\.group\) enrichDialCard\(d\.pin\)/);
    // Constant-true would defeat the whole guard.
    expect(show).not.toMatch(/if \(true[^)]*\) enrichDialCard/);
  });

  it("leaving the dial forgets the pin AND blanks the rows", () => {
    /* Otherwise re-dialling the same person would show a status and a last-call figure
     * captured before the previous call happened — both stale by definition. */
    const exit = codeOnly(fnAt(ENGINE, "exitPreConnect"));
    expect(exit).toMatch(/dcPin = null/);
    expect(exit).toMatch(/resetDialIdentity\(\)/);
  });

  it("the reset really clears every enriched row", () => {
    const reset = codeOnly(fnAt(ENGINE, "resetDialIdentity"));
    for (const id of ["dcAvImg", "dcRole", "dcPresence", "dcLast"]) {
      expect(reset).toContain(id);
    }
    // The image must lose its src, not merely be hidden — a stale src would flash on the
    // next dial before the new one decodes.
    expect(reset).toMatch(/removeAttribute\("src"\)/);
    // And its handlers, or a late onload from the previous dial re-shows it.
    expect(reset).toMatch(/img\.onload = null/);
    expect(reset).toMatch(/img\.onerror = null/);
  });
});

describe("v2.105.24 — staleness is checked on the PIN AS A VALUE", () => {
  const enrich = codeOnly(fnAt(ENGINE, "enrichDialCard"));

  it("every async continuation re-checks the pin", () => {
    /* `outgoingDial` is MUTATED in place (the ringing ack writes `.name` onto it), and
     * re-dialling the same person makes a NEW object for whom the answer is still
     * correct — so the comparison must be on the pin, not on object identity. */
    const guards = enrich.match(/outgoingDial\.pin !== pin|outgoingDial\.pin === pin/g) ?? [];
    // lookup .then, the image's own onload, and the last-call .then
    expect(guards.length).toBeGreaterThanOrEqual(3);
    expect(enrich).not.toMatch(/outgoingDial !== d\b/);
  });

  it("the photo is re-checked at DECODE time, not only at fetch time", () => {
    // A slow photo must never appear over the next person's card.
    expect(enrich).toMatch(/img\.onload = \(\) => \{[\s\S]{0,140}?outgoingDial\.pin === pin/);
  });

  it("a broken photo falls back to the initials", () => {
    expect(enrich).toMatch(/img\.onerror = \(\) => \{ img\.style\.display = "none"; \}/);
  });

  it("only a 6-digit shape is looked up", () => {
    expect(enrich).toMatch(/if \(!\/\^\\d\{6\}\$\/\.test\(pin\)\) return/);
  });

  it("both fetches swallow their own failure", () => {
    /* One decorative row must never cost anybody a call. */
    const catches = enrich.match(/\.catch\(\(\) => \{/g) ?? [];
    expect(catches.length).toBe(2);
  });
});

describe("v2.105.24 — the formatters are SHARED, never copied", () => {
  it("the engine imports the presence and status readers", () => {
    expect(ENGINE).toMatch(/import \{ describePeerPresence, formatElapsedSince \} from "@shared\/profileFields"/);
    expect(ENGINE).toMatch(/import \{ describeProfileStatus \} from "@shared\/profileStatus"/);
  });

  it("the chosen status outranks presence, and presence is the fallback", () => {
    /* A status they SET is a statement they made on purpose; presence is what to say when
     * they have said nothing. */
    const enrich = codeOnly(fnAt(ENGINE, "enrichDialCard"));
    expect(enrich).toMatch(/const chosen = describeProfileStatus\(/);
    expect(enrich).toMatch(/pres\.textContent = chosen \?\? describePeerPresence\(/);
  });

  it("the engine does NOT re-derive a presence string of its own", () => {
    /* The incoming ring card's inline version predates v2.101.1 and spells travelling
     * "Traveling" where the shared vocabulary spells it "Travelling" — copying it would
     * have put two spellings of one word in one app. The dial card must not add a third. */
    const enrich = codeOnly(fnAt(ENGINE, "enrichDialCard"));
    expect(enrich).not.toMatch(/"Traveling"/);
    expect(enrich).not.toMatch(/statusOverride === "away"/);
  });

  it("the shared presence reader has ONE definition and no local twin", () => {
    const shared = read("shared/profileFields.ts");
    expect(shared).toMatch(/export function describePeerPresence\(/);
    const overlays = read("client/src/app/PeerOverlays.tsx");
    /* v2.106.98 put a TRANSLATED renderer in front of it. The property this pin
       stands for is unchanged and is what is asserted: the popup does not carry its
       own copy of the presence rule. Both renderers read `peerPresenceState`, so the
       dial card and the popup still cannot disagree about whether somebody is idle. */
    expect(overlays).toMatch(/import \{ presenceLabel \} from "\.\/presenceCopy"/);
    expect(overlays).not.toMatch(/function (?:presenceLine|describePeerPresence)\(/);
    const copy = read("client/src/app/presenceCopy.ts");
    expect(copy).toMatch(/peerPresenceState\(d\)/);
    expect(shared).toMatch(/export function peerPresenceState\(/);
    // The English renderer reads the same state, so the two vocabularies share one decision.
    expect(shared).toMatch(/describePeerPresence[\s\S]{0,200}peerPresenceState\(d\)/);
  });
});

describe("v2.105.24 — the last-call line is honest", () => {
  const enrich = codeOnly(fnAt(ENGINE, "enrichDialCard"));

  it("renders NOTHING when there is no shared call", () => {
    /* Never "first call" or "never called": a cleared history and the server's row caps
     * make "no row" a frequent legitimate state, so a claim would be false. */
    expect(enrich).toMatch(/if \(!el \|\| !at \|\| Number\.isNaN\(at\.getTime\(\)\)\) return/);
    expect(enrich).not.toMatch(/First call|Never called|No previous/i);
  });

  it("the OUTCOME travels with the time", () => {
    /* "2h ago" reads identically about a declined call and a conversation, and those mean
     * opposite things when deciding whether to dial again. */
    expect(enrich).toMatch(/d\?\.answered \? `Last spoke \$\{ago\} ago` : `Last tried \$\{ago\} ago · no answer`/);
  });

  it("the elapsed figure uses the shared duration formatter", () => {
    // v2.99.90's rule: a duration, never a date, on this kind of line.
    expect(enrich).toMatch(/formatElapsedSince\(at\.getTime\(\), Date\.now\(\)\)/);
  });
});

describe("v2.105.24 — the fetch is authenticated and unwraps superjson correctly", () => {
  const get = codeOnly(fnAt(ENGINE, "trpcGet"));

  it("attaches this browser's device id", () => {
    /* Without it an identity-gated call is a permanent silent no-op for exactly the
     * Safari/ITP guests whose guest cookie was dropped — the case the header exists for. */
    expect(get).toMatch(/getDeviceId\(\)/);
    expect(get).toMatch(/headers\[DEVICE_ID_HEADER\] = did/);
    expect(get).toMatch(/credentials: "include"/);
  });

  it("unwraps .result.data.json FIRST, so a null result stays null", () => {
    /* superjson wraps null as {json: null}; reading the wrapper on a null yields a truthy
     * object and reports an unknown number as a resolved user — the defect v2.105.2
     * shipped and corrected. */
    const j = codeOnly(fnAt(ENGINE, "trpcJson"));
    expect(j).toMatch(/\?\.result\?\.data\?\.json/);
    /* Forbid ANY fallback to the raw payload, parenthesised or not. Found by mutation:
     * `?? (j as T)` slipped past a `\?\?\s*j\b` needle because of the paren, which is
     * exactly the shape the v2.105.2 defect took. */
    expect(j).not.toMatch(/\?\?[^;]*\bj\b/);
    // The unwrap is the LAST thing on that line — nothing may be appended to it.
    expect(j).toMatch(/\?\.result\?\.data\?\.json;\s*$/m);
  });
});

describe("v2.105.24 — layout, as a calculation rather than a magic number", () => {
  it("the card body scrolls, and centres only while it fits", () => {
    /* .dial-card is flex:1 with no overflow, so without an inner scroller the extra rows
     * would spill over the control bar. Auto margins centre it when it fits; a centred
     * flex column that overflows puts its TOP out of reach. */
    expect(ASSETS).toMatch(/\.dc-body\{[^}]*overflow-y:auto/);
    expect(ASSETS).toMatch(/\.dc-body\{[^}]*margin:auto/);
  });

  it("both new rows reserve their height while empty", () => {
    // So the card does not jump when the async lookup lands a beat after the dial starts.
    expect(ASSETS).toMatch(/\.dc-presence\{min-height:\d+px/);
    expect(ASSETS).toMatch(/\.dc-last\{min-height:\d+px/);
  });

  it("the status note is clamped and the name truncates, but the badge does not shrink", () => {
    expect(ASSETS).toMatch(/\.dc-presence\{[^}]*-webkit-line-clamp:2/);
    expect(ASSETS).toMatch(/\.dc-name\{[^}]*text-overflow:ellipsis/);
    expect(ASSETS).toMatch(/\.dc-role\{flex:0 0 auto/);
  });

  it("the number is clamped so 34px cannot overflow a 320px phone", () => {
    expect(ASSETS).toMatch(/\.dc-num\{[^}]*font-size:clamp\(/);
  });

  it("the narrow-phone tightening exists and only touches narrow phones", () => {
    /* MEASURED: with a photo, a two-line note and a last-call line the body needs 327px
     * and a 320px phone gives the card 318 — 9px over, so it scrolled. A smaller disc and
     * a tighter gap recover 20px. 360px and up were already comfortable and are untouched. */
    const q = ASSETS.slice(ASSETS.indexOf("@media (max-width:340px)"));
    expect(q.slice(0, 400)).toMatch(/\.dc-av-wrap\{width:84px;height:84px/);
    expect(q.slice(0, 400)).toMatch(/\.dc-body\{gap:8px\}/);
  });

  it("the status row is not the LAST row — the hang-up clearance measures from it", () => {
    // v2.98.3 measured that clearance, so the new rows go ABOVE the mode chip.
    const pres = CARD.indexOf('id="dcPresence"');
    const last = CARD.indexOf('id="dcLast"');
    const mode = CARD.indexOf('id="dcMode"');
    const status = CARD.indexOf('id="dcStatusTxt"');
    expect(pres).toBeLessThan(mode);
    expect(last).toBeLessThan(mode);
    expect(mode).toBeLessThan(status);
  });
});

describe("v2.105.24 — the CSS template literal stays parseable", () => {
  it("contains no backtick, which would terminate it", () => {
    /* This trap has bitten three times (v2.99.16, v2.99.82, and again while writing this
     * release — a backtick in a COMMENT inside the literal breaks the file with an error
     * reported 200 lines away). */
    const css = ASSETS.match(/export const RELAY_CSS = `([\s\S]*?)`;/);
    expect(css).not.toBeNull();
    expect(css![1]).not.toContain("`");
    const markup = ASSETS.match(/export const RELAY_MARKUP = `([\s\S]*?)`;/);
    expect(markup).not.toBeNull();
    expect(markup![1]).not.toContain("`");
  });
});
