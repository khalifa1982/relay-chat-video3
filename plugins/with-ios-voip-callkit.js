/**
 * Local Expo config plugin for RELAY's iOS VoIP Push (PushKit) + CallKit integration.
 *
 * This plugin modifies the iOS build to:
 *  1. Add the `aps-environment = production` entitlement for push notifications.
 *  2. Add PushKit + CallKit imports and delegate methods to AppDelegate.swift so
 *     VoIP pushes are handled IMMEDIATELY (iOS 13+ requirement) before the JS
 *     bridge is even initialized.
 *  3. Set up CallKit (CXProvider) natively so the incoming-call UI appears
 *     within ~2 seconds of the push arriving, even if the app was killed.
 *
 * The native code:
 *  - Registers for VoIP push tokens via PushKit on launch.
 *  - On token update: forwards to react-native-voip-push-notification's JS bridge.
 *  - On incoming push: parses payload, reports to CallKit IMMEDIATELY, then
 *    forwards to react-native-voip-push-notification for JS processing.
 *  - CallKit setup is done natively in AppDelegate so `didLoadWithEvents` works.
 */
const {
  withAppDelegate,
  withEntitlementsPlist,
  withInfoPlist,
  withPlugins,
} = require("@expo/config-plugins");

// ─── 1. Entitlements: production APNs environment ───────────────────────────
function withVoipEntitlements(config) {
  return withEntitlementsPlist(config, (cfg) => {
    cfg.modResults["aps-environment"] = "production";
    return cfg;
  });
}

// ─── 2. Info.plist: ensure UIBackgroundModes includes voip ──────────────────
function withVoipInfoPlist(config) {
  return withInfoPlist(config, (cfg) => {
    const modes = cfg.modResults.UIBackgroundModes || [];
    if (!modes.includes("voip")) modes.push("voip");
    if (!modes.includes("audio")) modes.push("audio");
    if (!modes.includes("remote-notification")) modes.push("remote-notification");
    cfg.modResults.UIBackgroundModes = modes;
    return cfg;
  });
}

