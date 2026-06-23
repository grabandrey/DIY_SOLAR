import React from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import { BackendProvider } from "./src/api";
import { ProfileProvider } from "./src/profile";
import { colors } from "./src/theme";
import { useCurrentBackground, statusBarStyleForKey } from "./src/background";
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

// Status bar follows the time-of-day zone: white icons at dawn/evening/night,
// black icons during the bright daytime.
function TimeAwareStatusBar() {
  const background = useCurrentBackground();
  return <StatusBar style={statusBarStyleForKey(background.key)} />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ProfileProvider>
        <BackendProvider>
          <TimeAwareStatusBar />
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
