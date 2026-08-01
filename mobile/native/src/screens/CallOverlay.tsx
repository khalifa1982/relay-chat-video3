import React, { useEffect, useState } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { RTCView, type MediaStream } from "@livekit/react-native-webrtc";
import { useCall, type RemoteTile } from "../call/engine";
import { colors, spacing } from "../lib/theme";

const fmtPin = (n: string) => (n.length === 6 ? `${n.slice(0, 3)}-${n.slice(3)}` : n);

function Tile({ t }: { t: RemoteTile }) {
  if (t.stream && t.hasVideo) {
    return <RTCView streamURL={(t.stream as MediaStream).toURL()} style={s.tileVideo} objectFit="cover" />;
  }
  return (
    <View style={[s.tileVideo, s.tileAvatar]}>
      <Text style={s.tileInitials}>{t.name.slice(0, 2).toUpperCase()}</Text>
      <Text style={s.tileName}>{t.name}</Text>
    </View>
  );
}

/** In-call "+" — 6-digit mini pad that auto-invites on the 6th digit and
 *  self-closes (the web's v2.49 add-person flow). */
function AddPersonPad({ onInvite, onClose }: { onInvite: (n: string) => void; onClose: () => void }) {
  const [digits, setDigits] = useState("");
  useEffect(() => {
    if (digits.length === 6) {
      onInvite(digits);
      onClose();
    }
  }, [digits, onInvite, onClose]);
  return (
    <View style={s.padWrap}>
      <Text style={s.padEcho}>{digits.padEnd(6, "•").split("").join(" ")}</Text>
      <View style={s.padGrid}>
        {["1","2","3","4","5","6","7","8","9","⌫","0","✕"].map(k => (
          <TouchableOpacity
            key={k}
            style={s.padKey}
            onPress={() => {
              if (k === "✕") { onClose(); return; }
              if (k === "⌫") { setDigits(d => d.slice(0, -1)); return; }
              setDigits(d => (d.length < 6 ? d + k : d));
            }}
          >
            <Text style={s.padKeyText}>{k}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={s.padHint}>Add someone — invites on the 6th digit</Text>
    </View>
  );
}

/** Full-screen call surface: dial card → ring screen → in-call grid. Rendered
 *  once at the root; visible whenever the engine isn't idle. */
export function CallOverlay() {
  const call = useCall();
  const [addOpen, setAddOpen] = useState(false);
  useEffect(() => { if (call.phase === "idle") setAddOpen(false); }, [call.phase]);
  if (call.phase === "idle") return null;

  const statusLabel =
    call.rejoining && call.status !== "live" ? "Reconnecting to your call…"
    : call.status === "calling" ? "Calling…"
    : call.status === "ringing" ? "Ringing…"
    : call.status === "paging" ? "Reaching their phone…"
    : call.status === "connecting" ? "Connecting…"
    : "Connected";

  return (
    <Modal visible animationType="fade" onRequestClose={call.hangup}>
      <View style={s.root}>
        {call.phase === "incoming" && call.incoming ? (
          <View style={s.center}>
            <View style={s.bigAvatar}><Text style={s.bigInitials}>{call.incoming.fromName.slice(0, 2).toUpperCase()}</Text></View>
            <Text style={s.name}>{call.incoming.fromName}</Text>
            <Text style={s.pin}>{fmtPin(call.incoming.from)}</Text>
            <Text style={s.mode}>{call.incoming.video ? "Video call" : "Voice call"}</Text>
            <View style={s.answerRow}>
              <TouchableOpacity style={[s.round, { backgroundColor: colors.online }]} onPress={() => call.acceptIncoming({ voice: true })}>
                <Text style={s.roundText}>🎙️</Text><Text style={s.roundLabel}>Voice</Text>
              </TouchableOpacity>
              {call.incoming.video ? (
                <TouchableOpacity style={[s.round, { backgroundColor: "#15803D" }]} onPress={() => call.acceptIncoming()}>
                  <Text style={s.roundText}>🎥</Text><Text style={s.roundLabel}>Video</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={[s.round, { backgroundColor: colors.danger }]} onPress={call.declineIncoming}>
                <Text style={s.roundText}>✕</Text><Text style={s.roundLabel}>Decline</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : call.status !== "live" ? (
          <View style={s.center}>
            <View style={s.bigAvatar}><Text style={s.bigInitials}>{(call.peerName || "#").slice(0, 2).toUpperCase()}</Text></View>
            <Text style={s.pin}>{fmtPin(call.peerPin)}</Text>
            {call.peerName ? <Text style={s.name}>{call.peerName}</Text> : null}
            <Text style={s.mode}>{call.isVideoCall ? "Video call" : "Voice call"}</Text>
            <Text style={s.status}>● {statusLabel}</Text>
            <TouchableOpacity style={[s.round, { backgroundColor: colors.danger, marginTop: spacing(10) }]} onPress={call.hangup}>
              <Text style={s.roundText}>⏚</Text><Text style={s.roundLabel}>End</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            {call.isGroup || call.onHold || call.sharingScreen || call.peerScreenPin ? (
              <View style={s.topBar}>
                {call.isGroup ? <Text style={s.topChip}>Group call · {call.tiles.length + 1}</Text> : null}
                {call.sharingScreen ? <Text style={s.topChip}>Sharing your screen</Text> : null}
                {call.peerScreenPin ? <Text style={s.topChip}>Viewing a shared screen</Text> : null}
                {call.onHold ? <Text style={[s.topChip, s.holdChip]}>On hold — they'll be right back</Text> : null}
              </View>
            ) : null}
            <View style={s.grid}>
              {call.tiles.length === 0 ? (
                <View style={[s.tileVideo, s.tileAvatar]}>
                  <Text style={s.tileName}>
                    {call.onHold ? "On hold…" : call.isGroup ? "Waiting for others to join…" : "Connected — waiting for media…"}
                  </Text>
                </View>
              ) : call.tiles.map(t => <Tile key={t.key} t={t} />)}
            </View>
            {call.localStream && call.camOn ? (
              <RTCView streamURL={(call.localStream as MediaStream).toURL()} style={s.self} objectFit="cover" mirror />
            ) : null}
            {call.videoAsk ? (
              <View style={s.ask}>
                <Text style={s.askText}>{call.videoAsk} wants to start video — accepting turns on BOTH cameras.</Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity style={[s.askBtn, { backgroundColor: colors.online }]} onPress={() => call.answerVideoAsk(true)}>
                    <Text style={{ color: colors.bg, fontWeight: "700" }}>Turn on cameras</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.askBtn, { backgroundColor: colors.surfaceRaised }]} onPress={() => call.answerVideoAsk(false)}>
                    <Text style={{ color: colors.text }}>Keep voice only</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
            {addOpen ? <AddPersonPad onInvite={call.addToCall} onClose={() => setAddOpen(false)} /> : null}
            <View style={s.controls}>
              <TouchableOpacity style={[s.ctrl, !call.micOn && s.ctrlOff]} onPress={call.toggleMic}>
                <Text style={s.ctrlText}>{call.micOn ? "🎙️" : "🔇"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.ctrl, !call.camOn && s.ctrlOff]} onPress={call.toggleCam}>
                <Text style={s.ctrlText}>🎥</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.ctrl} onPress={call.flipCam}>
                <Text style={s.ctrlText}>🔄</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.ctrl, call.speakerOn && s.ctrlOn]} onPress={call.toggleSpeaker}>
                <Text style={s.ctrlText}>🔊</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.ctrl, call.sharingScreen && s.ctrlOn]} onPress={call.toggleScreenShare}>
                <Text style={s.ctrlText}>🖥️</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.ctrl, addOpen && s.ctrlOn]} onPress={() => setAddOpen(o => !o)}>
                <Text style={s.ctrlText}>➕</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.ctrl, { backgroundColor: colors.danger, width: 68 }]} onPress={call.hangup}>
                <Text style={s.ctrlText}>⏚</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {/* CALL WAITING (M3.5): a second caller mid-call OR mid-dial (web
            shows it over the dial card too — hiding it silently machine-
            declines a real caller after 30s). Answering ENDS the current
            call/dial — no hold/swap yet, and the copy must say so. */}
        {call.waiting ? (
          <View style={s.waitCard}>
            <Text style={s.waitTitle}>{call.waiting.fromName} is calling</Text>
            <Text style={s.waitSub}>{fmtPin(call.waiting.from)} · {call.waiting.video ? "Video" : "Voice"} call</Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: spacing(2) }}>
              <TouchableOpacity style={[s.askBtn, { backgroundColor: colors.surfaceRaised }]} onPress={call.declineWaiting}>
                <Text style={{ color: colors.text }}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.askBtn, { backgroundColor: colors.danger }]} onPress={call.acceptWaiting}>
                <Text style={{ color: "#fff", fontWeight: "700" }}>End call & answer</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
        {call.notice ? (
          <View style={s.notice}><Text style={s.noticeText}>{call.notice}</Text></View>
        ) : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing(6) },
  bigAvatar: { width: 110, height: 110, borderRadius: 55, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.accent },
  bigInitials: { color: colors.text, fontSize: 38, fontWeight: "800" },
  name: { color: colors.text, fontSize: 24, fontWeight: "700", marginTop: spacing(3) },
  pin: { color: colors.text, fontSize: 30, fontWeight: "800", letterSpacing: 3, marginTop: spacing(2), fontVariant: ["tabular-nums"] },
  mode: { color: colors.textMuted, marginTop: spacing(2), borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: spacing(3), paddingVertical: 4, overflow: "hidden" },
  status: { color: colors.accent, marginTop: spacing(4), fontWeight: "700" },
  answerRow: { flexDirection: "row", gap: spacing(6), marginTop: spacing(10) },
  round: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center" },
  roundText: { fontSize: 24 },
  roundLabel: { color: "#fff", fontSize: 11, fontWeight: "700", marginTop: 2 },
  grid: { flex: 1, flexDirection: "row", flexWrap: "wrap" },
  tileVideo: { flexGrow: 1, minWidth: "48%", minHeight: 220, backgroundColor: colors.surface, margin: 2, borderRadius: 12, overflow: "hidden" },
  tileAvatar: { alignItems: "center", justifyContent: "center" },
  tileInitials: { color: colors.text, fontSize: 30, fontWeight: "800" },
  tileName: { color: colors.textMuted, marginTop: spacing(2) },
  self: { position: "absolute", top: spacing(4), right: spacing(4), width: 108, height: 150, borderRadius: 12, backgroundColor: colors.surface },
  ask: { position: "absolute", left: spacing(3), right: spacing(3), bottom: 108, backgroundColor: colors.surfaceRaised, borderRadius: 14, padding: spacing(3), gap: spacing(2) },
  askText: { color: colors.text, fontSize: 13 },
  askBtn: { flex: 1, borderRadius: 10, alignItems: "center", paddingVertical: spacing(2.5) },
  controls: { flexDirection: "row", justifyContent: "center", gap: 12, paddingVertical: spacing(4), backgroundColor: colors.surface },
  ctrl: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  ctrlOff: { backgroundColor: colors.danger },
  ctrlOn: { backgroundColor: "#1f4d44" },
  ctrlText: { fontSize: 20 },
  topBar: { flexDirection: "row", gap: 8, justifyContent: "center", paddingTop: spacing(3), paddingHorizontal: spacing(3), backgroundColor: colors.bg },
  topChip: { color: colors.text, fontSize: 12, fontWeight: "700", backgroundColor: colors.surfaceRaised, borderRadius: 12, paddingHorizontal: spacing(2.5), paddingVertical: 4, overflow: "hidden" },
  holdChip: { backgroundColor: "#4d3a1f", color: "#ffd28a" },
  waitCard: { position: "absolute", left: spacing(3), right: spacing(3), top: spacing(10), backgroundColor: colors.surfaceRaised, borderRadius: 16, padding: spacing(3.5), borderWidth: 1, borderColor: colors.border },
  waitTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  waitSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  notice: { position: "absolute", alignSelf: "center", bottom: 190, backgroundColor: "#000c", borderRadius: 12, paddingHorizontal: spacing(3), paddingVertical: spacing(2) },
  noticeText: { color: "#fff", fontSize: 13 },
  padWrap: { position: "absolute", alignSelf: "center", bottom: 108, backgroundColor: colors.surfaceRaised, borderRadius: 16, padding: spacing(3), alignItems: "center", borderWidth: 1, borderColor: colors.border },
  padEcho: { color: colors.text, fontSize: 20, fontWeight: "800", letterSpacing: 2, fontVariant: ["tabular-nums"], marginBottom: spacing(2) },
  padGrid: { flexDirection: "row", flexWrap: "wrap", width: 3 * 64 + 2 * 8, gap: 8, justifyContent: "center" },
  padKey: { width: 64, height: 48, borderRadius: 10, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  padKeyText: { color: colors.text, fontSize: 18, fontWeight: "700" },
  padHint: { color: colors.textMuted, fontSize: 11, marginTop: spacing(2) },
});
