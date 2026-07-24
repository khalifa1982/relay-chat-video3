import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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
    const tap = DIALER.slice(DIALER.indexOf("function tap(d: string)"), DIALER.indexOf("function tap(d: string)") + 500);
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
    expect(DIALER).toMatch(/className="mt-1\.5 text-\[0\.78rem\] min-h-4 text-muted-foreground"/);
    expect(DIALER).not.toMatch(/text-\[0\.78rem\] h-4 text-muted-foreground/);
  });
  it("name+badge sit on line 1 and presence on line 2 (a flex column, not one row)", () => {
    expect(DIALER).toMatch(/<span className="flex flex-col items-center gap-0\.5 leading-tight">/);
  });
  it("the badge renders WITHOUT its stacked caption, with the tier word inline", () => {
    expect(DIALER).toMatch(/<RoleBadge role=\{tier\} size=\{13\} caption=\{false\} \/>/);
    expect(DIALER).toMatch(/const tierWord = roleLabel\(tier\)/);
    expect(BADGE).toMatch(/export function roleLabel/);
  });
});

describe("v2.99.36 (3) — the Save-to-contacts pill is never clipped", () => {
  it("the pill is a shrink-0 centred row of its own", () => {
    expect(DIALER).toMatch(/<div className="shrink-0 flex justify-center pt-1 pb-0\.5">/);
  });
  it("the card can scroll as a safety valve so no row is ever unreachable", () => {
    expect(DIALER).toMatch(/flex flex-col overflow-y-auto/);
  });
});
