import { Tabs } from "expo-router";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";

/**
 * RELAY Mobile is a thin shell that loads the RELAY web app inside a full-screen
 * WebView. The web app provides its own bottom navigation (Dialer / History /
 * Messages / Contacts), so we hide the native tab bar entirely and present a
 * single immersive screen.
 */
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        // Hide the native tab bar — the web app supplies its own navigation.
        tabBarStyle: { display: "none" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "RELAY",
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
