import React, { useState, useRef, useEffect } from "react";
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
import {
  useDailyEnergy,
  useEnergySeries,
  useLive,
  useReadings,
} from "../api";
import { useProfile } from "../profile";
import { batteryVoltage, batteryCurrent, kw } from "../metrics";
import { useDeviceNames, resolveDeviceName } from "../deviceNames";
import { useDeviceOrder, orderReadings } from "../deviceOrder";
import GlassCard from "../components/GlassCard";
import LiveStat from "../components/LiveStat";
import BatteryInfoSheet from "../components/BatteryInfoSheet";
import LineChart from "../components/LineChart";

const glass = isLiquidGlassAvailable();

// Sage green for the solar production graph (trace + fill) and its toggle, and a
// subtle red for the load graph and its toggle — both softened a touch.
const SOLAR_GREEN = "#86C9A1";
const LOAD_RED = "#E59FB4";

const ENERGY_CHART_HEIGHT = 188;

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

// Liquid color: always green, regardless of charge level. Softer / desaturated
// tones, kept semi-transparent so they read calm, not harsh. The waves use the
// SAME hue as the main liquid at a low opacity, so they only add gentle motion
// and never form a visible separation line against the body.
function fluidColors() {
  return {
    gradient: ["rgba(91,229,132,0.4)", "rgba(52,199,89,0.48)"],
    wave: "rgba(52,199,89,0.28)",
    waveTop: "rgba(124,240,164,0.18)",
  };
}

