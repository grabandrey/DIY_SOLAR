import React from "react";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

export default function DeviceTypeIcon({ type, size = 58, color = "#1B1B19" }) {
  if (type === "battery") {
    return (
      <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
        <Rect x="13" y="15" width="38" height="38" rx="9" stroke={color} strokeWidth="2.4" />
        <Path d="M24 15V11H40V15" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
        <Rect x="19" y="22" width="26" height="23" rx="5" stroke={color} strokeWidth="2" />
        <Line x1="24" y1="28" x2="24" y2="39" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <Line x1="32" y1="28" x2="32" y2="39" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <Line x1="40" y1="28" x2="40" y2="39" stroke={color} strokeWidth="3" strokeLinecap="round" />
      </Svg>
    );
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Rect x="12" y="8" width="40" height="48" rx="10" stroke={color} strokeWidth="2.4" />
      <Rect x="20" y="16" width="24" height="13" rx="4" stroke={color} strokeWidth="2" />
      <Path d="M25 25C27 20 29 20 31 25C33 30 35 30 39 20" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <Circle cx="32" cy="38" r="4.5" stroke={color} strokeWidth="2" />
      <Line x1="22" y1="47" x2="42" y2="47" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="24" y1="51" x2="40" y2="51" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}
