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
 *  4. Register a native WKScriptMessageHandler ("RelayNative") for web→native
 *     bridge messages (webCallEnded, setAudioRoute).
 *  5. Handle audio session routing (speaker/earpiece/bluetooth) natively.
 *  6. Sync mute state from CallKit system UI → WebView.
 *  7. Observe AVAudioSession.routeChangeNotification → inject into WebView.
 *
 * Compliant with relay-push-ios-app-config.md §3.5 and §4.
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
import CallKit
import WebKit
import AVFoundation`;

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
  /// Track whether the current call is video (for audio session mode)
  private var currentCallIsVideo: Bool = false
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
    setupAudioRouteObserver()

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
extension AppDelegate: PKPushRegistryDelegate, CXProviderDelegate, WKScriptMessageHandler {

  // ─── Setup ────────────────────────────────────────────────────────────
  func setupVoIPPush() {
    voipRegistry = PKPushRegistry(queue: .main)
    voipRegistry?.delegate = self
    voipRegistry?.desiredPushTypes = [.voIP]
  }

  func setupCallKit() {
    let config = CXProviderConfiguration(localizedName: "RELAY")
    config.supportsVideo = true
    config.maximumCallsPerCallGroup = 1
    config.maximumCallGroups = 1
    callKitProvider = CXProvider(configuration: config)
    callKitProvider?.setDelegate(self, queue: nil)
    callKitController = CXCallController()

    // Also setup react-native-callkeep natively so didLoadWithEvents works
    RNCallKeep.setup(["appName": "RELAY", "supportsVideo": true, "maximumCallGroups": 1, "maximumCallsPerCallGroup": 1] as [String: Any])
  }

  /// Observe AVAudioSession route changes → inject into WebView
  func setupAudioRouteObserver() {
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(audioRouteChanged(_:)),
      name: AVAudioSession.routeChangeNotification,
      object: nil
    )
  }

  @objc private func audioRouteChanged(_ notification: Notification) {
    let session = AVAudioSession.sharedInstance()
    let route = session.currentRoute
    var routeName = "earpiece"
    for output in route.outputs {
      switch output.portType {
      case .builtInSpeaker:
        routeName = "speaker"
      case .bluetoothA2DP, .bluetoothHFP, .bluetoothLE:
        routeName = "bluetooth"
      case .headphones, .headsetMic:
        routeName = "earpiece"
      default:
        routeName = "earpiece"
      }
    }
    // Inject route change into WebView
    let js = "window.dispatchEvent(new CustomEvent('relay:native',{detail:{type:'audioRouteChanged',route:'\\(routeName)'}}));"
    DispatchQueue.main.async {
      self.findWebView()?.evaluateJavaScript(js, completionHandler: nil)
    }
    NSLog("[RELAY VoIP] Audio route changed to: %@", routeName)
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

  /// Find the WKWebView in the view hierarchy
  private func findWebView() -> WKWebView? {
    guard let window = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .flatMap({ $0.windows })
      .first(where: { $0.isKeyWindow }) else { return nil }
    return findWKWebView(in: window)
  }

  private func findWKWebView(in view: UIView) -> WKWebView? {
    if let webView = view as? WKWebView { return webView }
    for subview in view.subviews {
      if let found = findWKWebView(in: subview) { return found }
    }
    return nil
  }

  /// Register the RelayNative script message handler on the WKWebView
  /// Called after the WebView is available in the view hierarchy
  func registerRelayNativeHandler() {
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
      guard let self = self, let webView = self.findWebView() else {
        // Retry after a delay if WebView not yet available
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
          guard let self = self, let webView = self.findWebView() else { return }
          webView.configuration.userContentController.add(self, name: "RelayNative")
          NSLog("[RELAY VoIP] RelayNative handler registered (delayed retry)")
        }
        return
      }
      webView.configuration.userContentController.add(self, name: "RelayNative")
      NSLog("[RELAY VoIP] RelayNative handler registered")
    }
  }

  // ─── WKScriptMessageHandler (RelayNative bridge: web → native) ────────
  public func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == "RelayNative" else { return }
    guard let body = message.body as? String,
          let data = body.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let type = json["type"] as? String else {
      NSLog("[RELAY VoIP] RelayNative: invalid message body")
      return
    }

    switch type {
    case "webCallEnded", "callEnded":
      let callId = json["callId"] as? String ?? ""
      NSLog("[RELAY VoIP] Web ended call: %@", callId)
      let callUUID = uuid(for: callId)
      callKitProvider?.reportCall(with: callUUID, endedAt: Date(), reason: .remoteEnded)
      removeCall(callId)
      // §3 MIC RELEASE: Deactivate audio session with notifyOthersOnDeactivation
      // so other apps (e.g. voice recorders) can reclaim the mic immediately.
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
        do {
          try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
          NSLog("[RELAY VoIP] Audio session deactivated after call end")
        } catch {
          NSLog("[RELAY VoIP] Failed to deactivate audio session: %@", error.localizedDescription)
        }
      }

    case "setAudioRoute":
      let route = json["route"] as? String ?? ""
      NSLog("[RELAY VoIP] setAudioRoute: %@", route)
      handleSetAudioRoute(route)

    default:
      NSLog("[RELAY VoIP] RelayNative: unknown message type: %@", type)
    }
  }

  /// Handle audio route switching from web
  private func handleSetAudioRoute(_ route: String) {
    let session = AVAudioSession.sharedInstance()
    do {
      switch route {
      case "speaker":
        try session.overrideOutputAudioPort(.speaker)
      case "earpiece":
        try session.overrideOutputAudioPort(.none)
      case "bluetooth":
        try session.overrideOutputAudioPort(.none)
        if let bt = session.availableInputs?.first(where: {
          [.bluetoothHFP, .bluetoothLE].contains($0.portType)
        }) {
          try session.setPreferredInput(bt)
        }
      default:
        NSLog("[RELAY VoIP] Unknown audio route: %@", route)
      }
    } catch {
      NSLog("[RELAY VoIP] Failed to set audio route '%@': %@", route, error.localizedDescription)
    }
  }

  // ─── PushKit Delegate ─────────────────────────────────────────────────
  public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    // Hex-encode the VoIP push token
    let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    // Forward to react-native-voip-push-notification JS bridge
    RNVoipPushNotificationManager.didUpdate(pushCredentials, forType: type.rawValue)
    NSLog("[RELAY VoIP] Token registered: %@", String(token.prefix(12)) + "...")

    // Also register the RelayNative handler now that the app is fully up
    registerRelayNativeHandler()
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

    // Track video/voice mode for audio session configuration
    currentCallIsVideo = hasVideo

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

  // §3.5 item 1: Claim the audio session — fixes dead audio + dead mute
  public func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    NSLog("[RELAY VoIP] Audio session activated by CallKit (isVideo=%d)", currentCallIsVideo ? 1 : 0)
    // Set category with correct mode based on call type
    // .voiceChat defaults to earpiece (correct for voice calls)
    // .videoChat defaults to speaker (correct for video calls)
    try? audioSession.setCategory(
      .playAndRecord,
      mode: currentCallIsVideo ? .videoChat : .voiceChat,
      options: [.allowBluetooth, .allowBluetoothA2DP]
    )
    // Do NOT call setActive(true) — CallKit already activated it.
  }

  public func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    NSLog("[RELAY VoIP] Audio session didDeactivate callback")
    // §3 MIC RELEASE: Ensure the session is fully deactivated with notification
    // to other apps. This is the definitive teardown point from CallKit.
    do {
      try audioSession.setActive(false, options: .notifyOthersOnDeactivation)
      NSLog("[RELAY VoIP] Audio session deactivated with notifyOthersOnDeactivation")
    } catch {
      NSLog("[RELAY VoIP] didDeactivate setActive(false) error: %@", error.localizedDescription)
    }
  }

  // §3.5 item 3: Mute sync — forward CXSetMutedCallAction into the WebView
  public func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    let muted = action.isMuted
    NSLog("[RELAY VoIP] Mute action from CallKit: muted=%d", muted ? 1 : 0)
    let js = "window.dispatchEvent(new CustomEvent('relay:native',{detail:{type:'callMuted',muted:\\(muted)}}));"
    DispatchQueue.main.async {
      self.findWebView()?.evaluateJavaScript(js, completionHandler: nil)
    }
    action.fulfill()
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
