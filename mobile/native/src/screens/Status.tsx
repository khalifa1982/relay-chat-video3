import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { launchImageLibrary } from "react-native-image-picker";
import { api, absUrl, uploadStatusMedia, type StatusGroup, type StatusItem } from "../lib/api";
import { colors, spacing } from "../lib/theme";

/**
 * Rich user status (v2.95) for the native app — mirrors client/src/pages/app/
 * Status.tsx: a story STRIP (my ring + contacts'), a COMPOSER (text with a
 * colored background, or a picked photo + caption), and a full-screen VIEWER
 * (progress bars, auto-advance, tap-nav, delete). RN has no <video>, so a
 * video/audio status shows its caption + a "watch on the web" note; image + text
 * render fully. Backgrounds are solid colors (RN has no CSS gradients).
 */
const BG_OPTIONS = ["#0EA5E9", "#06D6A0", "#8B5CF6", "#F59E0B", "#111827", "#EC4899"];
const ITEM_MS = 5000;
const initials = (n: string) => (n || "?").trim().slice(0, 2).toUpperCase();

export function StatusStrip() {
  const [groups, setGroups] = useState<StatusGroup[]>([]);
  const [composer, setComposer] = useState(false);
  const [viewerAt, setViewerAt] = useState<number | null>(null);

  const load = useCallback(() => {
    api.status.feed().then(r => setGroups(r.groups)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const mine = groups.find(g => g.owner.isMe) ?? null;
  const others = groups.filter(g => !g.owner.isMe);

  return (
    <View style={s.strip}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing(3), paddingHorizontal: spacing(4) }}>
        <TouchableOpacity style={s.tile} onPress={() => (mine ? setViewerAt(groups.indexOf(mine)) : setComposer(true))}>
          <View style={[s.ring, { borderColor: colors.border }]}>
            <Avatar name="You" url={mine?.owner.avatarUrl ?? null} />
            <View style={s.plus}><Text style={s.plusText}>＋</Text></View>
          </View>
          <Text style={s.tileLabel} numberOfLines={1}>My status</Text>
        </TouchableOpacity>
        {others.map(g => (
          <TouchableOpacity key={g.owner.id} style={s.tile} onPress={() => setViewerAt(groups.indexOf(g))}>
            <View style={[s.ring, { borderColor: g.hasUnseen ? colors.accent : colors.border }]}>
              <Avatar name={g.owner.displayName} url={g.owner.avatarUrl} />
            </View>
            <Text style={s.tileLabel} numberOfLines={1}>{g.owner.displayName.split(/\s+/)[0]}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {composer ? (
        <StatusComposer onClose={() => setComposer(false)} onPosted={() => { setComposer(false); load(); }} />
      ) : null}
      {viewerAt !== null && groups[viewerAt] ? (
        <StatusViewer groups={groups} startIndex={viewerAt} onClose={() => { setViewerAt(null); load(); }} />
      ) : null}
    </View>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) return <Image source={{ uri: absUrl(url) }} style={s.avatarImg} />;
  return <View style={s.avatar}><Text style={s.avatarText}>{initials(name)}</Text></View>;
}

function StatusComposer({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }) {
  const [mode, setMode] = useState<"text" | "image">("text");
  const [text, setText] = useState("");
  const [caption, setCaption] = useState("");
  const [bg, setBg] = useState(0);
  const [img, setImg] = useState<{ base64: string; type: string; uri: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const r = await launchImageLibrary({ mediaType: "photo", includeBase64: true, maxWidth: 1600, maxHeight: 1600, quality: 0.8 });
    const a = r.assets?.[0];
    if (!a?.base64 || !a.type || !a.uri) return;
    setImg({ base64: a.base64, type: a.type, uri: a.uri });
    setMode("image");
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (mode === "text") {
        if (!text.trim()) { setBusy(false); return; }
        await api.status.post({ kind: "text", text: text.trim(), bgColor: BG_OPTIONS[bg] });
      } else {
        if (!img) { setBusy(false); return; }
        const up = await uploadStatusMedia({ dataBase64: img.base64, mimeType: img.type });
        await api.status.post({ kind: "image", mediaKey: up.storageKey, mimeType: img.type, text: caption.trim() || undefined });
      }
      onPosted();
    } catch (e) {
      Alert.alert("Not posted", e instanceof Error ? e.message : "Couldn't post your status.");
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.modalBack}>
        <View style={s.composer}>
          <View style={s.composerHead}>
            <Text style={s.composerTitle}>New status</Text>
            <TouchableOpacity onPress={onClose}><Text style={s.close}>✕</Text></TouchableOpacity>
          </View>
          <View style={s.segRow}>
            <TouchableOpacity style={[s.seg, mode === "text" && s.segOn]} onPress={() => setMode("text")}>
              <Text style={[s.segText, mode === "text" && s.segTextOn]}>Text</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.seg, mode === "image" && s.segOn]} onPress={pick}>
              <Text style={[s.segText, mode === "image" && s.segTextOn]}>Photo</Text>
            </TouchableOpacity>
          </View>

          {mode === "text" ? (
            <View style={[s.textCanvas, { backgroundColor: BG_OPTIONS[bg] }]}>
              <TextInput
                style={s.textInput}
                value={text}
                onChangeText={t => setText(t.slice(0, 700))}
                placeholder="Type a status…"
                placeholderTextColor="#FFFFFFAA"
                multiline
                autoFocus
              />
              <TouchableOpacity style={s.colorBtn} onPress={() => setBg(i => (i + 1) % BG_OPTIONS.length)}>
                <Text style={s.colorBtnText}>Color</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              {img ? <Image source={{ uri: img.uri }} style={s.preview} resizeMode="contain" /> : (
                <TouchableOpacity style={s.pickBox} onPress={pick}><Text style={s.pickText}>Tap to choose a photo</Text></TouchableOpacity>
              )}
              {img ? (
                <TextInput
                  style={s.captionInput}
                  value={caption}
                  onChangeText={t => setCaption(t.slice(0, 700))}
                  placeholder="Add a caption…"
                  placeholderTextColor={colors.textMuted}
                />
              ) : null}
            </View>
          )}

          <TouchableOpacity
            style={[s.share, ((mode === "text" ? !text.trim() : !img) || busy) && { opacity: 0.5 }]}
            onPress={submit}
            disabled={(mode === "text" ? !text.trim() : !img) || busy}
          >
            {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={s.shareText}>Share status</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function StatusViewer({ groups, startIndex, onClose }: { groups: StatusGroup[]; startIndex: number; onClose: () => void }) {
  const [gi, setGi] = useState(startIndex);
  const [ii, setIi] = useState(0);
  const [progress, setProgress] = useState(0);
  const startRef = useRef(0);

  const group = groups[gi];
  const item: StatusItem | undefined = group?.items[ii];
  const isMine = !!group?.owner.isMe;

  const next = useCallback(() => {
    if (!group) return onClose();
    if (ii + 1 < group.items.length) { setIi(ii + 1); return; }
    if (gi + 1 < groups.length) { setGi(gi + 1); setIi(0); return; }
    onClose();
  }, [group, ii, gi, groups, onClose]);
  const prev = () => {
    if (ii > 0) setIi(ii - 1);
    else if (gi > 0) { const p = gi - 1; setGi(p); setIi(Math.max(0, groups[p].items.length - 1)); }
  };

  // Mark viewed once per item.
  useEffect(() => {
    if (item && !isMine) api.status.markViewed(item.id).catch(() => {});
  }, [item, isMine]);

  // Progress timer.
  useEffect(() => {
    startRef.current = Date.now();
    setProgress(0);
    const iv = setInterval(() => {
      const p = Math.min(1, (Date.now() - startRef.current) / ITEM_MS);
      setProgress(p);
      if (p >= 1) { clearInterval(iv); next(); }
    }, 50);
    return () => clearInterval(iv);
  }, [gi, ii, next]);

  if (!group || !item) return null;

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={s.viewer}>
        <View style={s.bars}>
          {group.items.map((it, idx) => (
            <View key={it.id} style={s.barTrack}>
              <View style={[s.barFill, { width: `${idx < ii ? 100 : idx === ii ? progress * 100 : 0}%` }]} />
            </View>
          ))}
        </View>
        <View style={s.viewerHead}>
          <Avatar name={group.owner.displayName} url={group.owner.avatarUrl} />
          <Text style={s.viewerName}>{isMine ? "My status" : group.owner.displayName}</Text>
          <TouchableOpacity onPress={onClose}><Text style={s.viewerClose}>✕</Text></TouchableOpacity>
        </View>

        <View style={s.viewerBody}>
          {item.kind === "text" ? (
            <View style={[s.textFull, { backgroundColor: item.bgColor ?? "#111827" }]}>
              <Text style={s.textFullText}>{item.text}</Text>
            </View>
          ) : item.kind === "image" ? (
            <Image source={{ uri: absUrl(item.mediaUrl ?? "") }} style={s.mediaFull} resizeMode="contain" />
          ) : (
            <View style={s.mediaNote}>
              <Text style={s.mediaNoteEmoji}>{item.kind === "audio" ? "🎵" : "🎬"}</Text>
              <Text style={s.mediaNoteText}>{item.kind === "video" ? "Video" : "Audio"} status — open RELAY on the web to play it.</Text>
            </View>
          )}
          <TouchableOpacity style={s.tapLeft} activeOpacity={1} onPress={prev} />
          <TouchableOpacity style={s.tapRight} activeOpacity={1} onPress={next} />
        </View>

        {item.text && item.kind !== "text" ? <Text style={s.caption}>{item.text}</Text> : null}

        {isMine ? (
          <TouchableOpacity
            style={s.delete}
            onPress={() =>
              Alert.alert("Delete status?", undefined, [
                { text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: () => { api.status.remove(item.id).catch(() => {}); next(); } },
              ])
            }
          >
            <Text style={s.deleteText}>Delete</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  strip: { paddingVertical: spacing(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tile: { width: 68, alignItems: "center" },
  ring: { width: 64, height: 64, borderRadius: 32, borderWidth: 2.5, alignItems: "center", justifyContent: "center", padding: 2 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  avatarImg: { width: 56, height: 56, borderRadius: 28 },
  avatarText: { color: colors.accent, fontWeight: "800", fontSize: 15 },
  plus: { position: "absolute", right: 0, bottom: 0, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.online, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.bg },
  plusText: { color: colors.bg, fontSize: 12, fontWeight: "900", lineHeight: 14 },
  tileLabel: { color: colors.textMuted, fontSize: 11, marginTop: 4, maxWidth: 64, textAlign: "center" },
  // composer
  modalBack: { flex: 1, backgroundColor: "#000000BB", justifyContent: "center", padding: spacing(4) },
  composer: { backgroundColor: colors.surface, borderRadius: 22, padding: spacing(4), borderWidth: 1, borderColor: colors.border },
  composerHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing(3) },
  composerTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  close: { color: colors.textMuted, fontSize: 18 },
  segRow: { flexDirection: "row", gap: 8, marginBottom: spacing(3) },
  seg: { flex: 1, borderRadius: 12, alignItems: "center", paddingVertical: 10, backgroundColor: colors.surfaceRaised },
  segOn: { backgroundColor: colors.accent },
  segText: { color: colors.textMuted, fontWeight: "700" },
  segTextOn: { color: colors.bg },
  textCanvas: { minHeight: 200, borderRadius: 18, padding: spacing(4), justifyContent: "center" },
  textInput: { color: "#FFFFFF", fontSize: 22, fontWeight: "700", textAlign: "center" },
  colorBtn: { position: "absolute", right: 12, bottom: 12, backgroundColor: "#00000055", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  colorBtnText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  pickBox: { minHeight: 200, borderRadius: 18, borderWidth: 2, borderColor: colors.border, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  pickText: { color: colors.textMuted },
  preview: { width: "100%", height: 260, borderRadius: 18, backgroundColor: "#000" },
  captionInput: { marginTop: spacing(2), backgroundColor: colors.surfaceRaised, borderRadius: 12, color: colors.text, paddingHorizontal: spacing(3), paddingVertical: spacing(2.5) },
  share: { marginTop: spacing(4), backgroundColor: colors.online, borderRadius: 14, alignItems: "center", paddingVertical: spacing(3.5) },
  shareText: { color: colors.bg, fontWeight: "800", fontSize: 15 },
  // viewer
  viewer: { flex: 1, backgroundColor: "#000" },
  bars: { flexDirection: "row", gap: 4, paddingHorizontal: 10, paddingTop: 12 },
  barTrack: { flex: 1, height: 2.5, borderRadius: 2, backgroundColor: "#FFFFFF44", overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: "#FFFFFF" },
  viewerHead: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  viewerName: { flex: 1, color: "#FFFFFF", fontWeight: "700" },
  viewerClose: { color: "#FFFFFF", fontSize: 22 },
  viewerBody: { flex: 1, position: "relative" },
  textFull: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing(6) },
  textFullText: { color: "#FFFFFF", fontSize: 26, fontWeight: "700", textAlign: "center" },
  mediaFull: { flex: 1, width: "100%" },
  mediaNote: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: spacing(6) },
  mediaNoteEmoji: { fontSize: 56 },
  mediaNoteText: { color: "#FFFFFFCC", textAlign: "center", fontSize: 15 },
  tapLeft: { position: "absolute", left: 0, top: 0, bottom: 0, width: "33%" },
  tapRight: { position: "absolute", right: 0, top: 0, bottom: 0, width: "33%" },
  caption: { color: "#FFFFFF", textAlign: "center", padding: spacing(3), fontSize: 15 },
  delete: { alignSelf: "center", marginBottom: spacing(4), paddingVertical: 8, paddingHorizontal: 20 },
  deleteText: { color: colors.danger, fontWeight: "700" },
});
