import React from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import { BackendProvider } from "./src/api";
import { ProfileProvider } from "./src/profile";
import { colors } from "./src/theme";
import TabBar from "./src/components/TabBar";
import HomeScreen from "./src/screens/HomeScreen";
import EnergyScreen from "./src/screens/EnergyScreen";
import AnalyticsScreen from "./src/screens/AnalyticsScreen";
import SettingsScreen from "./src/screens/SettingsScreen";

const Tab = createBottomTabNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <ProfileProvider>
        <BackendProvider>
          <StatusBar style="dark" />
          <NavigationContainer theme={navTheme}>
            <Tab.Navigator
              tabBar={(props) => <TabBar {...props} />}
              screenOptions={{
                headerShown: false,
                sceneStyle: { backgroundColor: colors.bg },
              }}
            >
              <Tab.Screen name="Home" component={HomeScreen} />
              <Tab.Screen name="Energy" component={EnergyScreen} />
              <Tab.Screen name="Analytics" component={AnalyticsScreen} />
              <Tab.Screen name="Settings" component={SettingsScreen} />
            </Tab.Navigator>
          </NavigationContainer>
        </BackendProvider>
      </ProfileProvider>
    </SafeAreaProvider>
  );
}
