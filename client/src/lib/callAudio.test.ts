import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RINGTONE_NOTES, RINGTONE_LOOP_MS, RINGTONE_PEAK_GAIN } from "@shared/ringtone";
/* Profile now renders through `dict/profile.ts`, so the two copy pins below ask the
   PROPERTY (this sentence reaches this screen) rather than freezing the English
   literal, which would have forbidden the translation while saying nothing about the
   words. Strictly stronger: reaching the dictionary also proves an Arabic half exists. */
import { copyOnScreen, whyCopyMissing } from "../../../server/testing/copyOnScreen";

/**
 * v2.84 — mobile call audio + hang-up icon + signature ringtone, static pins.
 *
 * Field reports fixed here:
 *  1. Android: speaker unresponsive on ANSWERED calls (worked after hang-up +
 *     redial). Cause: modern Android has setSinkId, so the speaker button
 *     opened the sink MENU — but Android enumerates no outputs, so the menu
 *     was an empty dead end and the (working) loudspeaker force was
 *     unreachable. Mobile now treats the button as a speakerphone TOGGLE.
 *  2. iPhone↔Android "one-way audio" (iPhone side silent in BOTH directions).
 *     Cause: iOS routes WebRTC audio to the tiny EARPIECE while the mic is
 *     live — a phone held at arm's length hears ~nothing. Phones now default
 *     the speaker ON (persisted preference), primed inside the Answer/dial
 *     gesture and applied at establishment.
 *  3. Corrupted/misleading hang-up icon on Android: the pickup receiver was
 *     rotated 135° via an inline CSS transform, which some WebViews ignore —
 *     showing an ANSWER icon on End. Replaced with a drawn Material call_end.
 *  4. Custom ringtone at a fixed MEDIUM-LOUD level, shared spec used by both
 *     the engine and Profile's "Test ringtone" preview.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const CLIENT = read("client/src/lib/relayClient.ts");
const ASSETS = read("client/src/lib/relayAssets.ts");
const NOTIF = read("client/src/app/notifications.ts");
const PROFILE = read("client/src/pages/app/Profile.tsx");

describe("mobile speaker — route menu, default-on, gesture priming", () => {
  it("the audio button opens the Loudspeaker/Earpiece/Bluetooth ROUTE MENU on Android AND iOS (v2.99.4 — never the dead sink menu)", () => {
    // v2.84 made the button a blind toggle because the sink menu enumerated
    // EMPTY on phones; v2.99.4 (owner spec) replaces the toggle with a real
    // three-route menu built from what phones CAN do (loudspeaker force /
    // drop-force for earpiece / drop-force so the OS follows Bluetooth).
    expect(CLIENT).toMatch(/if \(IS_ANDROID \|\| IS_IOS\) \{\s*\n\s*void renderMobileAudioMenu\(\)/);
    expect(CLIENT).toMatch(/mobileAudioRow\("loud"/);
    expect(CLIENT).toMatch(/mobileAudioRow\("ear"/);
    expect(CLIENT).toMatch(/mobileAudioRow\("bt"/);
  });

  it("phones DEFAULT the speaker ON (persisted preference; iOS earpiece routing was heard as one-way audio)", () => {
    expect(CLIENT).toMatch(/function loudspeakerPref\(\): boolean/);
    expect(CLIENT).toMatch(/return IS_IOS \|\| IS_ANDROID;/);
    // The toggle REMEMBERS the choice in both directions.
    expect(CLIENT).toMatch(/setLoudspeakerPref\(false\); \/\/ remembered: next calls start on the earpiece/);
    expect(CLIENT).toMatch(/if \(ok\) setLoudspeakerPref\(true\);/);
  });

  it("BOTH call audio contexts are PRIMED inside real gestures (Answer tap + every dial path)", () => {
    expect(CLIENT).toMatch(/function loudspeakerPrime\(\)/);
    // acceptInvite + dial() + dialGroup() + legacy keypad startCall.
    const primes = CLIENT.match(/primeCallAudio\(\);/g) || [];
    expect(primes.length).toBeGreaterThanOrEqual(4);
    /* THE PROPERTY, not the arrangement: priming is ONE funnel that covers both
       contexts, so a sixth entry point cannot prime one and forget the other.
       That omission is exactly what left `meshAudioCtx` closed-but-never-primed
       after #160 — built inside `ontrack`, hence SUSPENDED on WebKit, which
       starves the <audio> element holding the same remote track. */
    const funnel = CLIENT.slice(CLIENT.indexOf("function primeCallAudio()"));
    expect(funnel.slice(0, 200)).toMatch(/loudspeakerPrime\(\);[\s\S]*meshSpeakerPrime\(\);/);
    /* ...and no gesture site primes just one of the two behind the funnel's back:
       each half has exactly ONE caller, which is the funnel. */
    expect((CLIENT.match(/loudspeakerPrime\(\);/g) || []).length).toBe(1);
    expect((CLIENT.match(/meshSpeakerPrime\(\);/g) || []).length).toBe(1);
  });

  it("the remembered speaker state is APPLIED at establishment — with the never-mute-into-a-dead-context guard intact", () => {
    expect(CLIENT).toMatch(/if \(\(IS_IOS \|\| IS_ANDROID\) && loudspeakerPref\(\) && !loudspeakerOn\) \{\s*\n\s*void loudspeakerEnable\(\)/);
    // Safety invariants from v2.80 stay: route-then-mute + running-state gate.
    expect(CLIENT).toMatch(/if \(loudspeakerCtx\.state !== "running"\) return false; \/\/ never mute → never silent/);
    expect(CLIENT).toMatch(/loudspeakerCtx\.onstatechange = \(\) => \{/);
  });
});

