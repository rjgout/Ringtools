import { prisma } from "./prisma";
import { isAllowedPushEndpoint, isValidPushKey, MAX_PUSH_SUBSCRIPTIONS_PER_USER } from "./pushEndpoint";
import { getPublicVapidKey, isPushConfigured, PushNotConfiguredError, sendPushToUser } from "./push";

/**
 * Webpush (VAPID) per gebruiker: gedeeld door de Server Actions van de bestaande website en de API van de webomgeving (web/PWA).
 * Alle functies werken uitsluitend op de eigen abonnementen van `userId`; meldingen bevatten nooit namen of functies (zie `push.ts`).
 */
export type WebPushResult = { ok: boolean; message: string };
export type WebPushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

export async function subscribeWebPush(userId: string, input: WebPushSubscriptionInput, userAgent?: string): Promise<WebPushResult> {
  if (!isPushConfigured()) return { ok: false, message: "Pushnotificaties zijn niet geconfigureerd door de beheerder." };
  if (!isAllowedPushEndpoint(input?.endpoint) || !isValidPushKey(input.keys?.p256dh, 200) || !isValidPushKey(input.keys?.auth, 100)) {
    return { ok: false, message: "Dit apparaat kan niet worden geregistreerd voor pushnotificaties." };
  }
  const existing = await prisma.pushSubscription.count({ where: { userId, NOT: { endpoint: input.endpoint } } });
  if (existing >= MAX_PUSH_SUBSCRIPTIONS_PER_USER) return { ok: false, message: "Je hebt het maximale aantal apparaten voor pushnotificaties bereikt." };
  const agent = userAgent ? userAgent.slice(0, 300) : undefined;
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    update: { userId, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: agent, lastSeenAt: new Date() },
    create: { userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: agent },
  });
  return { ok: true, message: "Pushnotificaties zijn ingeschakeld voor dit apparaat." };
}

export async function unsubscribeWebPush(userId: string, endpoint: string): Promise<WebPushResult> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
  return { ok: true, message: "Pushnotificaties zijn uitgeschakeld voor dit apparaat." };
}

export async function removeWebPushSubscription(userId: string, id: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { id, userId } });
}

export async function sendTestWebPush(userId: string): Promise<WebPushResult> {
  try {
    if ((await prisma.pushSubscription.count({ where: { userId } })) === 0) return { ok: false, message: "Er is nog geen apparaat geregistreerd voor pushnotificaties." };
    await sendPushToUser(userId, { title: "Ringtools", body: "Dit is een testnotificatie. Als je dit ziet, werken pushnotificaties op dit apparaat.", url: "/profiel" });
    return { ok: true, message: "Testnotificatie verstuurd." };
  } catch (err) {
    if (err instanceof PushNotConfiguredError) return { ok: false, message: err.message };
    console.error("[push] Testnotificatie mislukt:", err instanceof Error ? err.name : "fout");
    return { ok: false, message: "Versturen van de testnotificatie is mislukt." };
  }
}

/** Overzicht voor Profiel: de publieke VAPID-sleutel (niet geheim) en de eigen apparaten. Bevat nooit het endpoint of sleutels. */
export async function webPushOverview(userId: string) {
  const subs = await prisma.pushSubscription.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true, userAgent: true, createdAt: true } });
  return {
    configured: isPushConfigured(),
    publicKey: getPublicVapidKey(),
    subscriptions: subs.map((s) => ({ id: s.id, userAgent: s.userAgent ?? null, createdAt: s.createdAt.toISOString() })),
  };
}
