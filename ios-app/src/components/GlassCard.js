import React from "react";
import { View, StyleSheet } from "react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { colors, radius } from "../theme";

const glass = isLiquidGlassAvailable();

// A card whose surface is Liquid Glass (iOS 26), with a frosted-card fallback elsewhere.
// `style` is applied to the card (add padding / flex there).
export default function GlassCard({
  children,
  style,
  tint = "rgba(255,255,255,0.4)",
  glassStyle = "regular",
}) {
  return (
    <View style={[styles.base, style]}>
      {glass ? (
        <GlassView glassEffectStyle={glassStyle} tintColor={tint} style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallback]} />
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.5)",
  },
  fallback: { backgroundColor: colors.card },
});
