/**
 * Stable per-install device id — the SAME identity mechanism the web app uses
 * (`x-relay-device-id` header; server resolves identities by deviceId, see
 * server/_core/context.ts). This keeps guest identity sticky across app
 * restarts without depending on cookie behavior.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "relay_device_id";
let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const existing = await AsyncStorage.getItem(KEY);
  if (existing) {
    cached = existing;
    return existing;
  }
  const bytes = new Uint8Array(16);
  // Hermes provides crypto.getRandomValues (RN >= 0.75).
  (globalThis.crypto ?? require("react-native").NativeModules).getRandomValues?.(bytes);
  if (bytes.every(b => b === 0)) {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const id = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  cached = id;
  await AsyncStorage.setItem(KEY, id);
  return id;
}
