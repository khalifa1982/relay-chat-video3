import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RINGTONE_NOTES, RINGTONE_LOOP_MS, RINGTONE_PEAK_GAIN } from "@shared/ringtone";

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

describe("mobile speaker — toggle, default-on, gesture priming", () => {
  it("the audio button is a speakerphone TOGGLE on Android AND iOS (no dead sink menu)", () => {
    expect(CLIENT).toMatch(/if \(IS_ANDROID \|\| IS_IOS\) \{ void toggleLoudspeaker\(\); return; \}/);
  });

  it("phones DEFAULT the speaker ON (persisted preference; iOS earpiece routing was heard as one-way audio)", () => {
    expect(CLIENT).toMatch(/function loudspeakerPref\(\): boolean/);
    expect(CLIENT).toMatch(/return IS_IOS \|\| IS_ANDROID;/);
    // The toggle REMEMBERS the choice in both directions.
    expect(CLIENT).toMatch(/setLoudspeakerPref\(false\); \/\/ remembered: next calls start on the earpiece/);
    expect(CLIENT).toMatch(/if \(ok\) setLoudspeakerPref\(true\);/);
  });

  it("the speaker context is PRIMED inside real gestures (Answer tap + every dial path)", () => {
    expect(CLIENT).toMatch(/function loudspeakerPrime\(\)/);
    const primes = CLIENT.match(/loudspeakerPrime\(\);/g) || [];
    // acceptInvite + dial() + dialGroup() + legacy keypad startCall.
    expect(primes.length).toBeGreaterThanOrEqual(4);
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
    expect(CLIENT).toMatch(/kind === "incoming" \? RINGTONE_NOTES : \[\{ freq: 425, at: 0, dur: 0\.9, gain: 0\.12 \}\]/);
    expect(CLIENT).toMatch(/kind === "incoming" \? RINGTONE_LOOP_MS : 2000/);
    // Android vibration stays part of the ring.
    expect(CLIENT).toMatch(/navigator\.vibrate\?\.\(\[400, 200, 400\]\)/);
  });

  it("Profile offers a 'Test ringtone' preview playing the SAME spec", () => {
    expect(NOTIF).toMatch(/export function playRingtonePreview/);
    expect(NOTIF).toMatch(/RINGTONE_NOTES/);
    expect(PROFILE).toMatch(/playRingtonePreview\(\)/);
    expect(PROFILE).toMatch(/Test ringtone/);
  });
});

describe("Profile — call-alert (push) management", () => {
  it("granting notifications also registers this device for call-alert pushes, with state shown", () => {
    expect(PROFILE).toMatch(/trpc\.push\.publicKey\.useQuery/);
    expect(PROFILE).toMatch(/ensurePushSubscription\(pubKey\.data\.key/);
    expect(PROFILE).toMatch(/Call alerts on/);
    expect(PROFILE).toMatch(/iosNeedsInstallForPush\(\)/);
  });
});
