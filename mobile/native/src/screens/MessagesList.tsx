import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList, Modal, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { api, type ThreadRow } from "../lib/api";
import { onEvent } from "../lib/events";
import { isMuted, toggleMute } from "../lib/mute";
import { colors, spacing } from "../lib/theme";
import { StatusStrip } from "./Status";

const fmtPin = (n: string | null) => (n && n.length === 6 ? `${n.slice(0, 3)}-${n.slice(3)}` : n ?? "");
const threadTitle = (t: ThreadRow) =>
  t.title || t.peerDisplayName || fmtPin(t.peerNumber) || "Conversation";

/** Threads list — live via the v2 bus + pull-to-refresh; long-press mutes. */
export function MessagesList({ navigation }: { navigation: { navigate: (s: string, p?: object) => void } }) {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [muted, setMuted] = useState<Set<number>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeNum, setComposeNum] = useState("");
  const [composeErr, setComposeErr] = useState<string | null>(null);
  // Group compose (M3.5): title + up to 19 member numbers.
  const [composeGroup, setComposeGroup] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupNums, setGroupNums] = useState<string[]>([]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    api.threads()
      .then(async ts => {
        setThreads(ts);
        const flags = await Promise.all(ts.map(t => isMuted(t.conversationId)));
        setMuted(new Set(ts.filter((_, i) => flags[i]).map(t => t.conversationId)));
      })
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    refresh();
    const off = onEvent(ev => {
      if (ev.kind === "message" || ev.kind === "read") refresh();
    });
    // markRead notifies only PEERS — refresh on focus so MY unread badges
    // clear when popping back from a conversation.
    const nav = navigation as unknown as { addListener?: (e: string, cb: () => void) => () => void };
    const focusOff = nav.addListener?.("focus", refresh);
    return () => { off(); focusOff?.(); };
  }, [refresh]);

  // Search conversations by title / peer name / number (local filter).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return threads;
    const qDigits = q.replace(/\D/g, "");
    return threads.filter(
      t =>
        threadTitle(t).toLowerCase().includes(q) ||
        (qDigits.length > 0 && (t.peerNumber || "").includes(qDigits)),
    );
  }, [threads, search]);

  const open = (t: ThreadRow) =>
    navigation.navigate("Conversation", { conversationId: t.conversationId, title: threadTitle(t), kind: t.kind });

  const resetCompose = () => {
    setComposeOpen(false);
    setComposeNum("");
    setComposeErr(null);
    setComposeGroup(false);
    setGroupTitle("");
    setGroupNums([]);
  };

  const startCompose = async () => {
    if (!/^\d{6}$/.test(composeNum)) { setComposeErr("Enter a 6-digit number"); return; }
    try {
      const r = await api.openThread(composeNum);
      resetCompose();
      navigation.navigate("Conversation", { conversationId: r.conversationId, title: r.otherDisplayName, kind: "dm" });
    } catch {
      setComposeErr("That number isn't a RELAY user yet");
    }
  };

  const addGroupNum = () => {
    if (!/^\d{6}$/.test(composeNum)) { setComposeErr("Enter a 6-digit number"); return; }
    setGroupNums(g => (g.includes(composeNum) || g.length >= 19 ? g : [...g, composeNum]));
    setComposeNum("");
    setComposeErr(null);
  };

  const startGroup = async () => {
    if (!groupTitle.trim()) { setComposeErr("Give the group a name"); return; }
    const nums = /^\d{6}$/.test(composeNum) && !groupNums.includes(composeNum)
      ? [...groupNums, composeNum] : groupNums; // a typed-but-unadded number counts
    if (nums.length === 0) { setComposeErr("Add at least one member"); return; }
    try {
      const r = await api.createGroup({ title: groupTitle.trim(), numbers: nums });
      resetCompose();
      refresh();
      navigation.navigate("Conversation", { conversationId: r.conversationId, title: r.title ?? groupTitle.trim(), kind: "group" });
    } catch {
      setComposeErr("None of those numbers are RELAY users yet");
    }
  };

  return (
    <View style={s.root}>
      {threads.length > 0 ? (
        <View style={s.searchWrap}>
          <TextInput
            style={s.searchInput}
            placeholder="Search conversations"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
          />
        </View>
      ) : null}
      <FlatList
        data={filtered}
        keyExtractor={t => String(t.conversationId)}
        ListHeaderComponent={search.trim() ? null : <StatusStrip />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
        ListEmptyComponent={
          <Text style={s.empty}>
            {search.trim() ? `No conversations match "${search.trim()}".` : "No conversations yet — tap ✚ to start one."}
          </Text>
        }
        renderItem={({ item: t }) => (
          <TouchableOpacity
            style={s.row}
            onPress={() => open(t)}
            onLongPress={() => toggleMute(t.conversationId).then(on => {
              setMuted(prev => { const n = new Set(prev); if (on) n.add(t.conversationId); else n.delete(t.conversationId); return n; });
            })}
          >
            <View style={s.avatar}>
              <Text style={s.avatarText}>{threadTitle(t).slice(0, 2).toUpperCase()}</Text>
              {t.kind !== "group" ? (
                <View style={[s.led, { backgroundColor: t.peerIsOnline ? colors.online : colors.textMuted }]} />
              ) : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.title} numberOfLines={1}>
                {threadTitle(t)} {t.peerVerified ? "✔" : ""} {muted.has(t.conversationId) ? "🔕" : ""}
              </Text>
              <Text style={s.sub} numberOfLines={1}>
                {t.lastMessageKind === "image" ? "🖼️ Photo" : t.lastMessageBody ?? "…"}
              </Text>
            </View>
            {t.unreadCount > 0 && !muted.has(t.conversationId) ? (
              <View style={s.badge}><Text style={s.badgeText}>{t.unreadCount}</Text></View>
            ) : null}
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity style={s.fab} onPress={() => setComposeOpen(true)}>
        <Text style={s.fabText}>✚</Text>
      </TouchableOpacity>
      <Modal visible={composeOpen} transparent animationType="fade" onRequestClose={resetCompose}>
        <View style={s.modalBack}>
          <View style={s.modalCard}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity style={[s.segBtn, !composeGroup && s.segOn]} onPress={() => { setComposeGroup(false); setComposeErr(null); }}>
                <Text style={{ color: composeGroup ? colors.textMuted : colors.bg, fontWeight: "700" }}>New chat</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.segBtn, composeGroup && s.segOn]} onPress={() => { setComposeGroup(true); setComposeErr(null); }}>
                <Text style={{ color: composeGroup ? colors.bg : colors.textMuted, fontWeight: "700" }}>New group</Text>
              </TouchableOpacity>
            </View>
            {composeGroup ? (
              <TextInput
                style={s.modalInput}
                placeholder="Group name"
                placeholderTextColor={colors.textMuted}
                maxLength={128}
                value={groupTitle}
                onChangeText={v => { setGroupTitle(v); setComposeErr(null); }}
              />
            ) : null}
            <TextInput
              style={s.modalInput}
              placeholder={composeGroup ? "Add a 6-digit member number" : "6-digit RELAY number"}
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              maxLength={6}
              value={composeNum}
              onChangeText={v => { setComposeNum(v.replace(/\D/g, "")); setComposeErr(null); }}
              onSubmitEditing={composeGroup ? addGroupNum : startCompose}
              autoFocus
            />
            {composeGroup && groupNums.length > 0 ? (
              <Text style={s.groupChips} numberOfLines={2}>
                {groupNums.map(fmtPin).join("  ")}
              </Text>
            ) : null}
            {composeErr ? <Text style={s.modalErr}>{composeErr}</Text> : null}
            <View style={{ flexDirection: "row", gap: 10, marginTop: spacing(3) }}>
              <TouchableOpacity style={[s.modalBtn, { backgroundColor: colors.surfaceRaised }]} onPress={resetCompose}>
                <Text style={{ color: colors.text }}>Cancel</Text>
              </TouchableOpacity>
              {composeGroup ? (
                <TouchableOpacity style={[s.modalBtn, { backgroundColor: colors.surfaceRaised }]} onPress={addGroupNum}>
                  <Text style={{ color: colors.text }}>Add</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[s.modalBtn, { backgroundColor: colors.tabMessages }]}
                onPress={composeGroup ? startGroup : startCompose}
              >
                <Text style={{ color: colors.bg, fontWeight: "700" }}>
                  {composeGroup ? `Create${groupNums.length ? ` (${groupNums.length})` : ""}` : "Start"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  segBtn: { flex: 1, borderRadius: 10, alignItems: "center", paddingVertical: 8, backgroundColor: colors.surfaceRaised },
  segOn: { backgroundColor: colors.tabMessages },
  groupChips: { color: colors.text, fontSize: 13, fontWeight: "700", marginTop: 8, fontVariant: ["tabular-nums"] },
  root: { flex: 1, backgroundColor: colors.bg },
  searchWrap: { paddingHorizontal: spacing(4), paddingVertical: spacing(2.5), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  searchInput: { backgroundColor: colors.surfaceRaised, borderRadius: 12, color: colors.text, fontSize: 15, paddingHorizontal: spacing(3.5), paddingVertical: spacing(2.5) },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: spacing(4), paddingVertical: spacing(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  avatar: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: colors.tabMessages, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.text, fontWeight: "700" },
  led: { position: "absolute", right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.bg },
  title: { color: colors.text, fontSize: 15, fontWeight: "600" },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.tabMessages, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeText: { color: colors.bg, fontSize: 12, fontWeight: "800" },
  empty: { color: colors.textMuted, textAlign: "center", marginTop: spacing(20) },
  fab: { position: "absolute", right: spacing(5), bottom: spacing(5), width: 56, height: 56, borderRadius: 28, backgroundColor: colors.tabMessages, alignItems: "center", justifyContent: "center", elevation: 6 },
  fabText: { color: colors.bg, fontSize: 22, fontWeight: "800" },
  modalBack: { flex: 1, backgroundColor: "#000000AA", alignItems: "center", justifyContent: "center", padding: spacing(6) },
  modalCard: { alignSelf: "stretch", backgroundColor: colors.surface, borderRadius: 18, padding: spacing(5) },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: spacing(3) },
  modalInput: { backgroundColor: colors.surfaceRaised, borderRadius: 12, color: colors.text, fontSize: 18, paddingHorizontal: spacing(3), paddingVertical: spacing(2.5), letterSpacing: 2 },
  modalErr: { color: colors.danger, marginTop: spacing(2), fontSize: 13 },
  modalBtn: { flex: 1, borderRadius: 12, alignItems: "center", paddingVertical: spacing(3) },
});
