import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Native rewrite M1 (mobile/native — compiled React Native, per the owner's
 * mandate: "a real app such as WhatsApp and Telegram", no webview). These pins
 * bind the M1 invariants: same backend, same identity mechanism, same tabs.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("native rewrite — M1 foundation", () => {
  it("is a React Native app (no Capacitor/webview) with the store package id", () => {
    const pkg = JSON.parse(read("mobile/native/package.json"));
    expect(pkg.dependencies["react-native"]).toBeTruthy();
    expect(pkg.dependencies["@capacitor/core"]).toBeUndefined();
    const gradle = read("mobile/native/android/app/build.gradle");
    expect(gradle).toContain('applicationId "org.yourchat.relay"');
    expect(gradle).toContain('applicationIdSuffix ".next"');
  });

  it("talks to the EXISTING backend unmodified: tRPC/superjson + device-id identity", () => {
    const api = read("mobile/native/src/lib/api.ts");
    expect(api).toContain("/api/trpc");
    // APEX host only — the www subdomain 301s and POST mutations die on the
    // redirect ("Couldn't reach RELAY" in the field with working internet).
    expect(api).toContain('BASE_URL = "https://your-chat.io"'); // .org retired 2026-07-21 — .io is the only backend
    expect(api).not.toContain('"https://www.your-chat.io"');
    expect(api).toMatch(/transformer: superjson/);
    expect(api).toMatch(/x-relay-device-id/);
    expect(api).toMatch(/identity\.startGuest|"identity\.whoami"/);
  });

  it("carries the web app's tab structure + per-tab accents", () => {
    const app = read("mobile/native/App.tsx");
    for (const t of ["Calls", "History", "Messages", "Contacts", "Profile"]) {
      expect(app).toContain(`"${t}"`);
    }
    const theme = read("mobile/native/src/lib/theme.ts");
    for (const k of ["tabCalls", "tabHistory", "tabMessages", "tabContacts"]) {
      expect(theme).toContain(k);
    }
  });

  it("M2: messaging + contacts write-parity against the EXACT server shapes", () => {
    const api = read("mobile/native/src/lib/api.ts");
    // Procedure paths transcribed from server/v2routers.ts.
    for (const proc of [
      '"messages.openThread"', '"messages.list"', '"messages.send"',
      '"messages.markRead"', '"messages.typing"', '"messages.remove"',
      '"messages.conversationInfo"', '"contacts.upsert"', '"contacts.remove"',
    ]) expect(api).toContain(proc);
    // The threads shape uses the REAL field names (M1 had guessed wrong ones).
    for (const f of ["peerDisplayName", "lastMessageBody", "unreadCount", "peerIsOnline", "peerVerified"])
      expect(api).toContain(f);
    // Upload rides the same HTTP endpoint + device-id identity as the web.
    expect(api).toContain("/api/v2/upload");
    expect(api).toContain("dataBase64");
    // Realtime: the same v2 SSE bus the web consumes.
    const ev = read("mobile/native/src/lib/events.ts");
    expect(ev).toContain("/api/v2/events");
    expect(ev).toContain("x-relay-device-id");
    // Conversation screen: receipts from message.status, unsend, reply, typing.
    const conv = read("mobile/native/src/screens/Conversation.tsx");
    expect(conv).toMatch(/status === "read" \? "\s*✓✓" : "\s*✓"/);
    expect(conv).toContain("api.unsend");
    expect(conv).toContain("replyToId");
    expect(conv).toContain("api.typing");
    // Contacts write ops + Android-safe action sheet (Alert caps at 3 buttons).
    const cl = read("mobile/native/src/screens/ContactsList.tsx");
    expect(cl).toContain("contactUpsert");
    expect(cl).toContain("Modal");
  });

  it("M3: the call engine port speaks the production protocol", () => {
    const sig = read("mobile/native/src/call/signaling.ts");
    expect(sig).toContain("/api/relay/stream?cid=");
    expect(sig).toContain("/api/relay/send");
    expect(sig).toMatch(/250 \* Math\.pow\(3, attempt\)/); // v2.80 retry parity
    const eng = read("mobile/native/src/call/engine.tsx");
    // Staged progress incl. the v2.83 paging state + stale-ring replace rule.
    expect(eng).toContain('"paging"');
    expect(eng).toMatch(/cur\.from !== m\.from && Date\.now\(\) - cur\.at <= 70_000/);
    // Mutual-consent video protocol (v2.81 vocabulary).
    for (const t of ['"video-request"', '"video-accept"', '"video-decline"']) expect(eng).toContain(t);
    // Mesh glare rule: the NEWCOMER (joined.members) offers.
    expect(eng).toMatch(/case "joined":[\s\S]*?meshOffer/);
    // 1:1 auto-end + 65s no-answer backstop.
    expect(eng).toContain('hangupInternal("remote-left")');
    expect(eng).toContain("65_000");
    // One WebRTC stack for mesh + SFU; native audio routing.
    expect(eng).toContain("@livekit/react-native-webrtc");
    expect(eng).toContain("InCallManager");
    // Wired into the UI.
    expect(read("mobile/native/App.tsx")).toContain("<CallOverlay />");
    expect(read("mobile/native/src/screens/Dialer.tsx")).toContain("call.dial(dialed");
  });

  it("CI builds the milestone APK — STANDALONE (no Metro dev server on user phones)", () => {
    const wf = read(".github/workflows/native-rn.yml");
    expect(wf).toContain("RELAY-RN-debug-apk");
    expect(wf).toContain("RELAY-RN-release-apk"); // production-behavior test build
    expect(wf).toContain("mobile/native/android");
    // The debug APK must embed the JS bundle — an empty debuggableVariants
    // list is what bundles it (the default skips bundling for debug, which
    // red-screens "Unable to load script" on any phone without Metro).
    expect(read("mobile/native/android/app/build.gradle")).toMatch(/debuggableVariants = \[\]/);
  });
});

