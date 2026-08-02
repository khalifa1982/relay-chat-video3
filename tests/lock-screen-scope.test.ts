import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const codeOnly = (src: string) =>
  src
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\/\/|\/\*)/.test(l))
    .join("\n");

/**
 * The whole app used to display over the lock screen, permanently.
 *
 * `android:showWhenLocked="true"` on MainActivity is a manifest attribute, so it
 * is not scoped to anything. MainActivity is the WebView holding the entire
 * authenticated RELAY session — every conversation in it. Any route that brings
 * it to the front on a locked handset showed all of that without an unlock, and
 * a tap on an ordinary message notification is such a route, reachable by
 * whoever is holding the phone.
 *
 * The attribute exists for exactly one flow: answering a call from the lock
 * screen, where IncomingCallActivity hands over to MainActivity for the call
 * itself. So the window flag is now set at that handover and cleared when the
 * call ends. IncomingCallActivity keeps the attribute — it is only ever Answer
 * and Decline, so there is nothing on it to expose.
 */
describe("the app is over the lock screen only during a call", () => {
  const PIP = read("plugins/with-android-pip.js");
  const FCM = codeOnly(read("plugins/with-android-fcm-call.js"));

  it("MainActivity does not carry the attributes any more", () => {
    const code = codeOnly(PIP);
    expect(code).not.toMatch(/activity\.\$\["android:showWhenLocked"\] = "true"/);
    expect(code).not.toMatch(/activity\.\$\["android:turnScreenOn"\] = "true"/);
  });

  it("and they are actively removed, not merely left unset", () => {
    // A previous build's manifest, or another plugin, could have set them.
    const code = codeOnly(PIP);
    expect(code).toMatch(/delete activity\.\$\["android:showWhenLocked"\]/);
    expect(code).toMatch(/delete activity\.\$\["android:turnScreenOn"\]/);
  });

  it("the generated manifest really does not carry them", async () => {
    // Running the plugin, rather than reading it: the attributes are what ships.
    const withPip = require("../plugins/with-android-pip");
    const cfg = withPip({ name: "RELAY", slug: "relay" });
    const manifest = {
      manifest: {
        application: [
          {
            activity: [
              {
                $: {
                  "android:name": ".MainActivity",
                  // As a previous build left it.
                  "android:showWhenLocked": "true",
                  "android:turnScreenOn": "true",
                },
              },
            ],
          },
        ],
      },
    };
    const out = await cfg.mods.android.manifest({
      ...cfg,
      modResults: manifest,
      modRequest: {
        platform: "android",
        modName: "manifest",
        projectRoot: ".",
        platformProjectRoot: ".",
        introspect: true,
      },
    });
    const attrs = out.modResults.manifest.application[0].activity[0].$;
    expect(attrs["android:showWhenLocked"]).toBeUndefined();
    expect(attrs["android:turnScreenOn"]).toBeUndefined();
    // …and the picture-in-picture half of the plugin still applies.
    expect(attrs["android:supportsPictureInPicture"]).toBe("true");
    expect(attrs["android:configChanges"]).toContain("screenSize");
  });

  it("IncomingCallActivity keeps them — it is only Answer and Decline", () => {
    const decl = FCM.slice(FCM.indexOf('"android:name": ".IncomingCallActivity"'));
    expect(decl.slice(0, 400)).toMatch(/"android:showWhenLocked": "true"/);
    expect(decl.slice(0, 400)).toMatch(/"android:turnScreenOn": "true"/);
  });

  it("the runtime replacement exists and is written into the project", () => {
    expect(FCM).toMatch(/const RELAY_CALL_WINDOW = /);
    expect(FCM).toMatch(/path\.join\(packageDir, "RelayCallWindow\.kt"\)/);
    expect(FCM).toMatch(/object RelayCallWindow \{/);
    expect(FCM).toMatch(/a\.setShowWhenLocked\(on\)/);
    expect(FCM).toMatch(/a\.setTurnScreenOn\(on\)/);
  });

  it("it has a pre-O_MR1 path, and that path CLEARS as well as sets", () => {
    // addFlags with no matching clearFlags is the same permanent exposure by
    // another route on older devices.
    const obj = FCM.slice(FCM.indexOf("object RelayCallWindow {"));
    const body = obj.slice(0, obj.indexOf("\n}"));
    expect(body).toMatch(/FLAG_SHOW_WHEN_LOCKED/);
    expect(body).toMatch(/if \(on\) a\.window\.addFlags\(flags\) else a\.window\.clearFlags\(flags\)/);
  });

  it("the flag is set on both answer paths and on neither decline path", () => {
    const activityAnswer = FCM.slice(FCM.indexOf("private fun answerCall()"));
    expect(activityAnswer.slice(0, 600)).toMatch(/RelayCallWindow\.markCallActive\(\)/);
    const receiverAnswer = FCM.slice(FCM.indexOf("RelayCallFcmService.ACTION_ANSWER ->"));
    expect(receiverAnswer.slice(0, 300)).toMatch(/RelayCallWindow\.markCallActive\(\)/);

    const activityDecline = FCM.slice(FCM.indexOf("private fun declineCall()"));
    const declineBody = activityDecline.slice(0, 600);
    expect(declineBody).toMatch(/RelayCallWindow\.clear\(this\)/);
    expect(declineBody).not.toMatch(/markCallActive/);
    const receiverDecline = FCM.slice(FCM.indexOf("RelayCallFcmService.ACTION_DECLINE ->"));
    expect(receiverDecline.slice(0, 300)).toMatch(/RelayCallWindow\.clear\(null\)/);
    expect(receiverDecline.slice(0, 300)).not.toMatch(/markCallActive/);
  });

  it("it is cleared when the call ends", () => {
    const ended = FCM.slice(FCM.indexOf("private fun handleWebCallEnded"));
    expect(ended.slice(0, 900)).toMatch(/RelayCallWindow\.clear\(context as\? Activity\)/);
    // …which needs the import, or the generated Kotlin does not compile.
    const iface = FCM.slice(FCM.indexOf("const RELAY_NATIVE_INTERFACE"));
    expect(iface.slice(0, 400)).toMatch(/^import android\.app\.Activity$/m);
  });

  it("MainActivity re-applies it on resume", () => {
    // Window flags do not survive Activity recreation, and the flag is normally
    // set from IncomingCallActivity before MainActivity exists at all.
    expect(FCM).toMatch(/import \$\{PACKAGE\}\.RelayCallWindow/);
    expect(FCM).toMatch(/RelayCallWindow\.apply\(this\)/);
    // Ordering: assert the flag before the WebView hunt, which is delayed 500ms.
    const patch = FCM.slice(FCM.indexOf("override fun onResume()"));
    expect(patch.indexOf("RelayCallWindow.apply(this)")).toBeLessThan(
      patch.indexOf("RelayWebViewSetup.attachToWebView(this)"),
    );
  });

  it("state is process-wide, because the setter and the window are never co-located", () => {
    const obj = FCM.slice(FCM.indexOf("object RelayCallWindow {"));
    expect(obj.slice(0, 800)).toMatch(/@Volatile\s*\n\s*private var callActive = false/);
  });

  it("both plugins still parse and load", () => {
    expect(() => require("../plugins/with-android-fcm-call.js")).not.toThrow();
    expect(() => require("../plugins/with-android-pip.js")).not.toThrow();
  });
});
