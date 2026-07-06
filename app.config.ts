// Load environment variables with proper priority (system > .env)
import "./scripts/load-env.js";
import type { ExpoConfig } from "expo/config";

// Bundle ID format: space.manus.<project_name_dots>.<timestamp>
// e.g., "my-app" created at 2024-01-15 10:30:45 -> "space.manus.my.app.t20240115103045"
// Bundle ID can only contain letters, numbers, and dots
// Android requires each dot-separated segment to start with a letter
const rawBundleId = "com.relaytech.calling";
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
// Extract timestamp from bundle ID and prefix with "manus" for deep link scheme
// e.g., "space.manus.my.app.t20240115103045" -> "manus20240115103045"
const timestamp = bundleId.split(".").pop()?.replace(/^t/, "") ?? "";
const schemeFromBundleId = `manus${timestamp}`;

// Android native build number (versionCode). The self-hosted APK updater
// compares the server manifest's buildNumber against THIS value to decide
// whether a newer APK is available. Bump this every time you publish a new APK
// (and set the manifest's buildNumber to match the new release).
const ANDROID_BUILD_NUMBER = 16;

const env = {
  // App branding - update these values directly (do not use env vars)
  appName: "RELAY",
  appSlug: "relay-mobile",
  // S3 URL of the app logo - set this to the URL returned by generate_image when creating custom logo
  // Leave empty to use the default icon from assets/images/icon.png
  logoUrl: "/manus-storage/relay-icon_08a8c101.png",
  scheme: schemeFromBundleId,
  iosBundleId: "com.app.relaymobile",
  androidPackage: bundleId,
};

const config: ExpoConfig = {
  name: env.appName,
  slug: env.appSlug,
  version: "1.0.16",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: env.scheme,
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: env.iosBundleId,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription:
        "RELAY needs camera access so you can make video calls.",
      NSMicrophoneUsageDescription:
        "RELAY needs microphone access so you can make voice and video calls.",
      // Keep the call's audio session alive while backgrounded (voice/video calls).
      UIBackgroundModes: ["audio", "voip"],
    },
  },
  android: {
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
        microphonePermission: "Allow $(PRODUCT_NAME) to access your microphone.",
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
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
