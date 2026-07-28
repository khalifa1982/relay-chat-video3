import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  addSourceToProject,
  sourcePaths,
  CLASS_NAME,
  HEADER_SRC,
  IMPL_SRC,
} from "../plugins/with-ios-voip.js";
import { readVoipPayload } from "../lib/voip-payload";

/**
 * PushKit + CallKit — the iOS ringing path, in Objective-C.
 *
 * WHAT IS AND IS NOT PROVEN HERE, SAID UP FRONT. No test in this repo can compile
 * Objective-C or ring a handset — that needs Xcode and a device, neither of which
 * exists here. What IS proven: every library call is cross-checked against the
 * pod's OWN header on disk, so "does this method exist with these labels" is
 * answered for real rather than frozen as a string; and the Xcode wiring is driven
 * against a REAL prebuilt pbxproj, because a source file on disk that is not in the
 * Sources build phase compiles nowhere and NOTHING reports it.
 *
 * That last failure mode is why this file exists at all: a bad config plugin
 * produces an app that builds, installs, looks correct and never rings.
 */
const ROOT = path.resolve(__dirname, "..");
const VOIP_H = path.join(
  ROOT,
  "node_modules/react-native-voip-push-notification/ios/RNVoipPushNotification/RNVoipPushNotificationManager.h",
);
const CALLKEEP_H = path.join(ROOT, "node_modules/react-native-callkeep/ios/RNCallKeep/RNCallKeep.h");
const HAVE_PODS = fs.existsSync(VOIP_H) && fs.existsSync(CALLKEEP_H);

