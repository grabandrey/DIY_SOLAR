import React from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Path, Circle } from "react-native-svg";
import { colors } from "../theme";

// Lightweight area/line chart over a numeric series. `data` is an array of numbers.
export default function LineChart({ data = [], height = 120, color = colors.yellowDeep }) {
  const W = 320;
  const H = height;
  const pts = data.length ? data : [0, 0];
  const max = Math.max(1, ...pts);
  const n = Math.max(pts.length - 1, 1);
  const coords = pts.map((v, i) => [
    (i / n) * W,
    H - 8 - (v / max) * (H - 18),
  ]);
  const line = coords
    .map(([x, y], i) => `${i ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L ${W} ${H} L 0 ${H} Z`;
  const [lx, ly] = coords[coords.length - 1];

  return (
    <View style={{ width: "100%", height: H }}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="lcfill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0.28} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Path d={area} fill="url(#lcfill)" />
        <Path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <Circle cx={lx} cy={ly} r={3.5} fill={color} />
      </Svg>
    </View>
  );
}
