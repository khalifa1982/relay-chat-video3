import React, { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { api, type CallRow, type ConferenceRow, type ContactRow, type ThreadRow } from "../lib/api";
import { colors, spacing } from "../lib/theme";

/** M1 read-parity screens: History / Messages / Contacts render LIVE data from
 *  the existing backend with the web app's grouping + color language. Write
 *  actions (send, call back, edit) activate with their engines in M2/M3. */

function useData<T>(load: () => Promise<T>, empty: T) {
  const [data, setData] = useState<T>(empty);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(() => {
    setRefreshing(true);
    load().then(setData).catch(() => {}).finally(() => setRefreshing(false));
  }, [load]);
  useEffect(refresh, [refresh]);
  return { data, refreshing, refresh };
}

const fmtWhen = (d: string | Date | null) => (d ? new Date(d).toLocaleString() : "");
const fmtPin = (n: string | null) => (n && n.length === 6 ? `${n.slice(0, 3)}-${n.slice(3)}` : n ?? "");

export function History() {
  const calls = useData(api.callHistory, [] as CallRow[]);
  const confs = useData(api.conferenceHistory, [] as ConferenceRow[]);
  const items = [
    ...confs.data.map(c => ({
      key: `c${c.id}`, at: new Date(c.startedAt).getTime(),
      title: c.participants.filter(p => !p.isSelf).map(p => p.name).join(", ") || `Call to ${fmtPin(c.dialedNumber)}`,
      sub: `${c.participants[0]?.isSelf ? "Outgoing" : "Incoming"} · ${Math.round(c.durationSec / 60)}m · ${fmtWhen(c.startedAt)}`,
      tone: c.participants[0]?.isSelf ? colors.tabCalls : colors.tabHistory,
    })),
    // Parity with the web's isSoloRow: answered/ended calls are represented by
    // conferenceHistory above — the solo list is ONLY the never-connected rows.
    ...calls.data.filter(c => c.status !== "answered" && c.status !== "ended").map(c => ({
      key: `s${c.id}`, at: new Date(c.startedAt).getTime(),
      title: c.other?.displayName ?? fmtPin(c.other?.number ?? null) ?? "Unknown",
      sub: `${c.direction === "in" ? (c.status === "declined" ? "Declined" : "Missed") : "No answer"} · ${fmtWhen(c.startedAt)}`,
      tone: c.direction === "in" ? colors.danger : colors.tabCalls,
    })),
  ].sort((a, b) => b.at - a.at);

  return (
    <FlatList
      style={s.list}
      data={items}
      keyExtractor={i => i.key}
      refreshControl={<RefreshControl refreshing={calls.refreshing} onRefresh={() => { calls.refresh(); confs.refresh(); }} tintColor={colors.accent} />}
      ListEmptyComponent={<Text style={s.empty}>No calls yet.</Text>}
      renderItem={({ item }) => (
        <View style={s.row}>
          <View style={[s.dot, { backgroundColor: item.tone }]} />
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { color: item.tone }]} numberOfLines={1}>{item.title}</Text>
            <Text style={s.sub} numberOfLines={1}>{item.sub}</Text>
          </View>
        </View>
      )}
    />
  );
}

const s = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: spacing(4), paddingVertical: spacing(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  dot: { width: 10, height: 10, borderRadius: 5 },
  avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.text, fontWeight: "700" },
  led: { position: "absolute", right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.bg },
  title: { color: colors.text, fontSize: 15, fontWeight: "600" },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.tabMessages, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeText: { color: colors.bg, fontSize: 12, fontWeight: "800" },
  empty: { color: colors.textMuted, textAlign: "center", marginTop: spacing(20) },
});
