/**
 * Local Expo config plugin: PushKit + CallKit on iOS.
 *
 * ── WHY THIS NEEDS NATIVE CODE AT ALL ──────────────────────────────────────
 * A VoIP push is the ONLY thing that shows the real full-screen call screen on a
 * LOCKED iPhone. It does not arrive as a notification: iOS hands it to PushKit
 * (`PKPushRegistry`), which is a native API with no managed-Expo equivalent. So
 * the shell needs two things the JS layer cannot provide:
 *
 *   1. the PushKit token — a DIFFERENT token from the ordinary APNs alert token,
 *      addressed on the `<bundle>.voip` topic, which the server stores as
 *      kind "apns-voip";
 *   2. a `CXProvider` call reported the instant a push arrives.
 *
 * ── THE RULE THAT MAKES THIS DANGEROUS TO GET WRONG ────────────────────────
 * Since iOS 13, EVERY VoIP push MUST result in `reportNewIncomingCall` before the
 * PushKit handler returns. Miss it and iOS terminates the app; miss it repeatedly
 * and iOS STOPS DELIVERING VoIP PUSHES to it altogether — a failure that then
 * looks like a server problem forever. That is why the call is reported from the
 * native handler here and not from JS: when a push wakes a KILLED app, the React
 * Native bridge does not exist yet, so a JS-side report would arrive too late (or
 * never), and the penalty is silent and permanent.
 *
 * `RNVoipPushNotificationManager` + `RNCallKeep` do exactly this, which is why
 * they are used rather than hand-rolled: their whole value is the ordering.
 *
 * ── iOS ONLY, DELIBERATELY ─────────────────────────────────────────────────
 * Android already rings today through the existing FCM/Expo path plus the
 * full-screen-intent notification (`with-android-pip.js`). CallKeep also has an
 * Android ConnectionService implementation, and enabling it would add permissions
 * and a second, competing incoming-call UI to a platform that already works.
 * Only the broken platform changes — the same discipline the Expo-token switch
 * used (iOS-only, so fixing one platform cannot break the other).
 *
 * ── IT FAILS LOUDLY, WHICH IS THE POINT ────────────────────────────────────
 * If the AppDelegate anchor is not found (a future Expo template change), this
 * THROWS at prebuild rather than returning the file untouched. A silent no-op
 * would produce an app that builds, installs, looks correct and never rings —
 * exactly the class of failure this project keeps closing.
 */
const { withAppDelegate, withInfoPlist } = require("@expo/config-plugins");

/** Marker so a second run is a no-op rather than a double injection. */
const MARKER = "// relay-voip-pushkit";

const IMPORTS = `import PushKit
import RNVoipPushNotification
import RNCallKeep`;

/**
 * The PushKit delegate.
 *
 * `didReceiveIncomingPushWith` reports the call to CallKit FIRST and forwards to
 * JS second. That order is not a style choice — see the header. The JS side then
 * takes over the UI once the bridge is up.
 */
