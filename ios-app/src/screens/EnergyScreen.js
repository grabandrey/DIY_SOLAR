import React, { useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  Image,
  ImageBackground,
  Animated,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { StatusBar } from "expo-status-bar";
import MaskedView from "@react-native-masked-view/masked-view";
import Svg, { Circle, Path } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { colors, radius } from "../theme";
import { useReadings, useDiscovery } from "../api";
import { useCurrentBackground } from "../background";
import {
  chargePower,
  usedPower,
  batteryPower,
  batteryVoltage,
  batteryCurrent,
  kw,
} from "../metrics";
import { deviceImageSource } from "../deviceImages";
import { useDeviceNames, resolveDeviceName } from "../deviceNames";
import {
  useDeviceIcons,
  resolveDeviceIcon,
  resolveDeviceIconStyle,
} from "../deviceIcons";
import { useDeviceOrder, orderReadings } from "../deviceOrder";
import ReorderModal from "../components/ReorderModal";
import GlassCard from "../components/GlassCard";
import DeviceDetail from "../components/DeviceDetail";

const Stack = createNativeStackNavigator();

const SCREEN_PADDING = 16;
// The product image floats above its info card; only its bottom IMAGE_OVERLAP px sit
// over the card, so most of the device is outside (above) the card.
const IMAGE_H = 190;
const IMAGE_OVERLAP = 60;

export default function EnergyScreen() {
  return (
    <View style={styles.root}>
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

      {/* Top fade-to-blur, layered above the stack so it stays on the detail page too
          (the detail slides in beneath it, never removing it). */}
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
    </View>
  );
}

function DeviceListScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const background = useCurrentBackground();
  const { readings } = useReadings();
  // Icons are picked on the device page and stored locally (AsyncStorage), keyed by
  // device_id. Daisy-chained units report ids like "<masterId>:<n>"; resolveDeviceIcon
  // falls back to the master's icon for every unit in the chain. A legacy backend-configured
  // image (cfg.image) is used only as a last-resort fallback.
  const { devices } = useDiscovery();
  const { icons } = useDeviceIcons();
  const imageOf = (id) => {
    const masterId = String(id).split(":")[0];
    const backend = devices.find((d) => d.id === masterId)?.image;
    return resolveDeviceIcon(icons, id, backend);
  };
  // Apply the user's saved order (set from the reorder modal); unordered devices fall back
  // to alphabetical by name.
  const { order } = useDeviceOrder();
  const sorted = orderReadings(order, readings);
  const inverters = sorted.filter((reading) => reading.kind !== "bms");
  const batteries = sorted.filter((reading) => reading.kind === "bms");

  const openDevice = (reading) =>
    navigation.navigate("DeviceDetail", {
      deviceId: reading.device_id,
      initialReading: reading,
      image: imageOf(reading.device_id),
    });

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
        contentContainerStyle={{ paddingTop: insets.top + 14, paddingBottom: 140 }}
        showsVerticalScrollIndicator={false}
      >
        {sorted.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="hardware-chip-outline" size={28} color={colors.muted} />
            <Text style={styles.emptyText}>{t("energy.empty")}</Text>
          </View>
        )}

        {inverters.length > 0 && (
          <DeviceCarousel
            title={t("energy.inverters")}
            devices={inverters}
            type="inverter"
            onOpen={openDevice}
            imageOf={imageOf}
            t={t}
          />
        )}

        {batteries.length > 0 && (
          <DeviceCarousel
            title={t("energy.batteries")}
            devices={batteries}
            type="battery"
            onOpen={openDevice}
            imageOf={imageOf}
            t={t}
          />
        )}
      </ScrollView>
    </View>
  );
}

