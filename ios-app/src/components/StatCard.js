import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../theme";
import GlassCard from "./GlassCard";

// Small metric tile on a glass surface: icon chip, label, big value.
export default function StatCard({ icon, label, value, unit, style }) {
  return (
    <GlassCard style={[styles.card, style]}>
      <View style={styles.iconChip}>
        <Ionicons name={icon} size={18} color={colors.ink} />
      </View>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>
        {value}
        {unit ? <Text style={styles.unit}> {unit}</Text> : null}
      </Text>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, padding: 16 },
  iconChip: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.55)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  label: { color: "#5b5852", fontSize: 13, marginBottom: 4 },
  value: { color: colors.ink, fontSize: 24, fontWeight: "700", letterSpacing: -0.5 },
  unit: { fontSize: 15, fontWeight: "600", color: "#6c685f" },
});
