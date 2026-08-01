import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.86 — NATIVE Android app (mobile/app: Capacitor + native call layer),
 * static pins binding the four layers together:
 *   web engine ⇄ nativeBridge ⇄ Capacitor plugins (Java) ⇄ server FCM sender.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const BRIDGE = read("client/src/lib/nativeBridge.ts");
const CLIENT = read("client/src/lib/relayClient.ts");
const PROVIDER = read("client/src/app/RelayEngine.tsx");
const ROUTERS = read("server/v2routers.ts");
const V2DB = read("server/v2db.ts");
const WEBPUSH = read("server/webPush.ts");
const FCM = read("server/fcm.ts");
const MANIFEST = read("mobile/app/android/app/src/main/AndroidManifest.xml");
const MAIN = read("mobile/app/android/app/src/main/java/org/yourchat/relay/MainActivity.java");
const HELPER = read("mobile/app/android/app/src/main/java/org/yourchat/relay/NotificationHelper.java");
const AUDIO = read("mobile/app/android/app/src/main/java/org/yourchat/relay/CallAudioPlugin.java");
const GRADLE_APP = read("mobile/app/android/app/build.gradle");
const GRADLE_VARS = read("mobile/app/android/variables.gradle");
const WORKFLOW = read(".github/workflows/android-apk.yml");

