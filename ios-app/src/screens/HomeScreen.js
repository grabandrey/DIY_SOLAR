import React from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ImageBackground,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { colors } from "../theme";
import { useCurrentBackground } from "../background";
import { useDailyEnergy, useReadings, useTimeSeries } from "../api";
import { useProfile } from "../profile";
import {
  chargePower,
  usedPower,
  gridPower,
  sumBy,
  avgSoc,
  kw,
} from "../metrics";
import GlassCard from "../components/GlassCard";
import LineChart from "../components/LineChart";

const glass = isLiquidGlassAvailable();

function greetingKey() {
  const hour = new Date().getHours();
  if (hour < 12) return "home.morning";
  if (hour < 18) return "home.afternoon";
  return "home.evening";
}

function HeaderGlass({ children, style }) {
  return (
    <View style={[styles.headerGlass, style]}>
      {glass ? (
        <GlassView
          glassEffectStyle="clear"
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.glassFallback]} />
      )}
      {children}
    </View>
  );
}

function DailyMetric({ icon, label, value, accent }) {
  return (
    <View style={styles.dailyMetric}>
      <View style={[styles.metricIcon, { backgroundColor: accent }]}>
        <Ionicons name={icon} size={18} color={colors.ink} />
      </View>
      <Text style={styles.dailyLabel}>{label}</Text>
      <Text style={styles.dailyValue}>
        {value.toFixed(2)} <Text style={styles.dailyUnit}>kWh</Text>
      </Text>
    </View>
  );
}

function FlowMetric({ icon, label, value }) {
  return (
    <View style={styles.flowMetric}>
      <Ionicons name={icon} size={18} color={colors.ink} />
      <Text style={styles.flowValue}>{kw(value)} kW</Text>
      <Text style={styles.flowLabel}>{label}</Text>
    </View>
  );
}

export default function HomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const { name } = useProfile();
  const { readings, connected } = useReadings();
  const daily = useDailyEnergy();
  const background = useCurrentBackground();

  const production = sumBy(readings, chargePower);
  const load = sumBy(readings, usedPower);
  const grid = sumBy(readings, gridPower);
  const soc = avgSoc(readings);
  const online = readings.filter((reading) => reading.online).length;
  const series = useTimeSeries(
    () => ({ production: Math.round(sumBy(readings, chargePower)) }),
    { maxPoints: 30 }
  );

  return (
    <View style={styles.screen}>
      <ImageBackground
        source={background.source}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />
      <LinearGradient
        colors={["rgba(0,0,0,0.48)", "rgba(0,0,0,0.04)", "rgba(0,0,0,0.28)"]}
        locations={[0, 0.42, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingBottom: 150,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <HeaderGlass>
            <Ionicons name="person" size={21} color="#fff" />
          </HeaderGlass>
          <View style={styles.headerCopy}>
            <Text style={styles.hello}>
              {t("home.hello", { name: name.trim() || "James" })}
            </Text>
            <Text style={styles.greeting}>{t(greetingKey())}</Text>
          </View>
          <Pressable onPress={() => navigation.navigate("Settings")} hitSlop={8}>
            <HeaderGlass>
              <Ionicons name="notifications-outline" size={20} color="#fff" />
              <View style={styles.bellDot} />
            </HeaderGlass>
          </Pressable>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroLabel}>{t("home.liveSolar")}</Text>
          <Text style={styles.heroValue}>
            {kw(production)} <Text style={styles.heroUnit}>kW</Text>
          </Text>
          <View style={styles.liveRow}>
            <View style={[styles.liveDot, !connected && styles.liveDotOffline]} />
            <Text style={styles.liveText}>
              {connected ? t("settings.live") : t("energy.reconnecting")}
            </Text>
          </View>
        </View>

        <View style={styles.content}>
          <GlassCard style={styles.todayCard} tint="rgba(255,255,255,0.58)">
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{t("home.todayEnergy")}</Text>
              <Text style={styles.cardDate}>
                {new Date().toLocaleDateString(
                  i18n.resolvedLanguage === "ro" ? "ro-RO" : "en-US",
                  {
                    day: "numeric",
                    month: "short",
                  }
                )}
              </Text>
            </View>
            <View style={styles.dailyRow}>
              <DailyMetric
                icon="sunny"
                label={t("home.solarToday")}
                value={daily.solar_kwh}
                accent={colors.yellow}
              />
              <View style={styles.metricDivider} />
              <DailyMetric
                icon="home"
                label={t("home.consumptionToday")}
                value={daily.consumption_kwh}
                accent="#FFD4BE"
              />
            </View>
          </GlassCard>

          <GlassCard style={styles.flowCard} tint="rgba(255,255,255,0.5)">
            <Text style={styles.cardTitle}>{t("home.currentFlow")}</Text>
            <View style={styles.flowRow}>
              <FlowMetric icon="sunny-outline" label={t("energy.solar")} value={production} />
              <FlowMetric icon="home-outline" label={t("home.load")} value={load} />
              <FlowMetric icon="grid-outline" label={t("home.grid")} value={grid} />
            </View>
            <LineChart
              data={series.map((point) => point.production)}
              height={88}
              color={colors.yellowDeep}
            />
          </GlassCard>

          <GlassCard style={styles.statusCard} tint="rgba(255,255,255,0.5)">
            <View>
              <Text style={styles.cardTitle}>{t("home.systemStatus")}</Text>
              <Text style={styles.statusText}>
                {t("home.devices")}: {online}/{readings.length}
              </Text>
            </View>
            <View style={styles.battery}>
              <Ionicons name="battery-charging-outline" size={22} color={colors.ink} />
              <Text style={styles.batteryValue}>{soc ? `${soc}%` : "—"}</Text>
              <Text style={styles.batteryLabel}>{t("home.battery")}</Text>
            </View>
          </GlassCard>

          {!connected && <Text style={styles.offline}>{t("home.disconnected")}</Text>}
        </View>
      </ScrollView>
    </View>
  );
}

