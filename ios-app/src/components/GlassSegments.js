import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, Animated, Easing, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { colors, radius } from "../theme";

const glass = isLiquidGlassAvailable();
const TRACK_PADDING = 4;

// A clear glass pill sliding inside a clear glass track. Both layers are transparent —
// the page reads straight through them and only the refraction separates the two.
//
// The moving pill follows the tab bar's construction: a plain Animated.View carrying
// the transform with the glass material filling it via absoluteFill. Animating a
// GlassView directly does not move it.
//
// Note: never wrap this in an ancestor with an animated opacity — that switches off
// the native liquid-glass effect and both layers render flat.
export default function GlassSegments({ options, value, onChange, style }) {
  const [trackWidth, setTrackWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const settled = useRef(false);

  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const segmentWidth =
    trackWidth > 0 ? (trackWidth - TRACK_PADDING * 2) / options.length : 0;

  useEffect(() => {
    if (!segmentWidth) return;
    const target = index * segmentWidth;
    // Jump into place on first measure; glide for every change after that.
    if (!settled.current) {
      translateX.setValue(target);
      settled.current = true;
      return;
    }
    Animated.timing(translateX, {
      toValue: target,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [index, segmentWidth, translateX]);

  return (
    <View
      style={[styles.track, style]}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
    >
      {glass ? (
        <GlassView
          glassEffectStyle="clear"
          style={[StyleSheet.absoluteFill, styles.trackSurface]}
          pointerEvents="none"
        />
      ) : (
        <View
          style={[StyleSheet.absoluteFill, styles.trackSurface, styles.trackFallback]}
          pointerEvents="none"
        />
      )}

      {segmentWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pill,
            { width: segmentWidth, transform: [{ translateX }] },
          ]}
        >
          {glass ? (
            <>
              <BlurView
                intensity={2}
                tint="light"
                style={[StyleSheet.absoluteFill, styles.pillSurface]}
                pointerEvents="none"
              />
              <GlassView
                glassEffectStyle="clear"
                style={[StyleSheet.absoluteFill, styles.pillSurface]}
                pointerEvents="none"
              />
            </>
          ) : (
            <View
              style={[StyleSheet.absoluteFill, styles.pillSurface, styles.pillFallback]}
              pointerEvents="none"
            />
          )}
        </Animated.View>
      )}

      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={styles.segment}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.label, on && styles.labelOn]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    alignSelf: "stretch",
    padding: TRACK_PADDING,
    borderRadius: radius.pill,
    borderCurve: "continuous",
  },
  trackSurface: { borderRadius: radius.pill, borderCurve: "continuous" },
  trackFallback: { backgroundColor: "rgba(255,255,255,0.22)" },
  // Inset by the track's padding on every side, then slid across by one segment.
  pill: {
    position: "absolute",
    left: TRACK_PADDING,
    top: TRACK_PADDING,
    bottom: TRACK_PADDING,
  },
  pillSurface: { borderRadius: radius.pill, borderCurve: "continuous" },
  pillFallback: { backgroundColor: "rgba(255,255,255,0.5)" },
  segment: { flex: 1, paddingVertical: 11, alignItems: "center" },
  label: { color: "rgba(255,255,255,0.6)", fontSize: 18, fontWeight: "700" },
  labelOn: { color: colors.white },
});
