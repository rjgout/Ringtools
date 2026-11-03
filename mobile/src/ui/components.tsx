import React from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "./theme";

export function Screen({
  children,
  onRefresh,
  refreshing = false,
  padded = true,
}: {
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  padded?: boolean;
}) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={{ padding: padded ? 16 : 0, paddingBottom: 32, gap: 14 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} /> : undefined}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.cardBorder }, style]}>{children}</View>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.h1, { color: t.text }]}>{children}</Text>;
}

export function H2({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.h2, { color: t.text }]}>{children}</Text>;
}

export function Muted({ children, small }: { children: React.ReactNode; small?: boolean }) {
  const t = useTheme();
  return <Text style={{ color: t.muted, fontSize: small ? 12 : 14 }}>{children}</Text>;
}

export function Body({ children, bold }: { children: React.ReactNode; bold?: boolean }) {
  const t = useTheme();
  return <Text style={{ color: t.text, fontSize: 15, fontWeight: bold ? "600" : "400" }}>{children}</Text>;
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "success" | "danger" | "warning" }) {
  const t = useTheme();
  const color = tone === "success" ? t.success : tone === "danger" ? t.danger : tone === "warning" ? t.warning : t.primary;
  return (
    <View style={[styles.badge, { backgroundColor: t.chip }]}>
      <Text style={{ color, fontSize: 12, fontWeight: "600" }}>{children}</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = "primary",
  busy,
  disabled,
  small,
  testID,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "success" | "danger" | "ghost";
  busy?: boolean;
  disabled?: boolean;
  small?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const bg = variant === "primary" ? t.primary : variant === "success" ? t.success : variant === "danger" ? t.danger : "transparent";
  const fg = variant === "ghost" ? t.primary : variant === "primary" ? t.primaryText : "#ffffff";
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1, borderColor: variant === "ghost" ? t.line : bg },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: "600", fontSize: small ? 13 : 16 }}>{title}</Text>}
    </Pressable>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ padding: 24, alignItems: "center" }}>
      <Text style={{ color: t.muted, textAlign: "center" }}>{children}</Text>
    </View>
  );
}

export function ErrorText({ children }: { children?: string | null }) {
  const t = useTheme();
  if (!children) return null;
  return (
    <Text accessibilityRole="alert" style={{ color: t.danger, fontSize: 14 }}>
      {children}
    </Text>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap: 10 }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 10 },
  h1: { fontSize: 26, fontWeight: "700" },
  h2: { fontSize: 18, fontWeight: "600" },
  badge: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  button: { minHeight: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, borderWidth: 1 },
  buttonSmall: { minHeight: 36, borderRadius: 10, paddingHorizontal: 12 },
});
