import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { generateRawToken, hashToken } from "./crypto";
import type { User } from "@prisma/client";

export const SESSION_COOKIE_NAME = "ringtools_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dagen
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minuten
// Een sessie waarvan de identiteit al vaststaat (magic link/adminwachtwoord)
// maar waarvoor de verplichte MFA-stap nog niet is afgerond, is maar kort
// geldig: lang genoeg om de TOTP/passkey-stap af te ronden, te kort om als
// los "halfingelogd" account te blijven bestaan.
export const AWAITING_MFA_TTL_MS = 10 * 60 * 1000; // 10 minuten
// Hoe lang een geslaagde MFA-verificatie geldt als "recent" voor
// gevoelige acties (beveiligingsinstellingen wijzigen, admin-reset uitvoeren).
export const RECENT_MFA_WINDOW_MS = 15 * 60 * 1000; // 15 minuten

/**
 * Maakt een sessie aan direct na een geslaagde identiteitscontrole (magic
 * link of adminwachtwoord), vóórdat MFA is afgerond. `mfaAt` staat nog op
 * null: zolang dat zo is, geeft `getSessionUser()` (gebruikt door alle
 * overige pagina's/API's/server actions) hoe dan ook geen toegang — zie
 * hieronder. Alleen `getSessionAwaitingMfa()` mag deze sessie lezen, en
 * uitsluitend om de MFA-pagina's te laten weten wie er moet verifiëren.
 */
export async function createSession(userId: string, userAgent?: string | null): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + AWAITING_MFA_TTL_MS);
  await prisma.session.create({
    data: { userId, tokenHash: hashToken(rawToken), expiresAt, userAgent: userAgent || null },
  });
  return { rawToken, expiresAt };
}

/**
 * Geeft de gebruiker terug voor een VOLLEDIG ingelogde sessie, dus
 * uitsluitend als MFA succesvol is afgerond (`mfaAt` gezet). Dit is de ene
 * plek die voor de rest van de applicatie (elke pagina, server action en
 * API-route via requireUser/requireRole/getCurrentUser) bepaalt of iemand
 * toegang heeft — een gedeeltelijk ingelogde gebruiker (wel identiteit, nog
 * geen MFA) komt hier dus nooit doorheen, hoe de sessie ook wordt
 * aangesproken.
 */
export async function getSessionUser(rawToken: string | undefined | null): Promise<User | null> {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (!session.mfaAt) return null;
  if (!session.user.active) return null;
  return session.user;
}

export type ActiveSession = { sessionId: string; mfaAt: Date; user: User };

/**
 * Zoals `getSessionUser`, maar geeft ook het sessie-id en `mfaAt` terug.
 * Nodig op plekken die moeten weten of de MFA-verificatie nog "recent"
 * genoeg is (beveiligingsinstellingen) of die de sessie moeten kunnen
 * roteren (opnieuw verifiëren).
 */
export async function getActiveSession(rawToken: string | undefined | null): Promise<ActiveSession | null> {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const session = await prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (!session.mfaAt || !session.user.active) return null;
  return { sessionId: session.id, mfaAt: session.mfaAt, user: session.user };
}

export type AwaitingMfaSession = { sessionId: string; userId: string; user: User };

/**
 * Geeft de gebruiker terug voor een sessie waarvan de identiteit al
 * vaststaat maar die nog op MFA wacht (`mfaAt` nog null). Wordt uitsluitend
 * gebruikt door de /mfa/*-pagina's en hun server actions/API-routes. Een al
 * volledig ingelogde sessie (mfaAt gezet) levert hier bewust niets op, zodat
 * de MFA-stap niet opnieuw "herspeeld" kan worden na afronding.
 */
export async function getSessionAwaitingMfa(rawToken: string | undefined | null): Promise<AwaitingMfaSession | null> {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const session = await prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (session.mfaAt) return null;
  if (!session.user.active) return null;
  return { sessionId: session.id, userId: session.userId, user: session.user };
}

/**
 * Rondt de MFA-stap af: vervangt de sessie door een nieuwe met een vers
 * token ("vernieuw sessie-identificaties na succesvolle MFA") en de volle
 * levensduur, en zet mfaAt op nu. Wordt zowel bij het inloggen gebruikt
 * (promotie van een wachtende sessie) als bij het later opnieuw
 * verifiëren van een al volledig ingelogde sessie voor gevoelige acties
 * (dezelfde rotatie, gewoon opnieuw toegepast op de huidige sessie-rij).
 */
export async function promoteSessionToMfaVerified(sessionId: string, userId: string, userAgent?: string | null): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { id: sessionId } });
    await tx.session.create({
      data: { userId, tokenHash: hashToken(rawToken), expiresAt, mfaAt: new Date(), userAgent: userAgent || null },
    });
  });
  return { rawToken, expiresAt };
}

export function isRecentlyMfaVerified(mfaAt: Date | null, windowMs: number = RECENT_MFA_WINDOW_MS): boolean {
  return Boolean(mfaAt && Date.now() - mfaAt.getTime() < windowMs);
}

export async function destroySession(rawToken: string | undefined | null): Promise<void> {
  if (!rawToken) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(rawToken) } });
}

export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

export async function listSessionsForUser(userId: string) {
  return prisma.session.findMany({
    where: { userId, mfaAt: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, tokenHash: true, userAgent: true, createdAt: true, expiresAt: true },
  });
}

export async function destroySessionById(userId: string, sessionId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId, userId } });
}

/**
 * Maakt een eenmalige magic-link-token aan. Er wordt uitsluitend de hash
 * opgeslagen; de ruwe token verlaat de server alleen via de verstuurde
 * e-mail-link en mag nooit gelogd worden.
 */
export async function createMagicLinkToken(userId: string): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);
  await prisma.magicLinkToken.create({
    data: { userId, tokenHash: hashToken(rawToken), expiresAt },
  });
  return { rawToken, expiresAt };
}

export type MagicLinkPreview = { valid: boolean; name?: string };

/** Alleen lezen/valideren, zonder de token te verbruiken (voor de bevestigingspagina). */
export async function previewMagicLinkToken(rawToken: string): Promise<MagicLinkPreview> {
  const token = await prisma.magicLinkToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });
  if (!token || token.usedAt || token.expiresAt.getTime() < Date.now() || !token.user.active) {
    return { valid: false };
  }
  return { valid: true, name: token.user.name };
}

/**
 * Verbruikt een magic-link-token (eenmalig) en geeft de bijbehorende
 * gebruiker terug. Dit gebeurt uitsluitend na een expliciete bevestiging
 * door de gebruiker (POST-knop), nooit automatisch bij het openen van de
 * link, zodat e-mailscanners de token niet per ongeluk kunnen verbruiken.
 */
export async function consumeMagicLinkToken(rawToken: string): Promise<User | null> {
  const tokenHash = hashToken(rawToken);
  const token = await prisma.magicLinkToken.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!token || token.usedAt || token.expiresAt.getTime() < Date.now() || !token.user.active) {
    return null;
  }
  await prisma.magicLinkToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
  return token.user;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyAdminPassword(username: string, password: string): Promise<User | null> {
  const user = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!user || !user.active || !user.passwordHash) return null;
  if (user.name.toLowerCase() !== username.trim().toLowerCase()) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}