describe("web engine ⇄ native bridge", () => {
  it("the bridge is a safe no-op outside the native shell", () => {
    expect(BRIDGE).toMatch(/export function isNativeAndroid/);
    expect(BRIDGE).toMatch(/if \(!isNativeAndroid\(\)\) return false;/);
    expect(BRIDGE).toMatch(/nativeSetSpeaker|nativeSetInCall|nativeGetPushToken/);
  });

  it("speaker toggle prefers the REAL AudioManager route in the native app, with WebAudio fallback", () => {
    expect(CLIENT).toMatch(/if \(isNativeAndroid\(\)\) \{\s*\n\s*const next = !loudspeakerOn;\s*\n\s*if \(await nativeSetSpeaker\(next\)\)/);
  });

  it("establishment enters native call mode (+FGS) and hang-up leaves it", () => {
    expect(CLIENT).toMatch(/void nativeSetInCall\(true\);/);
    expect(CLIENT).toMatch(/if \(isNativeAndroid\(\)\) void nativeSetInCall\(false\);/);
  });

  it("the provider registers the FCM device token with kind:\"fcm\"", () => {
    expect(PROVIDER).toMatch(/nativeGetPushToken\(\)/);
    expect(PROVIDER).toMatch(/pushSubscribe\.mutate\(\{ endpoint: token, kind: "fcm" \}\)/);
  });
});

describe("server — FCM transport", () => {
  it("subscriptions carry kind, and every NATIVE kind is keyless", () => {
    // REWRITTEN in v2.99.79. This used to freeze the exact two-value enum
    // (`["webpush", "fcm"]`) and the exact `=== "fcm" || !!v.keys` refinement,
    // so adding a THIRD native transport broke it while saying nothing about
    // the property that matters. The property is: the column exists, the enum
    // covers every kind the sender can route, and encryption keys are demanded
    // for webpush ONLY — a native token has none, so a keys-always rule would
    // refuse every native registration.
    expect(V2DB).toMatch(/ADD COLUMN `kind` varchar\(10\)/);

    const NATIVE_KINDS = ["fcm", "expo"] as const;

    // The stored type and the wire enum must both admit webpush + every native
    // kind. Order-independent, so a future addition does not have to land in a
    // particular slot to keep this green.
    // Anchored inside upsertPushSubscription — `kind?:` also names a
    // CONVERSATION kind ("dm" | "group") earlier in the same file, and an
    // unanchored match reads that one instead.
    const UPSERT = V2DB.slice(V2DB.indexOf("export async function upsertPushSubscription("));
    expect(UPSERT.length, "upsertPushSubscription still exists").toBeGreaterThan(200);
    // `[a-z-]`, not `[a-z]`: v2.105.13's "apns-voip" carries a hyphen, and a
    // character class that excluded it made this read EMPTY — the guard failing
    // for a reason unrelated to parity, which is worse than failing loudly.
    const dbKinds = /kind\?: ((?:"[a-z-]+"(?: \| )?)+);/.exec(UPSERT)?.[1] ?? "";
    const enumKinds = /kind: z\.enum\(\[([^\]]+)\]\)\.optional\(\)/.exec(ROUTERS)?.[1] ?? "";
    expect(dbKinds, "v2db declares the kind union").not.toBe("");
    expect(enumKinds, "the router declares the kind enum").not.toBe("");
    for (const k of ["webpush", ...NATIVE_KINDS]) {
      expect(dbKinds, `v2db kind union covers ${k}`).toContain(`"${k}"`);
      expect(enumKinds, `router kind enum covers ${k}`).toContain(`"${k}"`);
    }

    // EVERY declared kind must FIT varchar(10) (v2.105.13). "apns-voip" is nine
    // characters, so the column takes it with no migration — but the next one
    // might not, and MySQL would TRUNCATE rather than refuse, leaving a row whose
    // kind silently routes to the wrong transport (or to none). Derived from the
    // declaration rather than hard-coded, so a new kind is checked automatically.
    for (const m of dbKinds.matchAll(/"([a-z-]+)"/g)) {
      expect(m[1].length, `"${m[1]}" fits the varchar(10) kind column`).toBeLessThanOrEqual(10);
    }

    // Keys are required for webpush only. Expressed as "not webpush ⇒ no keys
    // needed" rather than naming the native kinds, so it cannot go stale again.
    expect(ROUTERS).toMatch(/\(v\.kind \?\? "webpush"\) !== "webpush" \|\| !!v\.keys/);
  });

  it("sendPushToIdentity fans out to FCM tokens as DATA messages and prunes dead tokens", () => {
    expect(WEBPUSH).toMatch(/const fcmTokens = subs\.filter\(s => s\.kind === "fcm"\)\.map\(s => s\.endpoint\);/);
    expect(WEBPUSH).toMatch(/sendFcmData\(fcmTokens/);
    expect(WEBPUSH).toMatch(/r\.invalidTokens\.map\(t => deletePushSubscription\(t\)/);
    expect(FCM).toMatch(/https:\/\/fcm\.googleapis\.com\/v1\/projects\//);
    // REWRITTEN v2.106.74. This froze the bare literal `"70s"` — which WAS the
    // defect: APNs carried its own, different, private `45`, so one event had two
    // lifetimes and an iPhone reconnecting at t=50s got nothing where an Android
    // rang. The property is that a ring is bounded by the SHARED constant (whose
    // value is tied to the server's pending-ring TTL in callPushExpiry.test.ts)
    // while everything else keeps the long TTL.
    expect(FCM).toMatch(/data\.kind === "incoming-call"[\s\S]{0,80}`\$\{CALL_PUSH_EXPIRY_SECONDS\}s`/);
    expect(FCM).toMatch(/"3600s"/);
  });
});

describe("native Android project", () => {
  it("manifest declares the call components + the permissions the ring needs", () => {
    for (const needle of [
      'android:name=".IncomingCallActivity"',
      'android:showWhenLocked="true"',
      'android:name=".CallService"',
      'android:foregroundServiceType="microphone|mediaPlayback"',
      'android:name=".RelayFcmService"',
      "com.google.firebase.MESSAGING_EVENT",
      "android.permission.USE_FULL_SCREEN_INTENT",
      "android.permission.FOREGROUND_SERVICE_MICROPHONE",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO",
    ]) {
      expect(MANIFEST).toContain(needle);
    }
  });

  it("MainActivity registers both native plugins before the bridge boots", () => {
    expect(MAIN).toMatch(/registerPlugin\(CallAudioPlugin\.class\);\s*\n\s*registerPlugin\(CallNativePlugin\.class\);\s*\n\s*super\.onCreate/);
  });

  it("the incoming ring is a FULL-SCREEN intent on the ringtone channel with a 65s self-clear", () => {
    expect(HELPER).toMatch(/setFullScreenIntent\(fullPi, true\)/);
    expect(HELPER).toMatch(/RingtoneManager\.getDefaultUri\(RingtoneManager\.TYPE_RINGTONE\)/);
    expect(HELPER).toMatch(/setTimeoutAfter\(65_000\)/);
    expect(HELPER).toMatch(/CATEGORY_CALL/);
  });

  it("speakerphone uses setCommunicationDevice on 31+ with the legacy fallback below", () => {
    expect(AUDIO).toMatch(/Build\.VERSION\.SDK_INT >= 31/);
    expect(AUDIO).toMatch(/TYPE_BUILTIN_SPEAKER/);
    expect(AUDIO).toMatch(/am\.setSpeakerphoneOn\(on\);/);
  });

  it("toolchain matches 2026 store requirements (targetSdk 35, AGP 8.9.x) + Firebase messaging via BoM", () => {
    expect(GRADLE_VARS).toMatch(/targetSdkVersion = 35/);
    expect(read("mobile/app/android/build.gradle")).toMatch(/com\.android\.tools\.build:gradle:8\.9\.2/);
    expect(GRADLE_APP).toMatch(/firebase-bom/);
    expect(GRADLE_APP).toMatch(/firebase-messaging/);
    // FCM stays optional: google-services only applies when the config exists.
    expect(GRADLE_APP).toMatch(/google-services\.json/);
  });

  it("CI builds the native app as the PRIMARY artifact set", () => {
    expect(WORKFLOW).toMatch(/npx cap sync android/);
    expect(WORKFLOW).toMatch(/RELAY-NATIVE-debug-apk/);
    expect(WORKFLOW).toMatch(/RELAY-NATIVE-release-aab/);
    expect(WORKFLOW).toMatch(/RELAY-NATIVE-release-aab-SIGNED/);
  });
});
