import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  View,
  Text,
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Pressable,
  ImageBackground,
  useWindowDimensions,
  Switch,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { colors } from "../theme";
import { sunTimesForDate, useCurrentBackground } from "../background";
import { useDailyEnergy, useEnergySeries, useReadings } from "../api";
import { useProfile } from "../profile";
import {
  chargePower,
  usedPower,
  batteryVoltage,
  batteryCurrent,
  batteryPower,
  sumBy,
  kw,
} from "../metrics";
import GlassCard from "../components/GlassCard";
import LiveStat from "../components/LiveStat";
import BatteryInfoSheet from "../components/BatteryInfoSheet";
import LineChart from "../components/LineChart";

const glass = isLiquidGlassAvailable();

// Estimate a 0..1 charge level from a pack voltage, choosing the range from the
// nominal system voltage (12V / 24V / 48V LiFePO4).
function batteryFill(v) {
  if (!v) return 0;
  let min = 40;
  let max = 58.4;
  if (v < 20) {
    min = 10;
    max = 14.6;
  } else if (v < 40) {
    min = 20;
    max = 29.2;
  }
  return Math.max(0, Math.min(1, (v - min) / (max - min)));
}

// Charge-level gradient (top → bottom): red when low, amber mid, green when full.
function fillGradient(fill) {
  if (fill < 0.2) return ["#FF6B6B", "#EF4444"];
  if (fill < 0.45) return ["#FF9A5A", "#FF7A3C"];
  if (fill < 0.75) return ["#FCE36B", "#F6D03B"];
  return ["#5BE584", "#34C759"];
}

const BATTERY_H = 66;
const BATTERY_W = 40;
const BATTERY_CAP_W = 16;
const BATTERY_CAP_H = 5;
const PARTICLE_COUNT = 6;
const ENERGY_CHART_HEIGHT = 188;

