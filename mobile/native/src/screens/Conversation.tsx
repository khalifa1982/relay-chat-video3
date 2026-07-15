import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, AppState, FlatList, Image, KeyboardAvoidingView, PermissionsAndroid,
  Platform, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { launchImageLibrary } from "react-native-image-picker";
import AudioRecorderPlayer from "react-native-audio-recorder-player";
// The classic react-native-fs has no AGP-8 namespace and breaks the CI build;
// this fork is the maintained drop-in.
import { readFile as fsReadFile } from "@dr.pogodin/react-native-fs";
import { absUrl, api, uploadAttachment, type ConversationInfo, type MessageRow } from "../lib/api";
import { onEvent } from "../lib/events";
import { useMe } from "../lib/session";
import { colors, spacing } from "../lib/theme";

const recorder = new AudioRecorderPlayer();

/**
 * M2 conversation screen — parity with the web thread view: bubbles with
 * read ticks (message.status), reply/quote, long-press Unsend for own
 * messages, image attachments (same /api/v2/upload flow), typing indicator,
 * live updates via the v2 SSE bus with a polling safety net, markRead on
 * focus + on incoming. M3.5 adds GROUPS (routed kind — a 2-member group is
 * still a group) and VOICE NOTES (AAC m4a — plays in every web <audio>,
 * unlike the web's own webm/opus which iOS can't decode).
 */
export function Conversation({ route }: { route: { params: { conversationId: number; title: string; kind?: string } } }) {
  const { conversationId, title, kind } = route.params;
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
  // Truth is the routed thread kind — a 2-member group is legal (createGroup
  // min is ONE other member) and the old >2 heuristic rendered it as a DM.
  const isGroup = kind === "group" || (kind == null && (info?.members.length ?? 2) > 2);

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

  // ── voice notes (M3.5): tap 🎤 to record, tap ■ to send. AAC in .m4a. ──
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const recStartedAt = useRef(0);

  const startVoiceNote = async () => {
    if (sending || recording) return;
    if (Platform.OS === "android") {
      const ok = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (ok !== PermissionsAndroid.RESULTS.GRANTED) return;
      // API <29: the recorder writes via legacy external storage — without
      // this grant every start rejects (Android 7–9 devices, minSdk 24).
      if (Number(Platform.Version) < 29) {
        const w = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
        if (w !== PermissionsAndroid.RESULTS.GRANTED) return;
      }
    }
    try {
      await recorder.startRecorder();
      recStartedAt.current = Date.now();
      setRecSecs(0);
      setRecording(true);
      recorder.addRecordBackListener(e => {
        setRecSecs(Math.floor((e.currentPosition ?? 0) / 1000));
      });
    } catch {
      Alert.alert("Couldn't start recording");
    }
  };

  const stopVoiceNote = async (send: boolean) => {
    if (!recording) return;
    setRecording(false);
    recorder.removeRecordBackListener();
    let path = "";
    try { path = await recorder.stopRecorder(); } catch { return; }
    if (!send) return;
    const durationMs = Date.now() - recStartedAt.current;
    if (durationMs < 700) return; // accidental tap — nothing worth sending
    setSending(true);
    try {
      const dataBase64 = (await fsReadFile(path.replace("file://", ""), "base64")) as string;
      const att = await uploadAttachment({
        dataBase64,
        // Android records AAC-in-MP4 — the one codec every web <audio> plays
        // (the web's own webm/opus is undecodable on iOS Safari).
        mimeType: "audio/mp4",
        filename: "voice-note.m4a",
        durationMs,
      });
      await api.send({ conversationId, kind: "audio", attachmentId: att.id, replyToId: replyTo?.id ?? null });
      setReplyTo(null);
      refresh();
    } catch (e) {
      Alert.alert("Not sent", e instanceof Error ? e.message : "Couldn't upload the voice note.");
    } finally {
      setSending(false);
    }
  };

  // One shared player — tapping another bubble stops the current one.
  const [playingId, setPlayingId] = useState<number | null>(null);
  const togglePlay = async (m: MessageRow) => {
    try {
      if (playingId === m.id) {
        await recorder.stopPlayer();
        setPlayingId(null);
        return;
      }
      if (playingId != null) await recorder.stopPlayer().catch(() => {});
      if (!m.attachment) return;
      setPlayingId(m.id);
      await recorder.startPlayer(absUrl(m.attachment.url));
      recorder.addPlayBackListener(e => {
        if (e.currentPosition >= e.duration) {
          recorder.removePlayBackListener();
          void recorder.stopPlayer().catch(() => {});
          setPlayingId(null);
        }
      });
    } catch {
      setPlayingId(null);
    }
  };

  useEffect(() => () => {
    // Leaving the thread: stop any live capture/playback.
    recorder.removeRecordBackListener();
    recorder.removePlayBackListener();
    void recorder.stopRecorder().catch(() => {});
    void recorder.stopPlayer().catch(() => {});
  }, []);

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
            <Image source={{ uri: absUrl(m.attachment.url) }} style={s.image} resizeMode="cover" />
          ) : null}
          {m.attachment && (m.kind === "audio" || m.attachment.mimeType?.startsWith("audio/")) ? (
            <TouchableOpacity style={s.audioRow} onPress={() => togglePlay(m)}>
              <Text style={s.audioBtn}>{playingId === m.id ? "■" : "▶"}</Text>
              <Text style={s.audioLabel}>Voice message</Text>
            </TouchableOpacity>
          ) : m.attachment && m.kind !== "image" ? (
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
      {recording ? (
        <View style={s.recBar}>
          <Text style={s.recDot}>●</Text>
          <Text style={s.recText}>Recording… {recSecs}s</Text>
          <TouchableOpacity onPress={() => stopVoiceNote(false)}>
            <Text style={s.recCancel}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <View style={s.composer}>
        <TouchableOpacity style={s.attach} onPress={sendImage} disabled={sending || recording}>
          <Text style={{ fontSize: 20 }}>🖼️</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.attach}
          onPress={() => (recording ? stopVoiceNote(true) : startVoiceNote())}
          disabled={sending}
        >
          <Text style={{ fontSize: 20 }}>{recording ? "🟥" : "🎤"}</Text>
        </TouchableOpacity>
        <TextInput
          style={s.input}
          placeholder={recording ? "Tap 🟥 to send the voice note" : "Message"}
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={onChangeDraft}
          multiline
          maxLength={8000}
          editable={!recording}
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
  audioRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, minWidth: 160 },
  audioBtn: { color: colors.text, fontSize: 18, width: 30, height: 30, borderRadius: 15, backgroundColor: "#00000040", textAlign: "center", lineHeight: 28, overflow: "hidden" },
  audioLabel: { color: colors.text, fontSize: 14 },
  recBar: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, paddingHorizontal: spacing(3), paddingVertical: spacing(2), borderTopWidth: 1, borderTopColor: colors.border },
  recDot: { color: colors.danger, fontSize: 14 },
  recText: { color: colors.text, flex: 1, fontSize: 13 },
  recCancel: { color: colors.textMuted, padding: 6 },
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
