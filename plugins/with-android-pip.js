/**
 * Local Expo config plugin for RELAY's native call behaviour on Android:
 *
 *  1. Picture-in-picture for the main Activity, so an active call keeps showing
 *     in a floating window when the user leaves the app mid-call:
 *       - android:supportsPictureInPicture="true"
 *       - android:resizeableActivity="true"
 *       - configChanges so the Activity is not recreated when entering PiP
 *         (which would drop the call).
 *
 *  2. Lock-screen call UI, so the incoming-call notification's full-screen
 *     intent can wake and show over the lock screen:
 *       - android:showWhenLocked="true"
 *       - android:turnScreenOn="true"
 *
 *  3. The USE_FULL_SCREEN_INTENT permission, required for full-screen-intent
 *     (call-style) notifications on Android 10+.
 */
const { withAndroidManifest, AndroidConfig } = require("@expo/config-plugins");

const REQUIRED_CONFIG_CHANGES = [
  "screenSize",
  "smallestScreenSize",
  "screenLayout",
  "orientation",
];

function withRelayAndroidCall(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const application = manifest.manifest.application?.[0];
    if (!application || !application.activity) return cfg;

    const mainActivity = application.activity.find((a) => {
      const name = a.$?.["android:name"];
      return name === ".MainActivity" || name === "expo.modules.ReactActivity";
    });
    const activity = mainActivity || application.activity[0];
    if (!activity) return cfg;

    // --- Picture-in-picture ---
    activity.$["android:supportsPictureInPicture"] = "true";
    activity.$["android:resizeableActivity"] = "true";

    // --- Lock-screen call UI ---
    activity.$["android:showWhenLocked"] = "true";
    activity.$["android:turnScreenOn"] = "true";

    const existing = (activity.$["android:configChanges"] || "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    const merged = new Set([...existing, ...REQUIRED_CONFIG_CHANGES]);
    activity.$["android:configChanges"] = Array.from(merged).join("|");

    // --- USE_FULL_SCREEN_INTENT permission ---
    try {
      AndroidConfig.Permissions.addPermission(
        manifest,
        "android.permission.USE_FULL_SCREEN_INTENT",
      );
    } catch {
      // Fallback: add manually if helper is unavailable.
      manifest.manifest["uses-permission"] =
        manifest.manifest["uses-permission"] || [];
      const has = manifest.manifest["uses-permission"].some(
        (p) =>
          p.$?.["android:name"] ===
          "android.permission.USE_FULL_SCREEN_INTENT",
      );
      if (!has) {
        manifest.manifest["uses-permission"].push({
          $: { "android:name": "android.permission.USE_FULL_SCREEN_INTENT" },
        });
      }
    }

    return cfg;
  });
}

module.exports = withRelayAndroidCall;