// The green water inside a battery cell. Two large rounded squares slowly counter-
// rotate at the surface so their curved edges undulate like a wave. The fluid is
// inset from the cell walls and sits behind the glass body.
function BatteryFluid({ fill, online }) {
  const spinA = useRef(new Animated.Value(0)).current;
  const spinB = useRef(new Animated.Value(0)).current;
  // Randomized per-battery so no two cells wave in sync: each starts at a random
  // angle (phase) and runs at a slightly different speed.
  const rng = useRef({
    phaseA: Math.random() * 360,
    phaseB: Math.random() * 360,
    durA: 6000 + Math.random() * 4000,
    durB: 8000 + Math.random() * 4000,
  }).current;

  useEffect(() => {
    const loops = [
      Animated.loop(
        Animated.timing(spinA, {
          toValue: 1,
          duration: rng.durA,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ),
      Animated.loop(
        Animated.timing(spinB, {
          toValue: 1,
          duration: rng.durB,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ),
    ];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [spinA, spinB, rng]);

  // 0 and 360 align, so the loop stays seamless while the phase offset shifts where
  // each cell's wave starts.
  const rotA = spinA.interpolate({
    inputRange: [0, 1],
    outputRange: [`${rng.phaseA}deg`, `${rng.phaseA + 360}deg`],
  });
  const rotB = spinB.interpolate({
    inputRange: [0, 1],
    outputRange: [`${rng.phaseB}deg`, `${rng.phaseB - 360}deg`],
  });
  // Liquid is always green when online; muted white when offline.
  const palette = online
    ? fluidColors()
    : {
        gradient: ["rgb(200,202,205)", "rgb(176,178,182)"],
        wave: "rgba(176,178,182,0.36)",
        waveTop: "rgba(200,202,205,0.22)",
      };

  return (
    <View style={styles.batteryFluidTrack} pointerEvents="none">
      <View style={[styles.batteryFluid, { height: `${Math.round(fill * 100)}%` }]}>
        <LinearGradient
          colors={palette.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          style={[
            styles.batteryWave,
            {
              backgroundColor: palette.wave,
              transform: [{ rotate: rotA }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.batteryWave,
            styles.batteryWaveTop,
            {
              backgroundColor: palette.waveTop,
              transform: [{ rotate: rotB }],
            },
          ]}
        />
      </View>
    </View>
  );
}

// A single battery in the home-screen carousel: a clear-glass cell sitting over a
// green fluid whose level tracks the battery voltage. Tapping opens the info sheet.
function BatteryItem({ reading, name, online, onPress, width }) {
  const fill = batteryFill(batteryVoltage(reading));
  return (
    <Pressable
      style={({ pressed }) => [
        styles.batteryItem,
        { width },
        pressed && styles.batteryItemPressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
    >
      <View style={[styles.batteryCell, !online && styles.batteryCellOffline]}>
        <View style={styles.batteryCap} />
        <View style={styles.batteryShape}>
          {/* Green animated fluid, sitting under the glass. */}
          <BatteryFluid fill={fill} online={online} />
          {/* Clear glass body, rendered last so it stays on top of the fluid. The
              glass carries its own corner radius so its refraction follows the
              rounded corners instead of being clipped at square ones. */}
          {glass ? (
            <GlassView
              glassEffectStyle="clear"
              style={[StyleSheet.absoluteFill, styles.batteryGlass]}
              pointerEvents="none"
            />
          ) : (
            <View
              style={[StyleSheet.absoluteFill, styles.batteryGlass, styles.batteryGlassFallback]}
              pointerEvents="none"
            />
          )}
        </View>
      </View>
      <Text style={styles.batteryName} numberOfLines={1}>
        {name}
      </Text>
      <View style={styles.batteryReadouts}>
        <View style={styles.batteryReadout}>
          <LiveStat
            value={batteryVoltage(reading).toFixed(1)}
            unit="V"
            valueStyle={styles.batteryVoltValue}
            unitStyle={styles.batteryVoltUnit}
            gap={2}
          />
        </View>
        <View style={styles.batteryReadout}>
          <LiveStat
            value={batteryCurrent(reading).toFixed(1)}
            unit="A"
            valueStyle={styles.batteryAmpValue}
            unitStyle={styles.batteryAmpUnit}
            gap={2}
          />
        </View>
      </View>
    </Pressable>
  );
}

// Page indicator for the battery carousel: the dot for the leftmost-visible item
// grows into a pill and slides as you scroll. `stride` is one item + gutter.
function BatteryDots({ count, scrollX, stride }) {
  return (
    <View style={styles.batteryDotsRow}>
      {Array.from({ length: count }).map((_, i) => {
        const inputRange = [(i - 1) * stride, i * stride, (i + 1) * stride];
        const width = scrollX.interpolate({
          inputRange,
          outputRange: [6, 18, 6],
          extrapolate: "clamp",
        });
        const opacity = scrollX.interpolate({
          inputRange,
          outputRange: [0.3, 1, 0.3],
          extrapolate: "clamp",
        });
        return <Animated.View key={i} style={[styles.batteryDot, { width, opacity }]} />;
      })}
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

function RangeToggle({ value, onChange, accent = SOLAR_GREEN }) {
  return (
    <View style={styles.rangeSwitchRow}>
      <Text style={styles.rangeSwitchText}>{value === "hour" ? "Hour" : "Day"}</Text>
      <Switch
        value={value === "hour"}
        onValueChange={(enabled) => onChange(enabled ? "hour" : "day")}
        trackColor={{ false: colors.cardAlt, true: accent }}
        thumbColor={colors.white}
        ios_backgroundColor={colors.cardAlt}
      />
    </View>
  );
}

function GraphSummaryHeader({ title, value, dateText, range, onRangeChange, accent }) {
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
        <RangeToggle value={range} onChange={onRangeChange} accent={accent} />
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

// Day mode only needs the broad production/usage shape. Aggregate minute-level
// samples into ten-minute averages while retaining the exact trace endpoints.
function downsampleDaySeries(points, bucketMs = 10 * 60 * 1000) {
  if (points.length < 3) return points;
  const buckets = [];
  let currentKey = null;
  let sumTime = 0;
  let sumValue = 0;
  let count = 0;

  const flush = () => {
    if (!count) return;
    buckets.push({
      t: Math.round(sumTime / count),
      value: sumValue / count,
    });
  };

  for (const point of points) {
    const key = Math.floor(point.t / bucketMs);
    if (currentKey != null && key !== currentKey) {
      flush();
      sumTime = 0;
      sumValue = 0;
      count = 0;
    }
    currentKey = key;
    sumTime += point.t;
    sumValue += Number(point.value) || 0;
    count += 1;
  }
  flush();

  const first = points[0];
  const last = points[points.length - 1];
  return [
    first,
    ...buckets.filter((point) => point.t > first.t && point.t < last.t),
    last,
  ];
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
  const timedPoints = data.filter((point) => Number.isFinite(point?.t));
  const firstPointTime = timedPoints[0]?.t ?? windowStart;
  const lastPointTime = timedPoints[timedPoints.length - 1]?.t ?? windowEnd;
  const hasTraceRange =
    timedPoints.length > 1 && lastPointTime > firstPointTime;
  const traceStart = Math.max(windowStart, firstPointTime);
  const traceEnd = Math.max(traceStart + 1, Math.min(windowEnd, lastPointTime));
  const fullSpan = Math.max(1, windowEnd - windowStart);
  // Hour mode shows roughly one hour per viewport. Day mode keeps the same
  // centered-cursor interaction at a broader six-hour scale.
  const visibleDuration = range === "hour"
    ? 60 * 60 * 1000
    : 6 * 60 * 60 * 1000;
  const chartWidth = Math.max(
    viewportWidth,
    viewportWidth * (fullSpan / visibleDuration)
  );
  const firstCursorX =
    ((traceStart - windowStart) / fullSpan) * chartWidth;
  const lastCursorX =
    ((traceEnd - windowStart) / fullSpan) * chartWidth;
  // Native scrolling is relative to the first trace point. The graph viewport
  // may show space around the trace, but the center cursor itself can only move
  // from the first plotted timestamp to the last.
  const cursorTravel = Math.max(0, lastCursorX - firstCursorX);
  const [scrollX, setScrollX] = useState(0);
  const scrollRef = useRef(null);

  // Open at the latest available trace position when the selected range changes.
  // Also run once when the first usable trace arrives after startup. Later live
  // samples do not change `hasTraceRange`, so they cannot snap an active scroll.
  useEffect(() => {
    if (!hasTraceRange) return undefined;
    const targetX = cursorTravel;
    const id = setTimeout(() => {
      scrollRef.current?.scrollTo({ x: targetX, animated: false });
      setScrollX(targetX);
    }, 0);
    return () => clearTimeout(id);
  }, [hasTraceRange, range, viewportWidth]); // eslint-disable-line react-hooks/exhaustive-deps

  const onChartScroll = (event) => {
    const nextX = Math.max(
      0,
      Math.min(cursorTravel, event.nativeEvent.contentOffset.x)
    );
    setScrollX(nextX);
  };

  // Draw only the visible slice behind a stationary center cursor. Both ranges
  // share the same scale and interaction; only their visible duration differs.
  const chartMax = Math.max(1, ...data.map((point) => Number(point.value) || 0)) * 1.14;
  const cursorX = firstCursorX + scrollX;
  const visibleStart =
    windowStart + ((cursorX - viewportWidth / 2) / chartWidth) * fullSpan;
  const visibleEnd =
    windowStart + ((cursorX + viewportWidth / 2) / chartWidth) * fullSpan;
  const displayData =
    range === "day" ? downsampleDaySeries(data) : data;
  const visibleChart = (
    <LineChart
      data={clipSeries(displayData, visibleStart, visibleEnd)}
      height={ENERGY_CHART_HEIGHT}
      color={color}
      labelColor="#fff"
      fillId={`${fillId}${range === "hour" ? "Hour" : "Day"}`}
      markers={markers}
      windowStart={visibleStart}
      windowEnd={visibleEnd}
      width={viewportWidth}
      tickMode={range === "hour" ? "hour" : "day"}
      showCursor={false}
      centerCursor
      maxValue={chartMax}
    />
  );

  return (
    <View style={styles.energyChart}>
      <View style={styles.chartViewport}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {visibleChart}
        </View>
        <ScrollView
          ref={scrollRef}
          horizontal
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          decelerationRate="normal"
          onScroll={onChartScroll}
          onScrollBeginDrag={onScrubStart}
          onScrollEndDrag={onScrubEnd}
          onMomentumScrollEnd={onScrubEnd}
          style={styles.chartScroller}
          contentContainerStyle={{
            width: cursorTravel + viewportWidth,
            height: ENERGY_CHART_HEIGHT,
          }}
        >
          <View
            style={{
              width: cursorTravel + viewportWidth,
              height: ENERGY_CHART_HEIGHT,
            }}
          />
        </ScrollView>
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
  const live = useLive();
  const daily = useDailyEnergy();
  const storedSeries = useEnergySeries();
  const background = useCurrentBackground();
  const { names } = useDeviceNames();
  const { order } = useDeviceOrder();
  const { width } = useWindowDimensions();
  // Chart cards are inset 16pt from the screen. The graph itself spans the full
  // card width; only the summary header keeps the card's 18pt content padding.
  const chartViewportWidth = Math.max(280, width - 32);
  // Show four batteries per view inside the card (16pt screen padding + 18pt card
  // padding on each side), with small gutters between the four visible items.
  const batteryPerView = 4;
  const batteryGap = 10;
  const batteryItemWidth =
    (width - 32 - 36 - batteryGap * (batteryPerView - 1)) / batteryPerView;
  // The carousel pages a full group of four at a time.
  const batteryPageStride = batteryPerView * (batteryItemWidth + batteryGap);

  // Scale the live-stat font to the device width (locked against OS font scaling).
  const statFont = Math.round(34 * Math.min(Math.max(width / 390, 0.82), 1.3));
  const statValueStyle = [styles.heroValue, { fontSize: statFont }];
  const statUnitStyle = [styles.heroUnit, { fontSize: statFont }];
  const [selectedBatteryId, setSelectedBatteryId] = useState(null);
  const batteryScrollX = useRef(new Animated.Value(0)).current;
  const [solarRange, setSolarRange] = useState("hour");
  const [loadRange, setLoadRange] = useState("hour");
  const [graphScrubbing, setGraphScrubbing] = useState(false);

  // Live totals are computed by the backend (inverter PV / load, online-battery
  // power & current); the app only renders them.
  const production = live.solar_w;
  const load = live.load_w;
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
  // Same ordering the devices page uses, so batteries line up across screens.
  const batteries = orderReadings(
    order,
    readings.filter((reading) => reading.kind === "bms")
  );
  const batteryAmps = live.battery_a;
  const batteryWatts = live.battery_w;

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
              <View style={styles.batteryScrollWrap}>
                <Animated.ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.batteryRow}
                  contentContainerStyle={{ gap: batteryGap }}
                  snapToInterval={batteryPageStride}
                  decelerationRate="fast"
                  scrollEventThrottle={16}
                  onScroll={Animated.event(
                    [{ nativeEvent: { contentOffset: { x: batteryScrollX } } }],
                    { useNativeDriver: false }
                  )}
                >
                  {batteries.map((reading) => (
                    <BatteryItem
                      key={reading.device_id}
                      reading={reading}
                      name={resolveDeviceName(names, reading)}
                      online={reading.online}
                      width={batteryItemWidth}
                      onPress={() => setSelectedBatteryId(reading.device_id)}
                    />
                  ))}
                </Animated.ScrollView>
              </View>
              {batteries.length > batteryPerView && (
                <BatteryDots
                  count={Math.ceil(batteries.length / batteryPerView)}
                  scrollX={batteryScrollX}
                  stride={batteryPageStride}
                />
              )}
              {/* Blur the left/right edges over the full card height, so items
                  fade out as they scroll past the card's sides. */}
              <MaskedView
                pointerEvents="none"
                style={styles.batteryEdgeFade}
                maskElement={
                  <LinearGradient
                    colors={["#000", "transparent", "transparent", "#000"]}
                    locations={[0, 0.1, 0.9, 1]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={StyleSheet.absoluteFill}
                  />
                }
              >
                <BlurView intensity={28} tint="default" style={StyleSheet.absoluteFill} />
              </MaskedView>
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
              title={t("home.solarProduction")}
              value={daily.solar_kwh}
              dateText={todayDate}
              range={solarRange}
              onRangeChange={setSolarRange}
              accent={SOLAR_GREEN}
            />
            <LiveEnergyChart
              value={kw(production)}
              data={solarChartData}
              color={SOLAR_GREEN}
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
              accent={LOAD_RED}
            />
            <LiveEnergyChart
              value={kw(load)}
              data={loadChartData}
              color={LOAD_RED}
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
  batteryScrollWrap: { marginHorizontal: -18, marginTop: 22 },
  batteryRow: { paddingHorizontal: 18 },
  // Spans the whole card: negative insets cancel the card's 18pt padding so the
  // blurred edges reach the card sides (clipped to its rounded corners).
  batteryEdgeFade: { position: "absolute", top: -18, bottom: -18, left: -18, right: -18 },
  batteryItem: { alignItems: "center" },
  batteryItemPressed: { opacity: 0.6 },
  batteryCell: { alignItems: "center" },
  batteryCellOffline: { opacity: 0.55 },
  batteryCap: {
    width: 16,
    height: 4,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.55)",
    marginBottom: -1,
    zIndex: 1,
  },
  // The body is a single clear GlassView; the green liquid sits directly under it,
  // so no opaque background here — just the clip bounds and the rim.
  batteryShape: {
    width: 52,
    height: 90,
    borderRadius: 9,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  // Inset modestly from the cell walls so the green is large but not touching the
  // glass edges; clips the waves to the rounded pill. Its radius is the shape's
  // radius minus the inset, so the inner pill stays concentric with the glass body.
  batteryFluidTrack: {
    position: "absolute",
    top: 7,
    left: 7,
    right: 7,
    bottom: 7,
    borderRadius: 2,
    borderCurve: "continuous",
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  // The fill height marks the surface; waves are allowed to rise just above it so
  // the top edge ripples like liquid (the track clips them to the pill).
  batteryFluid: { width: "100%" },
  // Rounded square anchored just above the surface; counter-rotating two of them
  // makes the curved top edge crest and dip like a wavy liquid surface.
  batteryWave: {
    position: "absolute",
    left: "-35%",
    width: "170%",
    aspectRatio: 1,
    top: -5,
    borderRadius: 26,
    borderCurve: "continuous",
  },
  batteryWaveTop: { top: -11 },
  // Match the shape's radius so the glass renders its own rounded corners (its
  // refraction follows the curve) rather than being clipped at square corners.
  batteryGlass: { borderRadius: 9, borderCurve: "continuous" },
  batteryGlassFallback: { backgroundColor: "rgba(255,255,255,0.14)" },
  batteryDotsRow: {
    flexDirection: "row",
    alignSelf: "center",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
  },
  batteryDot: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.white,
  },
  batteryName: {
    marginTop: 7,
    maxWidth: "100%",
    color: colors.white,
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
    ...shadow,
  },
  batteryReadouts: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    marginTop: 3,
  },
  batteryReadout: { flexDirection: "row", alignItems: "center", gap: 3 },
  batteryVoltValue: {
    color: colors.white,
    fontSize: 14,
    fontWeight: "700",
    ...shadow,
  },
  batteryVoltUnit: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 14,
    fontWeight: "500",
    ...shadow,
  },
  batteryAmpValue: {
    color: "rgba(255,255,255,0.86)",
    fontSize: 14,
    fontWeight: "700",
    ...shadow,
  },
  batteryAmpUnit: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
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
  graphSummaryControls: {
    alignItems: "flex-end",
    alignSelf: "flex-end",
    gap: 8,
  },
  rangeSwitchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    minHeight: 31,
  },
  rangeSwitchText: { color: "rgba(255,255,255,0.86)", fontSize: 12, fontWeight: "800", ...shadow },
  cardDate: { color: "rgba(255,255,255,0.86)", fontSize: 16, fontWeight: "700", ...shadow },
  graphSummaryTitle: {
    color: colors.white,
    fontSize: 30,
    fontWeight: "200",
    marginBottom: 2,
    ...shadow,
  },
  dailyValue: { color: colors.white, fontSize: 30, fontWeight: "800", letterSpacing: -0.8, ...shadow },
  dailyUnit: { color: "rgba(255,255,255,0.78)", fontSize: 15, fontWeight: "700", ...shadow },
  energyChart: { marginTop: 6, marginHorizontal: -18 },
  chartViewport: {
    height: ENERGY_CHART_HEIGHT,
    overflow: "hidden",
    position: "relative",
  },
  chartScroller: { marginHorizontal: -2 },
  offline: { color: "#FFD3CE", fontSize: 13, textAlign: "center", ...shadow },
});
