import React, { useEffect, useRef } from "react";
import { Stack, useRouter, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { ActivityIndicator, View } from "react-native";
import { AuthProvider, useAuth } from "@/lib/auth";
import { configureNotificationHandler } from "@/lib/push";
import { parseTarget, routeFor } from "@/lib/links";
import { useTheme } from "@/ui/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});
configureNotificationHandler();

/** Wacht met navigeren tot de gebruiker is ingelogd; de oorspronkelijke bestemming blijft bewaard. */
function Gate() {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const pending = useRef<string | null>(null);
  const t = useTheme();

  useEffect(() => {
    if (status !== "loading") SplashScreen.hideAsync().catch(() => {});
  }, [status]);

  useEffect(() => {
    if (status === "signedOut" && pathname !== "/login") {
      if (pathname !== "/" && pathname !== "/index") pending.current = pathname;
      router.replace("/login");
    }
    if (status === "signedIn" && pathname === "/login") {
      const next = pending.current ?? "/";
      pending.current = null;
      router.replace(next as never);
    }
  }, [status, pathname, router]);

  // Tik op een pushmelding: alleen bekende interne routes (voorstel); rechten worden op de server gecontroleerd.
  useEffect(() => {
    const open = (url: unknown) => {
      const target = parseTarget(typeof url === "string" ? url : null);
      if (target) router.push(routeFor(target) as never);
    };
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data?.url));
    Notifications.getLastNotificationResponseAsync().then((r) => r && open(r.notification.request.content.data?.url));
    return () => sub.remove();
  }, [router]);

  if (status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg }}>
        <ActivityIndicator color={t.primary} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="roepingen/[id]" options={{ headerShown: true, title: "Voorstel", headerBackTitle: "Terug" }} />
      <Stack.Screen name="nieuw" options={{ headerShown: true, title: "Nieuw voorstel", presentation: "modal" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <Gate />
    </AuthProvider>
  );
}
