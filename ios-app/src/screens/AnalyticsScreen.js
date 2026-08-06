import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
  useWindowDimensions,
} from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { colors, darkPage, radius } from "../theme";
import { useEnergyHistory } from "../api";
import GlassCard from "../components/GlassCard";
import GlassSegments from "../components/GlassSegments";
import PeriodRuler from "../components/PeriodRuler";
import StatIcon from "../components/StatIcon";

// How far back to pull. The backend clamps this to its retention window.
const HISTORY_DAYS = 365;

// Fixed backdrop: this page deliberately ignores the time-of-day gradient the rest of
// the app uses, so the white readings sit on a constant, slightly deeper ground rather
// than drifting from pale morning to dark night.
const PAGE_GRADIENT = darkPage;
// Everything on this page is white at some opacity, so the tones live here rather
// than being spelled out per style.
const TEXT = colors.white;
const TEXT_DIM = "rgba(255,255,255,0.72)";
const TEXT_FAINT = "rgba(255,255,255,0.55)";

const SOLAR = "#7FB98F";
// Swapped: load takes the blue, grid takes the pink.
const LOAD = "#7FA6CE";
const GRID = "#D98BA4";

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

function formatMonth(key, locale, withYear = true) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(
    locale,
    withYear ? { month: "short", year: "numeric" } : { month: "short" }
  );
}

// A row of selectable pills. Scrolls horizontally so a long history still fits.
function PeriodPicker({ options, value, onChange }) {
  if (options.length < 2) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.pickerRow}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.chip, on && styles.chipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// One metric's bar. The filled portion is clear Liquid Glass tinted to the metric,
// so it reads as a lens over the page rather than a painted block. It grows from zero
// when the row appears, and eases to any new length after that (a percentage width is
// not a native-driver property, so this runs on the JS driver).
function Bar({ value, peak, color, icon, delay = 0 }) {
  const pct = peak > 0 ? Math.max((value / peak) * 100, value > 0 ? 3 : 0) : 0;
  const grow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(grow, {
      toValue: pct,
      duration: 560,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [pct, delay, grow]);

  const width = grow.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
    extrapolate: "clamp",
  });

  return (
    <View style={styles.barTrack}>
      {pct > 0 && (
        <Animated.View style={[styles.bar, { width }]}>
          <GlassCard
            style={StyleSheet.absoluteFill}
            radius={radius.pill}
            glassStyle="clear"
            tint={color}
            border={color}
          />
        </Animated.View>
      )}
      <View style={styles.barIcon} pointerEvents="none">
        <StatIcon name={icon} size={19} color={colors.white} style={styles.barIconGlyph} />
      </View>
      <Text style={styles.barValue}>
        {value.toFixed(1)} <Text style={styles.barUnit}>kWh</Text>
      </Text>
    </View>
  );
}

// `index` staggers the reveal down the list so the rows cascade rather than all
// snapping out at once.
function PeriodRow({ label, solar, load, grid, peak, index }) {
  const delay = Math.min(index * 45, 360);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.bars}>
        <Bar value={solar} peak={peak} color={SOLAR} icon="solar" delay={delay} />
        <Bar value={load} peak={peak} color={LOAD} icon="load" delay={delay} />
        <Bar value={grid} peak={peak} color={GRID} icon="grid" delay={delay} />
      </View>
    </View>
  );
}