// ─── 3. AppDelegate.swift: inject PushKit + CallKit native code ─────────────
function withVoipAppDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== "swift") {
      throw new Error(
        "[with-ios-voip-callkit] Expected Swift AppDelegate but found " +
          cfg.modResults.language
      );
    }

    let contents = cfg.modResults.contents;

    // --- Add imports at the top (after existing imports) ---
    const importsToAdd = `import PushKit
import CallKit`;

    // Insert after the last existing import line
    const importInsertionPoint = contents.lastIndexOf("import ");
    const endOfImportLine = contents.indexOf("\n", importInsertionPoint);
    if (!contents.includes("import PushKit")) {
      contents =
        contents.slice(0, endOfImportLine + 1) +
        importsToAdd +
        "\n" +
        contents.slice(endOfImportLine + 1);
    }

    // --- Add VoIP properties and setup code inside AppDelegate class ---
    // Find the class body opening
    const classBodyMarker = "public class AppDelegate: ExpoAppDelegate {";
    const classBodyIdx = contents.indexOf(classBodyMarker);
    if (classBodyIdx === -1) {
      throw new Error(
        "[with-ios-voip-callkit] Could not find AppDelegate class declaration"
      );
    }
    const afterClassOpen =
      classBodyIdx + classBodyMarker.length;

    // Add VoIP properties after the class opening brace
    const voipProperties = `
  // ─── RELAY VoIP Push + CallKit ─────────────────────────────────────
  private var voipRegistry: PKPushRegistry?
  private var callKitProvider: CXProvider?
  private var callKitController: CXCallController?
  /// Map callId (from server payload) → UUID used with CallKit
  private var callIdToUUID: [String: UUID] = [:]
`;

    if (!contents.includes("voipRegistry")) {
      contents =
        contents.slice(0, afterClassOpen) +
        "\n" +
        voipProperties +
        contents.slice(afterClassOpen);
    }

    // --- Add VoIP setup call inside didFinishLaunchingWithOptions ---
    const superReturnMarker =
      "return super.application(application, didFinishLaunchingWithOptions: launchOptions)";
    const superReturnIdx = contents.indexOf(superReturnMarker);
    if (superReturnIdx === -1) {
      throw new Error(
        "[with-ios-voip-callkit] Could not find super.application return in didFinishLaunchingWithOptions"
      );
    }

    const voipSetupCall = `
    // RELAY: Initialize VoIP Push + CallKit
    setupVoIPPush()
    setupCallKit()

`;

    if (!contents.includes("setupVoIPPush()")) {
      contents =
        contents.slice(0, superReturnIdx) +
        voipSetupCall +
        contents.slice(superReturnIdx);
    }

    // --- Add the extension with all VoIP/CallKit methods at the end of file ---
    const voipExtension = `

// MARK: - RELAY VoIP Push + CallKit Extension
extension AppDelegate: PKPushRegistryDelegate, CXProviderDelegate {

  // ─── Setup ────────────────────────────────────────────────────────────
  func setupVoIPPush() {
    voipRegistry = PKPushRegistry(queue: .main)
    voipRegistry?.delegate = self
    voipRegistry?.desiredPushTypes = [.voIP]
  }

  func setupCallKit() {
    let config = CXProviderConfiguration()
    config.localizedName = "RELAY"
    config.supportsVideo = true
    config.maximumCallsPerCallGroup = 1
    config.maximumCallGroups = 1
    callKitProvider = CXProvider(configuration: config)
    callKitProvider?.setDelegate(self, queue: nil)
    callKitController = CXCallController()

    // Also setup react-native-callkeep natively so didLoadWithEvents works
    RNCallKeep.setup(["appName": "RELAY", "supportsVideo": true, "maximumCallGroups": 1, "maximumCallsPerCallGroup": 1] as [String: Any])
  }

  /// Get or create a UUID for a given callId string
  private func uuid(for callId: String?) -> UUID {
    guard let id = callId, !id.isEmpty else { return UUID() }
    if let existing = callIdToUUID[id] { return existing }
    let newUUID = UUID()
    callIdToUUID[id] = newUUID
    return newUUID
  }

  /// Remove a callId→UUID mapping
  private func removeCall(_ callId: String?) {
    guard let id = callId else { return }
    callIdToUUID.removeValue(forKey: id)
  }

  // ─── PushKit Delegate ─────────────────────────────────────────────────
  public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    // Hex-encode the VoIP push token
    let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    // Forward to react-native-voip-push-notification JS bridge
    RNVoipPushNotificationManager.didUpdate(pushCredentials, forType: type.rawValue)
    NSLog("[RELAY VoIP] Token registered: %@", String(token.prefix(12)) + "...")
  }

  public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    NSLog("[RELAY VoIP] Push token invalidated")
  }

  public func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
    let d = payload.dictionaryPayload
    let pushType = d["type"] as? String ?? ""
    let callId = d["callId"] as? String ?? UUID().uuidString
    let callerName = d["callerName"] as? String ?? "RELAY"
    let mode = d["mode"] as? String ?? "voice"
    let hasVideo = mode == "video"
    let callUUID = uuid(for: callId)

    NSLog("[RELAY VoIP] Received push: type=%@, callId=%@, caller=%@, mode=%@", pushType, callId, callerName, mode)

    // Store completion handler for react-native-voip-push-notification
    RNVoipPushNotificationManager.addCompletionHandler(callId, completionHandler: completion)
    // Forward to JS bridge
    RNVoipPushNotificationManager.didReceiveIncomingPush(with: payload, forType: type.rawValue)

    if pushType == "call_cancel" {
      // Caller cancelled — dismiss the CallKit UI
      callKitProvider?.reportCall(with: callUUID, endedAt: nil, reason: .remoteEnded)
      removeCall(callId)
      completion()
    } else {
      // Incoming call — MUST report to CallKit before handler returns (iOS 13+ law)
      let update = CXCallUpdate()
      update.remoteHandle = CXHandle(type: .generic, value: callerName)
      update.localizedCallerName = callerName
      update.hasVideo = hasVideo
      update.supportsHolding = false
      update.supportsDTMF = false
      update.supportsGrouping = false
      update.supportsUngrouping = false

      callKitProvider?.reportNewIncomingCall(with: callUUID, update: update) { error in
        if let error = error {
          NSLog("[RELAY VoIP] Failed to report incoming call: %@", error.localizedDescription)
          self.removeCall(callId)
        }
        // completion() is called by react-native-voip-push-notification via onVoipNotificationCompleted
      }

      // Also report via react-native-callkeep for JS event bridge
      RNCallKeep.reportNewIncomingCall(
        callUUID.uuidString.lowercased(),
        handle: callerName,
        handleType: "generic",
        hasVideo: hasVideo,
        localizedCallerName: callerName,
        supportsHolding: false,
        supportsDTMF: false,
        supportsGrouping: false,
        supportsUngrouping: false,
        fromPushKit: true,
        payload: d as? [String: Any],
        withCompletionHandler: completion
      )
    }
  }

  // ─── CXProviderDelegate ───────────────────────────────────────────────
  public func providerDidReset(_ provider: CXProvider) {
    NSLog("[RELAY VoIP] Provider did reset")
    callIdToUUID.removeAll()
  }

  public func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    NSLog("[RELAY VoIP] Call answered via CallKit")
    // Configure audio session for WebRTC
    configureAudioSession()
    action.fulfill()
    // The JS side handles the rest via RNCallKeep 'answerCall' event
  }

  public func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    NSLog("[RELAY VoIP] Call ended/declined via CallKit")
    // Find and remove the callId for this UUID
    let endedUUID = action.callUUID
    if let entry = callIdToUUID.first(where: { $0.value == endedUUID }) {
      removeCall(entry.key)
    }
    action.fulfill()
    // The JS side handles the rest via RNCallKeep 'endCall' event
  }

  public func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    NSLog("[RELAY VoIP] Audio session activated by CallKit")
    // Audio session is now active — WebRTC in the WebView can use it
  }

  public func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    NSLog("[RELAY VoIP] Audio session deactivated")
  }

  // ─── Audio Session Configuration ─────────────────────────────────────
  private func configureAudioSession() {
    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .defaultToSpeaker])
      try session.setActive(true)
    } catch {
      NSLog("[RELAY VoIP] Failed to configure audio session: %@", error.localizedDescription)
    }
  }
}
`;

    if (!contents.includes("PKPushRegistryDelegate")) {
      contents += voipExtension;
    }

    cfg.modResults.contents = contents;
    return cfg;
  });
}

