import React, { useEffect, useRef, useState } from "react";
import {
  Modal,
  View,
  Text,
  Image,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
  PanResponder,
  Dimensions,
} from "react-native";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { colors, radius } from "../theme";
import { deviceImageSource } from "../deviceImages";

const glass = isLiquidGlassAvailable();
const ROW_H = 66;
const SCREEN_H = Dimensions.get("window").height;
const SLIDE_DURATION = 430;
const LONG_PRESS_MS = 160;
const REORDER_DURATION = 170;

// A native slide-up sheet (same presentation as the battery sheet on Home) with a
// hold-and-drag reorderable list of devices. Reordering uses PanResponder + Animated
// (no extra native deps): a short hold arms the drag, the row follows the finger while
// the others animate into open slots, and the new order is saved on close.
export default function ReorderModal({ visible, title, items, onClose, onSave }) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const translateY = useRef(new Animated.Value(SCREEN_H)).current;
  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState(items);

  const [dragId, setDragId] = useState(null);
  const startIndexRef = useRef(0);
  const hoverRef = useRef(0);
  const activeRef = useRef(false);
  const holdTimer = useRef(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const respondersRef = useRef({});
  const positionsRef = useRef({});

  const positionFor = (id, index) => {
    if (!positionsRef.current[id]) {
      positionsRef.current[id] = new Animated.Value(index * ROW_H);
    }
    return positionsRef.current[id];
  };

  const setPositions = (orderedItems) => {
    orderedItems.forEach((item, index) => {
      positionFor(item.id, index).setValue(index * ROW_H);
    });
  };

  useEffect(() => {
    if (visible) {
      setData(items); // snapshot the current order each time it opens
      setPositions(items);
      setMounted(true);
      translateY.setValue(SCREEN_H);
      Animated.timing(translateY, {
        toValue: 0,
        duration: SLIDE_DURATION,
        easing: Easing.out(Easing.back(0.7)),
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(translateY, {
        toValue: SCREEN_H,
        duration: SLIDE_DURATION,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => finished && setMounted(false));
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const indexOfId = (id) => dataRef.current.findIndex((d) => d.id === id);

  const animateOpenSlots = (draggingId, hoverIndex) => {
    const draggingIndex = indexOfId(draggingId);
    dataRef.current.forEach((item, index) => {
      if (item.id === draggingId) return;
      const compactedIndex = index < draggingIndex ? index : index - 1;
      const targetIndex = compactedIndex < hoverIndex ? compactedIndex : compactedIndex + 1;
      Animated.timing(positionFor(item.id, index), {
        toValue: targetIndex * ROW_H,
        duration: REORDER_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  };

  const finishDrag = () => {
    clearTimeout(holdTimer.current);
    if (!activeRef.current) return;
    activeRef.current = false;
    const from = startIndexRef.current;
    const to = hoverRef.current;
    const next = dataRef.current.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    Animated.timing(positionFor(moved.id, from), {
      toValue: to * ROW_H,
      duration: REORDER_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setData(next);
      setPositions(next);
      setDragId(null);
    });
  };

  const responderFor = (id) => {
    if (respondersRef.current[id]) return respondersRef.current[id];
    const pan = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => activeRef.current && Math.abs(g.dy) > 2,
      onPanResponderGrant: () => {
        const idx = indexOfId(id);
        startIndexRef.current = idx;
        hoverRef.current = idx;
        holdTimer.current = setTimeout(() => {
          activeRef.current = true;
          setPositions(dataRef.current);
          setDragId(id);
        }, LONG_PRESS_MS);
      },
      onPanResponderMove: (_, g) => {
        if (!activeRef.current) {
          // Movement before the hold fires means it's a tap/scroll, not a drag — cancel.
          if (Math.abs(g.dy) > 8 || Math.abs(g.dx) > 8) clearTimeout(holdTimer.current);
          return;
        }
        positionFor(id, startIndexRef.current).setValue(
          startIndexRef.current * ROW_H + g.dy
        );
        const raw = startIndexRef.current + Math.round(g.dy / ROW_H);
        const clamped = Math.max(0, Math.min(dataRef.current.length - 1, raw));
        if (clamped !== hoverRef.current) {
          hoverRef.current = clamped;
          animateOpenSlots(id, clamped);
        }
      },
      onPanResponderRelease: finishDrag,
      onPanResponderTerminate: finishDrag,
    });
    respondersRef.current[id] = pan;
    return pan;
  };

  const save = () => {
    onSave(dataRef.current.map((d) => d.id));
    onClose();
  };

  if (!mounted) return null;

  return (
    <Modal visible animationType="none" transparent onRequestClose={save}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={save} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          {glass ? <GlassView glassEffectStyle="clear" style={StyleSheet.absoluteFill} /> : null}
          <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, styles.tint]} />
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <Pressable onPress={save} hitSlop={10}>
              <Text style={styles.done}>{t("common.done")}</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>{t("settings.reorderHint")}</Text>

          <View style={[styles.list, { height: data.length * ROW_H, marginBottom: insets.bottom + 8 }]}>
            {data.map((item, idx) => {
              const dragging = item.id === dragId;
              const source = deviceImageSource(item.image);
              return (
                <Animated.View
                  key={item.id}
                  {...responderFor(item.id).panHandlers}
                  style={[
                    styles.row,
                    {
                      transform: [
                        { translateY: positionFor(item.id, idx) },
                        { scale: dragging ? 1.03 : 1 },
                      ],
                      zIndex: dragging ? 10 : 0,
                    },
                  ]}
                >
                  <View style={[styles.rowInner, dragging && styles.rowDragging]}>
                    {source ? (
                      <Image source={source} style={styles.thumb} resizeMode="contain" />
                    ) : (
                      <View style={styles.thumb} />
                    )}
                    <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                    <Ionicons name="reorder-three" size={26} color="rgba(255,255,255,0.55)" />
                  </View>
                </Animated.View>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end", backgroundColor: "transparent" },
  sheet: {
    maxHeight: "88%",
    backgroundColor: "transparent",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderCurve: "continuous",
    overflow: "hidden",
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  tint: { backgroundColor: "rgba(0,0,0,0.6)" },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.5)",
    marginBottom: 12,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.white, fontSize: 24, fontWeight: "800", letterSpacing: -0.4, flex: 1, marginRight: 12 },
  done: { color: colors.white, fontSize: 16, fontWeight: "700" },
  hint: { color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 6, marginBottom: 16 },
  list: { position: "relative" },
  row: { position: "absolute", left: 0, right: 0, height: ROW_H, paddingVertical: 4 },
  rowInner: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.16)",
  },
  rowDragging: { backgroundColor: "rgba(255,255,255,0.2)" },
  thumb: { width: 40, height: 40 },
  rowName: { flex: 1, color: colors.white, fontSize: 16, fontWeight: "600" },
});
