import React from "react";
import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/ui/theme";

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  const t = useTheme();
  const { me } = useAuth();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.line },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Overzicht", tabBarIcon: icon("◧"), tabBarBadge: me && me.pendingCount > 0 ? me.pendingCount : undefined }} />
      <Tabs.Screen name="voorstellen" options={{ title: "Voorstellen", tabBarIcon: icon("☰") }} />
      <Tabs.Screen name="meldingen" options={{ title: "Meldingen", tabBarIcon: icon("🔔") }} />
      <Tabs.Screen name="profiel" options={{ title: "Profiel", tabBarIcon: icon("☺") }} />
    </Tabs>
  );
}
