import React, { useEffect, useRef, useState } from "react";
import { View, Animated, Easing, StyleSheet } from "react-native";

const DURATION = 340;
const ease = Easing.out(Easing.cubic);

// A single fixed-width character cell. When its char changes it crossfades while
// sliding: upward when the digit increases, downward when it decreases.
function RollingChar({ char, textStyle, width, height }) {
  const [pair, setPair] = useState({ prev: char, next: char });
  const dir = useRef(1);
  const anim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (char === pair.next) return;
    const a = parseInt(pair.next, 10);
    const b = parseInt(char, 10);
    dir.current = !isNaN(a) && !isNaN(b) ? (b >= a ? 1 : -1) : 1;
    setPair({ prev: pair.next, next: char });
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: DURATION,
      easing: ease,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setPair((p) => ({ prev: p.next, next: p.next }));
    });
  }, [char]);

  const animating = pair.prev !== pair.next;
  const up = dir.current >= 0;
  const enter = anim.interpolate({ inputRange: [0, 1], outputRange: [up ? height : -height, 0] });
  const exit = anim.interpolate({ inputRange: [0, 1], outputRange: [0, up ? -height : height] });
  const exitOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <View style={[styles.charBox, { width, height }]}>
      <Animated.Text
        allowFontScaling={false}
        style={[
          textStyle,
          styles.cell,
          { lineHeight: height },
          animating && { opacity: anim, transform: [{ translateY: enter }] },
        ]}
      >
        {pair.next}
      </Animated.Text>
      {animating && (
        <Animated.Text
          allowFontScaling={false}
          style={[
            textStyle,
            styles.cell,
            { lineHeight: height, opacity: exitOpacity, transform: [{ translateY: exit }] },
          ]}
        >
          {pair.prev}
        </Animated.Text>
      )}
    </View>
  );
}

const cellWidth = (c, fontSize) => Math.round(fontSize * (c === "." ? 0.34 : 0.66));

// Renders a live numeric value with a trailing unit. Each digit rolls on change,
// and the unit slides horizontally as the number's width changes. The whole block
// (number + unit) has a deterministic, animated width so it can be centered.
export default function LiveStat({ value, unit = "kW", valueStyle, unitStyle, gap = 8 }) {
  const flat = StyleSheet.flatten(valueStyle) || {};
  const fontSize = flat.fontSize ?? 40;
  const height = Math.round(fontSize * 1.25);

  const chars = String(value).split("");
  const numberWidth = chars.reduce((sum, c) => sum + cellWidth(c, fontSize), 0);

  const widthAnim = useRef(new Animated.Value(numberWidth)).current;
  const gapUnit = useRef(new Animated.Value(gap)).current; // gap + measured unit width
  const unitX = useRef(Animated.add(widthAnim, gap)).current;
  const rowWidth = useRef(Animated.add(widthAnim, gapUnit)).current;
  const [unitW, setUnitW] = useState(0);

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: numberWidth,
      duration: DURATION,
      easing: ease,
      useNativeDriver: false,
    }).start();
  }, [numberWidth]);

  const onUnitLayout = (e) => {
    const w = e.nativeEvent.layout.width;
    if (w !== unitW) {
      setUnitW(w);
      gapUnit.setValue(gap + w);
    }
  };

  return (
    <Animated.View style={[styles.row, { height, width: rowWidth }]}>
      <View style={styles.number}>
        {chars.map((c, i) => (
          <RollingChar
            key={i}
            char={c}
            textStyle={valueStyle}
            width={cellWidth(c, fontSize)}
            height={height}
          />
        ))}
      </View>
      <Animated.Text
        allowFontScaling={false}
        onLayout={onUnitLayout}
        style={[
          unitStyle,
          styles.unit,
          { height, lineHeight: height, transform: [{ translateX: unitX }] },
        ]}
      >
        {unit}
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row" },
  number: { flexDirection: "row" },
  charBox: { overflow: "hidden" },
  cell: { position: "absolute", left: 0, right: 0, textAlign: "center" },
  unit: { position: "absolute", left: 0 },
});