// ─── 4. Bridging Header: ensure RNVoipPushNotificationManager and RNCallKeep are importable ───
// Since the AppDelegate is Swift, we need a bridging header to import ObjC modules.
// react-native-voip-push-notification and react-native-callkeep expose ObjC headers.
// We use withDangerousMod to create/modify the bridging header.
const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

function withBridgingHeader(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const projectRoot = cfg.modRequest.platformProjectRoot;
      // Find the app target directory
      const appName = cfg.modRequest.projectName || "RELAY";
      const appDir = path.join(projectRoot, appName);

      // Create or update bridging header
      const bridgingHeaderPath = path.join(appDir, `${appName}-Bridging-Header.h`);
      const bridgingContent = `//
//  ${appName}-Bridging-Header.h
//  Auto-generated by with-ios-voip-callkit plugin
//

#import <RNVoipPushNotificationManager.h>
#import <RNCallKeep/RNCallKeep.h>
`;

      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(bridgingHeaderPath, bridgingContent);

      // Update the pbxproj to reference the bridging header
      // This is handled by withXcodeProject below
      return cfg;
    },
  ]);
}

const { withXcodeProject } = require("@expo/config-plugins");

function withBridgingHeaderXcode(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const appName = cfg.modRequest.projectName || "RELAY";
    const bridgingHeaderPath = `${appName}/${appName}-Bridging-Header.h`;

    // Set SWIFT_OBJC_BRIDGING_HEADER build setting for all configurations
    const buildConfigs = project.pbxXCBuildConfigurationSection();
    for (const key in buildConfigs) {
      const config_entry = buildConfigs[key];
      if (
        config_entry &&
        config_entry.buildSettings &&
        config_entry.buildSettings.PRODUCT_NAME
      ) {
        config_entry.buildSettings.SWIFT_OBJC_BRIDGING_HEADER =
          `"${bridgingHeaderPath}"`;
      }
    }

    return cfg;
  });
}

// ─── Compose all sub-plugins ────────────────────────────────────────────────
function withIosVoipCallKit(config) {
  config = withVoipEntitlements(config);
  config = withVoipInfoPlist(config);
  config = withBridgingHeader(config);
  config = withBridgingHeaderXcode(config);
  config = withVoipAppDelegate(config);
  return config;
}

module.exports = withIosVoipCallKit;
