import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { extractVersion, reconcileVersion } from "../lib/version-watch";

describe("extractVersion", () => {
  it("extracts a semantic version from footer text", () => {
    expect(extractVersion("© 2026 RELAY · v2.51.0 · 2026-06-29")).toBe(
      "v2.51.0",
    );
  });

  it("returns null when no version is present", () => {
    expect(extractVersion("no version here")).toBeNull();
    expect(extractVersion(null)).toBeNull();
    expect(extractVersion(undefined)).toBeNull();
  });
});

describe("reconcileVersion", () => {
  it("records the first version without prompting", () => {
    const r = reconcileVersion(null, "v2.51.0");
    expect(r.next).toBe("v2.51.0");
    expect(r.shouldPromptReload).toBe(false);
  });

  it("prompts a reload when the version changes", () => {
    const r = reconcileVersion("v2.51.0", "v2.52.0");
    expect(r.next).toBe("v2.52.0");
    expect(r.shouldPromptReload).toBe(true);
  });

  it("does nothing when the version is unchanged", () => {
    const r = reconcileVersion("v2.51.0", "v2.51.0");
    expect(r.next).toBe("v2.51.0");
    expect(r.shouldPromptReload).toBe(false);
  });

  it("ignores an empty incoming version", () => {
    const r = reconcileVersion("v2.51.0", null);
    expect(r.next).toBe("v2.51.0");
    expect(r.shouldPromptReload).toBe(false);
  });
});

/* ── The version anchor ──────────────────────────────────────────────────
 * `extractVersion` scraped the first `vN.N.N` anywhere in body innerText —
 * i.e. USER CONTENT. A message, status or contact name containing "v1.2.3" was
 * read as the deployed version and flipped the watcher into a "RELAY was
 * updated, reload" prompt, which interrupts and can be triggered at will.
 */
describe("extractVersion prefers an anchor the web app owns", () => {
  it("an explicit anchor wins over anything in the page text", () => {
    expect(extractVersion("someone typed v9.9.9 in chat", "v2.51.0")).toBe("v2.51.0");
  });

  it("normalises a bare anchor value", () => {
    expect(extractVersion(null, "2.51.0")).toBe("v2.51.0");
    expect(extractVersion(null, "  v2.51.0  ")).toBe("v2.51.0");
  });

  it("ignores a malformed anchor and falls back", () => {
    expect(extractVersion("© RELAY · v2.51.0", "not-a-version")).toBe("v2.51.0");
    expect(extractVersion("© RELAY · v2.51.0", "")).toBe("v2.51.0");
  });

  it("the FALLBACK is deliberately unchanged — the live footer is inline", () => {
    // Narrowing it to a standalone match would break real detection today in
    // exchange for closing a nuisance. The anchor is the actual fix, and it makes
    // the fallback unreachable once the web app emits one.
    expect(extractVersion("© 2026 RELAY · v2.51.0 · 2026-06-29")).toBe("v2.51.0");
  });

  it("the injected script consults the anchor first", () => {
    const SRC = readFileSync(resolve(__dirname, "..", "lib/injected-scripts.ts"), "utf8");
    const read = SRC.slice(SRC.indexOf("var read = function ()"), SRC.indexOf("var read = function ()") + 1600);
    expect(read).toMatch(/data-relay-version/);
    // Compare CODE positions, not prose: the comment above the anchor mentions
    // innerText, and a naive indexOf("innerText") matches that comment rather than
    // the scrape it describes.
    expect(read.indexOf("document.querySelector(")).toBeLessThan(
      read.indexOf("document.body && document.body.innerText"),
    );
  });
});

describe("small resilience fixes", () => {
  it("a failed update check is visible in the footer", () => {
    // check()'s catch sets lastReason then setStatus("idle"), and with a null
    // manifest `upToDate` cannot be false — so the reason, added expressly so a
    // failed check never reads as "no update", was unreachable for every failure.
    const SRC = readFileSync(resolve(__dirname, "..", "components/build-status-row.tsx"), "utf8");
    expect(SRC).toMatch(/\|\| !!reason;/);
  });

  it("the ring animation is not re-armed on every render", () => {
    const SRC = readFileSync(resolve(__dirname, "..", "components/glossy-check-button.tsx"), "utf8");
    // No dependency array meant a 450ms JS-driven animation restarted continuously
    // — for the whole app lifetime, including during a video call.
    expect(SRC).toMatch(/\}, \[\s*\n\s*isDownloading,[\s\S]{0,200}ringAnim,\s*\n\s*\]\);/);
    // …and the tick that drives it dropped from 500ms to 5s.
    expect(SRC).toMatch(/\), 5_000\);/);
    expect(SRC).not.toMatch(/\), 500\);/);
  });

  it("Android backup is off, so the session cookie cannot be extracted", () => {
    const CFG = readFileSync(resolve(__dirname, "..", "app.config.ts"), "utf8");
    expect(CFG).toMatch(/allowBackup: false/);
  });
});
