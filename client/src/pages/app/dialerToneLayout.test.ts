import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const DIALER = read("client/src/pages/app/Dialer.tsx");
const DTMF = read("client/src/lib/dtmf.ts");
const BADGE = read("client/src/app/VerifiedBadge.tsx");

/**
 * v2.99.36 — owner feedback on the Dialer (screenshot):
 *  (1) "when you just enter the number, the first name and the last name is
 *      showing you online and the badge register — it's overlap": the preview
 *      sub-line was a FIXED h-4 (16px) row, but RoleBadge stacks its tier
 *      caption under the mark (~22px), so it overflowed into the keypad.
 *  (2) "when you click on the numbers on the dial pad you need to give a tone
 *      key like you're dialing": real DTMF tones per key.
 *  (3) "save to contact is not showing": the pill was clipped by the bottom of
 *      the no-scroll card / tab bar.
 */
describe("v2.99.36 (2) — real DTMF dial-pad tones", () => {
  it("implements the standard DTMF dual-tone frequency table", () => {
    // Row/column pairs must be the genuine telephony frequencies.
    expect(DTMF).toMatch(/"1": \[697, 1209\]/);
    expect(DTMF).toMatch(/"5": \[770, 1336\]/);
    expect(DTMF).toMatch(/"9": \[852, 1477\]/);
    expect(DTMF).toMatch(/"0": \[941, 1336\]/);
    expect(DTMF).toMatch(/"\*": \[941, 1209\]/);
    expect(DTMF).toMatch(/"#": \[941, 1477\]/);
  });
  it("plays BOTH tones of the pair together (a dual tone, not a single beep)", () => {
    expect(DTMF).toMatch(/pair\.map\(\(freq\) => \{/);
    expect(DTMF).toMatch(/o\.type = "sine"/);
  });
  it("is OUTPUT-ONLY — it can never hold the microphone", () => {
    // Critical given the owner's mic/camera-stays-live report: no capture APIs.
    expect(DTMF).not.toMatch(/getUserMedia/);
    expect(DTMF).not.toMatch(/createMediaStreamSource/);
    expect(DTMF).toMatch(/createOscillator/);
  });
  it("ramps the gain so the tone never clicks, and stays quieter than the ringtone", () => {
    expect(DTMF).toMatch(/linearRampToValueAtTime/);
    // 0.085 shipped first and was too quiet to hear over ambient noise (the
    // landing pad hit the same wall at 0.045, measured on a device). Both pads
    // now use 0.18 — audible, still well under the ringtone's 0.28.
    expect(DTMF).toMatch(/const PEAK = 0\.18/);
  });
  it("resumes a suspended context BEFORE scheduling, with a lookahead (iOS silence)", () => {
    // `resume()` is async and a suspended context's clock doesn't advance, so
    // scheduling in the same tick pinned the note to an already-elapsed time and
    // iOS dropped it. Resume first, then schedule a few ms out.
    expect(DTMF).toMatch(/const LOOKAHEAD_S = 0\.005;/);
    expect(DTMF).toMatch(/ac\.currentTime \+ LOOKAHEAD_S/);
    expect(DTMF).toMatch(/\.resume\(\)\s*\n?\s*\.then\(\(\) => fire\(ac, pair\)\)/);
    // The old same-tick shape must not come back.
    expect(DTMF).not.toMatch(/void ac\.resume\(\)\.catch\(\(\) => \{\}\);\s*\n\s*const now = ac\.currentTime;/);
  });
  it("the Dialer plays a tone on a pad tap AND on hardware-keyboard digits", () => {
    expect(DIALER).toMatch(/import \{ playDtmf, disposeDtmf \} from "@\/lib\/dtmf"/);
    // Bounded by the function's own end rather than a fixed +500 characters, which
    // silently shrank as the guard above the tone grew (the v2.99.78 lesson).
    const at = DIALER.indexOf("function tap(d: string)");
    const tap = DIALER.slice(at, DIALER.indexOf("\n  }", at) + 4);
    expect(tap.length).toBeGreaterThan(120);
    expect(tap).toMatch(/playDtmf\(d\)/);
    expect(DIALER).toMatch(/playDtmf\(e\.key\)/);
  });
  it("closes the tone AudioContext when the dial pad unmounts", () => {
    expect(DIALER).toMatch(/useEffect\(\(\) => \(\) => disposeDtmf\(\), \[\]\)/);
    expect(DTMF).toMatch(/export function disposeDtmf/);
  });
});

describe("v2.99.36 (1) — the number-preview line no longer overlaps", () => {
  it("the sub-line can grow instead of being clipped at a fixed 16px", () => {
    // v2.99.90 changed the MARGINS on this row (owner asked for space between the
    // number, the information and the pad), so the exact class string is no longer
    // the invariant. What matters — and what the v2.99.36 bug was — is that the row
    // has a MINIMUM height it can grow past, never a fixed one.
    expect(DIALER).toMatch(/text-\[0\.78rem\] min-h-4 text-muted-foreground/);
    expect(DIALER).not.toMatch(/text-\[0\.78rem\] h-4 text-muted-foreground/);
  });
  it("name+badge sit on line 1 and presence on line 2 (a flex column, not one row)", () => {
    // The gap widened from 0.5 to 1 in v2.99.90 ("make space between the little
    // bit"), so the exact value is not the property — being a COLUMN is, because a
    // single row is what let the badge collide with the keypad in v2.99.36.
    expect(DIALER).toMatch(/<span className="flex flex-col items-center gap-1 leading-tight">/);
    expect(DIALER).not.toMatch(/<span className="flex flex-row items-center[^"]*leading-tight">/);
  });
  it("the badge renders WITHOUT its stacked caption, with the tier word inline", () => {
    expect(DIALER).toMatch(/<RoleBadge role=\{tier\} size=\{13\} caption=\{false\} \/>/);
    expect(DIALER).toMatch(/const tierWord = roleLabel\(tier\)/);
    expect(BADGE).toMatch(/export function roleLabel/);
  });
});

describe("v2.99.36 (3) — the Save-to-contacts pill is never clipped", () => {
  it("the add-to-contacts button cannot displace the digits it sits beside", () => {
    /* REWRITTEN v2.106.78 TO THE PROPERTY. This used to assert the exact string
       `<div className="shrink-0 flex justify-center pt-1 pb-0.5">` — the pill's
       own ROW — which is the arrangement the owner asked to replace ("in place
       of showing below, show on the right after the numbers you enter it"). So
       it froze a location and said nothing about what v2.99.36 was actually for.

       WHAT v2.99.36 WAS FOR: the button was clipped and unreachable, because the
       card is a no-scroll flex column and it was an EXTRA row at the bottom of
       it. Two things now deliver that, and both are asserted:

       (1) it is no longer a row at all — it is ABSOLUTELY positioned beside the
           readout, so it adds no height to a card whose budget the keypad
           subtracts from by a hardcoded constant, and it cannot push the digits
           off centre (the readout stays exactly where it has always been);
       (2) the card can still scroll, which is the safety valve. */
    const readout = DIALER.slice(DIALER.indexOf("{quickAddTarget ?"));
    expect(readout.length, "found the mount").toBeGreaterThan(80);
    const mount = readout.slice(0, 400);
    expect(mount).toMatch(/absolute/);
    /* Positioned by a LOGICAL property, so the button swaps sides with the text
       direction rather than being pinned to the physical right — this app
       renders Arabic.
       AND THE UTILITY IS PROVEN TO EXIST, which is not pedantry: the first cut
       of this used `inset-inline-start-full`, which is the CSS PROPERTY name and
       not a Tailwind class. It emitted nothing, the absolutely-positioned button
       fell back to its static position and landed ON TOP of the digits — and a
       source pin could not tell the difference, because a class that does not
       exist looks identical to one that does. Only the browser measurement
       caught it, so the class is now checked against the built stylesheet. */
    expect(mount).toMatch(/\bstart-full\b/);
    expect(mount).not.toMatch(/\bleft-full\b|\bright-0\b|inset-inline-start-full/);
    const built = (() => {
      const dir = resolve(process.cwd(), "dist/public/assets");
      if (!existsSync(dir)) return null;
      const f = readdirSync(dir).find((n) => /^index-.*\.css$/.test(n));
      return f ? readFileSync(resolve(dir, f), "utf8") : null;
    })();
    if (built) {
      // Skipped when nothing has been built yet — a test must not demand a build
      // step — but enforced whenever dist/ is present, which includes CI.
      expect(built, "the .start-full utility really exists").toContain(".start-full");
      expect(built, "the 34px gap utility really exists").toContain(".ps-\\[34px\\]");
    }
    // The owner's own figure: "like 34 space" after the last digit.
    expect(mount).toMatch(/ps-\[34px\]/);
    // And it is NOT a flex row in the card's column any more.
    expect(DIALER).not.toMatch(/<div className="shrink-0 flex justify-center pt-1 pb-0\.5">/);
  });
  it("the card can scroll as a safety valve so no row is ever unreachable", () => {
    expect(DIALER).toMatch(/flex flex-col overflow-y-auto/);
  });
});
