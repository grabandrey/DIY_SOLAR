import React, { useEffect, useRef } from "react";
import { View, Text, Animated, Pressable, StyleSheet } from "react-native";
import { colors } from "../theme";

// A centred ruler timeline, the same shape as the day selector on the slay
// professional booking page: each period is a tick whose height, weight and colour
// grow as it approaches the middle of the viewport, with the centred one selected.
// Scrolling snaps by one item, so the selection settles rather than landing between
// two periods.
//
// Built on React Native's Animated rather than Reanimated (this app does not use
// Reanimated). Height, width and colour are not native-driver properties, so the
// scroll position stays on the JS driver.

const TICK_MIN_HEIGHT = 14;
const TICK_MAX_HEIGHT = 38;
const TICK_MIN_WIDTH = 2;
const TICK_MAX_WIDTH = 3.5;
// How many items either side still get some influence: ticks fall off over 2 slots,
// the text over a slightly tighter 1.75 so labels sharpen a touch sooner.
const TICK_FALLOFF = 2;
const TEXT_FALLOFF = 1.75;
// The strip is a fixed box. The tick is the only thing whose *height* animates, so it
// lives in a slot of its own at the tallest size it can reach and grows upward from
// the bottom of that slot. Without this the strip would resize on every scroll frame
// and shove the page around. Label scaling is a transform, which never affects layout.
const TICK_SLOT_HEIGHT = TICK_MAX_HEIGHT;
const STRIP_HEIGHT = TICK_SLOT_HEIGHT + 8 + 19 + 14 + 4;

function RulerItem({ item, index, itemWidth, scrollX, onPress }) {
  const band = (falloff) =>
    scrollX.interpolate({
      inputRange: [
        (index - falloff) * itemWidth,
        index * itemWidth,
        (index + falloff) * itemWidth,
      ],
      outputRange: [0, 1, 0],
      extrapolate: "clamp",
    });

  const tick = band(TICK_FALLOFF);
  const text = band(TEXT_FALLOFF);
  const to = (influence, from, until) =>
    influence.interpolate({ inputRange: [0, 1], outputRange: [from, until] });

  return (
    <Pressable
      onPress={onPress}
      style={[styles.item, { width: itemWidth }]}
      accessibilityRole="button"
      accessibilityLabel={item.label}
    >
      <View style={styles.tickSlot}>
        <Animated.View
          style={[
            styles.tick,
            {
              height: to(tick, TICK_MIN_HEIGHT, TICK_MAX_HEIGHT),
              width: to(tick, TICK_MIN_WIDTH, TICK_MAX_WIDTH),
              opacity: to(tick, 0.34, 1),
              backgroundColor: tick.interpolate({
                inputRange: [0, 1],
                outputRange: ["rgba(255,255,255,0.25)", colors.white],
              }),
            },
          ]}
        />
      </View>
      <Animated.Text
        allowFontScaling={false}
        numberOfLines={1}
        style={[
          styles.label,
          {
            opacity: to(text, 0.54, 1),
            transform: [{ scale: to(text, 0.82, 1.14) }],
            color: text.interpolate({
              inputRange: [0, 1],
              outputRange: ["rgba(255,255,255,0.45)", colors.white],
            }),
          },
        ]}
      >
        {item.label}
      </Animated.Text>
      {item.sublabel ? (
        <Animated.Text
          allowFontScaling={false}
          numberOfLines={1}
          style={[
            styles.sublabel,
            {
              opacity: to(text, 0.56, 1),
              transform: [{ scale: to(text, 0.9, 1.04) }],
              color: text.interpolate({
                inputRange: [0, 1],
                outputRange: ["rgba(255,255,255,0.32)", "rgba(255,255,255,0.8)"],
              }),
            },
          ]}
        >
          {item.sublabel}
        </Animated.Text>
      ) : null}
    </Pressable>
  );
}

