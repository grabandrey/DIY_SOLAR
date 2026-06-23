import React from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors } from "../theme";
import { useCurrentBackground } from "../background";

export default function TimeGradientBackground({ children }) {
  const background = useCurrentBackground();

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={background.gradient}
        locations={[0, 0.48, 1]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
