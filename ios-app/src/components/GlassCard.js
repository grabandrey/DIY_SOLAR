import React from "react";
import { View, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { colors, radius as radii } from "../theme";

const glass = isLiquidGlassAvailable();

// A card whose surface is Liquid Glass (iOS 26), with a frosted-card fallback elsewhere.
// `style` is applied to the card (add padding / flex there).
// `blur` adds a subtle blurred backdrop behind the glass (intensity, e.g. 18).
// The crisp stroke is drawn as a single top overlay so it follows the (continuous)
// corner radius exactly and stays unaffected by the glass material. `border`
// overrides its color; pass a color string (`true` keeps the default tint).
//
// The stroke must be drawn in exactly one place. Giving the container its own
// `borderWidth` as well pushes this overlay inside the container's padding box,
// so the two hairlines end up offset by the border width while sharing the same
// radius — non-concentric. On the straight edges they overlap and read as one
// line, but around a corner the offset between two equal-radius curves grows to
// ~1.41x, peaking at the 45 degree point, which shows up as a short doubled line
// in the middle of every corner.
export default function GlassCard({
  children,
  style,
  tint = "rgba(255,255,255,0.4)",
  glassStyle = "regular",
  blur = 0,
  border = false,
  radius = radii.lg,
}) {
  // `radius` is normally one number, but a card butted against a screen edge wants
  // that edge squared off — pass a style fragment of per-corner radii instead. It
  // has to reach all three layers: squaring only the container would leave the
  // glass surface and the stroke overlay rounded inside it.
  const radiusStyle = typeof radius === "number" ? { borderRadius: radius } : radius;
  // Every backdrop-sampling layer carries the card's own corner radius rather than
  // relying on the parent to clip it — see the note above `styles.surface`.
  const surface = [StyleSheet.absoluteFill, styles.surface, radiusStyle];

  return (
    <View style={[styles.base, radiusStyle, style]}>
      {blur > 0 && <BlurView intensity={blur} tint="light" style={surface} />}
      {glass ? (
        <GlassView glassEffectStyle={glassStyle} tintColor={tint} style={surface} />
      ) : (
        <View style={[surface, blur > 0 ? styles.blurTint : styles.fallback]} />
      )}
      {children}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.borderOverlay,
          radiusStyle,
          typeof border === "string" && { borderColor: border },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderCurve: "continuous",
    overflow: "hidden",
  },
  // Liquid Glass and BlurView both refract/sample the backdrop along their OWN
  // edges. Left at a plain absoluteFill they render as a square, and the parent's
  // `overflow: hidden` then crops that square to the rounded card — so the edge
  // treatment keeps running diagonally across each corner and terminates against
  // the clip, drawing a line into the middle of every corner. Giving them the
  // card's radius makes the material curve with the card instead of being cut.
  // Same reason `batteryGlass` in HomeScreen carries its own radius.
  surface: { borderCurve: "continuous" },
  borderOverlay: {
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.5)",
  },
  fallback: { backgroundColor: colors.card },
  blurTint: { backgroundColor: "rgba(255,255,255,0.12)" },
});
