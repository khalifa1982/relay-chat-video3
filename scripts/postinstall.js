#!/usr/bin/env node
/**
 * postinstall: apply native patches for react-native-callkeep and
 * react-native-voip-push-notification to work with RN 0.81+ and macOS.
 */
const fs = require('fs');
const path = require('path');

// ─── Patch 1: react-native-callkeep podspec ────────────────────────────────
// The podspec references `s.dependency 'React'` which no longer exists in
// RN 0.73+. Replace with 'React-Core'.
const podspecPath = path.join(
  __dirname, '..', 'node_modules', 'react-native-callkeep', 'RNCallKeep.podspec'
);

if (fs.existsSync(podspecPath)) {
  let content = fs.readFileSync(podspecPath, 'utf8');
  if (content.includes("s.dependency 'React'") && !content.includes("s.dependency 'React-Core'")) {
    content = content.replace("s.dependency 'React'", "s.dependency 'React-Core'");
    fs.writeFileSync(podspecPath, content);
    console.log('[postinstall] Patched react-native-callkeep podspec: React -> React-Core');
  } else {
    console.log('[postinstall] react-native-callkeep podspec already patched or not found');
  }
} else {
  console.log('[postinstall] react-native-callkeep not installed, skipping patch');
}

// ─── Patch 2: react-native-voip-push-notification ──────────────────────────
// The library's `voipRegistration` creates a PKPushRegistry with the AppDelegate
// as delegate. On macOS ("Designed for iPad"), PushKit VoIP is unsupported and
// the delegate callback crashes with "unrecognized selector". Add a runtime
// guard to bail out on macOS before creating the registry.
const voipManagerPath = path.join(
  __dirname, '..', 'node_modules', 'react-native-voip-push-notification',
  'ios', 'RNVoipPushNotification', 'RNVoipPushNotificationManager.m'
);

if (fs.existsSync(voipManagerPath)) {
  let voipContent = fs.readFileSync(voipManagerPath, 'utf8');
  if (!voipContent.includes('isiOSAppOnMac')) {
    // Insert the macOS guard right after the opening brace of voipRegistration
    const marker = '+ (void)voipRegistration\n{';
    if (voipContent.includes(marker)) {
      voipContent = voipContent.replace(
        marker,
        `+ (void)voipRegistration\n{\n    // [RELAY PATCH] Skip on macOS where PushKit VoIP is unsupported\n    if (@available(iOS 13.0, *)) {\n        if ([NSProcessInfo processInfo].isiOSAppOnMac) {\n            return;\n        }\n    }`
      );
      fs.writeFileSync(voipManagerPath, voipContent);
      console.log('[postinstall] Patched RNVoipPushNotificationManager: added macOS guard');
    } else {
      console.log('[postinstall] WARNING: Could not find voipRegistration marker in RNVoipPushNotificationManager.m');
    }
  } else {
    console.log('[postinstall] RNVoipPushNotificationManager already patched with macOS guard');
  }
} else {
  console.log('[postinstall] react-native-voip-push-notification not installed, skipping patch');
}