// A horizontal, paged carousel of large device images. Each page is a self-contained
// card; the only chrome is the page-dots beneath the scroll.
function DeviceCarousel({ title, devices, type, onOpen, imageOf, t }) {
  const { width } = useWindowDimensions();
  const { names } = useDeviceNames();
  const { setOrder } = useDeviceOrder();
  const [reordering, setReordering] = useState(false);
  // Full-bleed pages so `pagingEnabled` (which snaps by the scroll view's frame width)
  // aligns exactly; the side gutters live inside each page instead.
  const pageWidth = width;
  const scrollX = useRef(new Animated.Value(0)).current;

  const onScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
    { useNativeDriver: false }
  );

  const reorderItems = devices.map((reading) => ({
    id: reading.device_id,
    name: resolveDeviceName(names, reading),
    image: imageOf?.(reading.device_id),
  }));

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text
          style={[styles.sectionTitle, type === "inverter" && styles.sectionTitleInverter]}
        >
          {title}
        </Text>
        {devices.length > 1 && (
          <Pressable
            onPress={() => setReordering(true)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t("settings.reorderHint")}
          >
            <GlassCard
              style={styles.reorderPill}
              glassStyle="clear"
              tint="rgba(0,0,0,0.16)"
              blur={8}
              border="rgba(255,255,255,0.4)"
              radius={radius.pill}
            >
              <Text style={styles.reorderLabel}>{t("common.edit")}</Text>
            </GlassCard>
          </Pressable>
        )}
      </View>
      <ReorderModal
        visible={reordering}
        title={title}
        items={reorderItems}
        onClose={() => setReordering(false)}
        onSave={(ids) => setOrder(ids)}
      />
      <Animated.ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        decelerationRate="fast"
        style={styles.carousel}
      >
        {devices.map((reading, i) => {
          // Scale (and slightly fade) each page by its distance from the centred
          // scroll offset, so the focused device grows in and the others shrink away.
          const inputRange = [(i - 1) * pageWidth, i * pageWidth, (i + 1) * pageWidth];
          const scale = scrollX.interpolate({
            inputRange,
            outputRange: [0.84, 1, 0.84],
            extrapolate: "clamp",
          });
          const opacity = scrollX.interpolate({
            inputRange,
            outputRange: [0.6, 1, 0.6],
            extrapolate: "clamp",
          });
          return (
            <Pressable
              key={reading.device_id}
              style={[styles.page, { width: pageWidth }]}
              onPress={() => onOpen(reading)}
              accessibilityRole="button"
              accessibilityLabel={t("device.open", {
                name: resolveDeviceName(names, reading),
              })}
            >
              <Animated.View style={[styles.pageInner, { opacity, transform: [{ scale }] }]}>
                <GlassCard
                  style={[styles.card, type === "inverter" && styles.cardNarrow]}
                  glassStyle="clear"
                  tint="rgba(0,0,0,0.18)"
                  blur={10}
                  border="rgba(255,255,255,0.45)"
                  radius={radius.xl}
                >
                  <View
                    style={[
                      styles.cardStatusDot,
                      !reading.online && styles.statusOffline,
                    ]}
                  />
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>
                      {resolveDeviceName(names, reading)}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.8)" />
                  </View>
                  <FocusedStats reading={reading} type={type} t={t} />
                </GlassCard>
                <DeviceArt reading={reading} type={type} image={imageOf?.(reading.device_id)} />
              </Animated.View>
            </Pressable>
          );
        })}
      </Animated.ScrollView>

      {devices.length > 1 && (
        <Dots count={devices.length} scrollX={scrollX} pageWidth={pageWidth} />
      )}
    </View>
  );
}

// Floats above the info card (absolutely positioned); most of it sits outside the card.
// Shows the device photo only — no placeholder icon while/if the image is unavailable.
function DeviceArt({ reading, type, image }) {
  const { iconStyles } = useDeviceIcons();
  const source = deviceImageSource(image);
  if (!source) return null;
  // Vertical batteries render at the inverter image size (the default artShadow); horizontal
  // batteries render much smaller. Inverters always use artShadow.
  const horizontal =
    type === "battery" &&
    resolveDeviceIconStyle(iconStyles, reading.device_id) === "horizontal";
  return (
    <View
      style={[styles.art, horizontal && styles.artBattery]}
      pointerEvents="none"
    >
      {/* Shadow lives on this wrapper View, not the Image — an Image clips its own
          shadow at its bottom edge, a View does not. */}
      <View
        style={[
          styles.artShadow,
          horizontal && styles.artShadowHorizontal,
          !reading.online && styles.artImageOffline,
        ]}
      >
        <Image source={source} style={styles.artImage} resizeMode="contain" />
      </View>
    </View>
  );
}

