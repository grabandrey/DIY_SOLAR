import React, { useRef } from "react";
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
import MaskedView from "@react-native-masked-view/masked-view";
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
import GlassCard from "../components/GlassCard";
import TimeGradientBackground from "../components/TimeGradientBackground";
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
  // Device configs carry the chosen image (cfg.image); join by id to show it.
  // Daisy-chained units report ids like "<masterId>:<n>", so strip the suffix to reuse
  // the master device's image for every unit in the chain.
  const { devices } = useDiscovery();
  const imageOf = (id) => {
    const masterId = String(id).split(":")[0];
    return devices.find((d) => d.id === masterId)?.image;
  };
  // Alphabetical by display name (falling back to id) so the carousel order is stable
  // and predictable regardless of the backend's device ids.
  const sorted = [...readings].sort((a, b) =>
    (a.device_name || a.device_id).localeCompare(b.device_name || b.device_id)
  );
  const inverters = sorted.filter((reading) => reading.kind !== "bms");
  const batteries = sorted.filter((reading) => reading.kind === "bms");

  const openDevice = (reading) =>
    navigation.navigate("DeviceDetail", {
      deviceId: reading.device_id,
      initialReading: reading,
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
        contentContainerStyle={{ paddingTop: insets.top + 56, paddingBottom: 140 }}
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
            devices={inverters}
            type="inverter"
            onOpen={openDevice}
            imageOf={imageOf}
            t={t}
          />
        )}

        {batteries.length > 0 && (
          <DeviceCarousel
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
function DeviceCarousel({ devices, type, onOpen, imageOf, t }) {
  const { width } = useWindowDimensions();
  // Full-bleed pages so `pagingEnabled` (which snaps by the scroll view's frame width)
  // aligns exactly; the side gutters live inside each page instead.
  const pageWidth = width;
  const scrollX = useRef(new Animated.Value(0)).current;

  const onScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
    { useNativeDriver: false }
  );

  return (
    <View style={styles.section}>
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
                name: reading.device_name || reading.device_id,
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
                  <View style={styles.nameRow}>
                    <View
                      style={[styles.statusDot, !reading.online && styles.statusOffline]}
                    />
                    <Text style={styles.name} numberOfLines={1}>
                      {reading.device_name || reading.device_id}
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
  const source = deviceImageSource(image);
  if (!source) return null;
  return (
    <View
      style={[styles.art, type === "battery" && styles.artBattery]}
      pointerEvents="none"
    >
      {/* Shadow lives on this wrapper View, not the Image — an Image clips its own
          shadow at its bottom edge, a View does not. */}
      <View
        style={[
          styles.artShadow,
          type === "battery" && styles.artShadowBattery,
          !reading.online && styles.artImageOffline,
        ]}
      >
        <Image source={source} style={styles.artImage} resizeMode="contain" />
      </View>
    </View>
  );
}

// Page indicator whose active dot grows and slides as the carousel scrolls. Each dot's
// width/opacity is interpolated from the live scroll offset, so the elongated "pill"
// travels smoothly between dots instead of snapping.
function Dots({ count, scrollX, pageWidth }) {
  return (
    <View style={styles.dots}>
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
  );
}

// Live stats for a device, shown inside its card.
function FocusedStats({ reading, type, t }) {
  const stats =
    type === "battery"
      ? [
          { label: t("device.metrics.batteryVoltage"), value: batteryVoltage(reading).toFixed(1), unit: "V" },
          { label: t("home.batteryCurrent"), value: batteryCurrent(reading).toFixed(1), unit: "A" },
          { label: t("device.metrics.batteryPower"), value: kw(Math.abs(batteryPower(reading))), unit: "kW" },
        ]
      : [
          { label: t("energy.solar"), value: kw(chargePower(reading)), unit: "kW" },
          { label: t("energy.load"), value: kw(usedPower(reading)), unit: "kW" },
        ];

  return (
    <View style={styles.stats}>
      {stats.map((stat) => (
        <View key={stat.label} style={styles.stat}>
          <Text style={styles.statValue}>
            {stat.value}
            {stat.unit ? <Text style={styles.statUnit}> {stat.unit}</Text> : null}
          </Text>
          <Text style={styles.statLabel} numberOfLines={1}>
            {stat.label}
          </Text>
        </View>
      ))}
    </View>
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

const WHITE_DIM = "rgba(255,255,255,0.75)";

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBlur: { position: "absolute", top: 0, left: 0, right: 0, height: 100 },
  screen: { flex: 1, backgroundColor: "#1B1B19" },
  scroll: { flex: 1, backgroundColor: "transparent" },
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
  // Battery photos read better sitting lower over the card than the inverters.
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
  // Battery photos render larger than the inverters.
  artShadowBattery: { width: "130%", height: "170%" },
  artImage: { width: "100%", height: "100%" },
  artImageOffline: { opacity: 0.35 },

  dots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 7,
    marginTop: 18,
  },
  dot: { height: 7, borderRadius: 4, backgroundColor: colors.white },

  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green },
  statusOffline: { backgroundColor: colors.red },
  name: { color: colors.white, fontSize: 23, fontWeight: "700", flexShrink: 1 },

  stats: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignSelf: "stretch",
    marginTop: 18,
  },
  stat: { alignItems: "center", flex: 1 },
  statValue: { color: colors.white, fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  statUnit: { color: WHITE_DIM, fontSize: 12, fontWeight: "700" },
  statLabel: { color: WHITE_DIM, fontSize: 12, marginTop: 4 },
});
