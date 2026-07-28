import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { injectSwift, MARKER } from "../plugins/with-ios-voip.js";
import { readVoipPayload } from "../lib/voip-payload";

/**
 * PushKit + CallKit — the iOS ringing path.
 *
 * WHAT IS AND IS NOT PROVEN HERE, SAID UP FRONT. The config plugin is a pure
 * string transform, so the TRANSFORM is tested for real: it injects, it is
 * idempotent, and it THROWS rather than silently doing nothing. What no test in
 * this repo can prove is that the injected Swift COMPILES or that a real handset
 * rings — that needs Xcode and a device, neither of which exists here.
 *
 * The transform is worth testing hardest anyway, because the failure mode of a
 * bad config plugin is an app that builds, installs, looks correct and never
 * rings — and nothing anywhere reports it.
 */

/**
 * A faithful stand-in for the Expo SDK 54 Swift AppDelegate. Shaped from the real
 * template rather than invented, so the anchors this plugin depends on are the
 * ones it will actually meet.
 */
const APP_DELEGATE = `import Expo
import React
import ReactAppDependencyProvider

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

describe("the config plugin injects PushKit into AppDelegate.swift", () => {
  const out = injectSwift(APP_DELEGATE);

  it("adds the PushKit import (ObjC modules come via bridging header)", () => {
    expect(out).toContain("import PushKit");
    // RNCallKeep and RNVoipPushNotification are pure Obj-C — they are exposed
    // via the bridging header, NOT via Swift import statements.
    expect(out).not.toContain("import RNCallKeep");
    expect(out).not.toContain("import RNVoipPushNotification");
  });

  it("puts the imports AFTER the last existing one, never above it", () => {
    // Landing above an import is a compile error in some orderings, and landing
    // inside a leading comment block silently comments the injection out.
    const lastOriginal = out.indexOf("import ReactAppDependencyProvider");
    expect(lastOriginal).toBeGreaterThan(-1);
    expect(out.indexOf("import PushKit")).toBeGreaterThan(lastOriginal);
  });

  it("registers for PushKit inside didFinishLaunchingWithOptions", () => {
    // It MUST be at launch, not on demand from JS: a VoIP push can LAUNCH the app,
    // and by the time JS could ask, the push has already been delivered.
    const at = out.indexOf("didFinishLaunchingWithOptions");
    const reg = out.indexOf("RNVoipPushNotificationManager.voipRegistration()");
    expect(at).toBeGreaterThan(-1);
    expect(reg).toBeGreaterThan(at);
  });

  it("declares the PKPushRegistryDelegate conformance", () => {
    expect(out).toMatch(/extension AppDelegate: PKPushRegistryDelegate/);
    expect(out).toContain("didReceiveIncomingPushWith");
    expect(out).toContain("didUpdate pushCredentials");
    expect(out).toContain("didInvalidatePushTokenFor");
  });

  it("reports the call to CallKit BEFORE forwarding to JS", () => {
    // THE RULE THAT MATTERS MOST. Since iOS 13 every VoIP push must produce a
    // reportNewIncomingCall before the handler returns; miss it and iOS kills the
    // app, miss it repeatedly and iOS stops delivering VoIP pushes AT ALL — a
    // penalty that then looks like a server fault forever.
    const report = out.indexOf("RNCallKeep.reportNewIncomingCall");
    const forward = out.indexOf("RNVoipPushNotificationManager.didReceiveIncomingPush");
    expect(report).toBeGreaterThan(-1);
    expect(forward).toBeGreaterThan(-1);
    expect(report).toBeLessThan(forward);
    // …and the completion handler must be handed to CallKit, not called early.
    expect(out).toContain("withCompletionHandler: completion");
  });

  it("passes the push's completion handler through rather than inventing one", () => {
    expect(out).toMatch(/completion: @escaping \(\) -> Void/);
  });

  it("derives a STABLE call uuid from the room", () => {
    // A fresh uuid per event would leave CallKit believing a call is still ringing
    // after the user answered, because the answer refers to a different identity.
    expect(out).toContain("RelayVoip.stableUUID(from: room)");
    expect(out).toMatch(/static func stableUUID/);
  });

  it("reads video as the STRING \"1\", which is what the server sends", () => {
    // A bare truthiness check on the dictionary value would read "0" as true and
    // turn every voice call into a video call.
    expect(out).toMatch(/\(dict\["video"\] as\? String\) == "1"/);
  });

  it("is IDEMPOTENT — a second prebuild does not inject twice", () => {
    // `expo prebuild` runs repeatedly; a double injection is a duplicate-symbol
    // compile error, which at least fails loudly, but the marker makes it moot.
    const twice = injectSwift(out);
    expect(twice).toBe(out);
    expect(twice.split("extension AppDelegate: PKPushRegistryDelegate").length - 1).toBe(1);
    expect(twice.split("import PushKit").length - 1).toBe(1);
  });

  it("THROWS on an unrecognised AppDelegate rather than silently doing nothing", () => {
    // A no-op here yields an app that builds, installs, looks right and never
    // rings, with nothing reporting why. Failing the prebuild is far better.
    expect(() => injectSwift("import Foundation\nclass Something {}\n")).toThrow(/class AppDelegate/);
    expect(() => injectSwift("class AppDelegate {}\n")).toThrow(/import statements/);
    expect(() =>
      injectSwift("import Expo\nclass AppDelegate: ExpoAppDelegate {}\n"),
    ).toThrow(/didFinishLaunchingWithOptions/);
  });

  it("marks its own work so the idempotency check has something to see", () => {
    expect(MARKER).toBeTruthy();
    expect(out).toContain(MARKER);
  });

  it("registers for PushKit EXACTLY once, not once per anchor it matched", () => {
    // The extension deliberately has no `voipRegistration()` wrapper: registration
    // is called straight from didFinishLaunchingWithOptions. A wrapper nothing
    // calls reads as the registration path, and the next person to change this
    // would edit the dead one and wonder why the phone stopped ringing.
    expect(out.split("RNVoipPushNotificationManager.voipRegistration()").length - 1).toBe(1);
  });
});

/**
 * The same transform, against the REAL prebuilt AppDelegate when one is present.
 *
 * `ios/` is generated by `expo prebuild` and is gitignored, so this SKIPS in CI and
 * runs for anyone who has prebuilt locally. That is worth having even though it
 * cannot always run: the fixture above is a stand-in written by hand, and the only
 * way to know the anchors match the template Expo actually emits is to read the
 * template Expo actually emitted.
 */
describe("the transform against a REAL prebuilt AppDelegate", () => {
  const ROOT = path.resolve(__dirname, "..");
  const dir = path.join(ROOT, "ios");
  const found = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .map((d) => path.join(dir, d, "AppDelegate.swift"))
        .find((f) => fs.existsSync(f))
    : undefined;

  it.skipIf(!found)("the prebuilt file carries the injection, applied once", () => {
    const real = fs.readFileSync(found!, "utf8");
    expect(real).toContain("import PushKit");
    expect(real.split("extension AppDelegate: PKPushRegistryDelegate").length - 1).toBe(1);
    expect(real.split("RNVoipPushNotificationManager.voipRegistration()").length - 1).toBe(1);
    // The ordering rule, checked on the real artefact rather than the fixture.
    expect(real.indexOf("RNCallKeep.reportNewIncomingCall")).toBeLessThan(
      real.indexOf("RNVoipPushNotificationManager.didReceiveIncomingPush"),
    );
  });

  it.skipIf(!found)("re-running the transform on it changes nothing", () => {
    const real = fs.readFileSync(found!, "utf8");
    expect(injectSwift(real)).toBe(real);
  });
});

describe("the plugin is registered and scoped to iOS", () => {
  const ROOT = path.resolve(__dirname, "..");
  const cfg = fs.readFileSync(path.join(ROOT, "app.config.ts"), "utf8");
  const src = fs.readFileSync(path.join(ROOT, "plugins", "with-ios-voip.js"), "utf8");

  it("app.config.ts loads the plugin", () => {
    // Written but unregistered is the same as not written.
    expect(cfg).toContain("./plugins/with-ios-voip.js");
  });

  it("the VoIP background mode is present — PushKit is not delivered without it", () => {
    expect(cfg).toMatch(/UIBackgroundModes:\s*\["audio", "voip", "remote-notification"\]/);
    // The plugin also merges them, so a future edit to app.config.ts cannot drop
    // `voip` and silently stop delivery.
    expect(src).toContain('modes.add("voip")');
  });

  it("merges background modes rather than replacing them", () => {
    // Replacing would drop `audio` and kill a live call's audio session when the
    // app is backgrounded — a regression in a working feature.
    expect(src).toMatch(/new Set\(plist\.UIBackgroundModes \|\| \[\]\)/);
  });

  it("touches only the iOS project", () => {
    // Android already rings. CallKeep's Android ConnectionService would add a
    // competing incoming-call UI plus permissions to a platform that works.
    expect(src).not.toMatch(/withAndroidManifest|withMainActivity|AndroidConfig/);
  });
});

describe("the hook keeps the two iOS tokens apart", () => {
  const ROOT = path.resolve(__dirname, "..");
  const hook = fs.readFileSync(path.join(ROOT, "hooks", "use-voip-callkit.ts"), "utf8");

  it("posts the PushKit token declared as apns-voip", () => {
    // Both of iOS's tokens are hex, so the server cannot derive this. Declaring it
    // wrong is destructive rather than merely ineffective: a VoIP push to an ALERT
    // token earns BadDeviceToken, which the server reads as stale and PRUNES.
    expect(hook).toMatch(/type: "SET_PUSH_TOKEN", token, kind: "apns-voip"/);
  });

  it("is iOS-only", () => {
    expect(hook).toMatch(/if \(Platform\.OS !== "ios"\) return;/);
  });

  it("loads the native modules OPTIONALLY, so a missing one is not a crash", () => {
    // These exist only in a real prebuild — not Expo Go, not web, not a unit test.
    // An unguarded require would take the whole app down at startup.
    expect(hook).toMatch(/function optionalModule/);
    expect(hook).toMatch(/if \(!CallKeep \|\| !VoipPush\) return;/);
  });

  it("removes every listener it added", () => {
    for (const e of ["register", "notification", "answerCall", "endCall"]) {
      expect(hook, `${e} is added`).toContain(`addEventListener("${e}"`);
      expect(hook, `${e} is removed`).toContain(`removeEventListener("${e}")`);
    }
  });

  it("does not try to join the call itself", () => {
    // One implementation of "answer": the web app owns rooms, and a shell that
    // also tried to join would be a second, divergent one.
    expect(hook).not.toMatch(/roomId.*join|joinRoom/);
  });
});

describe("readVoipPayload — the push crosses a native boundary loosely typed", () => {
  it("reads the fields the server actually sends", () => {
    expect(
      readVoipPayload({ callerName: "Ana", callerPin: "111111", roomId: "r-1", video: "1" }),
    ).toEqual({ callerName: "Ana", callerPin: "111111", roomId: "r-1", video: true });
  });

  it('treats video "0" as FALSE, not as a truthy string', () => {
    // The whole reason this is a function: `video` arrives as a STRING, so a bare
    // truthiness check would make every voice call a video call.
    expect(readVoipPayload({ video: "0" }).video).toBe(false);
    expect(readVoipPayload({ video: "" }).video).toBe(false);
    expect(readVoipPayload({}).video).toBe(false);
    // A real boolean is accepted too, so a future payload shape is not a silent break.
    expect(readVoipPayload({ video: true }).video).toBe(true);
  });

  it("drops non-string fields rather than passing junk to CallKit", () => {
    const p = readVoipPayload({ callerName: 42, callerPin: {}, roomId: null });
    expect(p.callerName).toBeUndefined();
    expect(p.callerPin).toBeUndefined();
    expect(p.roomId).toBeUndefined();
  });

  it("survives a non-object payload", () => {
    for (const v of [null, undefined, "str", 7, []]) {
      expect(() => readVoipPayload(v)).not.toThrow();
    }
    expect(readVoipPayload(null)).toEqual({});
  });
});
