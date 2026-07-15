/**
 * RELAY native (Milestone 1) — compiled React Native app, no webview.
 * Identity, navigation, and the four tab surfaces run against the EXISTING
 * backend (tRPC/superjson over HTTPS, device-id identity — the same API the
 * production web app uses, unmodified). The call engine port is Milestone 3;
 * the OS call experience (CallKit / ConnectionService) is Milestone 4.
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StatusBar, Text, View } from "react-native";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { api, type Whoami } from "./src/lib/api";
import { SessionProvider } from "./src/lib/session";
import { CallProvider } from "./src/call/engine";
import { CallOverlay } from "./src/screens/CallOverlay";
import { colors } from "./src/lib/theme";
import { Onboarding } from "./src/screens/Onboarding";
import { Dialer } from "./src/screens/Dialer";
import { History } from "./src/screens/Lists";
import { MessagesList } from "./src/screens/MessagesList";
import { ContactsList } from "./src/screens/ContactsList";
import { Conversation } from "./src/screens/Conversation";
import { ContactEdit } from "./src/screens/ContactEdit";
import { Profile } from "./src/screens/Profile";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    border: colors.border,
    text: colors.text,
    primary: colors.accent,
  },
};

// Same tab set + per-tab accent colors as the web AppShell.
const TABS = [
  { name: "Calls", accent: colors.tabCalls, icon: "📞" },
  { name: "History", accent: colors.tabHistory, icon: "🕘" },
  { name: "Messages", accent: colors.tabMessages, icon: "💬" },
  { name: "Contacts", accent: colors.tabContacts, icon: "👥" },
  { name: "Profile", accent: colors.accent, icon: "👤" },
] as const;

export default function App() {
  const [me, setMe] = useState<Whoami | null>(null);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    api.whoami().then(w => setMe(w)).catch(() => {}).finally(() => setBooted(true));
  }, []);

  // Presence heartbeat — same 30s cadence as the web useIdentity hook.
  useEffect(() => {
    if (!me) return;
    api.heartbeat().catch(() => {});
    const t = setInterval(() => api.heartbeat().catch(() => {}), 30_000);
    return () => clearInterval(t);
  }, [me?.id]);

  if (!booted) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (!me) {
    return (
      <>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <Onboarding onReady={setMe} />
      </>
    );
  }

  const Tabs = () => (
      <Tab.Navigator
        screenOptions={({ route }) => {
          const tab = TABS.find(t => t.name === route.name)!;
          return {
            headerStyle: { backgroundColor: colors.bg },
            headerTitleStyle: { color: colors.text, fontWeight: "700" },
            headerShadowVisible: false,
            tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
            tabBarActiveTintColor: tab.accent,
            tabBarInactiveTintColor: colors.textMuted,
            tabBarIcon: ({ focused }) => (
              <Text style={{ fontSize: 18, opacity: focused ? 1 : 0.55 }}>{tab.icon}</Text>
            ),
          };
        }}
      >
        <Tab.Screen name="Calls">{() => <Dialer me={me} />}</Tab.Screen>
        <Tab.Screen name="History" component={History} />
        <Tab.Screen name="Messages" component={MessagesList as never} />
        <Tab.Screen name="Contacts" component={ContactsList as never} />
        <Tab.Screen name="Profile">{() => <Profile me={me} />}</Tab.Screen>
      </Tab.Navigator>
  );

  return (
    <SessionProvider value={me}>
      <CallProvider me={me}>
      <NavigationContainer theme={navTheme}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerTitleStyle: { fontWeight: "700" },
          }}
        >
          <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
          <Stack.Screen
            name="Conversation"
            component={Conversation as never}
            options={({ route }) => ({ title: (route.params as { title?: string })?.title ?? "Conversation" })}
          />
          <Stack.Screen
            name="ContactEdit"
            component={ContactEdit as never}
            options={({ route }) => ({
              title: (route.params as { contact?: unknown })?.contact ? "Edit contact" : "New contact",
            })}
          />
        </Stack.Navigator>
      </NavigationContainer>
      <CallOverlay />
      </CallProvider>
    </SessionProvider>
  );
}
