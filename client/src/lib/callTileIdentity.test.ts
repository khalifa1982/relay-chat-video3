/* ============================================================
   v2.99.82 — the in-call tile says each thing once.

   Owner, asked TWICE, the second time with a screenshot circling all three
   renderings of one name on a single tile: "you mentioned the name in two places,
   like you put my icon logo up, it means k h, and then below it, it mentioned u,
   and then below it mentioned u with my flag country. You don't need to repeat the
   name. You need to put the profile picture or the avatar, and below it, you put
   add to contact if he was not in your contact. and at the bottom of the border of
   the frame of the user where you put the flag and you put his first name only,
   and beside, you put the PIN number, the six digits without mention PIN."

   And: "add contact ... currently you're putting on the profile, on the video, and
   also you put it on the top left. Just put it one place. Under the name of each
   user."

   The LAYOUT half of this was measured in headless Chromium against the real
   stylesheet at 390 and 320 wide — a source pin cannot tell you whether the digits
   get clipped, and that was the one real risk in the change.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RELAY_CSS } from "./relayAssets";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const CLIENT = read("client/src/lib/relayClient.ts");
const ENGINE = read("client/src/app/RelayEngine.tsx");

/** Strip comment lines before an "absent" assertion — this repo has burned itself
 *  four times on a not.toMatch that matched the comment explaining the absence. */
