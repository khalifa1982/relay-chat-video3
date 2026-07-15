import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, AppState, FlatList, Image, KeyboardAvoidingView, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { launchImageLibrary } from "react-native-image-picker";
import { api, uploadAttachment, type ConversationInfo, type MessageRow } from "../lib/api";
import { onEvent } from "../lib/events";
import { useMe } from "../lib/session";
import { colors, spacing } from "../lib/theme";

/**
 * M2 conversation screen — parity with the web thread view: bubbles with
 * read ticks (message.status), reply/quote, long-press Unsend for own
 * messages, image attachments (same /api/v2/upload flow), typing indicator,
 * live updates via the v2 SSE bus with a polling safety net, markRead on
 * focus + on incoming. Voice notes ship with the A/V milestone (M3).
 */
export function Conversation({ route }: { route: { params: { conversationId: number; title: string } } }) {
  const { conversationId, title } = route.params;
  const me = useMe();
  const [rows, setRows] = useState<MessageRow[]>([]);
  const [info, setInfo] = useState<ConversationInfo | null>(null);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const [sending, setSending] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const typingClearT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentAt = useRef(0);
  const listRef = useRef<FlatList<MessageRow>>(null);

  const refresh = useCallback(() => {
    api.messages(conversationId, { limit: 100 })
      .then(r => setRows(r))
      .catch(() => {});
  }, [conversationId]);

  useEffect(() => {
    refresh();
    api.conversationInfo(conversationId).then(setInfo).catch(() => {});
    api.markRead(conversationId).catch(() => {});
    // Realtime: refetch on message/read for THIS thread; show typing pings.
    const off = onEvent(ev => {
      if (ev.kind === "message" && ev.conversationId === conversationId) {
        refresh();
        // HONEST receipts: never ✓✓ a message the user hasn't seen — only
        // mark read while the app is actually in the foreground.
        if (AppState.currentState === "active") api.markRead(conversationId).catch(() => {});
      } else if (ev.kind === "read" && ev.conversationId === conversationId) {
        refresh(); // my ticks flip to ✓✓
      } else if (ev.kind === "typing" && ev.conversationId === conversationId) {
        setPeerTyping(true);
        if (typingClearT.current) clearTimeout(typingClearT.current);
        typingClearT.current = setTimeout(() => setPeerTyping(false), 3500);
      }
    });
    // Returning to the foreground with this thread open = the user sees it now.
    const appStateSub = AppState.addEventListener("change", st => {
      if (st === "active") {
        refresh();
        api.markRead(conversationId).catch(() => {});
      }
    });
    // Polling safety net (the web keeps one too).
    const poll = setInterval(refresh, 6000);
    return () => {
      off();
      appStateSub.remove();
      clearInterval(poll);
      if (typingClearT.current) clearTimeout(typingClearT.current);
    };
  }, [conversationId, refresh]);

  const memberName = useMemo(() => {
    const m = new Map(info?.members.map(x => [x.id, x.displayName]) ?? []);
    return (id: number) => m.get(id) ?? "…";
  }, [info]);
  const isGroup = (info?.members.length ?? 2) > 2;

  const sendText = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    const reply = replyTo;
    setReplyTo(null);
    try {
      await api.send({ conversationId, kind: "text", body, replyToId: reply?.id ?? null });
      refresh();
    } catch (e) {
      Alert.alert("Not sent", e instanceof Error ? e.message : "Couldn't send the message.");
      setDraft(body);
    } finally {
      setSending(false);
    }
  };

  const sendImage = async () => {
    if (sending) return;
    const r = await launchImageLibrary({ mediaType: "photo", includeBase64: true, maxWidth: 1600, maxHeight: 1600, quality: 0.8 });
    const a = r.assets?.[0];
    if (!a?.base64 || !a.type) return;
    setSending(true);
    try {
      const att = await uploadAttachment({
        dataBase64: a.base64,
        mimeType: a.type,
        filename: a.fileName ?? undefined,
        width: a.width,
        height: a.height,
      });
      await api.send({ conversationId, kind: "image", attachmentId: att.id, replyToId: replyTo?.id ?? null });
      setReplyTo(null);
      refresh();
    } catch (e) {
      Alert.alert("Not sent", e instanceof Error ? e.message : "Couldn't upload the photo.");
    } finally {
      setSending(false);
    }
  };

  const onChangeDraft = (t: string) => {
    setDraft(t);
    // Throttled typing ping — same UX contract as the web (server fans out).
    const now = Date.now();
    if (t && now - lastTypingSentAt.current > 2500) {
      lastTypingSentAt.current = now;
      api.typing(conversationId).catch(() => {});
    }
  };

  const onLongPress = (m: MessageRow) => {
    const mine = m.senderIdentityId === me.id;
    Alert.alert(m.body ? m.body.slice(0, 60) : "Message", undefined, [
      { text: "Reply", onPress: () => setReplyTo(m) },
      ...(mine
        ? [{
            text: "Unsend",
            style: "destructive" as const,
            onPress: () => api.unsend(m.id).then(refresh).catch(() => Alert.alert("Couldn't unsend")),
          }]
        : []),
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  const byId = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows]);
  const data = useMemo(() => [...rows].sort((a, b) => b.id - a.id), [rows]); // inverted list

  const renderRow = ({ item: m }: { item: MessageRow }) => {
    const mine = m.senderIdentityId === me.id;
    const quoted = m.replyToId ? byId.get(m.replyToId) : null;
    return (
      <TouchableOpacity activeOpacity={0.8} onLongPress={() => onLongPress(m)}
        style={[s.bubbleRow, mine ? s.rowMine : s.rowTheirs]}>
        <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleTheirs]}>
          {isGroup && !mine ? <Text style={s.sender}>{memberName(m.senderIdentityId)}</Text> : null}
          {quoted ? (
            <View style={s.quote}>
              <Text style={s.quoteName}>{memberName(quoted.senderIdentityId)}</Text>
              <Text style={s.quoteBody} numberOfLines={2}>{quoted.body ?? "📎 attachment"}</Text>
            </View>
          ) : null}
          {m.attachment && m.kind === "image" ? (
            <Image source={{ uri: m.attachment.url }} style={s.image} resizeMode="cover" />
          ) : null}
          {m.attachment && m.kind !== "image" ? (
            <Text style={s.file}>📎 {m.attachment.filename ?? m.kind}</Text>
          ) : null}
          {m.body ? <Text style={s.body}>{m.body}</Text> : null}
          <Text style={s.meta}>
            {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {mine ? (m.status === "read" ? "  ✓✓" : "  ✓") : ""}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <FlatList
        ref={listRef}
        inverted
        data={data}
        keyExtractor={m => String(m.id)}
        renderItem={renderRow}
        contentContainerStyle={{ paddingVertical: spacing(3) }}
        ListEmptyComponent={<Text style={s.empty}>Say hello to {title} 👋</Text>}
      />
      {peerTyping ? <Text style={s.typing}>typing…</Text> : null}
      {replyTo ? (
        <View style={s.replyBar}>
          <Text style={s.replyText} numberOfLines={1}>↩ {replyTo.body ?? "attachment"}</Text>
          <TouchableOpacity onPress={() => setReplyTo(null)}><Text style={s.replyClose}>✕</Text></TouchableOpacity>
        </View>
      ) : null}
      <View style={s.composer}>
        <TouchableOpacity style={s.attach} onPress={sendImage} disabled={sending}>
          <Text style={{ fontSize: 20 }}>🖼️</Text>
        </TouchableOpacity>
        <TextInput
          style={s.input}
          placeholder="Message"
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={onChangeDraft}
          multiline
          maxLength={8000}
        />
        <TouchableOpacity style={[s.sendBtn, (!draft.trim() || sending) && { opacity: 0.4 }]}
          onPress={sendText} disabled={!draft.trim() || sending}>
          {sending ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={s.sendText}>➤</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  bubbleRow: { paddingHorizontal: spacing(3), marginVertical: 3, flexDirection: "row" },
  rowMine: { justifyContent: "flex-end" },
  rowTheirs: { justifyContent: "flex-start" },
  bubble: { maxWidth: "80%", borderRadius: 16, paddingHorizontal: spacing(3), paddingVertical: spacing(2) },
  bubbleMine: { backgroundColor: "#144e43", borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.surfaceRaised, borderBottomLeftRadius: 4 },
  sender: { color: colors.tabMessages, fontSize: 12, fontWeight: "700", marginBottom: 2 },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.accent, backgroundColor: "#00000030", borderRadius: 6, padding: 6, marginBottom: 4 },
  quoteName: { color: colors.accent, fontSize: 11, fontWeight: "700" },
  quoteBody: { color: colors.textMuted, fontSize: 12 },
  image: { width: 220, height: 220, borderRadius: 10, marginBottom: 4, backgroundColor: colors.surface },
  file: { color: colors.text, marginBottom: 2 },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  meta: { color: colors.textMuted, fontSize: 10, alignSelf: "flex-end", marginTop: 2 },
  typing: { color: colors.textMuted, fontStyle: "italic", paddingHorizontal: spacing(4), paddingBottom: 4 },
  replyBar: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, paddingHorizontal: spacing(3), paddingVertical: spacing(2), borderTopWidth: 1, borderTopColor: colors.border },
  replyText: { color: colors.textMuted, flex: 1, fontSize: 13 },
  replyClose: { color: colors.textMuted, padding: 6 },
  composer: { flexDirection: "row", alignItems: "flex-end", padding: spacing(2), gap: 8, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  attach: { padding: 8 },
  input: { flex: 1, minHeight: 40, maxHeight: 120, backgroundColor: colors.surfaceRaised, borderRadius: 20, color: colors.text, paddingHorizontal: spacing(3), paddingTop: 10, paddingBottom: 10 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  sendText: { color: colors.bg, fontSize: 16, fontWeight: "800" },
  empty: { color: colors.textMuted, textAlign: "center", transform: [{ scaleY: -1 }], marginTop: spacing(10) },
});