// Exact paths from the downloaded Lucide sun and house-plug SVG assets.
function StatIcon({ name }) {
  return (
    <Svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke={colors.white}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={styles.statIcon}
    >
      {name === "solar" ? (
        <>
          <Circle cx="12" cy="12" r="4" />
          <Path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </>
      ) : name === "load" ? (
        <>
          <Path d="M10 12V8.964M14 12V8.964" />
          <Path d="M15 12a1 1 0 0 1 1 1v2a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2a1 1 0 0 1 1-1z" />
          <Path d="M8.5 21H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-2" />
        </>
      ) : name === "battery-voltage" ? (
        <>
          <Path d="m11 7-3 5h4l-3 5" />
          <Path d="M14.856 6H16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.935M22 14v-4M5.14 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2.936" />
        </>
      ) : name === "battery-current" ? (
        <Path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
      ) : (
        <>
          <Path d="m12 14 4-4" />
          <Path d="M3.34 19a10 10 0 1 1 17.32 0" />
        </>
      )}
    </Svg>
  );
}

// Page indicator whose active dot grows and slides as the carousel scrolls. Each dot's
// width/opacity is interpolated from the live scroll offset, so the elongated "pill"
// travels smoothly between dots instead of snapping.
function Dots({ count, scrollX, pageWidth }) {
  return (
    <View style={styles.dotsWrap}>
      <GlassCard
        style={styles.dotsPill}
        glassStyle="clear"
        tint="rgba(0,0,0,0.18)"
        blur={8}
        border="rgba(255,255,255,0.4)"
        radius={radius.pill}
      >
        <View style={styles.dotsRow}>
          {Array.from({ length: count }).map((_, i) => {
            const inputRange = [(i - 1) * pageWidth, i * pageWidth, (i + 1) * pageWidth];
            const width = scrollX.interpolate({
              inputRange,
              outputRange: [7, 22, 7],
              extrapolate: "clamp",
            });
            const opacity = scrollX.interpolate({
              inputRange,
              outputRange: [0.25, 1, 0.25],
              extrapolate: "clamp",
            });
            return <Animated.View key={i} style={[styles.dot, { width, opacity }]} />;
          })}
        </View>
      </GlassCard>
    </View>
  );
}

