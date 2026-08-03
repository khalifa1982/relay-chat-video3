import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

/**
 * DO THE CALL CONTROLS ACTUALLY WORK — wired, honest about their state, and really
 * changing what is transmitted?
 *
 * Three separate questions, and each has its own failure that ships silently:
 *   1. a button with no listener, or a listener whose element does not exist —
 *      `$("id")?.addEventListener` is a no-op when the id is wrong, so a renamed
 *      element turns a control into decoration with nothing to notice;
 *   2. a button whose ON/OFF class is set from a shadow boolean that can drift
 *      from the track it claims to describe — the direction that drifts wrong is
 *      somebody being heard while their screen says muted;
 *   3. a re-entrancy guard that gets stuck, which makes a working button dead.
 */

const ROOT = path.resolve(__dirname, "../../..");
const ENGINE = fs.readFileSync(path.join(ROOT, "client/src/lib/relayClient.ts"), "utf8");
const ASSETS = fs.readFileSync(path.join(ROOT, "client/src/lib/relayAssets.ts"), "utf8");
const CODE = codeOnly(ENGINE);

/** Ids the engine attaches a click listener to. */
const wired = new Set<string>();
for (const m of ENGINE.matchAll(/\$\("([A-Za-z0-9_-]+)"\)[^\n]*addEventListener/g)) wired.add(m[1]);

