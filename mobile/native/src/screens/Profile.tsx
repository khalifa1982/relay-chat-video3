import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { type Whoami } from "../lib/api";
import { colors, spacing } from "../lib/theme";

export function Profile({ me }: { me: Whoami }) {
  const pin = me.number.length === 6 ? `${me.number.slice(0, 3)}-${me.number.slice(3)}` : me.number;
  return (
    <View style={s.root}>
      <View style={s.avatar}><Text style={s.avatarText}>{me.displayName.slice(0, 2).toUpperCase()}</Text></View>
      <Text style={s.name}>{me.displayName} {me.verified ? "✔" : ""}</Text>
      <Text style={s.pin}>{pin}</Text>
      <Text style={s.kind}>{me.isGuest ? "Guest identity" : me.email ?? "Registered"}</Text>
      <Text style={s.build}>RELAY native · 3.0.0-m1 (Milestone 1)</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: "center", paddingTop: spacing(16) },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.accent },
  avatarText: { color: colors.text, fontSize: 34, fontWeight: "800" },
  name: { color: colors.text, fontSize: 22, fontWeight: "700", marginTop: spacing(4) },
  pin: { color: colors.accent, fontSize: 18, fontWeight: "700", marginTop: spacing(1), fontVariant: ["tabular-nums"] },
  kind: { color: colors.textMuted, marginTop: spacing(2) },
  build: { color: colors.textMuted, fontSize: 12, position: "absolute", bottom: spacing(8) },
});
