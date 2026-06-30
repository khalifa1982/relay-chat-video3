import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Path } from "react-native-svg";

import type { ApkUpdateStatus } from "@/hooks/use-apk-update";
import { remainingFraction } from "@/lib/countdown";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * GlossyCheckButton — a fancy, glass-style blue control for the update footer.
 *
 * At rest it shows a circular refresh glyph on a glossy blue puck. A thin ring
 * around the puck represents the time remaining until the next automatic update
 * check: it starts full right after a check and slowly DRAINS over the 10-minute
 * poll window (no numbers shown). When it reaches empty the app checks for an
 * update; if none is found the ring re-fills with the same blue and the cycle
 * repeats. While a download is in progress the ring instead tracks the download
 * percentage, and the glyph adapts to the current phase.
 */

const SIZE = 52;
const STROKE = 4;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Blue palette tuned for a glossy look.
const BLUE_LIGHT = "#5BB8FF";
const BLUE = "#1E8BFF";
const BLUE_DEEP = "#0A55C8";
const RING_BG = "rgba(120,170,255,0.18)";
const READY_GREEN = "#34D399";

interface Props {
  status: ApkUpdateStatus;
  /** 0..1 download progress (used while downloading). */
  progress?: number;
  /** Epoch ms of the last check (anchors the countdown ring). */
  lastCheckAt: number;
  /** Poll window length in ms (the ring drains over this). */
  pollIntervalMs: number;
  /** Re-check the manifest. */
  onCheck?: () => void;
  /** Start downloading the available build. */
  onDownload?: () => void;
  /** Apply the downloaded APK + restart. */
  onApply?: () => void;
}

export function GlossyCheckButton({
  status,
  progress = 0,
  lastCheckAt,
  pollIntervalMs,
  onCheck,
  onDownload,
  onApply,
}: Props) {
  // Drives the ring fill fraction (0..1). Animated so it drains smoothly.
  const ringAnim = useRef(new Animated.Value(1)).current;
  // Continuous rotation while checking/downloading.
  const spinAnim = useRef(new Animated.Value(0)).current;
  // Subtle press scale.
  const scaleAnim = useRef(new Animated.Value(1)).current;

  // Local tick so the countdown recomputes on a cadence.
  const [, setTick] = useState(0);

  const isCountdownPhase = status === "idle" || status === "checking";
  const isDownloading = status === "downloading";
  const isReady = status === "ready";
  const isSpinning =
    status === "checking" || status === "downloading" || status === "installing";

  // While idle/checking, recompute the remaining fraction periodically so the
  // ring visibly drains. Cheap: a state bump that re-reads Date.now().
  useEffect(() => {
    if (!isCountdownPhase) return;
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 500);
    return () => clearInterval(id);
  }, [isCountdownPhase]);

  // Update the ring target whenever inputs change.
  useEffect(() => {
    let target: number;
    if (isDownloading) {
      target = Math.max(0, Math.min(1, progress));
    } else if (isCountdownPhase) {
      target = remainingFraction(lastCheckAt, Date.now(), pollIntervalMs);
    } else {
      // available / installing / ready / error — show a full ring as a backdrop.
      target = 1;
    }
    Animated.timing(ringAnim, {
      toValue: target,
      duration: isDownloading ? 180 : 450,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  });

  // Spin the glyph while actively checking/downloading/installing.
  useEffect(() => {
    if (!isSpinning) {
      spinAnim.stopAnimation();
      spinAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [isSpinning, spinAnim]);

  const ringColor = isReady ? READY_GREEN : BLUE_LIGHT;

  const strokeDashoffset = ringAnim.interpolate({
    inputRange: [0, 1],
    // Full fraction (1) -> no offset (full ring); empty (0) -> fully hidden.
    outputRange: [CIRCUMFERENCE, 0],
  });

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const handlePress = () => {
    if (isReady) return onApply?.();
    if (status === "available" || status === "error") return onDownload?.();
    if (isDownloading || status === "installing" || status === "checking") return;
    return onCheck?.();
  };

  const disabled =
    isDownloading || status === "installing" || status === "checking";

  const onPressIn = () =>
    Animated.timing(scaleAnim, {
      toValue: 0.94,
      duration: 80,
      useNativeDriver: true,
    }).start();
  const onPressOut = () =>
    Animated.timing(scaleAnim, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    }).start();

  // The center glyph adapts to the phase.
  const glyph = (() => {
    if (isReady) return <RestartGlyph />;
    if (status === "available" || status === "error") return <DownloadGlyph />;
    return <RefreshGlyph />; // idle / checking / downloading / installing
  })();

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Pressable
        onPress={handlePress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Check for updates"
        style={styles.tap}
      >
        {/* Countdown / progress ring */}
        <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={RING_BG}
            strokeWidth={STROKE}
            fill="none"
          />
          <AnimatedCircle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={ringColor}
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            strokeDashoffset={strokeDashoffset}
            // Start the ring at 12 o'clock and drain clockwise.
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>

        {/* Glossy blue puck */}
        <View style={styles.puckWrap}>
          <LinearGradient
            colors={
              isReady
                ? ["#5BE7B0", "#10B981", "#047857"]
                : [BLUE_LIGHT, BLUE, BLUE_DEEP]
            }
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={styles.puck}
          >
            {/* Top sheen highlight for the glossy effect */}
            <LinearGradient
              colors={[
                "rgba(255,255,255,0.55)",
                "rgba(255,255,255,0.06)",
                "rgba(255,255,255,0)",
              ]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 0.65 }}
              style={styles.sheen}
            />
            <Animated.View
              style={[
                styles.glyph,
                isSpinning && { transform: [{ rotate: spin }] },
              ]}
            >
              {glyph}
            </Animated.View>
          </LinearGradient>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/* ---------- Inline white SVG glyphs ---------- */

function RefreshGlyph() {
  // A clean circular-arrow refresh icon.
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      <Path
        d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"
        stroke="#FFFFFF"
        strokeWidth={2.4}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M18.2 3.4 L17.6 7.2 L13.8 6.6"
        stroke="#FFFFFF"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

function DownloadGlyph() {
  // Down arrow into a tray — signals "update available, tap to download".
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      <Path
        d="M12 4 L12 14 M7.5 10 L12 14.6 L16.5 10"
        stroke="#FFFFFF"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="M6 18 L18 18"
        stroke="#FFFFFF"
        strokeWidth={2.4}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

function RestartGlyph() {
  // Power-style restart arrow — signals "ready, tap to install + restart".
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      <Path
        d="M12 5 a7 7 0 1 1-5 2.1"
        stroke="#FFFFFF"
        strokeWidth={2.4}
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M7 3.4 L7 7.3 L10.9 7.3"
        stroke="#FFFFFF"
        strokeWidth={2.4}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  tap: {
    width: SIZE,
    height: SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  puckWrap: {
    width: SIZE - STROKE * 2 - 4,
    height: SIZE - STROKE * 2 - 4,
    borderRadius: (SIZE - STROKE * 2 - 4) / 2,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: BLUE,
        shadowOpacity: 0.6,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 6 },
      default: {},
    }),
  },
  puck: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "55%",
    borderTopLeftRadius: 999,
    borderTopRightRadius: 999,
  },
  glyph: {
    alignItems: "center",
    justifyContent: "center",
  },
});