// Particles drifting inside the filled part of the battery: up while charging
// (+A), down while discharging (-A). `direction` is +1 (up) or -1 (down);
// `height` is the colored region's height in px.
function Particles({ direction, height }) {
  const dots = useRef(
    Array.from({ length: PARTICLE_COUNT }, () => ({
      anim: new Animated.Value(0),
      x: 4 + Math.random() * (BATTERY_W - 12),
      size: 3 + Math.random() * 2.5,
      duration: 1500 + Math.random() * 1500,
    }))
  ).current;

  useEffect(() => {
    const loops = dots.map((d) =>
      Animated.loop(
        Animated.timing(d.anim, {
          toValue: 1,
          duration: d.duration,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      )
    );
    const timers = dots.map((d, i) =>
      setTimeout(() => loops[i].start(), Math.random() * d.duration)
    );
    return () => {
      timers.forEach(clearTimeout);
      loops.forEach((l) => l.stop());
    };
  }, [direction, height]);

  return (
    <View style={[styles.particleLayer, { height }]} pointerEvents="none">
      {dots.map((d, i) => {
        const from = direction > 0 ? height : -d.size;
        const to = direction > 0 ? -d.size : height;
        return (
          <Animated.View
            key={i}
            style={{
              position: "absolute",
              left: d.x,
              width: d.size,
              height: d.size,
              borderRadius: d.size / 2,
              backgroundColor: "rgba(255,255,255,0.9)",
              opacity: d.anim.interpolate({
                inputRange: [0, 0.15, 0.85, 1],
                outputRange: [0, 1, 1, 0],
              }),
              transform: [
                { translateY: d.anim.interpolate({ inputRange: [0, 1], outputRange: [from, to] }) },
              ],
            }}
          />
        );
      })}
    </View>
  );
}

// A minimal vertical bar that fills from the bottom; the fill is a gradient whose
// color varies with voltage. Particles drift up/down inside based on current flow.
function BatteryBar({ voltage, current, online, label }) {
  const fill = batteryFill(voltage);
  const gradient = online
    ? fillGradient(fill)
    : ["rgba(255,255,255,0.28)", "rgba(255,255,255,0.18)"];
  const direction = current > 0.05 ? 1 : current < -0.05 ? -1 : 0;
  const fillPx = Math.round(fill * BATTERY_H);
  return (
    <View style={styles.batteryUnit}>
      <View style={styles.batteryCap} />
      <View style={styles.batteryBody}>
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[styles.batteryFill, { height: fillPx }]}
        />
        {online && direction !== 0 && fillPx > 6 ? (
          <Particles direction={direction} height={fillPx} />
        ) : null}
        <Text style={styles.batteryIndexLabel}>{label}</Text>
      </View>
    </View>
  );
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

function RangeToggle({ value, onChange }) {
  return (
    <View style={styles.rangeSwitchRow}>
      <Text style={styles.rangeSwitchText}>{value === "hour" ? "Hour" : "Day"}</Text>
      <Switch
        value={value === "hour"}
        onValueChange={(enabled) => onChange(enabled ? "hour" : "day")}
        trackColor={{ false: colors.cardAlt, true: colors.yellowDeep }}
        thumbColor={colors.white}
        ios_backgroundColor={colors.cardAlt}
      />
    </View>
  );
}

function GraphSummaryHeader({ title, value, dateText, range, onRangeChange }) {
  return (
    <View style={styles.graphSummaryHeader}>
      <View style={styles.graphSummaryValue}>
        <Text style={styles.graphSummaryTitle}>{title}</Text>
        <Text style={styles.dailyValue}>
          {value.toFixed(2)} <Text style={styles.dailyUnit}>kWh</Text>
        </Text>
      </View>
      <View style={styles.graphSummaryControls}>
        <Text style={styles.cardDate}>{dateText}</Text>
        <RangeToggle value={range} onChange={onRangeChange} />
      </View>
    </View>
  );
}

// Keep only points within [start, end], plus the nearest neighbour on each side
// so the drawn line enters and exits the viewport edges correctly.
function clipSeries(points, start, end) {
  const inside = [];
  let before = null;
  let after = null;
  for (const point of points) {
    if (point.t < start) before = point;
    else if (point.t > end) {
      after = point;
      break;
    } else inside.push(point);
  }
  return [...(before ? [before] : []), ...inside, ...(after ? [after] : [])];
}

function LiveEnergyChart({
  value,
  unit = "kW",
  data,
  color,
  fillId,
  markers,
  windowStart,
  windowEnd,
  range,
  viewportWidth,
  onScrubStart,
  onScrubEnd,
}) {
  // Virtual scroll position (0…chartWidth) of the centered time. A native
  // horizontal ScrollView drives the scroll (so it gets native momentum/fling
  // and feels smooth); the chart is drawn behind it in a fixed viewport-sized
  // SVG that follows the offset. `chartWidth` sets the hourly zoom (~1h/screen).
  const chartWidth = range === "hour" ? viewportWidth * 24 : viewportWidth;
  const [hourScrollX, setHourScrollX] = useState(0);
  const scrollRef = useRef(null);

  // Position the hour view at "now" when it opens.
  useEffect(() => {
    if (range === "day") {
      scrollRef.current?.scrollTo({ x: 0, animated: false });
      setHourScrollX(0);
      return;
    }
    const span = Math.max(1, windowEnd - windowStart);
    const nowRatio = Math.max(0, Math.min(1, (Date.now() - windowStart) / span));
    const targetX = nowRatio * chartWidth;
    // Defer so the ScrollView has laid out its content before we scroll it.
    const id = setTimeout(() => {
      scrollRef.current?.scrollTo({ x: targetX, animated: false });
      setHourScrollX(targetX);
    }, 0);
    return () => clearTimeout(id);
  }, [chartWidth, range, windowEnd, windowStart]);

  const onHourScroll = (event) => setHourScrollX(event.nativeEvent.contentOffset.x);

  const chart = useMemo(() => (
    <LineChart
      data={data}
      height={ENERGY_CHART_HEIGHT}
      color={color}
      fillId={fillId}
      timeSpan="today"
      valueLabel={`${value}${unit}`}
      markers={markers}
      windowStart={windowStart}
      windowEnd={windowEnd}
      width={chartWidth}
      tickMode={range === "hour" ? "hour" : "day"}
      showCursor={range !== "hour"}
      onScrubStart={onScrubStart}
      onScrubEnd={onScrubEnd}
    />
  ), [
    chartWidth,
    color,
    data,
    fillId,
    markers,
    onScrubEnd,
    onScrubStart,
    unit,
    value,
    windowEnd,
    windowStart,
  ]);
  // The hour graph is one viewport-sized SVG showing the slice currently under
  // the cursor; it pans as `hourScrollX` changes. A fixed Y-scale shared with
  // the cursor dot keeps the line height stable while scrolling.
  const hourMax = Math.max(1, ...data.map((point) => Number(point.value) || 0)) * 1.14;
  const hourSpan = Math.max(1, windowEnd - windowStart);
  const visibleStart =
    windowStart + ((hourScrollX - viewportWidth / 2) / chartWidth) * hourSpan;
  const visibleEnd =
    windowStart + ((hourScrollX + viewportWidth / 2) / chartWidth) * hourSpan;
  const hourChart = (
    <LineChart
      data={clipSeries(data, visibleStart, visibleEnd)}
      height={ENERGY_CHART_HEIGHT}
      color={color}
      fillId={`${fillId}Hour`}
      markers={markers}
      windowStart={visibleStart}
      windowEnd={visibleEnd}
      width={viewportWidth}
      tickMode="hour"
      showCursor={false}
      centerCursor
      maxValue={hourMax}
    />
  );

  return (
    <View style={styles.energyChart}>
      <View style={styles.chartViewport}>
        {range === "hour" ? (
          <>
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {hourChart}
            </View>
            <ScrollView
              ref={scrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              decelerationRate="normal"
              onScroll={onHourScroll}
              onScrollBeginDrag={onScrubStart}
              onScrollEndDrag={onScrubEnd}
              onMomentumScrollEnd={onScrubEnd}
              style={styles.chartScroller}
              contentContainerStyle={{
                width: chartWidth + viewportWidth,
                height: ENERGY_CHART_HEIGHT,
              }}
            >
              <View
                style={{ width: chartWidth + viewportWidth, height: ENERGY_CHART_HEIGHT }}
              />
            </ScrollView>
          </>
        ) : (
          chart
        )}
      </View>
    </View>
  );
}

function withLivePoint(points, key, value, start, end) {
  const today = new Date();
  const fallbackStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const windowStart = start ?? fallbackStart;
  const windowEnd = end ?? fallbackStart + 24 * 60 * 60 * 1000;
  const now = Date.now();
  const base = points
    .filter((point) => point.t >= windowStart && point.t < windowEnd)
    .map((point) => ({ t: point.t, value: Number(point[key]) || 0 }));
  const live = { t: now, value: Math.max(0, Math.round(value)) };
  const last = base[base.length - 1];
  if (!last || now - last.t > 15 * 1000) return [...base, live];
  return [...base.slice(0, -1), live];
}

export default function HomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const { name } = useProfile();
  const { readings, connected } = useReadings();
  const daily = useDailyEnergy();
  const storedSeries = useEnergySeries();
  const background = useCurrentBackground();
  const { width } = useWindowDimensions();
  const chartViewportWidth = Math.max(280, width - 68);

  // Scale the live-stat font to the device width (locked against OS font scaling).
  const statFont = Math.round(34 * Math.min(Math.max(width / 390, 0.82), 1.3));
  const statValueStyle = [styles.heroValue, { fontSize: statFont }];
  const statUnitStyle = [styles.heroUnit, { fontSize: statFont }];
  const [selectedBatteryId, setSelectedBatteryId] = useState(null);
  const [solarRange, setSolarRange] = useState("hour");
  const [loadRange, setLoadRange] = useState("hour");
  const [graphScrubbing, setGraphScrubbing] = useState(false);

  // Solar production is the inverters' PV input only; BMS charge power must not be
  // counted here or the live total reads higher than what the inverters produce.
  const production = sumBy(
    readings.filter((reading) => reading.kind !== "bms"),
    chargePower
  );
  const load = sumBy(readings, usedPower);
  const { sunrise, sunset } = sunTimesForDate();
  const nowMs = Date.now();
  const dayStart = new Date(nowMs).setHours(0, 0, 0, 0);
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const solarWindowStart = dayStart;
  const solarWindowEnd = dayEnd;
  const loadWindowStart = dayStart;
  const loadWindowEnd = dayEnd;
  const sunMarkers = [
    { t: dayStart + sunrise * 60 * 1000, key: "sunrise", icon: "sunny-outline" },
    { t: dayStart + sunset * 60 * 1000, key: "sunset", icon: "moon-outline" },
  ];
  const todayDate = new Date().toLocaleDateString(
    i18n.resolvedLanguage === "ro" ? "ro-RO" : "en-US",
    {
      day: "numeric",
      month: "short",
    }
  );
  const solarChartData = withLivePoint(
    storedSeries.points,
    "solar_w",
    production,
    solarWindowStart,
    solarWindowEnd
  );
  const loadChartData = withLivePoint(
    storedSeries.points,
    "load_w",
    load,
    loadWindowStart,
    loadWindowEnd
  );
  const batteries = readings.filter((reading) => reading.kind === "bms");
  const onlineBatteries = batteries.filter((reading) => reading.online);
  const batteryAmps = onlineBatteries.reduce(
    (sum, reading) => sum + batteryCurrent(reading),
    0
  );
  const batteryWatts = onlineBatteries.reduce(
    (sum, reading) => sum + batteryPower(reading),
    0
  );

  // Track the opened battery by id so the sheet keeps showing live readings.
  const selectedBattery =
    batteries.find((reading) => reading.device_id === selectedBatteryId) || null;

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
        scrollEnabled={!graphScrubbing}
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingBottom: 150,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.hello}>
              {t("home.hello", { name: name.trim() || "James" })}
            </Text>
            <Text style={styles.greeting}>{t(`home.${background.key}`)}</Text>
          </View>
          <Pressable onPress={() => navigation.navigate("Settings")} hitSlop={8}>
            <HeaderGlass>
              <Ionicons name="notifications-outline" size={20} color="#fff" />
              <View style={styles.bellDot} />
            </HeaderGlass>
          </Pressable>
        </View>

        <View style={styles.hero}>
          <GlassCard
            style={styles.statCard}
            glassStyle="clear"
            tint="rgba(0,0,0,0.2)"
            blur={8}
            border="rgba(255,255,255,0.45)"
          >
            <Text style={styles.heroLabel}>{t("energy.solar")}</Text>
            <LiveStat value={kw(production)} valueStyle={statValueStyle} unitStyle={statUnitStyle} />
          </GlassCard>
          <GlassCard
            style={styles.statCard}
            glassStyle="clear"
            tint="rgba(0,0,0,0.2)"
            blur={8}
            border="rgba(255,255,255,0.45)"
          >
            <Text style={styles.heroLabel}>{t("home.load")}</Text>
            <LiveStat value={kw(load)} valueStyle={statValueStyle} unitStyle={statUnitStyle} />
          </GlassCard>
        </View>

        <View style={styles.content}>
          {batteries.length > 0 && (
            <GlassCard
              style={styles.batteryCard}
              glassStyle="clear"
              tint="rgba(0,0,0,0.2)"
              blur={8}
              border="rgba(255,255,255,0.45)"
            >
              <View>
                <Text style={styles.heroLabel}>{t("home.batterySystem")}</Text>
                <View style={styles.batteryStats}>
                  <View style={styles.batteryStatColumn}>
                    <LiveStat
                      value={batteryAmps.toFixed(1)}
                      unit="A"
                      valueStyle={statValueStyle}
                      unitStyle={statUnitStyle}
                    />
                  </View>
                  <View style={styles.batteryStatColumn}>
                    <LiveStat
                      value={String(Math.round(batteryWatts))}
                      unit="W"
                      valueStyle={statValueStyle}
                      unitStyle={statUnitStyle}
                    />
                  </View>
                </View>
              </View>
              <View style={styles.batteryRow}>
                {batteries.map((reading, index) => (
                  <Pressable
                    key={reading.device_id}
                    style={({ pressed }) => [
                      styles.batteryItem,
                      pressed && styles.batteryItemPressed,
                    ]}
                    onPress={() => setSelectedBatteryId(reading.device_id)}
                    accessibilityRole="button"
                    accessibilityLabel={t("device.open", {
                      name: reading.device_name || reading.device_id,
                    })}
                  >
                    <BatteryBar
                      voltage={batteryVoltage(reading)}
                      current={batteryCurrent(reading)}
                      online={reading.online}
                      label={`#${index + 1}`}
                    />
                    <View style={styles.batteryVoltageReadout}>
                      <LiveStat
                        value={batteryVoltage(reading).toFixed(1)}
                        unit="V"
                        valueStyle={styles.batteryVoltValue}
                        unitStyle={styles.batteryVoltUnit}
                        gap={2}
                      />
                    </View>
                    <View style={styles.batteryAmperageReadout}>
                      <LiveStat
                        value={batteryCurrent(reading).toFixed(1)}
                        unit="A"
                        valueStyle={styles.batteryAmpValue}
                        unitStyle={styles.batteryAmpUnit}
                        gap={2}
                      />
                    </View>
                  </Pressable>
                ))}
              </View>
            </GlassCard>
          )}

          <GlassCard
            style={styles.todayCard}
            glassStyle="clear"
            tint="rgba(0,0,0,0.2)"
            blur={8}
            border="rgba(255,255,255,0.45)"
          >
            <GraphSummaryHeader
              title={t("energy.solar")}
              value={daily.solar_kwh}
              dateText={todayDate}
              range={solarRange}
              onRangeChange={setSolarRange}
            />
            <LiveEnergyChart
              value={kw(production)}
              data={solarChartData}
              color={colors.yellow}
              fillId="solarTodayFill"
              markers={sunMarkers}
              windowStart={solarWindowStart}
              windowEnd={solarWindowEnd}
              range={solarRange}
              viewportWidth={chartViewportWidth}
              onScrubStart={() => setGraphScrubbing(true)}
              onScrubEnd={() => setGraphScrubbing(false)}
            />
          </GlassCard>

          <GlassCard
            style={styles.loadChartCard}
            glassStyle="clear"
            tint="rgba(0,0,0,0.2)"
            blur={8}
            border="rgba(255,255,255,0.45)"
          >
            <GraphSummaryHeader
              title={t("home.load")}
              value={daily.consumption_kwh}
              dateText={todayDate}
              range={loadRange}
              onRangeChange={setLoadRange}
            />
            <LiveEnergyChart
              value={kw(load)}
              data={loadChartData}
              color="#FFD4BE"
              fillId="loadTodayFill"
              markers={sunMarkers}
              windowStart={loadWindowStart}
              windowEnd={loadWindowEnd}
              range={loadRange}
              viewportWidth={chartViewportWidth}
              onScrubStart={() => setGraphScrubbing(true)}
              onScrubEnd={() => setGraphScrubbing(false)}
            />
          </GlassCard>

          {!connected && <Text style={styles.offline}>{t("home.disconnected")}</Text>}
        </View>
      </ScrollView>

      {/* Top fade-to-blur, mirroring the TabBar's bottom edge effect. */}
      <MaskedView
        pointerEvents="none"
        style={styles.topBlur}
        maskElement={
          <LinearGradient
            colors={["#000", "rgba(0,0,0,0.35)", "transparent"]}
            locations={[0, 0.58, 1]}
            style={StyleSheet.absoluteFill}
          />
        }
      >
        <BlurView intensity={42} tint="default" style={StyleSheet.absoluteFill} />
      </MaskedView>

      <BatteryInfoSheet
        reading={selectedBattery}
        onClose={() => setSelectedBatteryId(null)}
      />
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
  topBlur: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 100,
  },
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
  headerCopy: { flex: 1 },
  hello: { color: "rgba(255,255,255,0.88)", fontSize: 18, fontWeight: "600", ...shadow },
  greeting: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "300",
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
  hero: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
  },
  statCard: { flex: 1, padding: 18, alignItems: "center" },
  heroLabel: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 30,
    fontWeight: "200",
    marginBottom: 6,
    alignSelf: "flex-start",
    textAlign: "left",
    ...shadow,
  },
  heroValue: {
    color: "#fff",
    fontSize: 44,
    fontWeight: "800",
    letterSpacing: -1.6,
    ...shadow,
  },
  heroUnit: { color: "#fff", fontSize: 44, fontWeight: "300", ...shadow },
  content: { paddingHorizontal: 16, gap: 12 },
  batteryCard: { padding: 18, borderWidth: 0 },
  batteryLight: { color: colors.white, ...shadow },
  batteryStats: { flexDirection: "row", alignItems: "center", paddingTop: 2 },
  batteryStatColumn: { flex: 1, alignItems: "center" },
  batteryRow: { flexDirection: "row", paddingTop: 20 },
  batteryItem: { flex: 1, alignItems: "center", paddingHorizontal: 4 },
  batteryItemPressed: { opacity: 0.6 },
  batteryUnit: { alignItems: "center" },
  batteryCap: {
    width: BATTERY_CAP_W,
    height: BATTERY_CAP_H,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.55)",
    marginBottom: -1,
  },
  batteryBody: {
    width: BATTERY_W,
    height: BATTERY_H,
    borderRadius: 9,
    borderCurve: "continuous",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.55)",
    overflow: "hidden",
    justifyContent: "flex-end",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  batteryFill: { width: "100%" },
  batteryIndexLabel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 7,
    color: colors.white,
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
    ...shadow,
  },
  particleLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
  },
  batteryVoltageReadout: { marginTop: 8, alignItems: "center" },
  batteryAmperageReadout: { marginTop: 7, alignItems: "center" },
  batteryVoltValue: {
    color: colors.white,
    fontSize: 15,
    fontWeight: "700",
    ...shadow,
  },
  batteryVoltUnit: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 15,
    fontWeight: "500",
    ...shadow,
  },
  batteryAmpValue: {
    color: "rgba(255,255,255,0.86)",
    fontSize: 13,
    fontWeight: "700",
    ...shadow,
  },
  batteryAmpUnit: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    fontWeight: "500",
    ...shadow,
  },
  todayCard: { padding: 18, borderWidth: 0 },
  loadChartCard: { padding: 18, borderWidth: 0 },
  graphSummaryHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  graphSummaryValue: { flex: 1 },
  graphSummaryControls: { alignItems: "flex-end", gap: 8 },
  rangeSwitchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    minHeight: 31,
  },
  rangeSwitchText: { color: "rgba(255,255,255,0.86)", fontSize: 12, fontWeight: "800", ...shadow },
  cardDate: { color: "rgba(255,255,255,0.86)", fontSize: 16, fontWeight: "700", ...shadow },
  graphSummaryTitle: { color: colors.white, fontSize: 17, fontWeight: "800", marginBottom: 2, ...shadow },
  dailyValue: { color: colors.white, fontSize: 30, fontWeight: "800", letterSpacing: -0.8, ...shadow },
  dailyUnit: { color: "rgba(255,255,255,0.78)", fontSize: 15, fontWeight: "700", ...shadow },
  energyChart: { marginTop: 6 },
  chartViewport: {
    height: ENERGY_CHART_HEIGHT,
    overflow: "hidden",
    position: "relative",
  },
  chartScroller: { marginHorizontal: -2 },
  offline: { color: "#FFD3CE", fontSize: 13, textAlign: "center", ...shadow },
});
