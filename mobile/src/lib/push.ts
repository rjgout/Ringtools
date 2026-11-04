import { PushNotifications } from "@capacitor/push-notifications";
import type { ApiClient } from "./api";
import { storage } from "./storage";
import { isNative, platform } from "./native";

/**
 * Registreert dit toestel voor native pushmeldingen (APNs op iOS, FCM op Android). De toestemming wordt pas
 * gevraagd nadat de gebruiker er zelf om vraagt. Het token wordt nooit gelogd.
 */
export async function registerForPush(api: ApiClient): Promise<{ ok: boolean; message: string }> {
  if (!isNative) return { ok: false, message: "Pushmeldingen zijn alleen beschikbaar in de app op je telefoon of tablet." };

  let permission = await PushNotifications.checkPermissions();
  if (permission.receive === "prompt" || permission.receive === "prompt-with-rationale") {
    permission = await PushNotifications.requestPermissions();
  }
  if (permission.receive !== "granted") {
    return { ok: false, message: "Meldingen zijn niet toegestaan. Zet ze aan in de instellingen van je toestel." };
  }

  const token = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 15_000);
    void PushNotifications.addListener("registration", (t) => {
      clearTimeout(timer);
      resolve(t.value);
    });
    void PushNotifications.addListener("registrationError", () => {
      clearTimeout(timer);
      reject(new Error("registration"));
    });
    void PushNotifications.register();
  }).catch(() => null);
  void PushNotifications.removeAllListeners();

  if (!token) return { ok: false, message: "Registreren voor meldingen is niet gelukt. Probeer het later opnieuw." };
  await api.registerDevice(token, platform === "ios" ? "ios" : "android", await storage.deviceId());
  await storage.setPushToken(token);
  await storage.clearPendingUnregister();
  return { ok: true, message: "Meldingen staan aan voor dit toestel." };
}
