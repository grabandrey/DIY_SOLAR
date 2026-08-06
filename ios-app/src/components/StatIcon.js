import React from "react";
import { StyleSheet } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { colors } from "../theme";

// Exact paths from the downloaded Lucide sun and house-plug SVG assets.
// Shared so the devices page and the home screen's inverter carousel draw the
// same glyph for the same metric.
export default function StatIcon({ name, size = 24, color = colors.white, style }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={[styles.icon, style]}
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
      ) : name === "panel" ? (
        // A panel on its stand, for the array itself — distinct from "solar", which is
        // the sun and stands for production.
        <>
          <Path d="M2 14 6 4h12l4 10z" />
          <Path d="M4 9h16" />
          <Path d="M10 4 8.7 14" />
          <Path d="m14 4 1.3 10" />
          <Path d="M12 14v6" />
          <Path d="M8.5 20h7" />
        </>
      ) : name === "grid" ? (
        // Lucide "zap" — mains power, alongside the sun and house-plug glyphs.
        <Path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
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

const styles = StyleSheet.create({
  icon: { marginBottom: 7 },
});