const DELEGATE = `
${MARKER} — PushKit (VoIP) + CallKit.
extension AppDelegate: PKPushRegistryDelegate {
  // Registration itself is called directly from didFinishLaunchingWithOptions —
  // deliberately NOT wrapped in a helper here. A wrapper nothing calls reads as
  // the registration path, and the next person to change this would edit the dead
  // one and wonder why the phone stopped ringing.

  func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    // The PushKit token. NOT the same token as the alert token expo-notifications
    // reports — this one is addressed on the <bundle>.voip topic.
    RNVoipPushNotificationManager.didUpdate(pushCredentials, forType: type.rawValue)
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    RNVoipPushNotificationManager.didInvalidatePushToken(forType: type.rawValue)
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    let dict = payload.dictionaryPayload
    let callerName = (dict["callerName"] as? String) ?? "RELAY"
    let callerPin = (dict["callerPin"] as? String) ?? ""
    let hasVideo = (dict["video"] as? String) == "1"
    // A STABLE uuid derived from the room, so the answer JS reports later refers
    // to the same CallKit call. A fresh uuid here would leave a call CallKit
    // believes is still ringing after the user answered.
    let room = (dict["roomId"] as? String) ?? UUID().uuidString
    let uuid = RelayVoip.stableUUID(from: room)

    // REPORTED BEFORE ANYTHING ELSE. iOS kills the app if a VoIP push does not
    // produce a call, and repeated offences stop VoIP delivery permanently.
    RNCallKeep.reportNewIncomingCall(
      uuid,
      handle: callerPin,
      handleType: "generic",
      hasVideo: hasVideo,
      localizedCallerName: callerName,
      supportsHolding: true,
      supportsDTMF: false,
      supportsGrouping: false,
      supportsUngrouping: false,
      fromPushKit: true,
      payload: dict,
      withCompletionHandler: completion
    )
    RNVoipPushNotificationManager.didReceiveIncomingPush(with: payload, forType: type.rawValue)
  }
}

${MARKER} — a room id is not a uuid, so derive one deterministically.
enum RelayVoip {
  static func stableUUID(from seed: String) -> String {
    var bytes = Array(seed.utf8)
    // Pad/truncate to 16 bytes. Deterministic, so the same room always yields the
    // same CallKit identity across the push and the later answer.
    if bytes.count < 16 { bytes += Array(repeating: 0, count: 16 - bytes.count) }
    let b = Array(bytes.prefix(16))
    let hex = b.map { String(format: "%02x", $0) }.joined()
    let s = Array(hex)
    return String(s[0..<8]) + "-" + String(s[8..<12]) + "-" + String(s[12..<16])
      + "-" + String(s[16..<20]) + "-" + String(s[20..<32])
  }
}
`;

/**
 * Inject the imports and the delegate extension into AppDelegate.swift.
 *
 * Exported so the transform is unit-testable: this is a pure string function, and
 * the whole risk here is that it silently does nothing.
 */
function injectSwift(contents) {
  if (contents.includes(MARKER)) return contents; // already applied
  if (!/class AppDelegate/.test(contents)) {
    throw new Error(
      "[with-ios-voip] Could not find `class AppDelegate` in AppDelegate.swift. " +
        "The Expo template changed shape; update plugins/with-ios-voip.js rather than " +
        "shipping a build that cannot ring.",
    );
  }
  // Imports go after the LAST existing import, so we never land above one and
  // never inside a comment block at the top of the file.
  const importRe = /^import .*$/gm;
  let lastImportEnd = -1;
  for (const m of contents.matchAll(importRe)) lastImportEnd = m.index + m[0].length;
  if (lastImportEnd < 0) {
    throw new Error("[with-ios-voip] AppDelegate.swift has no import statements to anchor to.");
  }
  let out =
    contents.slice(0, lastImportEnd) + "\n" + IMPORTS + contents.slice(lastImportEnd);

  // Register for PushKit as soon as the app launches — including a launch CAUSED
  // by a VoIP push, which is why it cannot wait for JS to ask.
  const didFinish =
    /(func application\(\s*_ application: UIApplication,\s*didFinishLaunchingWithOptions[\s\S]*?\{)/;
  if (didFinish.test(out)) {
    out = out.replace(
      didFinish,
      `$1\n    ${MARKER}\n    RNVoipPushNotificationManager.voipRegistration()`,
    );
  } else {
    throw new Error(
      "[with-ios-voip] Could not find didFinishLaunchingWithOptions to register PushKit in.",
    );
  }

  return out + "\n" + DELEGATE;
}

function withRelayIosVoip(config) {
  // Background modes. `voip` is what allows PushKit delivery at all; `audio`
  // keeps a live call's audio session alive. Both may already be present from
  // app.config.ts — merged rather than replaced, so neither clobbers the other.
  config = withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults;
    const modes = new Set(plist.UIBackgroundModes || []);
    modes.add("voip");
    modes.add("audio");
    modes.add("remote-notification");
    plist.UIBackgroundModes = Array.from(modes);
    return cfg;
  });

  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== "swift") {
      throw new Error(
        `[with-ios-voip] Expected a Swift AppDelegate, got "${cfg.modResults.language}". ` +
          "Update this plugin for that language rather than skipping the injection.",
      );
    }
    cfg.modResults.contents = injectSwift(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = withRelayIosVoip;
module.exports.injectSwift = injectSwift;
module.exports.MARKER = MARKER;
