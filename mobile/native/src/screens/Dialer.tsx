import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { api, type LookupResult, type Whoami } from "../lib/api";
import { useCall } from "../call/engine";
import { colors, spacing } from "../lib/theme";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

/** Native keypad — same layout, ghost-number rule, and presence preview as
 *  the web Dialer. Live calls land in Milestone 3 (engine port). */
export function Dialer({ me }: { me: Whoami }) {
  const call = useCall();
  const [dialed, setDialed] = useState("");
  const [peer, setPeer] = useState<LookupResult | null>(null);
  /** Group dial staging (M3.5): 6-digit chips collected via the Group key. */
  const [group, setGroup] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    if (dialed.length === 6) {
      api.lookup(dialed).then(r => { if (alive) setPeer(r); }).catch(() => {});
    } else {
      setPeer(null);
    }
    return () => { alive = false; };
  }, [dialed]);

  const fmt = (n: string) => (n.length > 3 ? `${n.slice(0, 3)} ${n.slice(3)}` : n);
  const display = dialed || (me.number ? fmt(me.number) : "");

  const startCall = (voice: boolean) => {
    if (dialed.length !== 6) return;
    call.dial(dialed, { voice, displayName: peer?.displayName });
    setDialed("");
  };

  // Group key: a full number stages a chip; with chips staged and the pad
  // empty it STARTS the conference (voice-first — v2.83 rule).
  const groupKey = () => {
    if (dialed.length === 6) {
      setGroup(g => (g.includes(dialed) || g.length >= 9 ? g : [...g, dialed]));
      setDialed("");
      return;
    }
    if (group.length > 0) {
      call.dialGroup(group, { voice: true });
      setGroup([]);
    }
  };

  return (
    <View style={s.root}>
      <Text style={[s.number, !dialed && s.ghost]}>{display || "— — —  — — —"}</Text>
      <Text style={s.peer}>
        {peer ? `${peer.displayName} · ${peer.isOnline ? "online now" : "offline"}` : dialed.length === 6 ? "Unknown number" : me.number ? "Your number — dial someone" : " "}
      </Text>
      <View style={s.pad}>
        {KEYS.map(k => (
          <TouchableOpacity key={k} style={s.key} onPress={() => { if (dialed.length < 6 && /[0-9]/.test(k)) setDialed(d => d + k); }}>
            <Text style={s.keyText}>{k}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {group.length > 0 ? (
        <View style={s.groupRow}>
          <Text style={s.groupChips} numberOfLines={1}>
            {group.map(n => `${n.slice(0, 3)}-${n.slice(3)}`).join("  ")}
          </Text>
          <TouchableOpacity onPress={() => setGroup([])}>
            <Text style={s.groupClear}>Clear</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <View style={s.row}>
        <TouchableOpacity style={[s.action, { backgroundColor: "#1D4ED8" }]} onPress={() => startCall(true)}>
          <Text style={s.actionText}>Voice</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.action, { backgroundColor: "#15803D" }]} onPress={() => startCall(false)}>
          <Text style={s.actionText}>Video</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.action, { backgroundColor: "#7C3AED" }]} onPress={groupKey}>
          <Text style={s.actionText}>{dialed.length === 6 ? "+ Group" : group.length > 0 ? `Call ${group.length}` : "Group"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.action, { backgroundColor: colors.surfaceRaised }]} onPress={() => setDialed(d => d.slice(0, -1))}>
          <Text style={s.actionText}>⌫</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  groupRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: spacing(4), paddingBottom: spacing(1) },
  groupChips: { flex: 1, color: colors.text, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  groupClear: { color: colors.textMuted, fontSize: 12 },
  root: { flex: 1, backgroundColor: colors.bg, alignItems: "center", paddingTop: spacing(10) },
  number: { color: colors.text, fontSize: 40, fontWeight: "700", letterSpacing: 4, fontVariant: ["tabular-nums"] },
  ghost: { color: colors.textMuted },
  peer: { color: colors.textMuted, marginTop: spacing(2), height: 20 },
  pad: { flexDirection: "row", flexWrap: "wrap", width: 300, justifyContent: "center", marginTop: spacing(6) },
  key: { width: 84, height: 68, margin: 6, borderRadius: 18, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  keyText: { color: colors.text, fontSize: 26, fontWeight: "600" },
  row: { flexDirection: "row", gap: 12, marginTop: spacing(6) },
  action: { width: 92, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  actionText: { color: "#fff", fontWeight: "700" },
});