describe("the injected ObjC is a self-contained PushKit delegate", () => {
  it("is its OWN PKPushRegistry delegate, so no AppDelegate and no Swift", () => {
    /* THE WHOLE DESIGN. `RNVoipPushNotificationManager.voipRegistration` hardcodes
       `voipRegistry.delegate = RCTSharedApplication().delegate`, which is what
       forced the old Swift injection into AppDelegate. Owning the registry removes
       that requirement — and with it the bridging header that failed to compile
       twice. */
    expect(IMPL_SRC).toContain("<PKPushRegistryDelegate>");
    expect(IMPL_SRC).toContain("registry.delegate = self;");
    expect(IMPL_SRC).toContain("[[PKPushRegistry alloc] initWithQueue:dispatch_get_main_queue()]");
    /* …and it must NOT CALL the library's own registration, which would point the
       delegate back at the AppDelegate.
       Asserted as the message SEND, not as the bare word: the .m legitimately
       mentions `voipRegistration()` in a comment explaining why it is avoided, and
       a substring check on the name matches that prose instead of the code — the
       trap this repo has now hit sixteen times. */
    expect(IMPL_SRC).not.toContain("[RNVoipPushNotificationManager voipRegistration]");
    expect(IMPL_SRC).not.toMatch(/\bvoipRegistration\]/);
  });

  it("holds the registry STRONGLY — a local would deallocate and deliver nothing", () => {
    // The library's own voipRegistration() keeps its registry in a local, which is
    // a long-standing wart there and the one thing not to copy.
    expect(IMPL_SRC).toMatch(/@property \(nonatomic, strong, nullable\) PKPushRegistry \*registry;/);
    expect(IMPL_SRC).toContain("self.registry = registry;");
  });

  it("starts itself from +load on the main queue", () => {
    // +load is called by the ObjC runtime for every class in the binary before
    // main(), which is what makes this need no AppDelegate hook at all. The main-
    // queue hop puts registration on the first run-loop pass — the same moment
    // didFinishLaunchingWithOptions would have run.
    expect(IMPL_SRC).toMatch(/\+ \(void\)load \{/);
    expect(IMPL_SRC).toMatch(/dispatch_async\(dispatch_get_main_queue\(\), \^\{ \[\[self shared\] start\]; \}\);/);
  });

  it("start is idempotent", () => {
    expect(IMPL_SRC).toMatch(/if \(self\.registry != nil\) return;/);
  });

  it("asks for the VoIP push type — without it PushKit delivers nothing", () => {
    expect(IMPL_SRC).toContain("[NSSet setWithObject:PKPushTypeVoIP]");
  });

  it("reports the call to CallKit BEFORE forwarding to JS", () => {
    // THE RULE THAT MATTERS MOST. Since iOS 13 every VoIP push must produce a
    // reportNewIncomingCall before the handler returns; miss it and iOS kills the
    // app, miss it repeatedly and iOS stops delivering VoIP pushes AT ALL — a
    // penalty that then looks like a server fault forever.
    const report = IMPL_SRC.indexOf("[RNCallKeep reportNewIncomingCall:");
    const forward = IMPL_SRC.indexOf("[RNVoipPushNotificationManager didReceiveIncomingPushWithPayload:");
    expect(report).toBeGreaterThan(-1);
    expect(forward).toBeGreaterThan(-1);
    expect(report).toBeLessThan(forward);
  });

  it("hands the completion handler to CallKit rather than calling it itself", () => {
    expect(IMPL_SRC).toContain("withCompletionHandler:completion];");
    // Calling it directly would satisfy iOS's timer without a call ever appearing.
    expect(IMPL_SRC).not.toMatch(/^\s*completion\(\);/m);
  });

  it('reads video as the STRING "1", which is what the server sends', () => {
    // A bare truthiness check on the dictionary value would read "0" as true and
    // turn every voice call into a video call.
    expect(IMPL_SRC).toMatch(/isEqualToString:@"1"/);
  });

  it("derives a STABLE call uuid from the room, zero-padded", () => {
    // A fresh uuid per push would stack a second ringing call on the lock screen
    // when APNs retransmits. `= {0}` is what makes a short seed padded rather than
    // reading uninitialised stack.
    expect(IMPL_SRC).toContain("stableUUIDFromSeed:room");
    expect(HEADER_SRC).toContain("+ (NSString *)stableUUIDFromSeed:(NSString *)seed;");
    expect(IMPL_SRC).toMatch(/uint8_t bytes\[16\] = \{0\};/);
    // 8-4-4-4-12, or NSUUID cannot parse it and CallKit refuses the call.
    for (const r of ["NSMakeRange(0, 8)", "NSMakeRange(8, 4)", "NSMakeRange(12, 4)", "NSMakeRange(16, 4)", "NSMakeRange(20, 12)"]) {
      expect(IMPL_SRC).toContain(r);
    }
  });

  it("type-checks every value it reads out of the push payload", () => {
    // The payload crosses a native boundary loosely typed; a non-string where a
    // string is expected would crash inside CallKit rather than degrade.
    expect(IMPL_SRC).toContain("isKindOfClass:[NSString class]");
  });

  it("needs NO bridging header and NO Swift module", () => {
    /* The property this whole rewrite exists for. Both pods are pure ObjC with no
       modulemap, so `import RNCallKeep` fails with "No such module"; routing them
       through the bridging header moved the failure to
       PrecompileSwiftBridgingHeader, a module-compilation context that is strict
       about non-modular headers reached transitively (RNCallKeep.h imports
       <React/RCTEventEmitter.h>). ObjC→ObjC has neither problem. */
    const plugin = fs.readFileSync(path.join(ROOT, "plugins", "with-ios-voip.js"), "utf8");
    expect(plugin).not.toContain("Bridging-Header");
    expect(plugin).not.toContain("SWIFT_OBJC_BRIDGING_HEADER");
    expect(plugin).not.toContain("withAppDelegate");
    expect(IMPL_SRC).not.toMatch(/^import /m);
  });
});

