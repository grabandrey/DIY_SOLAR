import React from "react";
import { View, Text, Image, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { colors, radius } from "../theme";
import { DEVICE_IMAGE_OPTIONS, DEVICE_IMAGES } from "../deviceImages";

// Horizontal selector of device photos (plus a "None" option) used when setting up or
// editing a device. The chosen key is stored on the device config as `image`.
export default function DeviceImagePicker({ value, onChange, label }) {
  const { t } = useTranslation();

  const renderOption = (key, content, selected) => (
    <Pressable
      key={key || "none"}
      onPress={() => onChange(key)}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.option, selected && styles.optionSelected]}
    >
      {content}
    </Pressable>
  );

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label ?? t("settings.deviceImage")}</Text>
      <View style={styles.row}>
        {renderOption(
          null,
          <View style={styles.none}>
            <Ionicons name="ban-outline" size={22} color={colors.muted} />
            <Text style={styles.noneText}>{t("settings.imageNone")}</Text>
          </View>,
          !value
        )}
        {DEVICE_IMAGE_OPTIONS.map((opt) =>
          renderOption(
            opt.key,
            <>
              <Image source={DEVICE_IMAGES[opt.key]} style={styles.thumb} resizeMode="contain" />
              <Text style={styles.optionText} numberOfLines={1}>
                {opt.label}
              </Text>
            </>,
            value === opt.key
          )
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  label: { color: colors.muted, fontSize: 12, marginBottom: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  option: {
    width: 78,
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  optionSelected: { borderColor: colors.yellowDeep, backgroundColor: colors.cardAlt },
  thumb: { width: 48, height: 48, marginBottom: 4 },
  optionText: { color: colors.ink, fontSize: 11, fontWeight: "600" },
  none: { width: 48, height: 48, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  noneText: { color: colors.muted, fontSize: 11, fontWeight: "600" },
});
