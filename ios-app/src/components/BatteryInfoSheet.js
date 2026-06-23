import React, { useRef, useState, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
} from "react-native";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { colors, radius } from "../theme";
import { batteryVoltage, batteryCurrent } from "../metrics";
import { metricLabel, formatValue } from "./DeviceDetail";

const glass = isLiquidGlassAvailable();

// Native slide-up card listing every metric for a single battery, on a clear
// glass surface with a tappable backdrop to dismiss.
const SCREEN_H = Dimensions.get("window").height;
const SLIDE_DURATION = 430;

export default function BatteryInfoSheet({ reading, onClose }) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const translateY = useRef(new Animated.Value(SCREEN_H)).current;
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState(null);
  const isOpen = !!reading;

  // Keep showing live data while open.
  useEffect(() => {
    if (reading) setCurrent(reading);
  }, [reading]);

  // Slide up on open; slide down (slower) on dismiss, then unmount.
  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      translateY.setValue(SCREEN_H);
      Animated.timing(translateY, {
        toValue: 0,
        duration: SLIDE_DURATION,
        easing: Easing.out(Easing.back(0.7)),
        useNativeDriver: true,
      }).start();
    } else if (visible) {
      Animated.timing(translateY, {
        toValue: SCREEN_H,
        duration: SLIDE_DURATION,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setVisible(false);
      });
    }
  }, [isOpen]);

  const reading_ = current;
  const metrics = reading_ ? Object.entries(reading_.metrics || {}) : [];

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          {glass ? (
            <GlassView glassEffectStyle="clear" style={StyleSheet.absoluteFill} />
          ) : null}
          <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, styles.tint]} />
          <View style={styles.grabber} />
          <View style={styles.header}>
          <View style={styles.titleWrap}>
            <Text style={styles.title} numberOfLines={1}>
              {reading_?.device_name || reading_?.device_id}
            </Text>
            <View style={styles.statusRow}>
              <View
                style={[styles.dot, !reading_?.online && styles.dotOffline]}
              />
              <Text style={styles.status}>
                {reading_?.online ? t("common.online") : t("common.offline")}
              </Text>
            </View>
          </View>
          <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
            <Ionicons name="close" size={20} color={colors.white} />
          </Pressable>
        </View>

        {reading_ ? (
          <View style={styles.summary}>
            <Summary label={t("device.metrics.packVoltage")} value={`${batteryVoltage(reading_).toFixed(1)} V`} />
            <View style={styles.summaryDivider} />
            <Summary label={t("home.batteryCurrent")} value={`${batteryCurrent(reading_).toFixed(1)} A`} />
          </View>
        ) : null}

        <ScrollView
          style={styles.list}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 12 }]}
          showsVerticalScrollIndicator={false}
        >
          {metrics.length ? (
            metrics.map(([key, metric], index) => (
              <View
                key={key}
                style={[styles.row, index < metrics.length - 1 && styles.rowBorder]}
              >
                <Text style={styles.rowLabel}>{metricLabel(key, metric, t)}</Text>
                <Text style={styles.rowValue}>{formatValue(metric)}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.empty}>{t("device.noMeasurements")}</Text>
          )}
        </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function Summary({ label, value }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end", backgroundColor: "transparent" },
  sheet: {
    maxHeight: "88%",
    backgroundColor: "transparent",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderCurve: "continuous",
    overflow: "hidden",
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  tint: { backgroundColor: "rgba(0,0,0,0.6)" },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.5)",
    marginBottom: 12,
  },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  titleWrap: { flex: 1, marginRight: 12 },
  title: { color: colors.white, fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  statusRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green },
  dotOffline: { backgroundColor: colors.red },
  status: { color: "rgba(255,255,255,0.85)", fontSize: 13, marginLeft: 7 },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  summary: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: radius.lg,
    borderCurve: "continuous",
    paddingVertical: 16,
    marginTop: 18,
  },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryDivider: { width: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.25)" },
  summaryValue: { color: colors.white, fontSize: 22, fontWeight: "800" },
  summaryLabel: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 3 },
  list: { marginTop: 18, flexGrow: 1, flexShrink: 1 },
  listContent: { paddingBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.15)" },
  rowLabel: { color: "rgba(255,255,255,0.85)", fontSize: 14, flex: 1, marginRight: 12 },
  rowValue: { color: colors.white, fontSize: 15, fontWeight: "600" },
  empty: { color: "rgba(255,255,255,0.85)", fontSize: 14, textAlign: "center", paddingVertical: 24 },
});
