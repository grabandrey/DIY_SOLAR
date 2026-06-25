import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Image,
  ScrollView,
  StyleSheet,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { colors, radius } from "../theme";
import {
  batteryCurrent,
  batteryPower,
  batteryVoltage,
  chargePower,
  gridPower,
  usedPower,
  kw,
} from "../metrics";
import { useDeviceNames, resolveDeviceName } from "../deviceNames";
import { deviceImageSource } from "../deviceImages";

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

function LiveMetric({ icon, label, value, unit, style }) {
  return (
    <View
      style={[styles.liveMetric, style]}
      accessibilityLabel={`${label}: ${value} ${unit}`}
    >
      <Ionicons name={icon} size={18} color={colors.ink} />
      <View style={styles.liveMetricCopy}>
        <Text style={styles.liveValue}>
          {value} <Text style={styles.liveUnit}>{unit}</Text>
        </Text>
        <Text style={styles.liveLabel}>{label}</Text>
      </View>
    </View>
  );
}

export default function DeviceDetail({ reading, image, onBack }) {
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const { names, setName } = useDeviceNames();
  const displayName = resolveDeviceName(names, reading);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const startEdit = () => {
    setDraft(displayName);
    setEditing(true);
  };
  const commitEdit = () => {
    if (reading?.device_id) setName(reading.device_id, draft);
    setEditing(false);
  };

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
  const imageSource = deviceImageSource(image);
  const liveStats =
    reading?.kind === "bms"
      ? [
          {
            icon: "battery-charging-outline",
            label: t("device.metrics.batteryVoltage"),
            value: batteryVoltage(reading).toFixed(1),
            unit: "V",
          },
          {
            icon: "pulse-outline",
            label: t("home.batteryCurrent"),
            value: batteryCurrent(reading).toFixed(1),
            unit: "A",
          },
          {
            icon: "speedometer-outline",
            label: t("device.metrics.batteryPower"),
            value: kw(Math.abs(batteryPower(reading))),
            unit: "kW",
          },
        ]
      : [
          {
            icon: "sunny-outline",
            label: t("energy.solar"),
            value: kw(chargePower(reading)),
            unit: "kW",
          },
          {
            icon: "home-outline",
            label: t("energy.load"),
            value: kw(usedPower(reading)),
            unit: "kW",
          },
          {
            icon: "grid-outline",
            label: t("home.grid"),
            value: kw(gridPower(reading)),
            unit: "kW",
          },
        ];

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
          {editing ? (
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={commitEdit}
              onBlur={commitEdit}
              autoFocus
              returnKeyType="done"
              selectTextOnFocus
              placeholder={reading?.device_name || reading?.device_id}
              placeholderTextColor={colors.muted}
              style={[styles.title, styles.titleInput]}
            />
          ) : (
            <Pressable
              onPress={startEdit}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t("device.renameLabel", { name: displayName })}
              style={styles.titleRow}
            >
              <Text style={styles.title} numberOfLines={1}>
                {displayName}
              </Text>
              <Ionicons name="pencil" size={16} color={colors.muted} />
            </Pressable>
          )}
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

      <View
        style={[
          styles.deviceOverview,
          reading?.kind === "bms" && styles.batteryOverview,
        ]}
      >
        <View
          style={[
            styles.deviceImageWrap,
            reading?.kind === "bms" && styles.batteryImageWrap,
          ]}
        >
          {imageSource ? (
            <View style={styles.deviceImageShadow}>
              <Image
                source={imageSource}
                style={styles.deviceImage}
                resizeMode="contain"
              />
            </View>
          ) : (
            <Ionicons
              name="hardware-chip-outline"
              size={56}
              color={colors.muted}
            />
          )}
        </View>
        <View
          style={[
            styles.liveStats,
            reading?.kind === "bms" && styles.batteryLiveStats,
          ]}
        >
          {liveStats.map((stat) => (
            <LiveMetric
              key={stat.label}
              {...stat}
              style={reading?.kind === "bms" && styles.batteryLiveMetric}
            />
          ))}
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
  screen: { flex: 1, backgroundColor: colors.white },
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
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  titleInput: { padding: 0, margin: 0 },
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
  deviceOverview: {
    minHeight: 230,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 26,
  },
  batteryOverview: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 6,
  },
  deviceImageWrap: {
    width: "55%",
    height: 220,
    alignItems: "center",
    justifyContent: "center",
  },
  batteryImageWrap: {
    width: "100%",
    height: 230,
  },
  deviceImageShadow: {
    width: "125%",
    height: "125%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.24,
    shadowRadius: 14,
  },
  deviceImage: { width: "100%", height: "100%" },
  liveStats: { flex: 1, gap: 18 },
  batteryLiveStats: {
    width: "100%",
    flex: 0,
    flexDirection: "row",
    gap: 8,
  },
  liveMetric: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  batteryLiveMetric: { flex: 1 },
  liveMetricCopy: { flex: 1 },
  liveValue: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  liveUnit: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  liveLabel: { color: colors.muted, fontSize: 11, marginTop: 1 },
  sectionTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 13,
  },
  metricsCard: {
    backgroundColor: colors.card,
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
