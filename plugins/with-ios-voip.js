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
 * ── THE ObjC POD HEADERS GO IN THE BRIDGING HEADER, NOT IN A SWIFT `import` ──
 * Both `react-native-callkeep` and `react-native-voip-push-notification` are pure
 * Objective-C (`source_files = "ios/<Pod>/*.{h,m}"`), neither declares `header_dir`
 * or a modulemap, and the Expo Podfile leaves `use_frameworks!` OFF (it is
 * conditional on `ios.useFrameworks`/`USE_FRAMEWORKS`, and `use_modular_headers!`
 * is absent too). CocoaPods therefore builds them as static libraries with NO Swift
 * module, so `import RNCallKeep` fails with "No such module".
 *
 * They reach Swift through the bridging header, which prebuild already generates at
 * `ios/<Project>/<Project>-Bridging-Header.h` and already wires into both build
 * configurations via `SWIFT_OBJC_BRIDGING_HEADER` (verified against a real
 * prebuild). This plugin APPENDS to that file and re-asserts the build setting, so
 * it is correct whether or not the template did it.
 *
 * `import PushKit` STAYS in the Swift: that one is a real system framework.
 *
 * ── IT FAILS LOUDLY, WHICH IS THE POINT ────────────────────────────────────
 * If the AppDelegate anchor is not found (a future Expo template change), this
 * THROWS at prebuild rather than returning the file untouched. A silent no-op
 * would produce an app that builds, installs, looks correct and never rings —
 * exactly the class of failure this project keeps closing.
 */
