import React, { useState } from "react";
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { api, type ContactRow } from "../lib/api";
import { colors, spacing } from "../lib/theme";

const CATS = [
  { key: null, label: "None" },
  { key: "vip", label: "VIP" },
  { key: "family", label: "Family" },
  { key: "friend", label: "Friend" },
  { key: "team", label: "Team" },
] as const;

/** Add/edit contact — name, number, category chips, favorite, block, notes. */
export function ContactEdit({ route, navigation }: {
  route: { params?: { contact?: ContactRow } };
  navigation: { goBack: () => void };
}) {
  const existing = route.params?.contact ?? null;
  const [number, setNumber] = useState(existing?.number ?? "");
  const [name, setName] = useState(existing?.displayName ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [category, setCategory] = useState<"vip" | "family" | "friend" | "team" | null>(existing?.category ?? null);
  const [favourite, setFavourite] = useState(!!existing?.favourite);
  const [blocked, setBlocked] = useState(!!existing?.blocked);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!/^\d{6}$/.test(number)) { Alert.alert("Enter a 6-digit RELAY number"); return; }
    setBusy(true);
    try {
      await api.contactUpsert({
        number,
        displayName: name.trim() || null,
        notes: notes.trim() || null,
        category,
        favourite,
        blocked,
      });
      navigation.goBack();
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : "Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: spacing(4), gap: spacing(3) }}>
      <Text style={s.label}>RELAY number</Text>
      <TextInput
        style={[s.input, !!existing && { opacity: 0.6 }]}
        editable={!existing}
        keyboardType="number-pad"
        maxLength={6}
        value={number}
        onChangeText={v => setNumber(v.replace(/\D/g, ""))}
        placeholder="123456"
        placeholderTextColor={colors.textMuted}
      />
      <Text style={s.label}>Name</Text>
      <TextInput style={s.input} value={name} onChangeText={setName} maxLength={64}
        placeholder="Display name" placeholderTextColor={colors.textMuted} />
      <Text style={s.label}>Category</Text>
      <View style={s.chips}>
        {CATS.map(c => (
          <TouchableOpacity key={String(c.key)}
            style={[s.chip, category === c.key && s.chipOn]}
            onPress={() => setCategory(c.key)}>
            <Text style={[s.chipText, category === c.key && { color: colors.bg }]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={s.switchRow}>
        <Text style={s.label}>Favorite ★</Text>
        <Switch value={favourite} onValueChange={setFavourite} trackColor={{ true: colors.accent }} />
      </View>
      <View style={s.switchRow}>
        <Text style={s.label}>Blocked ⛔ (their calls + messages are refused)</Text>
        <Switch value={blocked} onValueChange={setBlocked} trackColor={{ true: colors.danger }} />
      </View>
      <Text style={s.label}>Notes</Text>
      <TextInput style={[s.input, { minHeight: 80 }]} value={notes} onChangeText={setNotes}
        multiline maxLength={2000} placeholder="Notes" placeholderTextColor={colors.textMuted} />
      <TouchableOpacity style={[s.save, busy && { opacity: 0.5 }]} onPress={save} disabled={busy}>
        <Text style={s.saveText}>{existing ? "Save changes" : "Add contact"}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, color: colors.text, fontSize: 16, paddingHorizontal: spacing(3), paddingVertical: spacing(2.5) },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing(3), paddingVertical: spacing(1.5), backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.tabContacts, borderColor: colors.tabContacts },
  chipText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  save: { backgroundColor: colors.tabContacts, borderRadius: 14, alignItems: "center", paddingVertical: spacing(3.5), marginTop: spacing(2) },
  saveText: { color: colors.bg, fontSize: 16, fontWeight: "800" },
});
