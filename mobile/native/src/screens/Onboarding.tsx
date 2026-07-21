import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { api, type Whoami } from "../lib/api";
import { colors, spacing } from "../lib/theme";

/**
 * Guest-first entry — mirrors the web OnboardingGate + the v2.94.6 guest
 * "matrix" ID-reveal. RN has no <canvas>, so instead of the web's green glyph
 * rain we reproduce the signature moment: after the guest is minted, the
 * assigned 6-digit number DECODES digit-by-digit out of a scramble on a dark
 * glass card, then "Welcome, <name>" before entering the app.
 */
type Stage = "entry" | "reveal";

export function Onboarding({ onReady }: { onReady: (me: Whoami) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stage, setStage] = useState<Stage>("entry");
  const [revealNum, setRevealNum] = useState("");
  const [shown, setShown] = useState("······");
  const [settled, setSettled] = useState(false);
  const meRef = useRef<Whoami | null>(null);
  const fade = useRef(new Animated.Value(0)).current;

  const enter = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const g = await api.startGuest(name.trim());
      const me = await api.whoami();
      if (!me) throw new Error("no identity");
      meRef.current = me;
      setRevealNum(/^\d{6}$/.test(g.number) ? g.number : me.number);
      setStage("reveal");
    } catch {
      setError("Couldn't reach RELAY — check your connection and try again.");
      setBusy(false);
    }
  };

  // Reveal: scramble → lock each digit left-to-right → settle → enter the app.
  useEffect(() => {
    if (stage !== "reveal" || !revealNum) return;
    Animated.timing(fade, {
      toValue: 1,
      duration: 400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    const start = Date.now();
    const iv = setInterval(() => {
      const elapsed = Date.now() - start;
      const revealed = Math.min(6, Math.floor(elapsed / 160)); // one digit / 160ms
      let out = "";
      for (let i = 0; i < 6; i++) {
        out += i < revealed ? revealNum[i] : String(Math.floor(Math.random() * 10));
      }
      setShown(out);
      if (revealed >= 6) {
        setShown(revealNum);
        setSettled(true);
        clearInterval(iv);
      }
    }, 55);
    const done = setTimeout(() => {
      if (meRef.current) onReady(meRef.current);
    }, 2300);
    return () => {
      clearInterval(iv);
      clearTimeout(done);
    };
  }, [stage, revealNum, fade, onReady]);

  const skip = useCallback(() => {
    if (meRef.current) onReady(meRef.current);
  }, [onReady]);

  if (stage === "reveal") {
    const display = /^\d{6}$/.test(shown) ? `${shown.slice(0, 3)}-${shown.slice(3)}` : shown;
    return (
      <View style={s.root}>
        <Animated.View style={[s.revealCard, { opacity: fade }]}>
          <Text style={s.revealEyebrow}>{settled ? "SESSION READY" : "GENERATING YOUR RELAY ID"}</Text>
          <Text style={s.revealNum}>{display}</Text>
          <Text style={[s.revealWelcome, { opacity: settled ? 1 : 0 }]}>
            Welcome, <Text style={s.revealName}>{name.trim() || "guest"}</Text>
          </Text>
          {settled ? (
            <TouchableOpacity style={s.revealGo} onPress={skip}>
              <Text style={s.revealGoText}>Continue</Text>
            </TouchableOpacity>
          ) : (
            <ActivityIndicator color={colors.accent} style={{ marginTop: spacing(4) }} />
          )}
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <View style={s.card}>
        <View style={s.brandRow}>
          <View style={s.dot} />
          <Text style={s.title}>RELAY</Text>
        </View>
        <Text style={s.sub}>Pick a name and jump straight in — no account needed.</Text>
        <Text style={s.label}>YOUR DISPLAY NAME</Text>
        <TextInput
          style={s.input}
          placeholder="e.g. Alex"
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={setName}
          autoFocus
          maxLength={64}
          onSubmitEditing={enter}
          returnKeyType="go"
        />
        <TouchableOpacity
          style={[s.cta, (!name.trim() || busy) && s.ctaOff]}
          onPress={enter}
          disabled={!name.trim() || busy}
        >
          {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={s.ctaText}>Enter as guest</Text>}
        </TouchableOpacity>
        {error ? <Text style={s.error}>{error}</Text> : null}
        <Text style={s.foot}>
          Guest sessions last until you close the app. Registering keeps your number forever.
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: spacing(5) },
  card: {
    alignSelf: "stretch",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 24,
    padding: spacing(6),
  },
  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing(2.5) as number },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent },
  title: { color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: 2 },
  sub: { color: colors.textMuted, fontSize: 14, marginTop: spacing(2.5), marginBottom: spacing(6), textAlign: "center" },
  label: { color: colors.textMuted, fontSize: 11, letterSpacing: 2, marginBottom: spacing(2) },
  input: {
    alignSelf: "stretch",
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3.5),
  },
  cta: {
    alignSelf: "stretch",
    backgroundColor: colors.online,
    borderRadius: 14,
    alignItems: "center",
    paddingVertical: spacing(3.5),
    marginTop: spacing(4),
  },
  ctaOff: { opacity: 0.5 },
  ctaText: { color: colors.bg, fontSize: 16, fontWeight: "700" },
  error: { color: colors.danger, marginTop: spacing(3), fontSize: 13, textAlign: "center" },
  foot: { color: colors.textMuted, fontSize: 12, marginTop: spacing(4), textAlign: "center", lineHeight: 18 },
  // reveal
  revealCard: {
    alignSelf: "stretch",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 24,
    padding: spacing(7),
    alignItems: "center",
  },
  revealEyebrow: { color: colors.accent, fontSize: 11, letterSpacing: 3, fontWeight: "700", marginBottom: spacing(3) },
  revealNum: {
    color: colors.text,
    fontSize: 44,
    fontWeight: "800",
    letterSpacing: 4,
    fontVariant: ["tabular-nums"],
  },
  revealWelcome: { color: colors.textMuted, fontSize: 15, marginTop: spacing(4) },
  revealName: { color: colors.text, fontWeight: "700" },
  revealGo: {
    marginTop: spacing(5),
    backgroundColor: colors.online,
    borderRadius: 14,
    paddingVertical: spacing(3),
    paddingHorizontal: spacing(8),
  },
  revealGoText: { color: colors.bg, fontSize: 15, fontWeight: "700" },
});
