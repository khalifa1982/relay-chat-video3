/**
 * v2.99.35 — the landing page is STRUCTURALLY alive (owner: "the dial pad…
 * if you click, doesn't click. The numbers doesn't show… the Arabic tab on
 * the top on the landing page is not active").
 *
 * ROOT CAUSE (traced live with an instrumented Element.innerHTML setter, not
 * guessed): React 19 re-applies dangerouslySetInnerHTML whenever the {__html}
 * OBJECT identity changes — even when the string inside is byte-identical.
 * Home rendered `dangerouslySetInnerHTML={{ __html: html }}` — a fresh object
 * every render — so the first unrelated re-render (the live-stats query
 * resolving ~0.5s after mount) re-set innerHTML on the live DOM, rebuilding
 * every node and silently discarding ALL of the engine's listeners: keypad,
 * CLEAR, DEMO, CALL, and the AR/EN toggle. The [lang]-keyed wiring effect saw
 * no dependency change and never re-ran; the pure-CSS watchdog then cleared
 * the (new, orphaned) boot overlay, so visitors saw a normal load into a
 * completely dead page. Empirical timeline: engine wired at t≈450ms, DOM
 * replaced at t≈565ms (same string hash, new object), lp-js-ok absent and
 * zero working listeners forever after. This also explains why the v2.99.24
 * "wire controls first" hardening didn't cure the owner's report — the
 * controls WERE wired; the nodes they were wired to got thrown away.
 *
 * THE FIX, three reinforcing layers:
 *  1. the {__html} object is memoized (`dsih`) — its identity changes only
 *     when the markup truly does, so React never re-sets identical innerHTML;
 *  2. the wiring effect keys on that object, so IF the DOM is ever replaced,
 *     the engine re-wires in the same commit;
 *  3. all dialer/lang clicks ride ONE DELEGATED listener on the stable host
 *     wrapper (React owns it; innerHTML swaps only replace its CHILDREN), so
 *     even a rogue replacement can't kill interactivity again.
 *
 * Verified end-to-end headlessly against the real built bundle: keypad
 * digits render AFTER the killer re-render, the v2.99.15 live number-lookup
 * states work, EN→AR and AR→EN both flip (keypad still live in RTL), CALL
 * navigates into the /i/<n> direct-join flow.
 *
 * Also fixed here: index.html shipped a literal %VITE_ANALYTICS_ENDPOINT%
 * script src whenever the env was unset (vite keeps unknown %VARS% verbatim)
 * — every production page load fetched that bogus URL, got a 400 and a
 * strict-MIME console error. Analytics now injects at runtime (main.tsx)
 * only when actually configured.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HOME = readFileSync(join(__dirname, "..", "client/src/pages/Home.tsx"), "utf8");
const INDEX_HTML = readFileSync(join(__dirname, "..", "client/index.html"), "utf8");
const MAIN = readFileSync(join(__dirname, "..", "client/src/main.tsx"), "utf8");

describe("the React-19 innerHTML re-set fix (v2.99.35)", () => {
  it("memoizes the {__html} object — identity changes only when the markup does", () => {
    expect(HOME).toMatch(/const dsih = useMemo\(\s*\n?\s*\(\) => \(\{ __html: markup\(/);
    expect(HOME).toMatch(/dangerouslySetInnerHTML=\{dsih\}/);
    // The bug shape — a fresh inline object every render — must never return.
    expect(HOME).not.toMatch(/dangerouslySetInnerHTML=\{\{/);
  });

  it("the wiring effect keys on the markup object, so a DOM swap re-wires the engine", () => {
    expect(HOME).toMatch(/\}, \[lang, dsih\]\);/);
  });

  it("dialer + lang clicks ride ONE delegated listener on the stable host wrapper", () => {
    expect(HOME).toMatch(/host\.addEventListener\("click", onHostClick\)/);
    expect(HOME).toMatch(/host\.removeEventListener\("click", onHostClick\)/);
    expect(HOME).toMatch(/\[data-lp-key\],\[data-lp='clearBtn'\],\[data-lp='demoBtn'\],\[data-lp='callBtn'\],\[data-lp='langBtn'\]/);
    // No per-node control listeners left to die with a DOM replacement.
    expect(HOME).not.toMatch(/forEach\(\(b\) => b\.addEventListener/);
    expect(HOME).not.toMatch(/\$\("langBtn"\)\?\.addEventListener/);
    expect(HOME).not.toMatch(/\$\("callBtn"\)\?\.addEventListener/);
  });

  it("delegation dispatches to the SAME handlers the controls always had", () => {
    const block = HOME.slice(HOME.indexOf("const onHostClick"), HOME.indexOf('host.addEventListener("click", onHostClick)'));
    expect(block).toMatch(/press\(key\)/);
    expect(block).toMatch(/case "clearBtn": clearDial\(\);/);
    expect(block).toMatch(/case "demoBtn": demoDial\(\);/);
    expect(block).toMatch(/case "callBtn": callNow\(e\);/);
    expect(block).toMatch(/case "langBtn": opts\.onToggleLang\(\);/);
  });

  it("keeps the v2.99.24 invariant: controls wire BEFORE any decorative/boot code", () => {
    const wireIdx = HOME.indexOf('host.addEventListener("click", onHostClick)');
    const decorativeIdx = HOME.indexOf('window.addEventListener("mousemove", onMove');
    expect(wireIdx).toBeGreaterThan(-1);
    expect(decorativeIdx).toBeGreaterThan(-1);
    expect(wireIdx).toBeLessThan(decorativeIdx);
  });
});

describe("dial status/preview no longer contradict (v2.99.35 polish)", () => {
  it("the redundant status line hides while a RESOLVED preview is showing", () => {
    // Before: dialStatus sat on "CHECKING NUMBER…" forever (syncDial wrote it,
    // nothing resolved it) right above "Sara · ONLINE" — two contradicting
    // lines. Found headlessly while verifying the delegation fix.
    const setPreview = HOME.slice(HOME.indexOf("const setPreview"), HOME.indexOf("const applyLookup"));
    expect(setPreview).toMatch(/st\.style\.display = html \? "none" : ""/);
  });
  it("the fail-open (FALLBACK) paths flip the status to LINE READY, not a stale 'checking'", () => {
    const runLookup = HOME.slice(HOME.indexOf("const runLookup"), HOME.indexOf("const syncDial"));
    const hits = runLookup.match(/st\.textContent = t\.dialReady/g) || [];
    expect(hits.length).toBe(2); // no-resolver branch + catch branch
  });
});

describe("analytics literal purged from the built page (v2.99.35)", () => {
  it("index.html carries NO %VITE_ANALYTICS% script tag (only the explanatory comment)", () => {
    expect(INDEX_HTML).not.toMatch(/src="%VITE_ANALYTICS_ENDPOINT%/);
    expect(INDEX_HTML).not.toMatch(/<script[^>]*umami/);
  });

  it("main.tsx injects analytics at runtime ONLY when configured", () => {
    expect(MAIN).toMatch(/VITE_ANALYTICS_ENDPOINT/);
    expect(MAIN).toMatch(/if \(endpoint && websiteId && !endpoint\.startsWith\("%"\)\)/);
  });
});
