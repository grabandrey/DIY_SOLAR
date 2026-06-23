import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { colors } from "../theme";

function smoothPath(coords) {
  if (coords.length <= 1) {
    const [x, y] = coords[0];
    return `M ${x.toFixed(1)} ${y.toFixed(1)}`;
  }

  return coords
    .map(([x, y], i) => {
      if (i === 0) return `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      const [prevX, prevY] = coords[i - 1];
      const dx = (x - prevX) * 0.45;
      return [
        "C",
        (prevX + dx).toFixed(1),
        prevY.toFixed(1),
        (x - dx).toFixed(1),
        y.toFixed(1),
        x.toFixed(1),
        y.toFixed(1),
      ].join(" ");
    })
    .join(" ");
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatPower(value) {
  return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)}kW`;
}

function buildTicks(span, width, mode) {
  if (!span) return [];
  const dayMs = 24 * 60 * 60 * 1000;
  const spanMs = span.end - span.start;
  if (mode === "hour") {
    const interval = 10 * 60 * 1000;
    const first = Math.ceil(span.start / interval) * interval;
    const ticks = [];
    for (let t = first; t <= span.end; t += interval) {
      const x = ((t - span.start) / spanMs) * width;
      const label = t === span.end && spanMs >= dayMs ? "24:00" : formatTime(t);
      ticks.push({ x, label, t });
    }
    return ticks;
  }

  return Array.from({ length: 5 }, (_, index) => {
    const t = span.start + (spanMs * index) / 4;
    const label = spanMs >= dayMs && index === 4 ? "24:00" : formatTime(t);
    return { x: (index / 4) * width, label, t };
  });
}

function interpolatePoint(points, x) {
  if (!points.length) return { x: 0, y: 0, value: 0 };
  if (x <= points[0].x) return { ...points[0], x };
  const last = points[points.length - 1];
  if (x >= last.x) return { ...last, x };

  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const next = points[index];
    if (x <= next.x) {
      const spanX = Math.max(1, next.x - prev.x);
      const ratio = Math.max(0, Math.min(1, (x - prev.x) / spanX));
      return {
        x,
        y: prev.y + (next.y - prev.y) * ratio,
        value: prev.value + (next.value - prev.value) * ratio,
      };
    }
  }

  return { ...last, x };
}

// Lightweight area/line chart over a numeric series. `data` is an array of numbers.
export default function LineChart({
  data = [],
  height = 120,
  color = colors.yellowDeep,
  timeSpan = null,
  fillId = "lcfill",
  valueLabel = null,
  markers = [],
  windowStart = null,
  windowEnd = null,
  width = 320,
  tickMode = "day",
  showCursor = true,
  centerCursor = false,
  maxValue = null,
  onScrubStart,
  onScrubEnd,
}) {
  const [scrubX, setScrubX] = useState(null);
  const scrubActiveRef = useRef(false);
  const holdTimerRef = useRef(null);
  const pendingXRef = useRef(null);

  useEffect(() => () => clearTimeout(holdTimerRef.current), []);
  const W = width;
  const H = height;
  const padTop = 34;
  const padBottom = 32;
  const points = data.length ? data : [0, 0];
  const values = points.map((point) =>
    typeof point === "number" ? point : Number(point.value) || 0
  );
  const max = maxValue != null ? maxValue : Math.max(1, ...values) * 1.14;
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const span =
    windowStart != null && windowEnd != null
      ? { start: windowStart, end: windowEnd }
      : timeSpan === "today"
        ? { start: dayStart, end: dayStart + 24 * 60 * 60 * 1000 }
        : null;
  const n = Math.max(points.length - 1, 1);
  const coords = points.map((point, i) => {
    const value = typeof point === "number" ? point : Number(point.value) || 0;
    const t = typeof point === "number" ? null : point.t;
    const x = span && t != null ? ((t - span.start) / (span.end - span.start)) * W : (i / n) * W;
    return [
      Math.max(0, Math.min(W, x)),
      H - padBottom - (value / max) * (H - padTop - padBottom),
    ];
  });
  const plotted = coords.map(([x, y], index) => ({
    x,
    y,
    value: values[index],
  }));
  const line = smoothPath(coords);
  const area = `${line} L ${W} ${H} L 0 ${H} Z`;
  const latestPoint = plotted[plotted.length - 1];
  const scrubPoint = scrubX == null ? null : interpolatePoint(plotted, scrubX);
  const activePoint = scrubPoint ?? latestPoint;
  const lx = activePoint.x;
  const ly = activePoint.y;
  const label = scrubPoint ? formatPower(scrubPoint.value) : valueLabel ?? formatPower(values[values.length - 1]);
  const labelW = Math.max(44, label.length * 7 + 14);
  const labelX = Math.max(4, Math.min(W - labelW - 4, lx - labelW / 2));
  const labelY = Math.max(2, ly - 44);
  // Fixed cursor pinned to the horizontal center (used by the scrollable hour
  // view, where the centered time sits under a stationary cursor).
  const centerCp = centerCursor ? interpolatePoint(plotted, W / 2) : null;
  const centerLabelTxt = centerCp ? formatPower(centerCp.value) : "";
  const centerLabelW = Math.max(58, centerLabelTxt.length * 7 + 14);
  const centerLabelX = Math.max(4, Math.min(W - centerLabelW - 4, W / 2 - centerLabelW / 2));
  const centerLabelY = centerCp ? Math.max(2, centerCp.y - 44) : 0;
  const ticks = buildTicks(span, W, tickMode);
  const markerPoints = span
    ? markers.map((marker) => ({
        ...marker,
        x: ((marker.t - span.start) / (span.end - span.start)) * W,
      })).filter((marker) => marker.x >= 0 && marker.x <= W)
    : [];

  const handleTouch = (event) => {
    if (!plotted.length || !showCursor) return;
    const localX = Math.max(0, Math.min(W, event.nativeEvent.locationX));
    pendingXRef.current = localX;
    if (scrubActiveRef.current) {
      setScrubX(localX);
    }
  };

  const handleTouchStart = (event) => {
    if (!plotted.length || !showCursor) return;
    const localX = Math.max(0, Math.min(W, event.nativeEvent.locationX));
    pendingXRef.current = localX;
    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      scrubActiveRef.current = true;
      setScrubX(pendingXRef.current);
      onScrubStart?.();
    }, 1000);
  };

  const handleTouchEnd = () => {
    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    if (scrubActiveRef.current) {
      scrubActiveRef.current = false;
      onScrubEnd?.();
    }
  };

  return (
    <View
      style={{ width: W, height: H }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouch}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0.28} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {ticks.map((tick) => (
          <Line
            key={`${tick.t}-guide`}
            x1={tick.x}
            y1={padTop}
            x2={tick.x}
            y2={H - padBottom + 12}
            stroke="rgba(255,255,255,0.16)"
            strokeWidth={1}
          />
        ))}
        {markerPoints.map((marker) => {
          const bandW = 22;
          return (
            <Rect
              key={marker.key ?? marker.t}
              x={Math.max(0, Math.min(W - bandW, marker.x - bandW / 2))}
              y={padTop}
              width={bandW}
              height={H - padTop - padBottom + 12}
              rx={8}
              fill="rgba(255,255,255,0.18)"
            />
          );
        })}
        <Path d={area} fill={`url(#${fillId})`} />
        <Path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={9}
          strokeOpacity={0.1}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <Path
          d={line}
          fill="none"
          stroke="rgba(255,255,255,0.55)"
          strokeWidth={4.5}
          strokeOpacity={0.24}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <Path d={line} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        {showCursor ? (
          <>
            <Line
              x1={lx}
              y1={padTop}
              x2={lx}
              y2={H - padBottom + 12}
              stroke="rgba(255,255,255,0.45)"
              strokeWidth={1}
              strokeDasharray="3 4"
            />
            <Circle cx={lx} cy={ly} r={5.5} fill="rgba(255,255,255,0.72)" />
            <Circle cx={lx} cy={ly} r={3.3} fill={color} />
            <Rect
              x={labelX}
              y={labelY}
              width={labelW}
              height={20}
              rx={10}
              fill={color}
              opacity={0.95}
            />
            <SvgText
              x={labelX + labelW / 2}
              y={labelY + 14}
              fill="#4A3A08"
              fontSize="10"
              fontWeight="800"
              textAnchor="middle"
            >
              {label}
            </SvgText>
          </>
        ) : null}
        {centerCursor && centerCp ? (
          <>
            <Line
              x1={W / 2}
              y1={padTop}
              x2={W / 2}
              y2={H - padBottom + 12}
              stroke="rgba(255,255,255,0.72)"
              strokeWidth={1.5}
              strokeDasharray="4 5"
              strokeLinecap="round"
            />
            <Circle cx={W / 2} cy={centerCp.y} r={5.5} fill="rgba(255,255,255,0.76)" />
            <Circle cx={W / 2} cy={centerCp.y} r={3.3} fill={color} />
            <Rect
              x={centerLabelX}
              y={centerLabelY}
              width={centerLabelW}
              height={20}
              rx={10}
              fill={color}
              opacity={0.96}
            />
            <SvgText
              x={centerLabelX + centerLabelW / 2}
              y={centerLabelY + 14}
              fill="#4A3A08"
              fontSize="10"
              fontWeight="800"
              textAnchor="middle"
            >
              {centerLabelTxt}
            </SvgText>
          </>
        ) : null}
        {ticks.map((tick, index) => (
          <SvgText
            key={`${tick.t}-tick`}
            x={index === 0 ? 2 : index === ticks.length - 1 ? W - 2 : tick.x}
            y={H - 8}
            fill="rgba(255,255,255,0.52)"
            fontSize="9"
            fontWeight="600"
            textAnchor={index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle"}
          >
            {tick.label}
          </SvgText>
        ))}
      </Svg>
      {markerPoints.map((marker) => {
        const left = Math.max(2, Math.min(W - 20, marker.x - 10));
        return (
          <View
            key={`${marker.key ?? marker.t}-external-icon`}
            pointerEvents="none"
            style={[styles.markerIcon, { left, top: 7 }]}
          >
            <Ionicons
              name={marker.icon}
              size={15}
              color="rgba(255,255,255,0.92)"
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  markerIcon: {
    position: "absolute",
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
