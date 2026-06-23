import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
  PanResponder,
} from "react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { colors } from "../theme";

// Icon per route name (route names come from the navigator in App.js).
const ICONS = {
  Home: "home",
  Energy: "hardware-chip",
  Analytics: "stats-chart",
  Settings: "settings-sharp",
};

const glass = isLiquidGlassAvailable();
const ITEM = 56;
const PAD_X = 15;
const PAD_Y = 8;
const BAR_RADIUS = 38;
const SELECTOR_WIDTH = 74;
const SELECTOR_HEIGHT = 60;
const SELECTOR_INSET = (ITEM + PAD_Y * 2 - SELECTOR_HEIGHT) / 2;
const SELECTOR_RADIUS = BAR_RADIUS - SELECTOR_INSET;
const ITEM_RADIUS = 26;
const ACTIVE_SCALE = 1.18;

// Custom React Navigation bottom tab bar built on Liquid Glass. Only the glass
// selector moves/scales — the bar itself stays put (no isInteractive, so tapping
// doesn't deform the whole bar). The selector's target X is taken from each tab's
// measured layout, so it always lands dead-centre on the tapped button.
export default function TabBar({ state, navigation }) {
  const index = state.index;
  const { t } = useTranslation();
  const activeRoute = state.routes[index];
  const nestedIndex = activeRoute.state?.index || 0;
  const hiddenForDetail = activeRoute.name === "Energy" && nestedIndex > 0;

  const translateX = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const moveId = useRef(0);
  const dragStartX = useRef(0);
  const dragX = useRef(0);
  const dragActive = useRef(false);
  const holdTimer = useRef(null);
  const barRef = useRef(null);
  const barPageX = useRef(0);
  const indexRef = useRef(index);
  const routesRef = useRef(state.routes);
  const navigationRef = useRef(navigation);
  const skipNextMove = useRef(false);
  const [selectorRaised, setSelectorRaised] = useState(false);
  const xs = useRef([]).current; // measured left of each tab
  const placed = useRef(false); // has the selector been positioned at least once?

  indexRef.current = index;
  routesRef.current = state.routes;
  navigationRef.current = navigation;

  const panResponder = useRef(
    PanResponder.create({
      // Capture the touch at the bar level before the active Pressable claims it.
      // Other icons keep their normal tap behavior.
      onStartShouldSetPanResponderCapture: (event) => {
        const activeX = xs[indexRef.current];
        if (activeX == null) return false;
        const touchX = event.nativeEvent.pageX - barPageX.current;
        return touchX >= activeX - 8 && touchX <= activeX + ITEM + 8;
      },
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => false,
      onPanResponderGrant: () => {
        const x = xs[indexRef.current];
        if (x == null) return;

        dragStartX.current = x;
        dragX.current = x;
        dragActive.current = false;
        clearTimeout(holdTimer.current);
        holdTimer.current = setTimeout(() => {
          dragActive.current = true;
          ++moveId.current;
          translateX.stopAnimation();
          scale.stopAnimation();
          setSelectorRaised(true);
          Animated.timing(scale, {
            toValue: ACTIVE_SCALE,
            duration: 140,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }).start();
        }, 180);
      },
      onPanResponderMove: (_, gesture) => {
        if (!dragActive.current) return;

        const first = xs[0];
        const last = xs[routesRef.current.length - 1];
        if (first == null || last == null) return;

        const x = Math.max(first, Math.min(last, dragStartX.current + gesture.dx));
        dragX.current = x;
        translateX.setValue(x);
      },
      onPanResponderRelease: () => {
        clearTimeout(holdTimer.current);
        if (dragActive.current) {
          finishDrag(true);
          return;
        }
        pressCurrentTab();
      },
      onPanResponderTerminate: () => {
        clearTimeout(holdTimer.current);
        if (dragActive.current) finishDrag(false);
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  function pressCurrentTab() {
    const route = routesRef.current[indexRef.current];
    navigationRef.current.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true,
    });
  }

  function finishDrag(selectNearest) {
    dragActive.current = false;
    const current = indexRef.current;
    let target = current;

    if (selectNearest) {
      target = xs.reduce((nearest, x, i) => {
        if (x == null) return nearest;
        return Math.abs(x - dragX.current) < Math.abs(xs[nearest] - dragX.current)
          ? i
          : nearest;
      }, current);

      const route = routesRef.current[target];
      const event = navigationRef.current.emit({
        type: "tabPress",
        target: route.key,
        canPreventDefault: true,
      });

      if (event.defaultPrevented) {
        target = current;
      } else if (target !== current) {
        skipNextMove.current = true;
        navigationRef.current.navigate(route.name);
      }
    }

    const targetX = xs[target];
    if (targetX == null) return;

    ++moveId.current;
    translateX.stopAnimation();
    scale.stopAnimation();
    setSelectorRaised(false);
    Animated.parallel([
      Animated.spring(translateX, {
        toValue: targetX,
        speed: 15,
        bounciness: 3,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        speed: 10,
        bounciness: 2,
        useNativeDriver: true,
      }),
    ]).start();
  }

  function moveTo(i, animate = true) {
    const x = xs[i];
    if (x == null) return;
    if (!animate) {
      translateX.setValue(x);
      return;
    }

    const id = ++moveId.current;
    translateX.stopAnimation();
    scale.stopAnimation();
    setSelectorRaised(true);

    Animated.spring(translateX, {
      toValue: x,
      speed: 11,
      bounciness: 3,
      useNativeDriver: true,
    }).start();

    Animated.timing(scale, {
      toValue: ACTIVE_SCALE,
      duration: 140,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished || id !== moveId.current) return;

      // Scale back down while the horizontal spring is still settling.
      setSelectorRaised(false);
      Animated.spring(scale, {
        toValue: 1,
        speed: 10,
        bounciness: 2,
        useNativeDriver: true,
      }).start();
    });
  }

  useEffect(() => {
    if (skipNextMove.current) {
      skipNextMove.current = false;
      return;
    }
    if (placed.current) moveTo(index, true);
  }, [index]);

  useEffect(() => () => clearTimeout(holdTimer.current), []);

  const onItemLayout = (i) => (e) => {
    xs[i] = e.nativeEvent.layout.x;
    // Snap (no animation) to the active tab once its position is first known.
    if (i === index && !placed.current) {
      moveTo(index, false);
      placed.current = true;
    }
  };

  const onBarLayout = () => {
    barRef.current?.measureInWindow((x) => {
      barPageX.current = x;
    });
  };

  if (hiddenForDetail) return null;

  // The moving circle: a plain Animated.View (reliable native-driven transforms) with
  // the glass material filling it. Animating the GlassView itself doesn't move it.
  const selector = (
    <Animated.View
      style={[
        styles.selector,
        selectorRaised ? styles.selectorRaised : styles.selectorResting,
        { transform: [{ translateX }, { scale }] },
      ]}
      pointerEvents="none"
    >
      {glass ? (
        <>
          <BlurView
            intensity={2}
            tint="light"
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <GlassView
            glassEffectStyle="clear"
            style={StyleSheet.absoluteFill}
          />
        </>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.selectorFallback]} />
      )}
    </Animated.View>
  );

  const inner = (
    <>
      {selector}
      {state.routes.map((route, i) => {
        const focused = state.index === i;
        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };
        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={t(`nav.${route.name.toLowerCase()}`)}
            onPress={onPress}
            onLayout={onItemLayout(i)}
            style={styles.item}
            hitSlop={8}
          >
            <Ionicons name={ICONS[route.name] || "ellipse"} size={24} color="#fff" />
          </Pressable>
        );
      })}
    </>
  );

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <MaskedView
        pointerEvents="none"
        style={styles.bottomBlur}
        maskElement={
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.35)", "#000"]}
            locations={[0, 0.42, 1]}
            style={StyleSheet.absoluteFill}
          />
        }
      >
        <BlurView intensity={42} tint="default" style={StyleSheet.absoluteFill} />
      </MaskedView>
      <View
        ref={barRef}
        {...panResponder.panHandlers}
        onLayout={onBarLayout}
        style={[styles.bar, !glass && styles.barFallback]}
      >
        {glass ? (
          <>
            <GlassView
              glassEffectStyle="clear"
              tintColor="rgba(0,0,0,0.52)"
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            {/* very subtle blur layered under the glass for extra depth */}
            <BlurView intensity={10} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
          </>
        ) : (
          <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill} pointerEvents="none" />
        )}
        {inner}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 52,
    right: 52,
    bottom: 28,
  },
  bottomBlur: {
    position: "absolute",
    left: -52,
    right: -52,
    bottom: -28,
    height: 150,
  },
  bar: {
    zIndex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: BAR_RADIUS,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.42)",
    paddingHorizontal: PAD_X,
    paddingVertical: PAD_Y,
    overflow: "hidden",
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 12,
  },
  barFallback: {
    borderColor: "rgba(255,255,255,0.45)",
  },
  selector: {
    position: "absolute",
    left: (ITEM - SELECTOR_WIDTH) / 2,
    top: SELECTOR_INSET,
    width: SELECTOR_WIDTH,
    height: SELECTOR_HEIGHT,
    borderRadius: SELECTOR_RADIUS,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.58)",
    overflow: "hidden",
  },
  selectorRaised: {
    zIndex: 2,
  },
  selectorResting: {
    zIndex: 0,
  },
  selectorFallback: {
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  item: {
    zIndex: 1,
    width: ITEM,
    height: ITEM,
    borderRadius: ITEM_RADIUS,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
  },
});