describe("hang-up icon — drawn call_end, no CSS transform", () => {
  it("uses the Material call_end path and drops the rotate(135deg) inline style", () => {
    expect(ASSETS).toMatch(/id="hangBtn"[\s\S]{0,700}M12 9c-1\.6 0-3\.15\.25-4\.6\.72/);
    expect(ASSETS).not.toMatch(/rotate\(135deg\)/);
  });
});

describe("signature ringtone — one shared spec, medium-loud", () => {
  it("the spec is distinct (a multi-note melody, not a bare burst) and MEDIUM-loud (well above the old 0.12, below max)", () => {
    expect(RINGTONE_NOTES.length).toBeGreaterThanOrEqual(4);
    expect(RINGTONE_PEAK_GAIN).toBeGreaterThanOrEqual(0.2);
    expect(RINGTONE_PEAK_GAIN).toBeLessThanOrEqual(0.35);
    expect(RINGTONE_LOOP_MS).toBeGreaterThanOrEqual(2000);
  });

  it("the ENGINE plays the shared spec for incoming rings (and keeps the soft outgoing dial-tone)", () => {
    expect(CLIENT).toMatch(/from "@shared\/ringtone"/);
    // QW-11: incoming rings the RESOLVED per-contact variant, whose default
    // (getRingtone(null)) is the shared "classic" spec — so an un-set contact is
    // unchanged. Outgoing keeps the soft single dial-tone beep.
    expect(CLIENT).toMatch(/getRingtone\(fromNumber && contactRingtoneResolver \? contactRingtoneResolver\(fromNumber\) : null\)/);
    expect(CLIENT).toMatch(/kind === "incoming" \? variant!\.notes : \[\{ freq: 425, at: 0, dur: 0\.9, gain: 0\.12 \}\]/);
    expect(CLIENT).toMatch(/kind === "incoming" \? variant!\.loopMs : 2000/);
    // Android vibration stays part of the ring.
    expect(CLIENT).toMatch(/navigator\.vibrate\?\.\(\[400, 200, 400\]\)/);
  });

  it("Profile offers a 'Test ringtone' preview playing the SAME spec", () => {
    expect(NOTIF).toMatch(/export function playRingtonePreview/);
    expect(NOTIF).toMatch(/RINGTONE_NOTES/);
    expect(PROFILE).toMatch(/playRingtonePreview\(\)/);
    expect(copyOnScreen(PROFILE, "Test ringtone"), whyCopyMissing(PROFILE, "Test ringtone")).toBe(
      true
    );
  });
});

describe("Profile — call-alert (push) management", () => {
  it("granting notifications also registers this device for call-alert pushes, with state shown", () => {
    expect(PROFILE).toMatch(/trpc\.push\.publicKey\.useQuery/);
    expect(PROFILE).toMatch(/ensurePushSubscription\(pubKey\.data\.key/);
    expect(copyOnScreen(PROFILE, "Call alerts on"), whyCopyMissing(PROFILE, "Call alerts on")).toBe(
      true
    );
    expect(PROFILE).toMatch(/iosNeedsInstallForPush\(\)/);
  });
});
