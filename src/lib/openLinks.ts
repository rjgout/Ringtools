import { prisma } from "./prisma";
import { env } from "./env";
import { generateRawToken, hashToken } from "./crypto";
import { sendPushToUser, isPushConfigured } from "./push";
import { createMagicLinkToken } from "./auth";
import { sendMail, magicLinkEmail } from "./mailer";

/** Hoe lang een persoonlijke koppeling uit een e-mail bruikbaar is. */
export const OPEN_LINK_TTL_MS = 72 * 60 * 60 * 1000;
/** Minimale tijd tussen twee meldingen via dezelfde koppeling, en het maximum per koppeling. */
export const OPEN_LINK_PUSH_COOLDOWN_MS = 2 * 60 * 1000;
export const OPEN_LINK_MAX_PUSHES = 5;

/**
 * Maakt een persoonlijke koppeling naar één voorstel voor in een e-mail. Het token
 * geeft geen toegang en logt niet in; het laat de ontvanger alleen kiezen hoe hij
 * verdergaat (zie /open/[token]). Alleen de hash wordt opgeslagen.
 */
export async function createOpenLink(userId: string, callingId: string): Promise<string> {
  const rawToken = generateRawToken();
  await prisma.openLinkToken.create({
    data: { userId, callingId, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + OPEN_LINK_TTL_MS) },
  });
  return `${env.appBaseUrl}/open/${rawToken}`;
}

export type OpenLinkInfo = { valid: false } | { valid: true; callingId: string; path: string };

/** Valideert een koppeling zonder iets te verbruiken of gegevens over het voorstel prijs te geven. */
export async function resolveOpenLink(rawToken: string): Promise<OpenLinkInfo> {
  const token = await prisma.openLinkToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true, calling: { select: { id: true, ringId: true } } },
  });
  if (!token || token.expiresAt.getTime() < Date.now() || !token.user.active) return { valid: false };
  const member = await prisma.ringMembership.findFirst({
    where: { userId: token.userId, ringId: token.calling.ringId, active: true },
    select: { id: true },
  });
  if (!member) return { valid: false };
  return { valid: true, callingId: token.callingId, path: `/roepingen/${token.callingId}` };
}

export type OpenLinkPushResult = "sent" | "no-devices" | "push-unavailable" | "throttled" | "invalid";

/**
 * Stuurt na een expliciete handeling een generieke pushmelding naar de geregistreerde
 * apparaten van de eigenaar van de koppeling. De melding bevat geen persoonsgegevens
 * en geen authenticatietoken: alleen een intern pad. Wie erop tikt, komt in de app
 * en moet daar gewoon zijn eigen sessie en ringrechten hebben.
 */
export async function sendOpenLinkPush(rawToken: string): Promise<OpenLinkPushResult> {
  const info = await resolveOpenLink(rawToken);
  if (!info.valid) return "invalid";
  if (!isPushConfigured()) return "push-unavailable";

  const tokenHash = hashToken(rawToken);
  const token = await prisma.openLinkToken.findUniqueOrThrow({ where: { tokenHash } });

  const subscriptions = await prisma.pushSubscription.count({ where: { userId: token.userId } });
  if (subscriptions === 0) return "no-devices";

  // Atomisch "claimen": herhaald of gelijktijdig klikken geeft maximaal één melding per termijn.
  const claimed = await prisma.openLinkToken.updateMany({
    where: {
      id: token.id,
      pushCount: { lt: OPEN_LINK_MAX_PUSHES },
      OR: [{ lastPushAt: null }, { lastPushAt: { lt: new Date(Date.now() - OPEN_LINK_PUSH_COOLDOWN_MS) } }],
    },
    data: { pushCount: { increment: 1 }, lastPushAt: new Date() },
  });
  if (claimed.count !== 1) return "throttled";

  const delivered = await sendPushToUser(token.userId, {
    title: "Ringtools",
    body: "Er staat een melding voor je klaar. Tik om Ringtools te openen.",
    url: info.path,
    tag: "open-link",
  });
  return delivered > 0 ? "sent" : "no-devices";
}

export type OpenLinkMailResult = "mail-sent" | "mail-failed" | "throttled" | "invalid";

/**
 * Stuurt (na een expliciete handeling) een gewone inloglink naar het e-mailadres van de
 * eigenaar, met het voorstel als bestemming. Het adres is al bekend, dus de ontvanger hoeft
 * het niet nog eens in te typen; de link zelf komt, zoals altijd, alleen in zijn eigen inbox.
 */
export async function sendOpenLinkLoginMail(rawToken: string): Promise<OpenLinkMailResult> {
  const info = await resolveOpenLink(rawToken);
  if (!info.valid) return "invalid";
  const token = await prisma.openLinkToken.findUniqueOrThrow({ where: { tokenHash: hashToken(rawToken) }, include: { user: true } });

  const claimed = await prisma.openLinkToken.updateMany({
    where: { id: token.id, OR: [{ lastMailAt: null }, { lastMailAt: { lt: new Date(Date.now() - OPEN_LINK_PUSH_COOLDOWN_MS) } }] },
    data: { lastMailAt: new Date() },
  });
  if (claimed.count !== 1) return "throttled";

  try {
    const { rawToken: loginToken, code } = await createMagicLinkToken(token.userId, { withCode: true });
    const link = `${env.appBaseUrl}/auth/magic/${loginToken}?redirect=${encodeURIComponent(info.path)}`;
    const { subject, text } = magicLinkEmail(token.user.name, link, code);
    await sendMail({ to: token.user.email, subject, text });
    return "mail-sent";
  } catch (err) {
    console.error("[openlink] Inlogmail versturen mislukt:", err);
    return "mail-failed";
  }
}

/** Ruimt verlopen koppelingen op (nachtelijke taak). */
export async function deleteExpiredOpenLinks(): Promise<number> {
  const res = await prisma.openLinkToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return res.count;
}