const shadow = {
  textShadowColor: "rgba(0,0,0,0.32)",
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 6,
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1, backgroundColor: "transparent" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  headerGlass: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  glassFallback: { backgroundColor: "rgba(255,255,255,0.18)" },
  headerCopy: { flex: 1, marginLeft: 12 },
  hello: { color: "rgba(255,255,255,0.88)", fontSize: 13, ...shadow },
  greeting: {
    color: "#fff",
    fontSize: 21,
    fontWeight: "700",
    letterSpacing: -0.4,
    ...shadow,
  },
  bellDot: {
    position: "absolute",
    top: 11,
    right: 12,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.yellow,
  },
  hero: { paddingHorizontal: 20, paddingTop: 46, paddingBottom: 54 },
  heroLabel: { color: "rgba(255,255,255,0.9)", fontSize: 14, fontWeight: "600", ...shadow },
  heroValue: {
    color: "#fff",
    fontSize: 58,
    fontWeight: "800",
    letterSpacing: -2.2,
    marginTop: 3,
    ...shadow,
  },
  heroUnit: { fontSize: 27, fontWeight: "700" },
  liveRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#8DE19B" },
  liveDotOffline: { backgroundColor: "#F4A09A" },
  liveText: { color: "rgba(255,255,255,0.82)", fontSize: 12, marginLeft: 7, ...shadow },
  content: { paddingHorizontal: 16, gap: 12 },
  todayCard: { padding: 18 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: "700" },
  cardDate: { color: colors.muted, fontSize: 12 },
  dailyRow: { flexDirection: "row", alignItems: "stretch", marginTop: 20 },
  dailyMetric: { flex: 1 },
  metricIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  dailyLabel: { color: "#5F5B53", fontSize: 12, marginBottom: 5 },
  dailyValue: { color: colors.ink, fontSize: 28, fontWeight: "800", letterSpacing: -0.8 },
  dailyUnit: { color: "#666158", fontSize: 14, fontWeight: "600" },
  metricDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginHorizontal: 16 },
  flowCard: { padding: 18 },
  flowRow: { flexDirection: "row", marginTop: 18, marginBottom: 10 },
  flowMetric: { flex: 1 },
  flowValue: { color: colors.ink, fontSize: 16, fontWeight: "700", marginTop: 9 },
  flowLabel: { color: colors.muted, fontSize: 11, marginTop: 2 },
  statusCard: {
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusText: { color: colors.muted, fontSize: 12, marginTop: 6 },
  battery: { alignItems: "flex-end" },
  batteryValue: { color: colors.ink, fontSize: 20, fontWeight: "800", marginTop: 3 },
  batteryLabel: { color: colors.muted, fontSize: 11 },
  offline: { color: "#FFD3CE", fontSize: 13, textAlign: "center", ...shadow },
});
