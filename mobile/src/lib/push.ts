import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import type { ApiClient } from "./api";
import { storage } from "./storage";

/** Toon meldingen ook als de app open is. De inhoud is generiek (geen namen of functies). */
export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
  });
}

export type PushResult = "registered" | "denied" | "unsupported" | "failed";

/**
 * Vraagt (na een expliciete handeling van de gebruiker) toestemming en registreert het apparaat
 * bij de server. Werkt alleen op een fysiek toestel met een EAS-projectId (zie mobile/README).
 */
export async function registerForPush(api: ApiClient): Promise<PushResult> {
  if (!Device.isDevice) return "unsupported";
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Ringtools",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return "denied";

    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    if (!projectId) return "unsupported";
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.registerDevice(token, Platform.OS === "ios" ? "ios" : "android");
    await storage.setPushToken(token);
    return "registered";
  } catch (err) {
    console.warn("[push] Registreren mislukt:", err);
    return "failed";
  }
}

export async function setBadge(count: number) {
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch {
    /* niet ondersteund: negeren */
  }
}
