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

/**
 * Stuurt een pushnotificatie naar alle geregistreerde apparaten van een
 * gebruiker. Verlopen/ongeldige subscriptions (HTTP 404/410 van de pushdienst)
 * worden automatisch opgeruimd. Een mislukte verzending gooit nooit een
 * fout naar de aanroeper: push mag de rest van de workflow nooit blokkeren.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!isPushConfigured()) return 0;

  const user = await prisma.user.findUnique({ where: { id: userId }, include: { pushSubscriptions: true } });
  if (!user || !user.active || user.pushSubscriptions.length === 0) return 0;

  ensureConfigured();

  // Alleen interne doelpaden: een push kan nooit naar een externe site verwijzen.
  const body = JSON.stringify({ ...payload, url: safeInternalPath(payload.url) ?? "/dashboard" });
  let delivered = 0;

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
