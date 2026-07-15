/**
 * @format
 */
import { AppRegistry } from 'react-native';
import { registerGlobals } from '@livekit/react-native';
import App from './App';
import { name as appName } from './app.json';

// WebRTC globals (RTCPeerConnection, mediaDevices, …) from LiveKit's
// react-native-webrtc fork — ONE native WebRTC stack serves both the mesh
// path and the LiveKit SFU path.
registerGlobals();

AppRegistry.registerComponent(appName, () => App);
