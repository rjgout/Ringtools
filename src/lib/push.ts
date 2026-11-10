import { isAllowedPushEndpoint } from "./pushEndpoint";
import { sendApns, sendFcm } from "./nativePush";
import webpush from "web-push";
import { prisma } from "./prisma";
import { env } from "./env";
import { safeInternalPath } from "./safePath";

export class PushNotConfiguredError extends Error {
  constructor() {
    super("Web Push is niet geconfigureerd (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT ontbreken).");
  }
}

let configured = false;
function ensureConfigured() {
  const vapid = env.vapid;
  if (!vapid) throw new PushNotConfiguredError();
  if (!configured) {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    configured = true;
  }
}

export function isPushConfigured(): boolean {
  return env.vapid !== null;
}

export function getPublicVapidKey(): string | null {
  return env.vapid?.publicKey ?? null;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

const WEB_PUSH_TIMEOUT_MS = 10_000;

/** Verstuurt naar de actieve native apparaten via APNs/FCM; ongeldige tokens worden opgeruimd. */
async function sendNativePush(devices: { id: string; token: string; provider: string }[], payload: PushPayload & { url: string }): Promise<number> {
  let delivered = 0;
  await Promise.all(
    devices.map(async (d) => {
      try {
        const result = d.provider === "apns" ? await sendApns(d.token, payload) : await sendFcm(d.token, payload);
        if (result === "ok") delivered += 1;
        else if (result === "invalid-token") await prisma.devicePushToken.delete({ where: { id: d.id } }).catch(() => {});
      } catch (err) {
        console.error(`[push] Versturen naar een ${d.provider}-apparaat mislukt:`, err);
      }
    })
  );
  return delivered;
}

/**
 * Een telefoon met de native app EN een geïnstalleerde PWA/browser-abonnement van hetzelfde
 * platform zou dezelfde melding twee keer tonen. Web-abonnementen van een mobiel platform
 * waarvoor de gebruiker een actief native apparaat heeft, worden daarom overgeslagen.
 * Desktopbrowsers en het andere mobiele platform blijven Web Push ontvangen.
 */
export function webSubscriptionCoveredByNative(userAgent: string | null, nativePlatforms: Set<string>): boolean {
  const ua = userAgent ?? "";
  if (/iPhone|iPad|iPod/i.test(ua)) return nativePlatforms.has("ios");
  if (/Android/i.test(ua)) return nativePlatforms.has("android");
  return false;
}

/**
 * Stuurt een pushnotificatie naar alle geregistreerde apparaten van een gebruiker:
 * webbrowsers/PWA (Web Push) en de native app (APNs/FCM). Verlopen/ongeldige
 * registraties worden automatisch opgeruimd.
 * Een mislukte verzending gooit nooit een fout naar de aanroeper: push mag de rest
 * van de workflow nooit blokkeren. Geeft het aantal geslaagde afleveringen terug.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { pushSubscriptions: true, devicePushTokens: true },
  });
  if (!user || !user.active || user.accountKind !== "NORMAL") return 0;

  // Alleen interne doelpaden: een push kan nooit naar een externe site verwijzen.
  const safe = { ...payload, url: safeInternalPath(payload.url) ?? "/dashboard" };
  const activeDevices = user.devicePushTokens.filter((d) => d.active && (d.provider === "apns" ? env.apns : env.fcm));
  let delivered = await sendNativePush(activeDevices, safe);
  const nativePlatforms = new Set(activeDevices.map((d) => d.platform));

  const webSubs = user.pushSubscriptions.filter((s) => !webSubscriptionCoveredByNative(s.userAgent, nativePlatforms));
  if (!isPushConfigured() || webSubs.length === 0) return delivered;
  ensureConfigured();

  const body = JSON.stringify(safe);

  await Promise.all(
    webSubs.map(async (sub) => {
      // Bestaande rijen met een niet-toegestaan endpoint worden nooit aangeroepen en opgeruimd.
      if (!isAllowedPushEndpoint(sub.endpoint)) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        return;
      }
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          { timeout: WEB_PUSH_TIMEOUT_MS }
        );
        delivered += 1;
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          console.error(`[push] Aflevering mislukt (${statusCode ?? "transport"}).`);
        }
      }
    })
  );
  return delivered;
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  await Promise.all(userIds.map((id) => sendPushToUser(id, payload)));
}