describe("every library call exists in the pod's OWN header", () => {
  /* THE LOAD-BEARING TEST. Its absence is what let the Swift version ship two
   * calls to methods that do not exist. ObjC cannot be compiled here, but the
   * pods' headers ARE on disk, so this is answerable for real.
   */
  it("reports whether the header cross-check actually ran", () => {
    // A skip nobody sees is a green run pretending to be coverage.
    expect(HAVE_PODS, "node_modules present so the cross-check ran").toBe(true);
  });

  it.skipIf(!HAVE_PODS)("every selector it sends is declared", () => {
    const voip = fs.readFileSync(VOIP_H, "utf8");
    const ck = fs.readFileSync(CALLKEEP_H, "utf8");
    const pairs: [string, string, string][] = [
      ["[RNVoipPushNotificationManager didUpdatePushCredentials:", "+ (void)didUpdatePushCredentials:", voip],
      ["[RNVoipPushNotificationManager didReceiveIncomingPushWithPayload:", "+ (void)didReceiveIncomingPushWithPayload:", voip],
      ["[RNCallKeep reportNewIncomingCall:", "+ (void)reportNewIncomingCall:", ck],
    ];
    for (const [call, selector, header] of pairs) {
      expect(IMPL_SRC, `sends ${call}`).toContain(call);
      expect(header, `header declares ${selector}`).toContain(selector);
    }
  });

  it.skipIf(!HAVE_PODS)("reportNewIncomingCall passes every label the header declares", () => {
    // Twelve labelled arguments: one missing or misspelled label is a compile
    // error, and reading them off the header is the only way to be sure here.
    const ck = fs.readFileSync(CALLKEEP_H, "utf8");
    const decl = ck.slice(ck.indexOf("+ (void)reportNewIncomingCall:"));
    const sig = decl.slice(0, decl.indexOf(";"));
    const call = IMPL_SRC.slice(IMPL_SRC.indexOf("[RNCallKeep reportNewIncomingCall:"));
    const args = call.slice(0, call.indexOf("];") + 2);
    for (const label of [
      "handle", "handleType", "hasVideo", "localizedCallerName", "supportsHolding",
      "supportsDTMF", "supportsGrouping", "supportsUngrouping", "fromPushKit",
      "payload", "withCompletionHandler",
    ]) {
      expect(sig, `header declares ${label}:`).toContain(`${label}:`);
      expect(args, `call passes ${label}:`).toContain(`${label}:`);
    }
  });

  it.skipIf(!HAVE_PODS)("the invalidate handler calls no library method, because there is none", () => {
    // Checked against the header rather than assumed: the manager genuinely
    // exposes no invalidation hook, so a log is the whole available behaviour.
    const voip = fs.readFileSync(VOIP_H, "utf8");
    expect(voip).not.toContain("didInvalidatePushToken");
    const body = IMPL_SRC.slice(IMPL_SRC.indexOf("didInvalidatePushTokenForType:"));
    const fn = body.slice(0, body.indexOf("\n}"));
    expect(fn).toContain("NSLog(");
    expect(fn).not.toContain("[RNVoipPushNotificationManager");
  });

  it.skipIf(!HAVE_PODS)("forwarding before the RN bridge exists is SAFE, not merely hoped", () => {
    // +load runs before JS subscribes, so a token could arrive with no listener.
    // The manager buffers into _delayedEvents and replays — verified in its own
    // implementation, which is what makes the +load design shippable.
    const m = fs.readFileSync(
      path.join(ROOT, "node_modules/react-native-voip-push-notification/ios/RNVoipPushNotification/RNVoipPushNotificationManager.m"),
      "utf8",
    );
    expect(m).toContain("_delayedEvents");
    expect(m).toMatch(/if \(_hasListeners\)/);
  });
});