describe("native rewrite — M4 rings-when-closed (Android)", () => {
  it("ships the native ring/keep-alive layer under the RN namespace", () => {
    for (const f of [
      "mobile/native/android/app/src/main/java/com/relaynative/RelayFcmService.java",
      "mobile/native/android/app/src/main/java/com/relaynative/NotificationHelper.java",
      "mobile/native/android/app/src/main/java/com/relaynative/IncomingCallActivity.java",
      "mobile/native/android/app/src/main/java/com/relaynative/CallService.java",
      "mobile/native/android/app/src/main/res/drawable/ic_stat_call.xml",
    ]) {
      expect(read(f).length).toBeGreaterThan(100);
      if (f.endsWith(".java")) expect(read(f)).toContain("package com.relaynative;");
    }
    // Full-screen lock-screen ring with the app CLOSED (FCM data → fullScreenIntent).
    const helper = read("mobile/native/android/app/src/main/java/com/relaynative/NotificationHelper.java");
    expect(helper).toContain("setFullScreenIntent(fullPi, true)");
    expect(helper).toContain("setTimeoutAfter(65_000)"); // stale ring self-clears
    // NotificationChannel is API 26+; minSdk 24 — the unguarded class was a
    // boot crash on Android 7.x (adversarial review finding). Both apps.
    expect(helper).toContain("Build.VERSION.SDK_INT < 26");
    expect(read("mobile/app/android/app/src/main/java/org/yourchat/relay/NotificationHelper.java"))
      .toContain("Build.VERSION.SDK_INT < 26");
    const fcm = read("mobile/native/android/app/src/main/java/com/relaynative/RelayFcmService.java");
    expect(fcm).toContain('"incoming-call".equals(kind)');
  });

  it("bridges the native layer to the JS engine (CallNative module)", () => {
    const mod = read("mobile/native/android/app/src/main/java/com/relaynative/CallNativeModule.kt");
    for (const m of ["startCallService", "stopCallService", "ensureNotificationPermission", "getPushToken", "cancelRing"])
      expect(mod).toContain(m);
    // Firebase-less builds must not crash: token path is guarded.
    expect(mod).toContain("FirebaseApp.getApps(reactApplicationContext).isEmpty()");
    expect(read("mobile/native/android/app/src/main/java/com/relaynative/MainApplication.kt"))
      .toContain("add(CallNativePackage())");
  });

  it("declares the manifest surface (FGS types, full-screen intent, FCM service)", () => {
    const man = read("mobile/native/android/app/src/main/AndroidManifest.xml");
    for (const p of [
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.USE_FULL_SCREEN_INTENT",
      "android.permission.FOREGROUND_SERVICE_MICROPHONE",
    ]) expect(man).toContain(p);
    expect(man).toMatch(/IncomingCallActivity[\s\S]*?android:showWhenLocked="true"/);
    expect(man).toMatch(/CallService[\s\S]*?microphone\|mediaPlayback/);
    expect(man).toContain("com.google.firebase.MESSAGING_EVENT");
  });

  it("builds WITHOUT Firebase (conditional google-services apply)", () => {
    expect(read("mobile/native/android/build.gradle")).toContain("com.google.gms:google-services");
    const app = read("mobile/native/android/app/build.gradle");
    expect(app).toContain("firebase-bom");
    expect(app).toMatch(/if \(relayServicesJson\.exists\(\)\)/);
    // google-services.json is deliberately COMMITTABLE (public config; CI
    // builds need it for FCM) — the ignore entry must stay commented out.
    expect(read("mobile/native/.gitignore")).toMatch(/^# google-services\.json/m);
  });

  it("wires the engine: FGS at establish/hangup + FCM token → push.subscribe", () => {
    const eng = read("mobile/native/src/call/engine.tsx");
    expect(eng).toContain("nativeStartCallService(st.current.peerName");
    expect(eng).toContain("nativeStopCallService()");
    // Android 12+ rejects FGS starts from the background — the engine retries
    // the keep-alive on foreground when the call established while backgrounded.
    expect(eng).toMatch(/if \(established\.current\) nativeStartCallService/);
    expect(eng).toContain("nativeCancelRing()"); // in-app ring supersedes the FCM one
    expect(eng).toContain("serverApi.pushSubscribe(token)");
    // kind:"fcm" — endpoint IS the device token (server/v2routers.ts contract).
    expect(read("mobile/native/src/lib/api.ts")).toMatch(/push\.subscribe.*kind: "fcm"/);
  });
});

describe("native rewrite — M3.5 call waiting / groups / rejoin / voice notes", () => {
  const eng = () => read("mobile/native/src/call/engine.tsx");

  it("call waiting: v2.83 replace rules, destructive answer is leave-THEN-accept, promote-on-death", () => {
    const e = eng();
    // The old blind in-call auto-reject is gone; only a fresh different-caller waiter rejects.
    expect(e).toMatch(/w && w\.from !== m\.from && Date\.now\(\) - w\.at <= 70_000/);
    // The switch awaits a RETRIED leave before accept (v2.50 race class).
    expect(e).toMatch(/await sig\.current\?\.send\(\{ type: "leave", reason: "switch" \}, \{ attempts: 3 \}\)/);
    expect(read("mobile/native/src/call/signaling.ts")).toContain("opts?.attempts");
    // A dying call must promote a live waiter, not swallow it (v2.78.1).
    expect(e).toMatch(/promoted/);
    // peer-hold parks us instead of the SFU auto-end firing.
    expect(e).toContain('case "peer-hold"');
    expect(e).toMatch(/!callIsGroup\.current && !heldByPeer\.current/);
    // In-call waiting cue is vibration — never a ringtone over live audio.
    expect(e).toMatch(/Vibration\.vibrate/);
    // UI: the answer button says what it does — END the current call.
    expect(read("mobile/native/src/screens/CallOverlay.tsx")).toContain("End call & answer");
  });

  it("groups: room-flush dial, add-person offline guard, consent bypass, no 0-remote auto-end", () => {
    const e = eng();
    expect(e).toContain("dialGroup:");
    expect(e).toMatch(/pendingGroupInvites\.current\.splice\(0\)/); // flushed on the server's `room` ack
    expect(e).toMatch(/addInviteGuardUntil\.current = Date\.now\(\) \+ 6000/); // v2.50: offline add = toast, not teardown
    expect(e).toMatch(/videoApproved\.current \|\| callIsGroup\.current/); // v2.81 group consent bypass
    expect(e).toMatch(/aloneInCall\(\)/); // web-shaped teardown gates
    expect(read("mobile/native/src/screens/Dialer.tsx")).toContain("call.dialGroup(group");
  });

  it("rejoin: snapshot gates registration, hijack guard, ghost-roster timeout", () => {
    const snap = read("mobile/native/src/call/rejoinSnapshot.ts");
    expect(snap).toContain("REJOIN_MAX_AGE_MS = 28_000");
    const e = eng();
    expect(e).toMatch(/readRejoinSnapshot/); // read BEFORE register
    expect(e).toMatch(/snap\.pin !== me\.number/); // shared-device hijack guard
    // The PERSISTED cid is what lets a restart reclaim the in-grace pin —
    // without it the ≤28s snapshot window sits entirely inside the server's
    // 30s grace and rejoin can never fire (review finding #1).
    expect(e).toMatch(/await s\.restoreCid\(\)/);
    expect(read("mobile/native/src/call/signaling.ts")).toContain('AsyncStorage.getItem("relay_cid")');
    expect(e).toMatch(/s\.register\(me\.displayName, snapPin \?\? me\.number\)/);
    expect(e).toContain('"rejoin-no-media"');
    expect(e).toContain('"rejoin-declined"'); // idle offers still declined
    expect(e).toMatch(/hangupInternal\("rejoin-failed"\)/); // rejoin rosters aren't ghost-filtered
    // Room-keyed ring dedupe holds across the whole answer window (Step 0c).
    expect(e).toMatch(/roomId\.current = r\.roomId/);
  });

  it("messaging: createGroup + routed group kind + absolute attachment URLs + m4a voice notes", () => {
    expect(read("mobile/native/src/lib/api.ts")).toContain('"messages.createGroup"');
    const conv = read("mobile/native/src/screens/Conversation.tsx");
    expect(conv).toMatch(/kind === "group"/); // 2-member groups are groups
    expect(conv).toContain("absUrl(m.attachment.url)"); // relative URLs unfetchable in RN
    expect(conv).toContain('mimeType: "audio/mp4"'); // the codec every web <audio> plays
    expect(conv).toContain('kind: "audio"');
    const pkg = JSON.parse(read("mobile/native/package.json"));
    expect(pkg.dependencies["react-native-audio-recorder-player"]).toBeTruthy();
    // The lib's Kotlin predates RN 0.80 (currentActivity property access is
    // gone) — patch-package fixes it at npm ci time; losing either the patch
    // or the postinstall hook is a deterministic CI build failure.
    expect(pkg.scripts.postinstall).toBe("patch-package");
    expect(read("mobile/native/patches/react-native-audio-recorder-player+3.6.14.patch"))
      .toContain("reactContext.currentActivity");
    // The classic react-native-fs has no AGP-8 namespace (breaks the CI
    // build) — the maintained fork is the pinned choice.
    expect(pkg.dependencies["@dr.pogodin/react-native-fs"]).toBeTruthy();
    expect(pkg.dependencies["react-native-fs"]).toBeUndefined();
    expect(read("mobile/native/src/screens/MessagesList.tsx")).toContain("startGroup");
  });
});

describe("native rewrite — M5 screen share / PiP (Android)", () => {
  it("engine speaks the production screen vocabulary, and offers no recording", () => {
    const e = read("mobile/native/src/call/engine.tsx");
    const pkg2 = JSON.parse(read("mobile/native/package.json"));
    expect(e).toContain('case "peer-screen"');
    expect(e).toMatch(/type: "screen", action: "on"/); // server broadcasts peer-screen
    /* RECORDING IS GONE, AND THIS ASSERTION USED TO REQUIRE IT (v2.106.54).
       It was the hosted SFU's egress service in its entirety — `server/recording.ts`
       said so in its own header — so it died with the cancelled account: the server
       sends no `recording` flag on the registered ack and has no case for either verb.
       Leaving the control here would have been a Record chip driven by a flag nothing
       sets, whose taps reach a server that ignores them — a control that silently does
       nothing, which is the class this repo keeps removing. Asserted on the OVERLAY too,
       because the engine going quiet while the chip stayed is the half-shipped shape. */
    const ov = read("mobile/native/src/screens/CallOverlay.tsx");
    for (const gone of ['"start-recording"', '"stop-recording"', 'case "recording"',
                        "recAvailable", "recOn", "toggleRecording"]) {
      expect(e, `engine still names ${gone}`).not.toContain(gone);
      expect(ov, `overlay still names ${gone}`).not.toContain(gone);
    }
    expect(ov).not.toContain("REC");
    /* THE SFU BRANCH IS GONE (v2.106.54): the hosted SFU account was cancelled, so
       `setScreenShareEnabled` — its SDK's capture call — must not come back. Screen
       share is the MESH path only now: getDisplayMedia + a replaceTrack hot-swap
       into the pre-allocated video m-line. */
    expect(e).not.toContain("setScreenShareEnabled");
    /* THE CALL, not the name. A `toContain("getDisplayMedia")` here SURVIVED a mutation
       that deleted the awaited call, because the identifier also occurs in the local
       type declaration and in the `!md.getDisplayMedia` support guard — so it pinned
       that the engine MENTIONS capture while share had become a no-op. With the SFU
       branch gone this is the only capture path there is. */
    expect(e).toMatch(/await md\.getDisplayMedia\(/);
    // Android 14: mediaProjection FGS type only AFTER the capture grant.
    expect(e).toMatch(/screenShare: true/);
    expect(read("mobile/native/android/app/src/main/java/com/relaynative/CallService.java"))
      .toContain("FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION");
    // Review findings: the lib's projection FGS is OFF until setup() runs
    // (share silently sends black without it), and startForeground with a
    // type missing from the manifest declaration throws.
    /* THIS STAYS, AND IT IS A MESH DEPENDENCY WEARING A CONFUSING NAME.
       `LiveKitReactNative.setup()` configures `WebRTCModuleOptions` — the options of
       @livekit/react-native-webrtc, i.e. the binding the MESH is built on: hardware
       acoustic echo cancellation and noise suppression, the video encoder/decoder
       factories, and `enableMediaProjectionService`, without which screen share sends
       BLACK FRAMES. Deleting it alongside the SFU client (v2.106.54's first draft did)
       would cost every mesh call its hardware audio processing and break screen share,
       while also failing the Kotlin compile on the unresolved import. */
    expect(read("mobile/native/android/app/src/main/java/com/relaynative/MainApplication.kt"))
      .toContain("LiveKitReactNative.setup(this)");
    // …so the package that provides it must remain a dependency, while the SFU
    // CLIENT must not.
    expect(pkg2.dependencies["@livekit/react-native"], "the Android initialiser").toBeTruthy();
    expect(pkg2.dependencies["@livekit/react-native-webrtc"], "the WebRTC binding").toBeTruthy();
    expect(pkg2.dependencies["livekit-client"], "the SFU client is deleted").toBeUndefined();
    expect(read("mobile/native/android/app/src/main/AndroidManifest.xml"))
      .toContain("microphone|mediaPlayback|mediaProjection");
    // Mid-share parity: camera enable is state-only, joiners get the SCREEN.
    const eng = read("mobile/native/src/call/engine.tsx");
    expect(eng).toMatch(/if \(st\.current\.sharingScreen\) return;/);
    /* THIS is the mid-share join rule, and after v2.106.54 it is the ONLY one: a
       fresh mesh peer is handed the screen track rather than the parked camera.
       `Track.Source.ScreenShare` was the SFU half of the same rule (its viewers
       picked the share publication out of a participant's tracks) and it came from
       the deleted `livekit-client` — so its NAMESPACE must be gone too, or the
       import is back. */
    expect(eng).toMatch(/screenVt \?\? ls\.getVideoTracks\(\)\[0\]/);
    expect(eng).not.toContain("Track.Source");
    expect(eng).not.toMatch(/\bfrom "livekit-client"/);
  });

  /* THE MANIFEST AND ITS LOCKFILE CANNOT DISAGREE, AND THIS GUARD EXISTS BECAUSE
     THE WAY THEY BREAK IS SILENT. `native-rn.yml` installs this project with
     `npm ci`, which REFUSES to run when package.json and package-lock.json declare
     different roots — but READ ITS TRIGGER BEFORE RELYING ON IT: `push` on branch
     **`main`** AND path `mobile/native/**`, plus `workflow_dispatch`. Both
     conditions, and `main` is the Expo project rather than this app's mainline —
     so it does NOT run on a PR, and does NOT run on a merge into `web-app-main`.
     An older note (CLAUDE.md/todo.md, v2.99.52) claims it "triggers on any push
     touching mobile/native/**, so the commit verifies itself"; that is wrong on
     both counts and is corrected in the v2.107.62 entry.
     That is precisely why this check has to live HERE: a half-restore (the
     dependency put back in the manifest and not in the lock) sails through every
     PR and every merge, and then breaks the Android build for whoever next
     dispatches that workflow, with nothing saying why. Comparing the two roots is
     the check `npm ci` performs, moved into the suite that runs on EVERY change. */
  it("the mobile manifest and its lockfile declare the same dependencies", () => {
    const pkg = JSON.parse(read("mobile/native/package.json"));
    const lock = JSON.parse(read("mobile/native/package-lock.json"));
    const root = lock.packages?.[""];
    expect(root, "the lockfile's root package entry").toBeTruthy();
    for (const section of ["dependencies", "devDependencies"] as const) {
      expect(root[section] ?? {}, `${section} must match package.json`).toEqual(
        pkg[section] ?? {},
      );
    }
    // Non-vacuity: a lockfile listing nothing would satisfy an empty manifest.
    expect(Object.keys(pkg.dependencies ?? {}).length).toBeGreaterThan(5);
    // …and the initialiser must be RESOLVED, not merely requested: a root entry
    // with no installed package is what an interrupted `npm install` leaves.
    expect(
      lock.packages?.["node_modules/@livekit/react-native"],
      "the Android initialiser must be resolved in the lockfile",
    ).toBeTruthy();
  });

  it("PiP: in-call home press shrinks to Picture-in-Picture, gated by the engine", () => {
    expect(read("mobile/native/android/app/src/main/java/com/relaynative/MainActivity.kt"))
      .toContain("enterPictureInPictureMode");
    expect(read("mobile/native/android/app/src/main/AndroidManifest.xml"))
      .toContain('android:supportsPictureInPicture="true"');
    const e = read("mobile/native/src/call/engine.tsx");
    expect(e).toContain("nativeSetPipEligible(true)");  // at establish
    expect(e).toContain("nativeSetPipEligible(false)"); // at hangup
  });
});
