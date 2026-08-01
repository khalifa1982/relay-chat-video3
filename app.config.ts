// Load environment variables with proper priority (system > .env)
import "./scripts/load-env.js";
import type { ExpoConfig } from "expo/config";

// Bundle ID format: space.manus.<project_name_dots>.<timestamp>
// e.g., "my-app" created at 2024-01-15 10:30:45 -> "space.manus.my.app.t20240115103045"
// Bundle ID can only contain letters, numbers, and dots
// Android requires each dot-separated segment to start with a letter
const rawBundleId = "com.app.relaymobile";
const bundleId =
  rawBundleId
    .replace(/[-_]/g, ".") // Replace hyphens/underscores with dots
    .replace(/[^a-zA-Z0-9.]/g, "") // Remove invalid chars
    .replace(/\.+/g, ".") // Collapse consecutive dots
    .replace(/^\.+|\.+$/g, "") // Trim leading/trailing dots
    .toLowerCase()
    .split(".")
    .map((segment) => {
      // Android requires each segment to start with a letter
      // Prefix with 'x' if segment starts with a digit
      return /^[a-zA-Z]/.test(segment) ? segment : "x" + segment;
    })
    .join(".") || "space.manus.app";
// Deep-link scheme: the server fires relay://call/<callId> — must match exactly.
const schemeFromBundleId = "relay";

// Android native build number (versionCode). The self-hosted APK updater
// compares the server manifest's buildNumber against THIS value to decide
// whether a newer APK is available. Bump this every time you publish a new APK
// (and set the manifest's buildNumber to match the new release).
const ANDROID_BUILD_NUMBER = 33;

const env = {
  // App branding - update these values directly (do not use env vars)
  appName: "RELAY",
  appSlug: "relay",
  // S3 URL of the app logo - set this to the URL returned by generate_image when creating custom logo
  // Leave empty to use the default icon from assets/images/icon.png
  logoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/86205309/gICDuHUjOkeXoJiJ.png",
  scheme: schemeFromBundleId,
  iosBundleId: "com.app.relaymobile",
  androidPackage: bundleId,
};

const config: ExpoConfig = {
  owner: "uaecoms-team",
  name: env.appName,
  slug: env.appSlug,
  version: "1.0.26",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: env.scheme,
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: env.iosBundleId,
    buildNumber: "32",
    googleServicesFile: "./GoogleService-Info.plist",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription:
        "RELAY uses your camera to transmit live video to the person you are calling during a video call. For example, when you tap the video-call button next to a contact's name, your front camera activates so the other person can see you in real time.",
      NSMicrophoneUsageDescription:
        "RELAY uses your microphone to capture and transmit your voice to the person you are speaking with during a voice or video call. For example, when you accept an incoming call or dial a contact, your microphone activates so the other person can hear you clearly throughout the conversation.",
      // Keep the call's audio session alive while backgrounded (voice/video calls).
      UIBackgroundModes: ["audio", "voip", "remote-notification"],
    },
  },
  android: {
    googleServicesFile: "./google-services.json",
    adaptiveIcon: {
      backgroundColor: "#0B1020",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    package: env.androidPackage,
    // versionCode is the integer build number the APK updater compares against.
    versionCode: ANDROID_BUILD_NUMBER,
    permissions: [
      "POST_NOTIFICATIONS",
      "CAMERA",
      "RECORD_AUDIO",
      "MODIFY_AUDIO_SETTINGS",
      // Required so the app can launch the system installer for the downloaded APK.
      "REQUEST_INSTALL_PACKAGES",
      // Allow the call/notification service + WebRTC to keep running in background.
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_MICROPHONE",
      "FOREGROUND_SERVICE_CAMERA",
      "FOREGROUND_SERVICE_MEDIA_PROJECTION",
      "WAKE_LOCK",
      // Let a ringing incoming-call notification pop full-screen even when the
      // app is minimized or the device is locked, so the caller is identified.
      "USE_FULL_SCREEN_INTENT",
      // Audio output routing to Bluetooth headsets (earpiece/speaker/Bluetooth switch).
      "BLUETOOTH",
      "BLUETOOTH_CONNECT",
    ],
    // Defense-in-depth (audit follow-up): even if a transitive dependency tries
    // to merge these in, strip them. The app downloads updates to its private
    // cache dir, so it never needs shared/external storage access.
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
            scheme: env.scheme,
            host: "*",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    [
      "expo-audio",
      {
        microphonePermission:
          "RELAY uses your microphone to capture and transmit your voice during voice and video calls. For example, when you accept an incoming call, your microphone activates so the other person can hear you.",
      },
    ],
    [
      "expo-notifications",
      {
        // Bundle the incoming-call ringtone so the Android channel + iOS
        // notification can play it as the call sound.
        sounds: ["./assets/audio/ringtone.wav"],
      },
    ],
    [
      "expo-video",
      {
        supportsBackgroundPlayback: true,
        supportsPictureInPicture: true,
      },
    ],
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
    // Local plugin: enable Android picture-in-picture for active calls.
    "./plugins/with-android-pip.js",
    // Local plugin: native Android FCM service for incoming call ringing when app is killed.
    "./plugins/with-android-fcm-call.js",
    // Local plugin: iOS VoIP Push (PushKit) + CallKit for incoming call ringing.
    "./plugins/with-ios-voip-callkit.js",
  ],
  extra: {
    eas: {
      projectId: "e157c3d8-8d70-42ad-a11c-86d75c691039",
    },
  },
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