function codeOnly(src: string): string {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

/** The one builder every tile goes through. */
const BUILDER = (() => {
  const start = CLIENT.indexOf("  function tileContentHTML(");
  expect(start, "tileContentHTML exists").toBeGreaterThan(0);
  const end = CLIENT.indexOf("  /** The per-tile", start);
  expect(end, "the slice has an end").toBeGreaterThan(start);
  const s = CLIENT.slice(start, end);
  expect(s.length, "the slice is not empty").toBeGreaterThan(800);
  return s;
})();

describe("the name appears EXACTLY ONCE per tile", () => {
  it("the centred duplicate under the avatar is gone", () => {
    // `.ph-name` was the second rendering; the bottom band was the third.
    expect(codeOnly(BUILDER)).not.toMatch(/ph-name/);
    expect(codeOnly(CLIENT)).not.toMatch(/ph-name/);
    // And its CSS with it — including a rule that was ALREADY dead before this
    // change (nothing ever put a flag inside .ph-name).
    expect(RELAY_CSS).not.toMatch(/\.ph-name/);
  });

  it("the builder emits ONE name-bearing element", () => {
    // Count the name sinks in the returned markup, not the whole function.
    const ret = BUILDER.slice(BUILDER.indexOf("return ("));
    const sinks = (ret.match(/nm-text|ph-name/g) ?? []).length;
    expect(sinks, "exactly one name element").toBe(1);
  });

  it("the avatar is still there, so a camera-off tile is never blank", () => {
    expect(BUILDER).toMatch(/<div class="av">' \+ escapeHtml\(initials\(avatarName \|\| name\)\)/);
    expect(RELAY_CSS).toMatch(/\.relay-tile \.ph \.av\{/);
  });
});

describe("the bottom band: flag · first name · six digits", () => {
  it("carries the FIRST name only, with the full name on title", () => {
    expect(BUILDER).toMatch(/const first = \(name \|\| ""\)\.trim\(\)\.split\(\/\\s\+\/\)\[0\] \|\| name;/);
    expect(BUILDER).toMatch(/'<div class="nm" title="' \+ escapeHtml\(name\) \+ '">'/);
    expect(BUILDER).toMatch(/<span class="nm-text">' \+ escapeHtml\(first\)/);
  });

  it("prints the six digits with NO label and no grouping dash", () => {
    expect(BUILDER).toMatch(/<span class="nm-pin" dir="ltr">' \+ escapeHtml\(pin as string\)/);
    // The literal "PIN" must not appear in the tile code (comments stripped).
    expect(codeOnly(BUILDER)).not.toMatch(/PIN/);
    // No fmtPin / dash formatting on the band.
    expect(codeOnly(BUILDER)).not.toMatch(/fmtPin/);
  });

  it("bidi-isolates the digits so an Arabic name cannot reorder them", () => {
    // The v2.99.77 PinTag lesson: dir="ltr" alone is not enough inside an RTL run.
    expect(BUILDER).toMatch(/dir="ltr"/);
    expect(RELAY_CSS).toMatch(/\.nm \.nm-pin\{[^}]*unicode-bidi:isolate/);
  });

  it("the digits can never be squeezed out by a long name", () => {
    // .nm is nowrap + overflow:hidden, so without flex:0 0 auto a long first name
    // eats the digits — and the digits are the one part of the band that must never
    // truncate. MEASURED at 390 and 320: pin never clipped, always inside the band.
    expect(RELAY_CSS).toMatch(/\.nm \.nm-pin\{flex:0 0 auto/);
    // …and the name is the only shrinker.
    expect(RELAY_CSS).toMatch(/\.nm \.nm-text\{overflow:hidden;text-overflow:ellipsis[^}]*min-width:0/);
  });

  it("hides the digits on a thumbnail rather than letting them clip", () => {
    expect(RELAY_CSS).toMatch(/is-thumb \.nm \.nm-pin,/);
    expect(RELAY_CSS).toMatch(/compact \.relay-tile \.nm \.nm-pin\{display:none\}/);
  });
});

describe("add-to-contacts lives in exactly ONE place", () => {
  it("the top-left in-call chip is unmounted", () => {
    expect(codeOnly(ENGINE)).not.toMatch(/<InCallSaveContacts/);
  });

  it("the per-tile pill is the single carrier, and only for an unsaved peer", () => {
    expect(BUILDER).toMatch(/const addMark = pin \? addContactMarkHTML\(pin, name\) : "";/);
    expect(CLIENT).toMatch(/if \(!\/\^\\d\{6\}\$\/\.test\(pin\) \|\| savedContactPins\.has\(pin\)\) return "";/);
  });

  it("the pill sits under the name and does not overlap the band", () => {
    // MEASURED: addOverlaps=false at 390 and 320 for both unsaved tiles.
    expect(RELAY_CSS).toMatch(/\.relay-tile \.tile-addc\{position:absolute;left:12px;bottom:44px/);
  });
});

describe("the SELF tile goes through the same builder", () => {
  it("addSelfTile no longer hand-rolls the DOM", () => {
    // It kept its own duplicate name for exactly this reason — a second copy of the
    // markup does not inherit a change to the first.
    const self = CLIENT.slice(CLIENT.indexOf("function addSelfTile"));
    const body = self.slice(0, self.indexOf("\n  /**", 10));
    expect(body.length).toBeGreaterThan(300);
    expect(body).toMatch(
      /tileContentHTML\("You", detectDeviceType\(\), selfFlag \|\| "", undefined, me\.name \|\| "You"\)/
    );
    expect(codeOnly(body)).not.toMatch(/ph-name|nm-text/);
  });

  it("shows the person's OWN initials while the band reads You", () => {
    // avatarName exists only for this: the band says "You", the disc says "KA".
    expect(BUILDER).toMatch(/avatarName\?: string/);
    expect(BUILDER).toMatch(/initials\(avatarName \|\| name\)/);
  });

  it("gets no menu, no maximize, no Add pill and no digits", () => {
    // All four are gated on `pin`, which the self call deliberately omits — you
    // cannot add yourself, and the owner has said they do not need their own number
    // shown back to them (the v2.99.77 call-log rule).
    expect(BUILDER).toMatch(/const menuBtn = pin\s*$/m);
    expect(BUILDER).toMatch(/const addMark = pin \?/);
    expect(BUILDER).toMatch(/const pinTag = \/\^\\d\{6\}\$\/\.test\(pin \|\| ""\)/);
  });
});

describe("the stylesheet is a template literal", () => {
  it("contains no backtick", () => {
    // This broke the build twice: v2.99.16, and again while writing this release —
    // a backtick inside a CSS COMMENT terminates the literal, and the failure
    // surfaces as syntax errors hundreds of lines away.
    expect(RELAY_CSS).not.toContain("`");
  });
});
