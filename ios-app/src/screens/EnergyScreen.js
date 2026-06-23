import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { colors, radius } from "../theme";
import { useReadings } from "../api";
import { chargePower, usedPower, capacity, kw } from "../metrics";
import TimeGradientBackground from "../components/TimeGradientBackground";
import DeviceDetail from "../components/DeviceDetail";
import DeviceTypeIcon from "../components/DeviceTypeIcon";

const Stack = createNativeStackNavigator();

export default function EnergyScreen() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "transparent" },
        animation: "slide_from_right",
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
      }}
    >
      <Stack.Screen name="DeviceList" component={DeviceListScreen} />
      <Stack.Screen name="DeviceDetail" component={DeviceDetailScreen} />
    </Stack.Navigator>
  );
}

function DeviceListScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { readings, connected } = useReadings();
  const sorted = [...readings].sort((a, b) =>
    a.device_id.localeCompare(b.device_id)
  );
  const inverters = sorted.filter((reading) => reading.kind !== "bms");
  const batteries = sorted.filter((reading) => reading.kind === "bms");

  const openDevice = (reading) =>
    navigation.navigate("DeviceDetail", {
      deviceId: reading.device_id,
      initialReading: reading,
    });

  return (
    <TimeGradientBackground>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 140, paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>{t("energy.title")}</Text>
        <Text style={styles.sub}>
          {connected ? t("energy.liveReadings") : t("energy.reconnecting")}
        </Text>

        {sorted.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="hardware-chip-outline" size={28} color={colors.muted} />
            <Text style={styles.emptyText}>
              {t("energy.empty")}
            </Text>
          </View>
        )}

        {inverters.length > 0 && (
          <DeviceSection
            title={t("energy.inverters")}
            devices={inverters}
            type="inverter"
            onOpen={openDevice}
            t={t}
          />
        )}

        {batteries.length > 0 && (
          <DeviceSection
            title={t("energy.batteries")}
            devices={batteries}
            type="battery"
            onOpen={openDevice}
            t={t}
          />
        )}
      </ScrollView>
    </TimeGradientBackground>
  );
}

function DeviceSection({ title, devices, type, onOpen, t }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionCount}>{devices.length}</Text>
      </View>
      <View style={styles.grid}>
        {devices.map((reading) => (
          <DeviceCard
            key={reading.device_id}
            reading={reading}
            type={type}
            onPress={() => onOpen(reading)}
            t={t}
          />
        ))}
      </View>
    </View>
  );
}

function DeviceCard({ reading, type, onPress, t }) {
  const batteryLevel =
    reading.metrics?.soc?.value ?? reading.metrics?.battery_capacity?.value;
  const batteryPower = Math.abs(Number(reading.metrics?.power?.value) || 0);
  const primaryValue =
    type === "battery"
      ? batteryLevel != null
        ? `${Math.round(batteryLevel)}%`
        : capacity(reading, t("common.device"))
      : `${kw(chargePower(reading))} kW`;
  const secondaryValue =
    type === "battery"
      ? `${kw(batteryPower)} kW`
      : `${kw(usedPower(reading))} kW`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("device.open", {
        name: reading.device_name || reading.device_id,
      })}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardTop}>
        <View style={[styles.statusDot, !reading.online && styles.statusOffline]} />
        <Ionicons name="chevron-forward" size={15} color={colors.muted} />
      </View>
      <View style={styles.art}>
        <DeviceTypeIcon
          type={type}
          color={reading.online ? colors.ink : colors.muted}
        />
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {reading.device_name || reading.device_id}
      </Text>
      <Text style={styles.meta}>
        {reading.online ? t("common.online") : t("common.offline")}
      </Text>
      <View style={styles.cardMetrics}>
        <View>
          <Text style={styles.metricLabel}>
            {type === "battery" ? t("home.battery") : t("energy.solar")}
          </Text>
          <Text style={styles.metricValue}>{primaryValue}</Text>
        </View>
        <View style={styles.metricRight}>
          <Text style={styles.metricLabel}>
            {type === "battery" ? t("device.metrics.batteryPower") : t("energy.load")}
          </Text>
          <Text style={styles.metricValue}>{secondaryValue}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function DeviceDetailScreen({ route, navigation }) {
  const { readings } = useReadings();
  const { deviceId, initialReading } = route.params;
  const reading =
    readings.find((item) => item.device_id === deviceId) || initialReading;

  return (
    <TimeGradientBackground>
      <DeviceDetail reading={reading} onBack={() => navigation.goBack()} />
    </TimeGradientBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "transparent" },
  title: { fontSize: 28, fontWeight: "800", color: colors.ink, letterSpacing: -0.6 },
  sub: { color: colors.muted, fontSize: 13, marginTop: 2, marginBottom: 18 },
  empty: { alignItems: "center", gap: 10, paddingVertical: 60 },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: "center", maxWidth: 220 },
  section: { marginBottom: 24 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  sectionTitle: { color: colors.ink, fontSize: 16, fontWeight: "700" },
  sectionCount: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  card: {
    width: "48%",
    minHeight: 226,
    backgroundColor: "rgba(251,250,247,0.9)",
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.92)",
    padding: 14,
  },
  cardPressed: { opacity: 0.72 },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green },
  statusOffline: { backgroundColor: colors.red },
  art: { height: 78, alignItems: "center", justifyContent: "center" },
  name: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 11, marginTop: 3 },
  cardMetrics: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    marginTop: 13,
    paddingTop: 12,
  },
  metricRight: { alignItems: "flex-end" },
  metricLabel: { color: colors.muted, fontSize: 11 },
  metricValue: { color: colors.ink, fontSize: 14, fontWeight: "700", marginTop: 3 },
});
