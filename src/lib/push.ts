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

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Stuurt via de Expo Push-dienst naar de native iOS/Android-app (APNs/FCM-sleutels
 * staan bij Expo/EAS, niet op deze server). Bevat net als de webpush alleen generieke
 * tekst en een intern pad. Tokens die Expo als ongeldig meldt, worden opgeruimd.
 */
async function sendExpoPush(tokens: { id: string; token: string }[], payload: PushPayload & { url: string }): Promise<number> {
  if (tokens.length === 0) return 0;
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(
        tokens.map((t) => ({
          to: t.token,
          title: payload.title,
          body: payload.body,
          data: { url: payload.url },
          sound: "default",
          channelId: "default",
          ...(payload.tag ? { collapseId: payload.tag } : {}),
        }))
      ),
    });
    if (!res.ok) {
      console.error(`[push] Expo Push antwoordde met status ${res.status}.`);
      return 0;
    }
    const body = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
    let delivered = 0;
    await Promise.all(
      (body.data ?? []).map(async (ticket, i) => {
        if (ticket.status === "ok") delivered += 1;
        else if (ticket.details?.error === "DeviceNotRegistered") {
          await prisma.devicePushToken.delete({ where: { id: tokens[i].id } }).catch(() => {});
        }
      })
    );
    return delivered;
  } catch (err) {
    console.error("[push] Versturen via Expo Push mislukt:", err);
    return 0;
  }
}

/**
 * Stuurt een pushnotificatie naar alle geregistreerde apparaten van een gebruiker:
 * webbrowsers/PWA (Web Push) en de native app (Expo Push). Verlopen/ongeldige
 * registraties (HTTP 404/410 resp. DeviceNotRegistered) worden automatisch opgeruimd.
 * Een mislukte verzending gooit nooit een fout naar de aanroeper: push mag de rest
 * van de workflow nooit blokkeren. Geeft het aantal geslaagde afleveringen terug.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { pushSubscriptions: true, devicePushTokens: true },
  });
  if (!user || !user.active) return 0;

  // Alleen interne doelpaden: een push kan nooit naar een externe site verwijzen.
  const safe = { ...payload, url: safeInternalPath(payload.url) ?? "/dashboard" };
  let delivered = await sendExpoPush(user.devicePushTokens, safe);

  if (!isPushConfigured() || user.pushSubscriptions.length === 0) return delivered;
  ensureConfigured();

  const body = JSON.stringify(safe);

  await Promise.all(
    user.pushSubscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        );
        delivered += 1;
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          console.error(`[push] Versturen naar abonnement van ${user.email} mislukt:`, err);
        }
      }
    })
  );
  return delivered;
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  await Promise.all(userIds.map((id) => sendPushToUser(id, payload)));
}