describe("the .m is actually COMPILED — driven against the real pbxproj", () => {
  /* A file on disk that is not in the Sources build phase compiles nowhere and
   * does nothing, silently. That is the single most likely way this plugin could
   * "work" and still never ring, so it is tested behaviourally against a REAL
   * prebuilt project rather than pinned as a string.
   *
   * `ios/` is gitignored, so this SKIPS in CI and runs for anyone who prebuilt.
   */
  const projRoot = path.join(ROOT, "ios");
  const pbx = fs.existsSync(projRoot)
    ? fs.readdirSync(projRoot).filter((d) => d.endsWith(".xcodeproj")).map((d) => path.join(projRoot, d, "project.pbxproj"))[0]
    : undefined;
  const have = !!pbx && fs.existsSync(pbx);

  it.skipIf(!have)("prebuild put the .m in a Sources build phase", () => {
    const src = fs.readFileSync(pbx!, "utf8");
    const phases = src.match(/\/\* Sources \*\/ = \{[\s\S]*?\};/g) ?? [];
    expect(phases.length).toBeGreaterThan(0);
    expect(phases.some((p) => p.includes(`${CLASS_NAME}.m`)), `${CLASS_NAME}.m in Sources`).toBe(true);
  });

  it.skipIf(!have)("addSourceToProject ITSELF adds it to Sources, on a project without it", () => {
    /* FOUND BY MUTATION, and it was the most important gap in this file: deleting
       `project.addSourceFile(...)` from the plugin SURVIVED, because the assertion
       above reads the pbxproj already on disk — which still carried the reference
       from an earlier prebuild. It asserted a stale artefact rather than the
       function's effect.
       This drives the real function against a real project parsed FRESH, with the
       existing reference forced out of view, and asserts the Sources phase gains
       it. A plugin that stops adding the file now fails here. */
    const xcode = require("xcode");
    const project = xcode.project(pbx!);
    project.parseSync();
    const sourcesOf = () =>
      JSON.stringify(project.hash.project.objects["PBXSourcesBuildPhase"] ?? {});
    project.hasFile = () => false; // pretend it is not there yet
    const before = sourcesOf();
    expect(addSourceToProject(project, "RELAY")).toBe(true);
    const after = sourcesOf();
    expect(after).not.toBe(before);
    // The NEW build-file entry must name our .m, and there must be one more of them.
    const count = (s: string) => (s.match(new RegExp(`${CLASS_NAME}\\.m`, "g")) ?? []).length;
    expect(count(after)).toBe(count(before) + 1);
  });

  it.skipIf(!have)("and left AppDelegate.swift and the bridging header alone", () => {
    // The two things the previous versions broke.
    const app = fs.readdirSync(projRoot).map((d) => path.join(projRoot, d, "AppDelegate.swift")).find((f) => fs.existsSync(f));
    expect(app, "found AppDelegate.swift").toBeTruthy();
    const swift = fs.readFileSync(app!, "utf8");
    expect(swift).not.toContain("PushKit");
    expect(swift).not.toContain("PKPushRegistry");
    expect(swift).not.toContain("RNCallKeep");
  });

  it.skipIf(!have)("adding the source twice is a no-op — a duplicate is a link error", () => {
    const xcode = require("xcode");
    const project = xcode.project(pbx!);
    project.parseSync();
    // Already added by the prebuild above, so a second call must decline.
    expect(addSourceToProject(project, "RELAY")).toBe(false);
  });

  it.skipIf(!have)("THROWS rather than silently skipping when there is no app target", () => {
    // A returned-untouched project yields an app that installs and never rings.
    const xcode = require("xcode");
    const project = xcode.project(pbx!);
    project.parseSync();
    project.hasFile = () => false; // force it past the idempotency check
    project.getFirstTarget = () => undefined;
    expect(() => addSourceToProject(project, "RELAY")).toThrow(/app target/);
  });

  it.skipIf(!have)("THROWS when the project group is missing", () => {
    const xcode = require("xcode");
    const project = xcode.project(pbx!);
    project.parseSync();
    project.hasFile = () => false;
    project.findPBXGroupKey = () => undefined;
    expect(() => addSourceToProject(project, "RELAY")).toThrow(/group/);
  });
});

describe("the plugin's own wiring", () => {
  const plugin = fs.readFileSync(path.join(ROOT, "plugins", "with-ios-voip.js"), "utf8");

  it("app.config.ts loads the plugin", () => {
    expect(fs.readFileSync(path.join(ROOT, "app.config.ts"), "utf8")).toContain("./plugins/with-ios-voip.js");
  });

  it("the VoIP background mode is present — PushKit is not delivered without it", () => {
    expect(plugin).toContain('modes.add("voip")');
  });

  it("merges background modes rather than replacing them", () => {
    // app.config.ts already declares audio/voip/remote-notification; clobbering
    // that list would silently drop whatever it had.
    expect(plugin).toContain("new Set(plist.UIBackgroundModes || [])");
  });

  it("touches only the iOS project", () => {
    expect(plugin).toContain('withDangerousMod(config, [\n    "ios"');
    expect(plugin).not.toContain("withAndroid");
  });

  it("derives paths from the project name rather than hardcoding RELAY", () => {
    expect(sourcePaths("/x/ios", "RELAY").impl).toBe(`/x/ios/RELAY/${CLASS_NAME}.m`);
    expect(sourcePaths("/x/ios", "Other").implRef).toBe(`Other/${CLASS_NAME}.m`);
    expect(plugin).not.toMatch(/"RELAY\//);
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
