import React from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { colors, radius } from "../theme";

// Horizontal row of selectable chips — a lightweight stand-in for a dropdown.
export default function ChipSelect({ options, value, onChange, label }) {
  return (
    <View style={{ marginBottom: 12 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.row}>
          {options.map((opt) => {
            const val = typeof opt === "object" ? opt.value : opt;
            const text = typeof opt === "object" ? opt.label : String(opt);
            const on = val === value;
            return (
              <Pressable
                key={String(val)}
                onPress={() => onChange(val)}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{text}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.muted, fontSize: 12, marginBottom: 6 },
  row: { flexDirection: "row", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipOn: { backgroundColor: colors.yellow, borderColor: colors.yellowDeep },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  chipTextOn: { color: colors.ink },
});