function TotalTile({ icon, color, label, value }) {
  return (
    <View style={styles.totalTile}>
      <View style={styles.totalHead}>
        <StatIcon name={icon} size={24} color={color} style={styles.totalIcon} />
        {/* Three tiles across leaves little room, so the figure shrinks rather than
            wrapping or clipping on a big day. */}
        <Text
          style={styles.totalValue}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {value.toFixed(1)} <Text style={styles.totalUnit}>kWh</Text>
        </Text>
      </View>
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
  // Null means "follow the data" — the newest period is used until one is picked,
  // and a stale pick that the data no longer covers falls back the same way.
  const [pickedMonth, setPickedMonth] = useState(null);
  const [pickedYear, setPickedYear] = useState(null);
  const history = useEnergyHistory(HISTORY_DAYS);
  const { width } = useWindowDimensions();
  const listRef = useRef(null);

  const days = history.days || [];

  const months = useMemo(
    () => [...new Set(days.map((d) => String(d.date).slice(0, 7)))].sort(),
    [days]
  );
  const years = useMemo(
    () => [...new Set(days.map((d) => String(d.date).slice(0, 4)))].sort(),
    [days]
  );

  const month =
    pickedMonth && months.includes(pickedMonth) ? pickedMonth : months[months.length - 1];
  const year =
    pickedYear && years.includes(pickedYear) ? pickedYear : years[years.length - 1];

  const rows = useMemo(() => {
    if (mode === "monthly") {
      return groupByMonth(days)
        .filter((m) => m.key.slice(0, 4) === year)
        .map((m) => ({
          key: m.key,
          label: formatMonth(m.key, locale, false),
          solar: m.solar_kwh,
          load: m.consumption_kwh,
          grid: m.grid_kwh,
        }));
    }
    return days
      .filter((d) => String(d.date).slice(0, 7) === month)
      .map((d) => ({
        key: d.date,
        label: formatDay(d.date, locale),
        solar: d.solar_kwh || 0,
        load: d.consumption_kwh || 0,
        grid: d.grid_kwh || 0,
      }));
  }, [days, mode, month, year, locale]);

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

  // A new period is a new set of results, so start it at the top rather than leaving
  // the reader part-way down the previous month's list.
  useEffect(() => {
    listRef.current?.scrollTo({ y: 0, animated: false });
  }, [mode, month, year]);

  const empty = !history.loading && rows.length === 0;

  return (
    <View style={styles.page}>
      {/* This page keeps a dark ground whatever the hour, so the status bar is
          always light here rather than following the time-of-day style. */}
      <StatusBar style="light" />
      <LinearGradient
        colors={PAGE_GRADIENT}
        locations={[0, 0.48, 1]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* The page itself does not scroll. Everything above the list is pinned; only
          the bar rows move, inside their own scroller below. */}
      <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
        <View style={styles.static}>
        <Text style={styles.title}>{t("analytics.title")}</Text>
        <Text style={styles.sub}>{t("analytics.history")}</Text>

        <GlassSegments
          style={styles.segments}
          value={mode}
          onChange={setMode}
          options={[
            { value: "daily", label: t("analytics.daily") },
            { value: "monthly", label: t("analytics.monthly") },
          ]}
        />

        {/* Daily drills into one month, on a centred ruler; monthly drills into a
            year, where there are only ever a couple of options. */}
        {mode === "daily" ? (
          <PeriodRuler
            items={months.map((key) => ({
              value: key,
              label: formatMonth(key, locale, false),
              sublabel: key.slice(0, 4),
            }))}
            value={month}
            onChange={setPickedMonth}
            // The strip bleeds past the page gutters to the screen edges, so it
            // centres against the full screen width, not the padded content width.
            viewportWidth={width}
          />
        ) : (
          <PeriodPicker
            options={years.map((key) => ({ value: key, label: key }))}
            value={year}
            onChange={setPickedYear}
          />
        )}

        {/* Totals for whatever is selected: the month in daily view, the year in
            monthly view. Same tile shape either way. */}
        <View style={styles.totals}>
          <TotalTile
            icon="solar"
            color={SOLAR}
            label={t("energy.solar")}
            value={totals.solar}
          />
          <TotalTile
            icon="load"
            color={LOAD}
            label={t("analytics.load")}
            value={totals.load}
          />
          <TotalTile
            icon="grid"
            color={GRID}
            label={t("analytics.gridConsumption")}
            value={totals.grid}
          />
        </View>
        </View>

        {/* Rows dissolve into the pinned chrome instead of cutting off against it. */}
        <MaskedView
          style={styles.list}
          maskElement={
            // The mask has to cover the whole scroller — anything it does not paint is
            // masked away entirely. So: a short fade band, then solid for the rest.
            <View style={StyleSheet.absoluteFill}>
              <LinearGradient
                colors={["transparent", "#000"]}
                style={styles.listMaskFade}
              />
              <View style={styles.listMaskBody} />
            </View>
          }
        >
        <ScrollView
          ref={listRef}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
        <View style={styles.card}>
          {history.failed && rows.length === 0 ? (
            <Text style={styles.notice}>{t("analytics.historyFailed")}</Text>
          ) : empty ? (
            <Text style={styles.notice}>{t("analytics.noHistory")}</Text>
          ) : (
            ordered.map((row, i) => (
              <PeriodRow
                key={row.key}
                index={i}
                label={row.label}
                solar={row.solar}
                load={row.load}
                grid={row.grid}
                peak={peak}
              />
            ))
          )}
        </View>

        </ScrollView>
        </MaskedView>
      </View>
    </View>
  );
}

// Same treatment the home screen uses for white text over variable backdrops.
const textShadow = {
  textShadowColor: "rgba(0,0,0,0.32)",
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 6,
};

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: PAGE_GRADIENT[1] },
  screen: { flex: 1, backgroundColor: "transparent" },
  // Pinned chrome: title, today's tiles, the mode switch and the period selector.
  static: { paddingHorizontal: 16 },
  // The only vertical scroller on the page. `flex: 1` lets it take whatever height
  // is left under the pinned block.
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 140 },
  // Only the top edge fades; a fixed band keeps the fade the same depth whatever the
  // list height, and the solid body below it leaves the rest fully opaque.
  listMaskFade: { height: 34 },
  listMaskBody: { flex: 1, backgroundColor: "#000" },
  title: { fontSize: 28, fontWeight: "800", color: TEXT, letterSpacing: -0.6 },
  sub: { color: TEXT_FAINT, fontSize: 13, marginTop: 2, marginBottom: 16 },
  segments: { marginBottom: 16 },
  pickerRow: { flexDirection: "row", gap: 8, paddingBottom: 14 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipOn: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderColor: "rgba(255,255,255,0.55)",
  },
  chipText: { color: TEXT_FAINT, fontSize: 14, fontWeight: "600" },
  chipTextOn: { color: TEXT },
  totals: { flexDirection: "row", gap: 10, marginTop: 4, marginBottom: 16 },
  // Cards on this page carry no fill and no stroke — the time-of-day gradient runs
  // straight through, and spacing alone separates them.
  totalTile: {
    flex: 1,
    borderRadius: radius.md,
    borderCurve: "continuous",
    padding: 12,
  },
  totalHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  // StatIcon carries its own bottom margin for the stacked layout on the devices
  // page; on one line it needs none.
  totalIcon: { marginBottom: 0 },
  totalValue: {
    flexShrink: 1,
    color: TEXT,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  totalUnit: { fontSize: 11, fontWeight: "700", color: TEXT_DIM },
  totalLabel: { color: TEXT, fontSize: 14, fontWeight: "600", marginTop: 6 },
  card: {
    borderRadius: radius.lg,
    borderCurve: "continuous",
    padding: 16,
  },
  row: { marginBottom: 18 },
  rowLabel: {
    color: TEXT,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 8,
    ...textShadow,
  },
  bars: { gap: 7 },
  barTrack: {
    height: 42,
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.09)",
    borderRadius: radius.pill,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  bar: { position: "absolute", left: 0, top: 0, bottom: 0 },
  // White on a light page, so it carries a shadow to stay legible where the bar has
  // not filled the track behind it.
  // Pinned to the left edge of the track, over the glass fill.
  barIcon: {
    position: "absolute",
    left: 10,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  barIconGlyph: { marginBottom: 0 },
  barValue: {
    alignSelf: "flex-end",
    marginRight: 14,
    color: TEXT,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
    ...textShadow,
  },
  barUnit: {
    fontSize: 13,
    fontWeight: "700",
    color: TEXT_DIM,
    ...textShadow,
  },
  notice: { color: TEXT_DIM, fontSize: 13, textAlign: "center", paddingVertical: 12 },
});
