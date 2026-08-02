import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "..", "components/relay-webview.tsx"), "utf8");
const PLUGIN = readFileSync(resolve(__dirname, "..", "plugins/with-android-fcm-call.js"), "utf8");

/**
 * What the user sees when the shell's one job — showing the site — goes wrong.
 * Three defects, all of which presented as "the app is dead" with no way out.
 */
describe("a stale error overlay cannot outlive the failure", () => {
  it("a successful load clears it", () => {
    // setHasError(false) used to exist ONLY in the manual reload callback, so one
    // transient main-frame error left an opaque, touch-intercepting overlay over a
    // WebView that had since loaded fine.
    expect(SRC).toMatch(/if \(!loadFailedRef\.current\) setHasError\(false\);/);
  });

  it("…but onLoadEnd after a FAILURE does not count as success", () => {
    // onLoadEnd fires after an error too, so clearing unconditionally would have
    // dismissed the card the error had just raised.
    expect(SRC).toMatch(/loadFailedRef\.current = true;[\s\S]{0,200}setHasError\(true\)/);
    expect(SRC).toMatch(/loadFailedRef\.current = false;/);
  });
});

describe("HTTP errors are not swallowed", () => {
  it("onHttpError is implemented, not an empty function", () => {
    expect(SRC).not.toMatch(/onHttpError=\{\(\) => \{\}\}/);
    expect(SRC).toMatch(/statusCode >= 400 && isMainDocument\(url\)/);
  });

  it("a sub-resource 404 does not replace the whole app with an error card", () => {
    // onHttpError fires for images, scripts and XHRs too.
    const fn = SRC.slice(SRC.indexOf("function isMainDocument"), SRC.indexOf("export function RelayWebView"));
    expect(fn).toMatch(/js\|mjs\|css\|png/);
    expect(fn).toMatch(/return false;/);
  });

  it("the card names the actual failure instead of blaming the connection", () => {
    expect(SRC).toMatch(/The server responded with \$\{httpStatus\}/);
    expect(SRC).toMatch(/didn't finish loading/);
    expect(SRC).toMatch(/Check your internet connection/);
  });
});

describe("the first-load watchdog never reveals a blank screen", () => {
  it("expiry raises the error card rather than silently dismissing the splash", () => {
    // It used to set loading=false regardless, and since onLoadStart is gated on
    // !firstLoadDoneRef the splash could never return — a blank navy screen with
    // no spinner, no message and no way out for the rest of the process.
    expect(SRC).toMatch(/if \(!firstLoadDoneRef\.current\) \{[\s\S]{0,220}setTimedOut\(true\);[\s\S]{0,80}setHasError\(true\);/);
  });

  it("a manual retry resets the failure state", () => {
    const reload = SRC.slice(SRC.indexOf("const reloadWebContent"), SRC.indexOf("const handleError"));
    expect(reload).toMatch(/setTimedOut\(false\)/);
    expect(reload).toMatch(/setHttpStatus\(null\)/);
    expect(reload).toMatch(/loadFailedRef\.current = false/);
  });
});

describe("the generated Kotlin interpolates instead of printing placeholders", () => {
  it("no escaped-literal dollar precedes an interpolation", () => {
    // `\\\${` in this JS template emits `\${` into the Kotlin, and `\$` is Kotlin's
    // escape for a LITERAL dollar — so the answer-from-lock-screen deep link was
    // literally `relay://call?nativeCall=${callId}&...` and the ringtone URI never
    // resolved, silencing the ring. Eight lines were affected.
    const THREE = "\\".repeat(3) + "${";
    expect(PLUGIN.includes(THREE), "escaped-literal $ before an interpolation").toBe(false);
  });

  it("the interpolations that must survive are still present", () => {
    const ONE = "\\" + "${";
    for (const name of ["callId", "mode", "callerName", "packageName"]) {
      expect(PLUGIN, name).toContain(ONE + name + "}");
    }
  });

  it("the repo's own verifier now covers this class", () => {
    const V = readFileSync(resolve(__dirname, "..", "scripts/verify-kotlin-templates.js"), "utf8");
    expect(V).toMatch(/escaped-literal dollar before a Kotlin interpolation/);
  });
});
