import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { colors, radius } from "../theme";
import { useLive, useTimeSeries } from "../api";
import { kw } from "../metrics";
import LineChart from "../components/LineChart";
import TimeGradientBackground from "../components/TimeGradientBackground";

export default function AnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const live = useLive();
  const series = useTimeSeries(
    () => ({
      charged: Math.round(live.solar_w),
      used: Math.round(live.load_w),
    }),
    { maxPoints: 30 }
  );

  const charged = series.map((p) => p.charged);
  const used = series.map((p) => p.used);
  const latest = series[series.length - 1] || { charged: 0, used: 0 };

  return (
    <TimeGradientBackground>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 140, paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>{t("analytics.title")}</Text>
        <Text style={styles.sub}>{t("analytics.liveSession")}</Text>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>{t("analytics.solarProduction")}</Text>
          <Text style={styles.cardValue}>
            {kw(latest.charged)} <Text style={styles.cardUnit}>kW</Text>
          </Text>
          <LineChart data={charged} color={colors.yellowDeep} />
        </View>

        <View style={[styles.card, { marginTop: 14 }]}>
          <Text style={styles.cardLabel}>{t("analytics.energyUsage")}</Text>
          <Text style={styles.cardValue}>
            {kw(latest.used)} <Text style={styles.cardUnit}>kW</Text>
          </Text>
          <LineChart data={used} color={colors.orange} />
        </View>
      </ScrollView>
    </TimeGradientBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "transparent" },
  title: { fontSize: 28, fontWeight: "800", color: colors.ink, letterSpacing: -0.6 },
  sub: { color: colors.muted, fontSize: 13, marginTop: 2, marginBottom: 18 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
  },
  cardLabel: { color: colors.muted, fontSize: 14 },
  cardValue: { color: colors.ink, fontSize: 30, fontWeight: "800", letterSpacing: -1, marginVertical: 6 },
  cardUnit: { fontSize: 18, fontWeight: "700" },
});