// Live stats for a device, shown inside its card.
function FocusedStats({ reading, type, t }) {
  const stats =
    type === "battery"
      ? [
          {
            label: t("device.metrics.batteryVoltage"),
            icon: "battery-voltage",
            value: batteryVoltage(reading).toFixed(1),
            unit: "V",
          },
          {
            label: t("home.batteryCurrent"),
            icon: "battery-current",
            value: batteryCurrent(reading).toFixed(1),
            unit: "A",
          },
          {
            label: t("device.metrics.batteryPower"),
            icon: "battery-power",
            value: kw(Math.abs(batteryPower(reading))),
            unit: "kW",
          },
        ]
      : [
          {
            label: t("energy.solar"),
            icon: "solar",
            value: kw(chargePower(reading)),
            unit: "kW",
          },
          {
            label: t("energy.load"),
            icon: "load",
            value: kw(usedPower(reading)),
            unit: "kW",
          },
        ];

  return (
    <View style={styles.stats}>
      {stats.map((stat) => (
        <View
          key={stat.label}
          style={styles.stat}
          accessibilityLabel={`${stat.label}: ${stat.value} ${stat.unit}`}
        >
          {stat.icon ? <StatIcon name={stat.icon} /> : null}
          <Text style={styles.statValue}>
            {stat.value}
            {stat.unit ? <Text style={styles.statUnit}> {stat.unit}</Text> : null}
          </Text>
          {!stat.icon ? (
            <Text style={styles.statLabel} numberOfLines={1}>
              {stat.label}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function DeviceDetailScreen({ route, navigation }) {
  const { readings } = useReadings();
  const { deviceId, initialReading, image } = route.params;
  const reading =
    readings.find((item) => item.device_id === deviceId) || initialReading;

  return (
    <>
      <StatusBar style="dark" />
      <DeviceDetail
        reading={reading}
        image={image}
        onBack={() => navigation.goBack()}
      />
    </>
  );
}

const WHITE_DIM = "rgba(255,255,255,0.75)";

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBlur: { position: "absolute", top: 0, left: 0, right: 0, height: 100 },
  screen: { flex: 1, backgroundColor: "#1B1B19" },
  scroll: { flex: 1, backgroundColor: "transparent" },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: SCREEN_PADDING,
    marginBottom: 16,
  },
  sectionTitle: {
    color: colors.white,
    fontSize: 52,
    fontWeight: "200",
    letterSpacing: -0.8,
    flexShrink: 1,
  },
  sectionTitleInverter: { paddingBottom: 24 },
  reorderPill: {
    marginTop: 14,
    minHeight: 34,
    paddingHorizontal: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  reorderLabel: { color: colors.white, fontSize: 13, fontWeight: "700" },
  empty: { alignItems: "center", gap: 10, paddingVertical: 60, paddingHorizontal: SCREEN_PADDING },
  emptyText: { color: WHITE_DIM, fontSize: 14, textAlign: "center", maxWidth: 220 },

  section: { marginBottom: 34 },

  carousel: { overflow: "visible" },
  page: { justifyContent: "flex-end" },
  pageInner: {
    alignItems: "center",
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: 0,
    paddingBottom: 26,
  },
  // The card holds only text. marginTop pushes it down so the image overhangs above it,
  // and the top padding leaves room for the overlapping bottom of that image.
  card: {
    width: "100%",
    marginTop: IMAGE_H - IMAGE_OVERLAP,
    paddingTop: IMAGE_OVERLAP + 18,
    paddingHorizontal: 18,
    paddingBottom: 20,
    alignItems: "center",
  },
  // Inverter cards are narrower than batteries' (and centred by pageInner).
  cardNarrow: { width: "80%" },

  // Floating product image: absolutely positioned at the top of the page so it sits
  // mostly above the card (only its bottom IMAGE_OVERLAP px overlap the card).
  art: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: IMAGE_H,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  // Horizontal battery photos read better sitting a little lower over the card. Vertical
  // batteries use the inverter position (top: 0) so they sit higher, like an inverter.
  artBattery: { top: 20 },
  // Drop shadow on the wrapper (shaped by the child image's alpha). A View doesn't clip
  // its shadow, so the bottom of the shadow stays fully visible.
  artShadow: {
    width: "100%",
    height: "122%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
  },
  // Horizontal battery style: a large, wide image (bigger than the inverter-sized vertical
  // style), sitting a little lower over the card (see artBattery).
  artShadowHorizontal: { width: "66%", height: "84%" },
  artImage: { width: "100%", height: "100%" },
  artImageOffline: { opacity: 0.35 },

  // Dots live in a clear-glass pill, tucked up close to the carousel.
  dotsWrap: { alignItems: "center", marginTop: 2 },
  dotsPill: { paddingVertical: 12, paddingHorizontal: 14 },
  dotsRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  dot: { height: 7, borderRadius: 4, backgroundColor: colors.white },

  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  cardStatusDot: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.green,
  },
  statusOffline: { backgroundColor: colors.red },
  name: { color: colors.white, fontSize: 23, fontWeight: "700", flexShrink: 1 },

  stats: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignSelf: "stretch",
    marginTop: 18,
  },
  stat: { alignItems: "center", flex: 1 },
  statIcon: { marginBottom: 7 },
  statValue: { color: colors.white, fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  statUnit: { color: WHITE_DIM, fontSize: 12, fontWeight: "700" },
  statLabel: { color: WHITE_DIM, fontSize: 12, marginTop: 4 },
});
