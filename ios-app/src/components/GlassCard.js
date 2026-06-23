import React from "react";
import { View, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { colors, radius as radii } from "../theme";

const glass = isLiquidGlassAvailable();

// A card whose surface is Liquid Glass (iOS 26), with a frosted-card fallback elsewhere.
// `style` is applied to the card (add padding / flex there).
// `blur` adds a subtle blurred backdrop behind the glass (intensity, e.g. 18).
// `border` draws a crisp stroke as a top overlay so it follows the (continuous)
// corner radius exactly and stays concentric with the card edge — unaffected by
// the glass material. Pass `true` for the default tint, or a color string.
export default function GlassCard({
  children,
  style,
  tint = "rgba(255,255,255,0.4)",
  glassStyle = "regular",
  blur = 0,
  border = false,
  radius = radii.lg,
}) {
  return (
    <View style={[styles.base, { borderRadius: radius }, style]}>
      {blur > 0 && (
        <BlurView intensity={blur} tint="light" style={StyleSheet.absoluteFill} />
      )}
      {glass ? (
        <GlassView glassEffectStyle={glassStyle} tintColor={tint} style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, blur > 0 ? styles.blurTint : styles.fallback]} />
      )}
      {children}
      {border ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.borderOverlay,
            { borderRadius: radius },
            typeof border === "string" && { borderColor: border },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderCurve: "continuous",
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.5)",
  },
  borderOverlay: {
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.5)",
  },
  fallback: { backgroundColor: colors.card },
  blurTint: { backgroundColor: "rgba(255,255,255,0.12)" },
});
