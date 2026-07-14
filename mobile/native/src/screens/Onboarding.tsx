import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { api, type Whoami } from "../lib/api";
import { colors, spacing } from "../lib/theme";

/** Guest-first entry — mirrors the web OnboardingGate (v2.81 order). */
export function Onboarding({ onReady }: { onReady: (me: Whoami) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enter = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const me = await api.startGuest(name.trim());
      onReady(me);
    } catch {
      setError("Couldn't reach RELAY — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.root}>
      <View style={s.badge}><Text style={s.badgeText}>R</Text></View>
      <Text style={s.title}>RELAY</Text>
      <Text style={s.sub}>Pick a name — you'll get your own 6-digit number.</Text>
      <TextInput
        style={s.input}
        placeholder="Your display name"
        placeholderTextColor={colors.textMuted}
        value={name}
        onChangeText={setName}
        autoFocus
        maxLength={64}
        onSubmitEditing={enter}
      />
      <TouchableOpacity style={[s.cta, (!name.trim() || busy) && s.ctaOff]} onPress={enter} disabled={!name.trim() || busy}>
        {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={s.ctaText}>Enter as guest</Text>}
      </TouchableOpacity>
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: spacing(6) },
  badge: { width: 72, height: 72, borderRadius: 20, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center", marginBottom: spacing(3) },
  badgeText: { color: colors.accent, fontSize: 34, fontWeight: "800" },
  title: { color: colors.text, fontSize: 28, fontWeight: "800", letterSpacing: 4 },
  sub: { color: colors.textMuted, fontSize: 14, marginTop: spacing(2), marginBottom: spacing(6), textAlign: "center" },
  input: { alignSelf: "stretch", backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, color: colors.text, fontSize: 16, paddingHorizontal: spacing(4), paddingVertical: spacing(3) },
  cta: { alignSelf: "stretch", backgroundColor: colors.accent, borderRadius: 14, alignItems: "center", paddingVertical: spacing(3.5), marginTop: spacing(3) },
  ctaOff: { opacity: 0.5 },
  ctaText: { color: colors.bg, fontSize: 16, fontWeight: "700" },
  error: { color: colors.danger, marginTop: spacing(3), fontSize: 13, textAlign: "center" },
});
