# Build Debug Notes

## Build History
- v1.0.26 (build 13) - SUCCESS - no callkeep, no voip, newArchEnabled: true
- v1.0.27 (build 14) - ERRORED - "Install dependencies" - lockfile out of sync
- v1.0.28 (build 15) - ERRORED - "Install dependencies" - lockfile out of sync  
- v1.0.28 (build 16) - ERRORED - "Install pods" - lockfile fixed, pod install fails
- v1.0.28 (build 17) - ERRORED - "Install pods" - with patch + postinstall, still fails

## Key Differences from v1.0.26 (success) to v1.0.28 (fail)
1. Added `react-native-callkeep@^4.3.16` 
2. Added `react-native-voip-push-notification@^3.3.3`
3. Changed `newArchEnabled: true` → `false`
4. Added `./plugins/with-ios-voip.js` to plugins array
5. Restored `hooks/use-voip-callkit.ts` (full implementation)
6. Added VoIP integration to `components/relay-webview.tsx`

## Pod Install Error Analysis
- Error occurs in ~48 seconds (too fast for compilation, it's dependency resolution)
- The callkeep podspec originally had `s.dependency 'React'` (deprecated in RN 0.73+)
- Patched to `s.dependency 'React-Core'` via pnpm patch + postinstall script
- Both approaches confirmed working locally
- The voip-push-notification podspec already uses `React-Core`

## Possible Remaining Issues
1. The entitlements file has `aps-environment: development` but this is a store build
   - The with-ios-voip.js plugin adds this, EAS should override to `production` for store builds
2. The Info.plist has `<string>voip</string>` in UIBackgroundModes
   - This requires the VoIP Push entitlement in the provisioning profile
   - The provisioning profile (Q7SZQNVFA3) may NOT have VoIP push capability enabled
3. Maybe the pod install fails because of a different reason entirely

## Next Steps
- Try removing the with-ios-voip.js plugin temporarily and just keep the packages
- Or try adding VoIP capability to the Apple Developer portal provisioning profile
- Or check if EAS needs the provisioning profile regenerated with VoIP push capability
