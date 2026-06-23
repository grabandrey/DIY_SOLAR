import React from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { colors, radius } from "../theme";
import { chargePower, gridPower, usedPower, kw } from "../metrics";

const METRIC_LABEL_KEYS = {
  grid_voltage: "gridVoltage",
  grid_frequency: "gridFrequency",
  grid_power: "gridPower",
  ac_input_active_power: "gridPower",
  ac_output_voltage: "outputVoltage",
  ac_output_frequency: "outputFrequency",
  ac_output_apparent_power: "apparentPower",
  ac_output_active_power: "outputPower",
  total_ac_output_apparent_power: "totalApparentPower",
  total_ac_output_active_power: "totalOutputPower",
  output_load_percent: "outputLoad",
  total_output_load_percent: "totalOutputLoad",
  bus_voltage: "busVoltage",
  battery_voltage: "batteryVoltage",
  battery_charge_current: "chargeCurrent",
  battery_discharge_current: "dischargeCurrent",
  battery_capacity: "batteryCapacity",
  battery_ac_charge_power: "acChargePower",
  battery_discharge_power: "dischargePower",
  battery_power: "batteryPower",
  inverter_temperature: "inverterTemperature",
  pv_input_current: "pvCurrent",
  pv_input_voltage: "pvVoltage",
  pv_input_power: "pvPower",
  pv2_voltage: "pv2Voltage",
  pv2_power: "pv2Power",
  pv_energy_today: "pvToday",
  pv_energy_total: "pvTotal",
  battery_voltage_scc: "controllerVoltage",
  total_charge_current: "totalChargeCurrent",
  mode: "operatingMode",
  pack_voltage: "packVoltage",
  pack_current: "packCurrent",
  power: "batteryPower",
  soc: "stateOfCharge",
  soh: "stateOfHealth",
  cell_temp: "cellTemperature",
  cycles: "chargeCycles",
  nominal_capacity: "nominalCapacity",
};

export function metricLabel(key, metric, t) {
  const translationKey = METRIC_LABEL_KEYS[key];
  if (translationKey) return t(`device.metrics.${translationKey}`);
  return metric.label || key.replaceAll("_", " ");
}

export function formatValue(metric) {
  const value =
    typeof metric.value === "number"
      ? Number.isInteger(metric.value)
        ? metric.value
        : metric.value.toFixed(2)
      : metric.value;
  return `${value ?? "—"}${metric.unit ? ` ${metric.unit}` : ""}`;
}

function PowerMetric({ icon, label, value }) {
  return (
    <View style={styles.powerMetric}>
      <Ionicons name={icon} size={19} color={colors.ink} />
      <Text style={styles.powerValue}>{kw(value)} kW</Text>
      <Text style={styles.powerLabel}>{label}</Text>
    </View>
  );
}

export default function DeviceDetail({ reading, onBack }) {
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();

  const metrics = Object.entries(reading?.metrics || {}).sort(([a], [b]) =>
    metricLabel(a, reading.metrics[a], t).localeCompare(
      metricLabel(b, reading.metrics[b], t),
      i18n.resolvedLanguage === "ro" ? "ro" : "en"
    )
  );

  const updated = reading?.ts
    ? new Date(reading.ts).toLocaleTimeString(
        i18n.resolvedLanguage === "ro" ? "ro-RO" : "en-US",
        { hour: "2-digit", minute: "2-digit", second: "2-digit" }
      )
    : "—";

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{
        paddingTop: insets.top + 10,
        paddingBottom: 150,
        paddingHorizontal: 16,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("device.back")}
          onPress={onBack}
          style={styles.backButton}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{reading?.device_name || reading?.device_id}</Text>
          <Text style={styles.subtitle}>
            {reading?.kind || t("common.device")} · {t("device.updated", { time: updated })}
          </Text>
        </View>
      </View>

      <View style={styles.statusRow}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: reading?.online ? colors.green : colors.red },
          ]}
        />
        <Text style={styles.statusText}>
          {reading?.online ? t("common.online") : t("common.offline")}
        </Text>
        <Text style={styles.deviceId}>{reading?.device_id}</Text>
      </View>

      <View style={styles.powerCard}>
        <Text style={styles.sectionTitle}>{t("device.livePower")}</Text>
        <View style={styles.powerRow}>
          <PowerMetric
            icon="sunny-outline"
            label={t("energy.solar")}
            value={chargePower(reading)}
          />
          <PowerMetric
            icon="home-outline"
            label={t("energy.load")}
            value={usedPower(reading)}
          />
          <PowerMetric
            icon="grid-outline"
            label={t("home.grid")}
            value={gridPower(reading)}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t("device.measurements")}</Text>
      <View style={styles.metricsCard}>
        {metrics.length ? (
          metrics.map(([key, metric], index) => (
            <View
              key={key}
              style={[styles.metricRow, index < metrics.length - 1 && styles.metricBorder]}
            >
              <Text style={styles.metricLabel}>{metricLabel(key, metric, t)}</Text>
              <Text style={styles.metricValue}>{formatValue(metric)}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.empty}>{t("device.noMeasurements")}</Text>
        )}
      </View>

      {reading?.error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>{t("device.error")}</Text>
          <Text style={styles.errorText}>{reading.error}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "transparent" },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: { flex: 1, marginLeft: 12 },
  title: { color: colors.ink, fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: "#5F5B53", fontSize: 12, marginTop: 3 },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 7 },
  statusText: { color: colors.ink, fontSize: 13, fontWeight: "600" },
  deviceId: { color: colors.muted, fontSize: 12, marginLeft: "auto" },
  powerCard: {
    backgroundColor: "rgba(251,250,247,0.9)",
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.9)",
    padding: 16,
    marginBottom: 22,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 13,
  },
  powerRow: { flexDirection: "row" },
  powerMetric: { flex: 1 },
  powerValue: { color: colors.ink, fontSize: 17, fontWeight: "800", marginTop: 9 },
  powerLabel: { color: colors.muted, fontSize: 11, marginTop: 2 },
  metricsCard: {
    backgroundColor: "rgba(251,250,247,0.9)",
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.9)",
    paddingHorizontal: 16,
  },
  metricRow: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  metricBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  metricLabel: { color: "#5F5B53", fontSize: 13, flex: 1, textTransform: "capitalize" },
  metricValue: { color: colors.ink, fontSize: 14, fontWeight: "700", textAlign: "right" },
  empty: { color: colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 30 },
  errorCard: {
    backgroundColor: "#FFF0EE",
    borderRadius: radius.sm,
    padding: 14,
    marginTop: 14,
  },
  errorTitle: { color: colors.red, fontSize: 13, fontWeight: "700" },
  errorText: { color: "#7A3833", fontSize: 12, lineHeight: 18, marginTop: 4 },
});