const {
  withAppDelegate,
  withInfoPlist,
  withDangerousMod,
  withXcodeProject,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/** Marker so a second run is a no-op rather than a double injection. */
const MARKER = "// relay-voip-pushkit";

/** The bridging header is C, so its marker has to be a C comment. */
const H_MARKER = "/* relay-voip-pushkit */";

/**
 * Only system frameworks belong in a Swift `import`.
 * RNCallKeep and RNVoipPushNotificationManager come through the bridging header.
 *
 * `Foundation` is listed even though the template resolves it transitively today
 * (it uses `UIWindow`/`UIScreen` without importing UIKit at all). The injected code
 * calls `NSLog`, `String(format:)` and `UUID()` — all Foundation — and an injection
 * should not depend on the host file's import list staying the shape it happens to
 * be in.
 */
const IMPORTS = `import PushKit
import Foundation`;

/**
 * The two ObjC pod headers, reached through the bridging header.
 *
 * BOTH use the angle form naming the pod's public header directory, which
 * CocoaPods creates as `Pods/Headers/Public/<PodName>/` because neither podspec
 * overrides `header_dir`. The quoted form works only while a flattened search path
 * happens to be present, so the two imports may as well be consistent about it.
 *
 * Note the directory and the file DIFFER for the VoIP pod: the pod is
 * `RNVoipPushNotification`, the header inside it is
 * `RNVoipPushNotificationManager.h`. Collapsing the two fails with "file not
 * found" and nothing that names the cause.
 */
const BRIDGE_IMPORTS = `${H_MARKER}
// PushKit + CallKit: ObjC pods, reachable from Swift only via this header.
#import <RNCallKeep/RNCallKeep.h>
#import <RNVoipPushNotification/RNVoipPushNotificationManager.h>`;

/**
 * The PushKit delegate.
 *
 * `didReceiveIncomingPushWith` reports the call to CallKit FIRST and forwards to
 * JS second. That order is not a style choice — see the header. The JS side then
 * takes over the UI once the bridge is up.
 *
 * EVERY METHOD IS `public`, AND THAT IS REQUIRED RATHER THAN DECORATIVE. The Expo
 * SDK 54 template declares `public class AppDelegate: ExpoAppDelegate`, and Swift
 * requires a witness for a requirement of a PUBLIC protocol to be at least as
 * visible as the conformance. An internal `func pushRegistry` fails to build with
 * "must be declared public because it matches a requirement in public protocol
 * 'PKPushRegistryDelegate'".
 *
 * EVERY SELECTOR BELOW WAS READ OFF THE POD'S OWN HEADER rather than recalled, and
 * two of them were wrong before: `didUpdate(_:forType:)` does not exist (the real
 * selector is `didUpdatePushCredentials:forType:`) and neither does
 * `didReceiveIncomingPush(with:forType:)` (the real first label is `withPayload:`).
 * `tests/voip-callkit.test.ts` now cross-checks each call against the header so a
 * recalled name cannot come back.
 */
const DELEGATE = `
${MARKER} — PushKit (VoIP) + CallKit.
extension AppDelegate: PKPushRegistryDelegate {
  // Registration itself is called directly from didFinishLaunchingWithOptions —
  // deliberately NOT wrapped in a helper here. A wrapper nothing calls reads as
  // the registration path, and the next person to change this would edit the dead
  // one and wonder why the phone stopped ringing.

  public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    // The PushKit token. NOT the same token as the alert token expo-notifications
    // reports — this one is addressed on the <bundle>.voip topic.
    RNVoipPushNotificationManager.didUpdate(pushCredentials, forType: type.rawValue)
  }

  public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    // Token invalidated — no-op on the native side. The server will discover the
    // token is stale on next send attempt. RNVoipPushNotification does not expose
    // a didInvalidate class method, so we just log and move on.
    NSLog("[RELAY] VoIP push token invalidated for type: \\(type.rawValue)")
  }

  public func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    let dict = payload.dictionaryPayload
    let callerName = (dict["callerName"] as? String) ?? "RELAY"
    let callerPin = (dict["callerPin"] as? String) ?? ""
    let hasVideo = (dict["video"] as? String) == "1"
    // A STABLE uuid derived from the room, so a RETRANSMITTED push for the same
    // call joins the call already ringing instead of stacking a second one on the
    // lock screen. (It is deliberately not a channel to JS: read against
    // use-voip-callkit.ts, the hook answers via CallKeep's own answerCall/endCall
    // events and never re-derives this value — the comment that used to be here
    // claimed otherwise and was simply wrong.)
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
    // same CallKit identity across a push and any retransmission of it.
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

/**
 * Add the ObjC pod headers to the bridging header, once.
 *
 * Exported for the same reason `injectSwift` is: it is a pure string transform and
 * the whole risk is that it silently does nothing.
 */
function injectBridgingHeader(contents) {
  if (contents.includes(H_MARKER)) return contents; // already applied
  const trimmed = contents.replace(/\s+$/, "");
  return trimmed ? `${trimmed}\n\n${BRIDGE_IMPORTS}\n` : `${BRIDGE_IMPORTS}\n`;
}

/** Where the Expo template puts the bridging header for this project. */
function bridgingHeaderPath(platformProjectRoot, projectName) {
  return path.join(platformProjectRoot, projectName, `${projectName}-Bridging-Header.h`);
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

  // Step 1: Inject Swift code into AppDelegate.swift
  config = withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== "swift") {
      throw new Error(
        `[with-ios-voip] Expected a Swift AppDelegate, got "${cfg.modResults.language}". ` +
          "Update this plugin for that language rather than skipping the injection.",
      );
    }
    cfg.modResults.contents = injectSwift(cfg.modResults.contents);
    return cfg;
  });

  // Step 2: put the ObjC pod headers in the bridging header.
  //
  // APPENDED, NEVER OVERWRITTEN, and the filename is DERIVED. The earlier version
  // wrote the whole file from a template with the name hardcoded as
  // `RELAY-Bridging-Header.h`, which has two problems: the Expo template already
  // generates `<Project>-Bridging-Header.h` and already points
  // SWIFT_OBJC_BRIDGING_HEADER at it, so a hardcoded name leaves an orphan the day
  // the app is renamed; and a whole-file write destroys anything another plugin
  // put there. Appending under a marker is idempotent AND lets plugins coexist.
  config = withDangerousMod(config, [
    "ios",
    (cfg) => {
      const { platformProjectRoot, projectName } = cfg.modRequest;
      if (!projectName) {
        throw new Error(
          "[with-ios-voip] No iOS projectName available; cannot locate the bridging header.",
        );
      }
      const header = bridgingHeaderPath(platformProjectRoot, projectName);
      // Created if the template ever stops emitting one, so a template change
      // degrades to "we make it ourselves" rather than to a build that cannot ring.
      const existing = fs.existsSync(header) ? fs.readFileSync(header, "utf8") : "";
      fs.writeFileSync(header, injectBridgingHeader(existing), "utf-8");
      return cfg;
    },
  ]);

  // Step 3: Set SWIFT_OBJC_BRIDGING_HEADER in the Xcode project build settings.
  config = withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;

    // Find the main app target's build configurations
    const projectName = cfg.modRequest.projectName;
    // Derived, not hardcoded: this must name the SAME file step 2 wrote, and the
    // template already points here — so on an unchanged template this step is a
    // no-op that costs nothing and covers the case where it is not set.
    const bridgingHeaderValue = `${projectName}/${projectName}-Bridging-Header.h`;

    // Set for all build configurations in the project
    const pbxProject = project.hash.project.objects["PBXProject"];
    const nativeTargets = project.hash.project.objects["PBXNativeTarget"];

    // Iterate all native targets and set the bridging header on the app target
    for (const key of Object.keys(nativeTargets)) {
      if (typeof nativeTargets[key] !== "object") continue;
      const target = nativeTargets[key];
      // Only set on the main app target (not tests, etc.)
      if (target.productType !== '"com.apple.product-type.application"') continue;

      const configListId = target.buildConfigurationList;
      const configList =
        project.hash.project.objects["XCConfigurationList"][configListId];
      if (!configList) continue;

      for (const configRef of configList.buildConfigurations) {
        const configId =
          typeof configRef === "object" ? configRef.value : configRef;
        const buildConfig =
          project.hash.project.objects["XCBuildConfiguration"][configId];
        if (!buildConfig || !buildConfig.buildSettings) continue;

        buildConfig.buildSettings["SWIFT_OBJC_BRIDGING_HEADER"] =
          `"${bridgingHeaderValue}"`;
      }
    }

    console.log(
      `[with-ios-voip] Set SWIFT_OBJC_BRIDGING_HEADER = "${bridgingHeaderValue}"`,
    );
    return cfg;
  });

  return config;
}

module.exports = withRelayIosVoip;
module.exports.injectSwift = injectSwift;
module.exports.injectBridgingHeader = injectBridgingHeader;
module.exports.bridgingHeaderPath = bridgingHeaderPath;
module.exports.MARKER = MARKER;
module.exports.H_MARKER = H_MARKER;
