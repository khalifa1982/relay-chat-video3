import React, { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Modal, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { api, type ContactRow } from "../lib/api";
import { onEvent } from "../lib/events";
import { colors, spacing } from "../lib/theme";

const fmtPin = (n: string) => (n.length === 6 ? `${n.slice(0, 3)}-${n.slice(3)}` : n);
const CATEGORY_ORDER = ["vip", "family", "friend", "team"] as const;
const CATEGORY_LABEL: Record<string, string> = { vip: "VIP", family: "Family", friend: "Friends", team: "Team" };

/** Contacts with M2 write-parity: add/edit/favorite/category/block/delete +
 *  Message action; grouped Favorites → categories → the rest, like the web. */
export function ContactsList({ navigation }: { navigation: { navigate: (s: string, p?: object) => void } }) {
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(() => {
    setRefreshing(true);
    api.contacts().then(setRows).catch(() => {}).finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    refresh();
    const off = onEvent(ev => {
      if (ev.kind === "contact" || ev.kind === "presence") refresh();
    });
    const unsub = navigation as unknown as { addListener?: (e: string, cb: () => void) => () => void };
    const focusOff = unsub.addListener?.("focus", refresh);
    return () => { off(); focusOff?.(); };
  }, [refresh]);

  type Section = { label: string; items: ContactRow[] };
  const sections: Section[] = [];
  const favs = rows.filter(r => r.favourite);
  if (favs.length) sections.push({ label: "Favorites", items: favs });
  for (const c of CATEGORY_ORDER) {
    const items = rows.filter(r => !r.favourite && r.category === c);
    if (items.length) sections.push({ label: CATEGORY_LABEL[c], items });
  }
  const rest = rows.filter(r => !r.favourite && !r.category);
  if (rest.length) sections.push({ label: "All contacts", items: rest });
  const flat: Array<{ type: "h"; label: string } | { type: "c"; c: ContactRow }> = [];
  for (const sct of sections) {
    flat.push({ type: "h", label: sct.label });
    for (const c of sct.items) flat.push({ type: "c", c });
  }

  const message = async (c: ContactRow) => {
    try {
      const r = await api.openThread(c.number);
      navigation.navigate("Conversation", { conversationId: r.conversationId, title: r.otherDisplayName });
    } catch {
      Alert.alert("Unavailable", "That number isn't a RELAY user yet.");
    }
  };

  // Bottom action sheet (a Modal — Android caps Alert.alert at 3 buttons).
  const [sheet, setSheet] = useState<ContactRow | null>(null);
  const sheetAction = (fn: () => void) => { setSheet(null); fn(); };
  const actions = (c: ContactRow) => setSheet(c);

  return (
    <View style={s.root}>
      <FlatList
        data={flat}
        keyExtractor={(i, idx) => (i.type === "h" ? `h-${i.label}` : `c-${i.c.id}-${idx}`)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
        ListEmptyComponent={<Text style={s.empty}>No contacts yet — tap ✚ to add one.</Text>}
        renderItem={({ item }) =>
          item.type === "h" ? (
            <Text style={s.header}>{item.label}</Text>
          ) : (
            <TouchableOpacity style={[s.row, item.c.blocked && { opacity: 0.5 }]} onPress={() => actions(item.c)}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>{(item.c.displayName ?? item.c.number).slice(0, 2).toUpperCase()}</Text>
                <View style={[s.led, { backgroundColor: item.c.isOnline ? colors.online : colors.textMuted }]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.title} numberOfLines={1}>
                  {item.c.displayName ?? fmtPin(item.c.number)} {item.c.verified ? "✔" : ""} {item.c.favourite ? "★" : ""}{item.c.blocked ? " ⛔" : ""}
                </Text>
                <Text style={s.sub}>{fmtPin(item.c.number)}{item.c.isOnline ? " · online" : ""}</Text>
              </View>
              <TouchableOpacity style={s.msgBtn} onPress={() => message(item.c)}>
                <Text style={{ fontSize: 16 }}>💬</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          )
        }
      />
      <TouchableOpacity style={s.fab} onPress={() => navigation.navigate("ContactEdit", {})}>
        <Text style={s.fabText}>✚</Text>
      </TouchableOpacity>
      <Modal visible={!!sheet} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <TouchableOpacity style={s.sheetBack} activeOpacity={1} onPress={() => setSheet(null)}>
          <View style={s.sheet}>
            {sheet ? (
              <>
                <Text style={s.sheetTitle}>{sheet.displayName ?? fmtPin(sheet.number)} · {fmtPin(sheet.number)}</Text>
                <TouchableOpacity style={s.sheetRow} onPress={() => sheetAction(() => message(sheet))}>
                  <Text style={s.sheetText}>💬  Message</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.sheetRow} onPress={() => sheetAction(() => navigation.navigate("ContactEdit", { contact: sheet }))}>
                  <Text style={s.sheetText}>✏️  Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.sheetRow} onPress={() => sheetAction(() =>
                  api.contactUpsert({ number: sheet.number, favourite: !sheet.favourite }).then(refresh).catch(() => {}))}>
                  <Text style={s.sheetText}>★  {sheet.favourite ? "Unfavorite" : "Favorite"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.sheetRow} onPress={() => sheetAction(() =>
                  api.contactUpsert({ number: sheet.number, blocked: !sheet.blocked }).then(refresh).catch(() => {}))}>
                  <Text style={[s.sheetText, { color: colors.danger }]}>⛔  {sheet.blocked ? "Unblock" : "Block"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.sheetRow} onPress={() => sheetAction(() =>
                  Alert.alert("Delete contact?", sheet.displayName ?? fmtPin(sheet.number), [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: () => api.contactRemove(sheet.number).then(refresh).catch(() => {}) },
                  ]))}>
                  <Text style={[s.sheetText, { color: colors.danger }]}>🗑  Delete</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { color: colors.textMuted, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, paddingHorizontal: spacing(4), paddingTop: spacing(4), paddingBottom: spacing(1) },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: spacing(4), paddingVertical: spacing(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: colors.tabContacts, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.text, fontWeight: "700" },
  led: { position: "absolute", right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.bg },
  title: { color: colors.text, fontSize: 15, fontWeight: "600" },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  msgBtn: { padding: 8 },
  empty: { color: colors.textMuted, textAlign: "center", marginTop: spacing(20) },
  fab: { position: "absolute", right: spacing(5), bottom: spacing(5), width: 56, height: 56, borderRadius: 28, backgroundColor: colors.tabContacts, alignItems: "center", justifyContent: "center", elevation: 6 },
  fabText: { color: colors.bg, fontSize: 22, fontWeight: "800" },
  sheetBack: { flex: 1, backgroundColor: "#000000AA", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingVertical: spacing(2), paddingBottom: spacing(6) },
  sheetTitle: { color: colors.textMuted, fontSize: 13, fontWeight: "700", textAlign: "center", paddingVertical: spacing(2) },
  sheetRow: { paddingVertical: spacing(3), paddingHorizontal: spacing(5) },
  sheetText: { color: colors.text, fontSize: 16, fontWeight: "600" },
});