export default function PeriodRuler({
  items,
  value,
  onChange,
  viewportWidth,
  itemWidth = 66,
}) {
  const scrollRef = useRef(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  // Live scroll offset, so the centring effect can tell "the selection moved because
  // the user scrolled here" (already centred, leave it alone) from "the selection was
  // changed elsewhere" (glide to it).
  const offset = useRef(0);
  const mounted = useRef(false);
  const fromScroll = useRef(false);
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.value === value)
  );

  // Half a viewport of padding on each side lets the first and last items reach the
  // centre line like every other one. `viewportWidth` must be the strip's own rendered
  // width — this component runs edge to edge (see `wrap`), so that is the full screen
  // width, not the page's padded content width. Passing the narrower figure silently
  // parks the selected item off-centre by the size of the gutter.
  const sidePadding = Math.max(0, (viewportWidth - itemWidth) / 2);

  // Keep the selected item on the centre line. First measure jumps; a change from
  // outside glides. A change the scroll itself produced is skipped entirely — the
  // item is already centred by then, and scrolling again would fight the platform's
  // snap animation, which is what makes the strip stutter.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || selectedIndex < 0 || !itemWidth) return;
    if (fromScroll.current) {
      fromScroll.current = false;
      return;
    }
    const target = selectedIndex * itemWidth;
    if (Math.abs(offset.current - target) < 1) return;
    const animated = mounted.current;
    const id = requestAnimationFrame(() => {
      node.scrollTo({ x: target, animated });
      if (!animated) {
        offset.current = target;
        scrollX.setValue(target);
      }
      mounted.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, [selectedIndex, itemWidth, items.length, scrollX]);

  // Read the settled position and commit it. Positioning is left to `snapToInterval`,
  // which has already parked the strip on an exact multiple of one item — issuing our
  // own scrollTo here would interrupt that animation mid-flight.
  const settle = (event) => {
    const index = Math.min(
      Math.max(Math.round(event.nativeEvent.contentOffset.x / itemWidth), 0),
      items.length - 1
    );
    const next = items[index];
    if (next && next.value !== value) {
      fromScroll.current = true;
      onChange(next.value);
    }
  };

  return (
    <View style={styles.wrap}>
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate={0.985}
        snapToInterval={itemWidth}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingHorizontal: sidePadding }}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          {
            useNativeDriver: false,
            listener: (e) => {
              offset.current = e.nativeEvent.contentOffset.x;
            },
          }
        )}
        // Only momentum end. `snapToInterval` always runs a snap animation on release,
        // so this fires once the strip has actually parked; committing on drag end too
        // would read a mid-snap position and re-render the ticks against a moving target.
        onMomentumScrollEnd={settle}
      >
        {items.map((item, index) => (
          <RulerItem
            key={item.value}
            item={item}
            index={index}
            itemWidth={itemWidth}
            scrollX={scrollX}
            onPress={() => {
              // Selecting is enough — the centring effect owns the scroll, so doing
              // it here as well would start a second animation to the same offset.
              if (item.value !== value) onChange(item.value);
              else scrollRef.current?.scrollTo({ x: index * itemWidth, animated: true });
            }}
          />
        ))}
      </Animated.ScrollView>
    </View>
  );
}

// White labels sit over a light gradient, so they carry the same shadow the rest of
// the app uses for white text on variable backdrops.
const textShadow = {
  textShadowColor: "rgba(0,0,0,0.32)",
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 6,
};

const styles = StyleSheet.create({
  wrap: { marginHorizontal: -16, height: STRIP_HEIGHT, marginBottom: 18 },
  item: { alignItems: "center", height: STRIP_HEIGHT, paddingTop: 2 },
  // Fixed slot; the tick is bottom-anchored inside it and grows upward.
  tickSlot: { height: TICK_SLOT_HEIGHT, justifyContent: "flex-end", marginBottom: 8 },
  tick: { borderRadius: 2 },
  label: { fontSize: 15, fontWeight: "800", letterSpacing: -0.3, ...textShadow },
  sublabel: { fontSize: 10, fontWeight: "600", marginTop: 1, ...textShadow },
});