/** Ids that exist in the rendered markup, or are built at runtime. */
const present = new Set<string>();
for (const m of ASSETS.matchAll(/id=["']([A-Za-z0-9_-]+)["']/g)) present.add(m[1]);
for (const m of ENGINE.matchAll(/\.id\s*=\s*["']([A-Za-z0-9_-]+)["']/g)) present.add(m[1]);

describe("every control is connected at both ends", () => {
  it("every listener has an element to attach to", () => {
    // `?.addEventListener` on a missing element is silent — this is the only thing
    // that would notice a renamed id.
    const dead = [...wired].filter((id) => !present.has(id));
    expect(dead, `listeners with no such element: ${dead.join(", ")}`).toEqual([]);
    expect(wired.size).toBeGreaterThan(40); // it found the surface, not nothing
  });

  it("every button in the markup has a listener", () => {
    const buttons: string[] = [];
    for (const m of ASSETS.matchAll(/<button[^>]*\bid=["']([A-Za-z0-9_-]+)["'][^>]*>/g)) {
      buttons.push(m[1]);
    }
    const inert = buttons.filter((id) => !wired.has(id));
    expect(inert, `buttons that do nothing: ${inert.join(", ")}`).toEqual([]);
    expect(buttons.length).toBeGreaterThan(30);
  });
});

describe("mute and camera change what is SENT, not just what is shown", () => {
  it("the mute goes through one helper that covers both streams", () => {
    // With a filter on, the published stream is the canvas output while the raw
    // mic lives on `localStream` — disabling only one leaves a live copy on
    // whichever the senders happen to hold.
    const fn = CODE.slice(CODE.indexOf("function syncMicEnabled()"));
    const body = fn.slice(0, fn.indexOf("\n  }"));
    expect(body).toMatch(/outStream\(\)/);
    expect(body).toMatch(/getAudioTracks\(\)\.forEach\(t => \(t\.enabled = micOn\)\)/);
    expect(body).toMatch(/processedStream && localStream/);
  });

  it("mute is `enabled = false`, never a stopped track", () => {
    // `stop()` is irreversible: unmuting after it would need a fresh getUserMedia
    // and a renegotiation, which is how a mute button becomes a one-way door.
    const fn = CODE.slice(CODE.indexOf("function syncMicEnabled()"));
    expect(fn.slice(0, fn.indexOf("\n  }"))).not.toMatch(/\.stop\(\)/);
  });

  it("the button's class and the track state are set by the SAME function", () => {
    const setMic = CODE.slice(CODE.indexOf("function setMic(on: boolean)"));
    const body = setMic.slice(0, setMic.indexOf("\n  }"));
    expect(body).toMatch(/micOn = on/);
    expect(body).toMatch(/syncMicEnabled\(\)/);
    expect(body).toMatch(/\$\("micBtn"\)\?\.classList\.toggle\("off", !on\)/);
  });

  it("a HOST force-mute goes through it too, so the victim's button tells the truth", () => {
    // The remote path is the one that would leave a button saying "unmuted" while
    // the track is off — it must not touch `enabled` itself.
    const fn = CODE.slice(CODE.indexOf("function onForceMute(m: Msg)"));
    const body = fn.slice(0, fn.indexOf("\n  }"));
    expect(body).toMatch(/setMic\(false\)/);
    expect(body).toMatch(/setMic\(true\)/);
    expect(body).not.toMatch(/enabled\s*=/);
  });

  it("every place that moves `camOn` or `micOn` repaints its button right there", () => {
    /* THE DRIFT CHECK, by proximity rather than by counting — a bare assignment
       with no repaint beside it is the shape where the control and the wire come to
       disagree, and the direction it fails is a button that says "off" while the
       track is live. Proximity, not totals: equal counts can still be five writes
       and five repaints in the wrong places. The DECLARATION is skipped; it
       initialises both flags before any button exists. */
    /* The RAW source, not the comment-stripped copy: this check is about physical
       proximity, and stripping renumbers the lines out from under the window. */
    const lines = ENGINE.split("\n");
    for (const [flag, btn] of [["camOn", "camBtn"], ["micOn", "micBtn"]] as const) {
      const writes: number[] = [];
      lines.forEach((l, i) => {
        if (new RegExp(`\\b${flag} = `).test(l) && !/^\s*let /.test(l)) writes.push(i);
      });
      // A floor, so a rename that makes the scan match nothing fails loudly rather
      // than passing vacuously. `micOn` has two sites, `camOn` five.
      expect(writes.length, `no ${flag} assignments found — the check is looking at nothing`)
        .toBeGreaterThanOrEqual(2);
      for (const i of writes) {
        /* An eight-line window, not three: `setCam` legitimately puts the two
           track-enable lines between the assignment and the repaint. It is a proxy
           for "in the same block" — wide enough for the real code that belongs
           there, far too narrow for a repaint that lives in another function. */
        const near = lines.slice(i, i + 8).join("\n");
        expect(near, `${flag} moves at line ~${i + 1} with no ${btn} repaint beside it`).toMatch(
          new RegExp(`\\$\\("${btn}"\\)\\?\\.classList`),
        );
      }
    }
  });
});

describe("a re-entrancy guard cannot strand its own button", () => {
  /**
   * `screenBusy` was the one of four guards reset BY HAND, at four separate points.
   * A throw between the set and a reset leaves it stuck TRUE, and every later tap on
   * Share dies at `if (screenBusy) return;` with no toast and no log — self-healing
   * only on hang-up, which is the shape that gets reported as "it randomly stops
   * working" and never reproduces.
   */
  it("every media guard releases in a `finally`", () => {
    for (const flag of ["screenBusy", "flipBusy", "filterBusy", "recoverBusy"]) {
      const at = CODE.indexOf(`${flag} = true`);
      expect(at, `${flag} is never set`).toBeGreaterThan(0);
      const after = CODE.slice(at, at + 6000);
      expect(after, `${flag} is not released in a finally`).toMatch(
        new RegExp(`finally \\{[\\s\\S]{0,400}?${flag} = false`),
      );
    }
  });

  it("the screen-share paths no longer reset it by hand mid-body", () => {
    const toggle = CODE.slice(
      CODE.indexOf("async function toggleScreenShare()"),
      CODE.indexOf("async function stopScreenShare()"),
    );
    // One release, in the finally — not four scattered through the early returns.
    expect((toggle.match(/screenBusy = false/g) ?? []).length).toBe(1);
    expect(toggle).toMatch(/\} finally \{\s*\n\s*screenBusy = false;/);
  });

  it("the browser's own Stop-sharing bar still reaches the app", () => {
    // `track.onended` is what makes the OS-level stop restore the camera; without
    // it the app would keep publishing a dead screen track.
    expect(CODE).toMatch(/track\.onended = \(\) => \{ void stopScreenShare\(\); \}/);
  });

  it("hang-up and teardown still clear the guard outright", () => {
    // Belt and braces for a flag that outlives one call.
    expect((CODE.match(/screenBusy = false/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
