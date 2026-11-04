import { PushNotifications } from "@capacitor/push-notifications";
import type { PluginListenerHandle } from "@capacitor/core";
import type { ApiClient } from "./api";
import { storage } from "./storage";
import { isNative, platform } from "./native";

/**
 * Wacht tot de OS-registratie een pushtoken oplevert. Beheert UITSLUITEND de listeners die deze functie zelf
 * registreert (registration/registrationError) en ruimt precies die weer op. Nooit `removeAllListeners()`
 * gebruiken: dat zou ook de listener voor `pushNotificationActionPerformed` (tikken op een melding, door
 * App.tsx geregistreerd) verwijderen.
 */
export async function obtainPushToken(timeoutMs = 15_000): Promise<string | null> {
  const handles: PluginListenerHandle[] = [];
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      void (async () => {
        handles.push(
          await PushNotifications.addListener("registration", (t) => {
            clearTimeout(timer);
            resolve(t.value);
          })
        );
        handles.push(
          await PushNotifications.addListener("registrationError", () => {
            clearTimeout(timer);
            reject(new Error("registration"));
          })
        );
        await PushNotifications.register();
      })().catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  } catch {
    return null;
  } finally {
    await Promise.all(handles.map((h) => h.remove().catch(() => {})));
  }
}

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

  const token = await obtainPushToken();
  if (!token) return { ok: false, message: "Registreren voor meldingen is niet gelukt. Probeer het later opnieuw." };
  await api.registerDevice(token, platform === "ios" ? "ios" : "android", await storage.deviceId());
  await storage.setPushToken(token);
  await storage.clearPendingUnregister();
  return { ok: true, message: "Meldingen staan aan voor dit toestel." };
}
