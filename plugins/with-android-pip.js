/**
 * Local Expo config plugin: enable Android picture-in-picture for the main
 * Activity. This lets the app continue showing an active RELAY call in a
 * floating window when the user leaves the app mid-call.
 *
 * It sets on the main <activity>:
 *   - android:supportsPictureInPicture="true"
 *   - android:resizeableActivity="true"
 *   - adds "smallestScreenSize" + "screenLayout" to configChanges so the
 *     Activity is not recreated when entering PiP (which would drop the call).
 */
const { withAndroidManifest } = require("@expo/config-plugins");

const REQUIRED_CONFIG_CHANGES = [
  "screenSize",
  "smallestScreenSize",
  "screenLayout",
  "orientation",
];

function withAndroidPip(config) {
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

    activity.$["android:supportsPictureInPicture"] = "true";
    activity.$["android:resizeableActivity"] = "true";

    const existing = (activity.$["android:configChanges"] || "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    const merged = new Set([...existing, ...REQUIRED_CONFIG_CHANGES]);
    activity.$["android:configChanges"] = Array.from(merged).join("|");

    return cfg;
  });
}

module.exports = withAndroidPip;
