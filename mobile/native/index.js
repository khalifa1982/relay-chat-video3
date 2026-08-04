/**
 * @format
 */
import { AppRegistry } from 'react-native';
import { registerGlobals } from '@livekit/react-native-webrtc';
import App from './App';
import { name as appName } from './app.json';
import { initNativeCrashReporter } from './src/lib/crashReporter';

// Crash telemetry (v2.107.x): installed BEFORE the app registers so even a
// crash in the very first render is recorded — fatals persist locally and are
// delivered to the server's /api/crash on the next launch.
initNativeCrashReporter();

// WebRTC globals (RTCPeerConnection, mediaDevices, …) from LiveKit's
// react-native-webrtc fork — ONE native WebRTC stack serves both the mesh
// path and the LiveKit SFU path.
registerGlobals();

AppRegistry.registerComponent(appName, () => App);
