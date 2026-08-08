import type { ExpoConfig } from "expo/config";

/**
 * RELAY mobile shell — clean rebuild (1.1.0, build 46).
 *
 * One WebView to https://your-chat.io plus the native minimum: push, deep
 * links, call affordances, screenshot block. Same bundle ids and EAS project
 * as every prior build, so this ships as a normal update.
 *
 * Push, per the server's senders:
 *  • Android — server/fcm.ts sends FCM HTTP v1 directly; the shell needs a
 *    real FCM registration token, which expo-notifications provides when
 *    `android.googleServicesFile` is set. No Firebase JS SDK required.
 *  • iOS — server/apnsAlert.ts (v2.107.50+) sends raw APNs with the .p8 key;
 *    the shell hands over the raw APNs device token. No Firebase involved,
 *    so the old GoogleService-Info.plist + @react-native-firebase/* are gone.
 */

// Deep-link scheme: the server's notification payloads use relay:// links —
// must match exactly.
const SCHEME = "relay";

const APP_VERSION = "1.1.0";
const BUILD_NUMBER = 46; // iOS buildNumber + Android versionCode

const config: ExpoConfig = {
  owner: "uaecoms-team",
  name: "RELAY",
  slug: "relay",
  version: APP_VERSION,
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: SCHEME,
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.app.relaymobile",
    buildNumber: String(BUILD_NUMBER),
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription:
        "RELAY uses your camera to transmit live video to the person you are calling during a video call. For example, when you tap the video-call button next to a contact's name, your front camera activates so the other person can see you in real time.",
      NSMicrophoneUsageDescription:
        "RELAY uses your microphone to capture and transmit your voice to the person you are speaking with during a voice or video call. For example, when you accept an incoming call or dial a contact, your microphone activates so the other person can hear you clearly throughout the conversation.",
      // Keep the call's audio session alive while backgrounded (voice/video calls).
      UIBackgroundModes: ["audio", "remote-notification"],
    },
  },
  android: {
    // FCM registration tokens for expo-notifications — the server sends
    // pushes to this token via FCM HTTP v1 (server/fcm.ts).
    googleServicesFile: "./google-services.json",
    adaptiveIcon: {
      backgroundColor: "#0B1020",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    package: "com.app.relaymobile",
    versionCode: BUILD_NUMBER,
    permissions: [
      "POST_NOTIFICATIONS",
      // WebRTC in the WebView — the shell grants, the web app captures.
      "CAMERA",
      "RECORD_AUDIO",
      "MODIFY_AUDIO_SETTINGS",
      // Keep a call (mic/camera/WebRTC) running when the app is backgrounded.
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_MICROPHONE",
      "FOREGROUND_SERVICE_CAMERA",
      "WAKE_LOCK",
      // Audio output routing to Bluetooth headsets.
      "BLUETOOTH",
      "BLUETOOTH_CONNECT",
    ],
    // Defense-in-depth: even if a transitive dependency tries to merge these
    // in, strip them. The shell never touches shared/external storage.
    blockedPermissions: [
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.READ_EXTERNAL_STORAGE",
    ],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: SCHEME,
            host: "*",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  plugins: [
    "expo-notifications",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 180,
        resizeMode: "contain",
        backgroundColor: "#050608",
        dark: {
          backgroundColor: "#050608",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["armeabi-v7a", "arm64-v8a"],
          minSdkVersion: 24,
        },
      },
    ],
    // Local manifest-only plugin: PiP + lock-screen call UI + the
    // USE_FULL_SCREEN_INTENT permission for call-style notifications.
    "./plugins/with-android-pip.js",
      [
        "@sentry/react-native/expo",
        {
          url: "https://sentry.io/",
          organization: "relay-apps",
          project: "relay-mobile",
          // Sourcemap/dSYM upload runs only when SENTRY_AUTH_TOKEN is present
          // (set as an EAS secret, deliberately not in this repo).
        },
      ],
  ],
  extra: {
    eas: {
      projectId: "e157c3d8-8d70-42ad-a11c-86d75c691039",
    },
  },
};

export default config;
