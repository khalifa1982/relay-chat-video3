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
  it("subscriptions carry kind (migrator + upsert + router enum, keys optional for fcm)", () => {
    expect(V2DB).toMatch(/ADD COLUMN `kind` varchar\(10\)/);
    expect(V2DB).toMatch(/kind\?: "webpush" \| "fcm";/);
    expect(ROUTERS).toMatch(/kind: z\.enum\(\["webpush", "fcm"\]\)\.optional\(\)/);
    expect(ROUTERS).toMatch(/=== "fcm" \|\| !!v\.keys/);
  });

  it("sendPushToIdentity fans out to FCM tokens as DATA messages and prunes dead tokens", () => {
    expect(WEBPUSH).toMatch(/const fcmTokens = subs\.filter\(s => s\.kind === "fcm"\)\.map\(s => s\.endpoint\);/);
    expect(WEBPUSH).toMatch(/sendFcmData\(fcmTokens/);
    expect(WEBPUSH).toMatch(/r\.invalidTokens\.map\(t => deletePushSubscription\(t\)/);
    expect(FCM).toMatch(/https:\/\/fcm\.googleapis\.com\/v1\/projects\//);
    expect(FCM).toMatch(/ttl: data\.kind === "incoming-call" \? "70s"/);
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
