import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

/**
 * MINIMAL ROOT LAYOUT — diagnostic build to isolate crash.
 * No tRPC, no QueryClient, no GestureHandler, no NativeWind, no SafeArea overrides.
 */
export default function RootLayout() {
  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
      <StatusBar style="auto" />
    </>
  );
}
