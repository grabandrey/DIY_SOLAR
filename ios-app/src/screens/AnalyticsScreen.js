import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { colors, radius } from "../theme";
import { useEnergyHistory } from "../api";
import StatIcon from "../components/StatIcon";
import TimeGradientBackground from "../components/TimeGradientBackground";

// How far back to pull. The backend clamps this to its retention window.
const HISTORY_DAYS = 365;
// Daily view shows a focused recent window; monthly rolls up everything fetched.
const DAILY_VISIBLE = 30;

const SOLAR = "#7FB98F";
const LOAD = "#D98BA4";
const GRID = "#7FA6CE";

// Sum the day rows into calendar months, keyed "YYYY-MM" so they sort naturally.
function groupByMonth(days) {
  const months = new Map();
  for (const day of days) {
    const key = String(day.date).slice(0, 7);
    const bucket =
      months.get(key) || { key, solar_kwh: 0, consumption_kwh: 0, grid_kwh: 0 };
    bucket.solar_kwh += day.solar_kwh || 0;
    bucket.consumption_kwh += day.consumption_kwh || 0;
    bucket.grid_kwh += day.grid_kwh || 0;
    months.set(key, bucket);
  }
  return [...months.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function formatDay(iso, locale) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
  });
}

function formatMonth(key, locale) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale, {
    month: "short",
    year: "numeric",
  });
}

// One period: its label, then a proportional bar per metric. Bars are scaled against
// the largest value across the whole visible set, so rows stay comparable.
function PeriodRow({ label, solar, load, grid, peak }) {
  const width = (value) => `${peak > 0 ? Math.max((value / peak) * 100, value > 0 ? 2 : 0) : 0}%`;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.bars}>
        <View style={styles.barTrack}>
          <View style={[styles.bar, { width: width(solar), backgroundColor: SOLAR }]} />
          <Text style={styles.barValue}>{solar.toFixed(1)}</Text>
        </View>
        <View style={styles.barTrack}>
          <View style={[styles.bar, { width: width(load), backgroundColor: LOAD }]} />
          <Text style={styles.barValue}>{load.toFixed(1)}</Text>
        </View>
        <View style={styles.barTrack}>
          <View style={[styles.bar, { width: width(grid), backgroundColor: GRID }]} />
          <Text style={styles.barValue}>{grid.toFixed(1)}</Text>
        </View>
      </View>
    </View>
  );
}

function TotalTile({ icon, color, label, value }) {
  return (
    <View style={styles.totalTile}>
      <View style={styles.totalHead}>
        {icon ? <StatIcon name={icon} size={18} color={color} /> : null}
        <View style={[styles.swatch, { backgroundColor: color }]} />
      </View>
      <Text style={styles.totalValue}>
        {value.toFixed(1)} <Text style={styles.totalUnit}>kWh</Text>
      </Text>
      <Text style={styles.totalLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export default function AnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === "ro" ? "ro-RO" : "en-US";
  const [mode, setMode] = useState("daily");
  const history = useEnergyHistory(HISTORY_DAYS);

  const days = history.days || [];

  const rows = useMemo(() => {
    if (mode === "monthly") {
      return groupByMonth(days).map((month) => ({
        key: month.key,
        label: formatMonth(month.key, locale),
        solar: month.solar_kwh,
        load: month.consumption_kwh,
        grid: month.grid_kwh,
      }));
    }
    return days.slice(-DAILY_VISIBLE).map((day) => ({
      key: day.date,
      label: formatDay(day.date, locale),
      solar: day.solar_kwh || 0,
      load: day.consumption_kwh || 0,
      grid: day.grid_kwh || 0,
    }));
  }, [days, mode, locale]);

  // Newest first for reading; the bar scale uses the same set either way.
  const ordered = useMemo(() => [...rows].reverse(), [rows]);
  const peak = useMemo(
    () => rows.reduce((max, r) => Math.max(max, r.solar, r.load, r.grid), 0),
    [rows]
  );
  const totals = useMemo(
    () =>
      rows.reduce(
        (sum, r) => ({
          solar: sum.solar + r.solar,
          load: sum.load + r.load,
          grid: sum.grid + r.grid,
        }),
        { solar: 0, load: 0, grid: 0 }
      ),
    [rows]
  );

  const empty = !history.loading && rows.length === 0;

  return (
    <TimeGradientBackground>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: 140,
          paddingHorizontal: 16,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>{t("analytics.title")}</Text>
        <Text style={styles.sub}>{t("analytics.history")}</Text>

        <View style={styles.toggle}>
          {["daily", "monthly"].map((option) => (
            <Pressable
              key={option}
              onPress={() => setMode(option)}
              style={[styles.toggleChip, mode === option && styles.toggleChipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === option }}
            >
              <Text
                style={[styles.toggleText, mode === option && styles.toggleTextOn]}
              >
                {t(`analytics.${option}`)}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.totals}>
          <TotalTile
            icon="solar"
            color={SOLAR}
            label={t("analytics.solarProduction")}
            value={totals.solar}
          />
          <TotalTile
            icon="load"
            color={LOAD}
            label={t("analytics.load")}
            value={totals.load}
          />
          <TotalTile
            color={GRID}
            label={t("analytics.gridConsumption")}
            value={totals.grid}
          />
        </View>

        <View style={styles.card}>
          {history.failed && rows.length === 0 ? (
            <Text style={styles.notice}>{t("analytics.historyFailed")}</Text>
          ) : empty ? (
            <Text style={styles.notice}>{t("analytics.noHistory")}</Text>
          ) : (
            ordered.map((row) => (
              <PeriodRow
                key={row.key}
                label={row.label}
                solar={row.solar}
                load={row.load}
                grid={row.grid}
                peak={peak}
              />
            ))
          )}
        </View>

        <Text style={styles.footnote}>{t("analytics.gridNotice")}</Text>
      </ScrollView>
    </TimeGradientBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "transparent" },
  title: { fontSize: 28, fontWeight: "800", color: colors.ink, letterSpacing: -0.6 },
  sub: { color: colors.muted, fontSize: 13, marginTop: 2, marginBottom: 16 },
  toggle: { flexDirection: "row", gap: 8, marginBottom: 16 },
  toggleChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderCurve: "continuous",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  toggleChipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  toggleText: { color: colors.muted, fontSize: 14, fontWeight: "600" },
  toggleTextOn: { color: colors.white },
  totals: { flexDirection: "row", gap: 10, marginBottom: 14 },
  totalTile: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
  },
  totalHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  swatch: { width: 8, height: 8, borderRadius: 4 },
  totalValue: { color: colors.ink, fontSize: 20, fontWeight: "800", letterSpacing: -0.6 },
  totalUnit: { fontSize: 11, fontWeight: "700", color: colors.muted },
  totalLabel: { color: colors.muted, fontSize: 11, marginTop: 2 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
  },
  row: { marginBottom: 14 },
  rowLabel: { color: colors.ink, fontSize: 13, fontWeight: "700", marginBottom: 6 },
  bars: { gap: 4 },
  barTrack: {
    height: 16,
    justifyContent: "center",
    backgroundColor: colors.cardAlt,
    borderRadius: 8,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  bar: { position: "absolute", left: 0, top: 0, bottom: 0 },
  barValue: {
    alignSelf: "flex-end",
    marginRight: 8,
    color: colors.ink,
    fontSize: 10,
    fontWeight: "700",
  },
  notice: { color: colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 12 },
  footnote: { color: colors.muted, fontSize: 11, marginTop: 12, lineHeight: 15 },
});
