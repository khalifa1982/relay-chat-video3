/** Per-conversation mute — client-side, exactly like the web (localStorage). */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "relay_muted_threads";
let cache: Set<number> | null = null;

async function load(): Promise<Set<number>> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch {
    cache = new Set();
  }
  return cache;
}

export async function isMuted(conversationId: number): Promise<boolean> {
  return (await load()).has(conversationId);
}

export async function toggleMute(conversationId: number): Promise<boolean> {
  const s = await load();
  if (s.has(conversationId)) s.delete(conversationId);
  else s.add(conversationId);
  await AsyncStorage.setItem(KEY, JSON.stringify([...s]));
  return s.has(conversationId);
}
