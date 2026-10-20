import bcrypt from "bcryptjs";
import { randomInt, randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { generateRawToken, hashToken } from "./crypto";
import type { Prisma, User } from "@prisma/client";

export const SESSION_COOKIE_NAME = "ringtools_session";
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Sessietermijnen voor ingelogde sessies (zie README, "Sessies en ingelogd blijven"):
 * - inactiviteitstermijn: 60 dagen zonder gebruik, daarna is opnieuw inloggen nodig;
 *   elk geauthenticeerd gebruik schuift deze termijn op ("sliding");
 * - absolute levensduur: 180 dagen na het inloggen, ook bij dagelijks gebruik;
 * - het token wordt hooguit elke 24 uur geroteerd (zie `rotateSessionIfDue`).
 */
export const SESSION_IDLE_TTL_MS = 60 * DAY_MS;
export const SESSION_ABSOLUTE_TTL_MS = 180 * DAY_MS;
export const SESSION_TTL_MS = SESSION_IDLE_TTL_MS;
/** Hoe vaak de laatste-activiteit/verloopdatum in de database wordt bijgewerkt (voorkomt een schrijfactie per verzoek). */
export const SESSION_TOUCH_INTERVAL_MS = 15 * 60 * 1000;
/** Na hoeveel tijd een token bij gebruik wordt vervangen door een nieuw token. */
export const SESSION_ROTATE_INTERVAL_MS = DAY_MS;
/** Het vorige token blijft zo lang geldig, zodat gelijktijdige verzoeken en een verloren antwoord niet uitloggen. */
export const SESSION_ROTATION_GRACE_MS = 5 * 60 * 1000;
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minuten, gerekend vanaf het versturen van de e-mail
/** Maximaal aantal foute pogingen met de inlogcode per inloglink. */
export const MAGIC_CODE_MAX_ATTEMPTS = 5;
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
 * Maakt direct een volledig ingelogde sessie, voor reguliere gebruikers die
 * (optionele) passkey-verificatie niet hebben ingeschakeld. Nooit voor het
 * adminaccount: dat doorloopt altijd TOTP (zie `mfaRequired`).
 */
export async function createVerifiedSession(userId: string, userAgent?: string | null): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { userId, tokenHash: hashToken(rawToken), expiresAt, mfaAt: new Date(), userAgent: userAgent || null },
  });
  return { rawToken, expiresAt };
}

type SessionRow = Prisma.SessionGetPayload<{ include: { user: true } }>;

/** Verloopdatum voor een sessie die nu actief is: de inactiviteitstermijn, begrensd door de absolute levensduur. */
function nextExpiry(createdAt: Date, now: number = Date.now()): Date {
  return new Date(Math.min(now + SESSION_IDLE_TTL_MS, createdAt.getTime() + SESSION_ABSOLUTE_TTL_MS));
}

/**
 * Zoekt de sessie bij een ruw token. Een token dat net is vervangen door een
 * rotatie blijft kort (SESSION_ROTATION_GRACE_MS) geldig. Verlopen sessies
 * (inactiviteit of absolute levensduur) worden verwijderd en leveren niets op.
 */
async function findLiveSession(rawToken: string | undefined | null): Promise<SessionRow | null> {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  let session = await prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!session) {
    session = await prisma.session.findFirst({
      where: { prevTokenHash: tokenHash, rotatedAt: { gt: new Date(Date.now() - SESSION_ROTATION_GRACE_MS) } },
      include: { user: true },
    });
  }
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() < now || session.createdAt.getTime() + SESSION_ABSOLUTE_TTL_MS < now) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session;
}

/** Schuift de inactiviteitstermijn van een volledig ingelogde sessie op (hooguit eens per SESSION_TOUCH_INTERVAL_MS). */
async function touchSession(session: SessionRow): Promise<void> {
  const now = Date.now();
  if (!session.mfaAt || now - session.lastSeenAt.getTime() < SESSION_TOUCH_INTERVAL_MS) return;
  await prisma.session
    .update({ where: { id: session.id }, data: { lastSeenAt: new Date(now), expiresAt: nextExpiry(session.createdAt, now) } })
    .catch(() => {});
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
  const active = await getActiveSession(rawToken);
  return active?.user ?? null;
}

export type ActiveSession = { sessionId: string; mfaAt: Date; user: User };

/**
 * Zoals `getSessionUser`, maar geeft ook het sessie-id en `mfaAt` terug.
 * Nodig op plekken die moeten weten of de MFA-verificatie nog "recent"
 * genoeg is (beveiligingsinstellingen) of die de sessie moeten kunnen
 * roteren (opnieuw verifiëren). Geauthenticeerd gebruik verlengt de sessie.
 */
export async function getActiveSession(rawToken: string | undefined | null): Promise<ActiveSession | null> {
  const session = await findLiveSession(rawToken);
  if (!session || !session.mfaAt || !session.user.active) return null;
  await touchSession(session);
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
  const session = await findLiveSession(rawToken);
  if (!session || session.mfaAt || !session.user.active) return null;
  return { sessionId: session.id, userId: session.userId, user: session.user };
}

export type SessionRotation =
  | { status: "none" }
  | { status: "ok"; rotated: false }
  | { status: "ok"; rotated: true; rawToken: string; expiresAt: Date };

/**
 * Vernieuwt (roteert) het sessietoken van een volledig ingelogde sessie als
 * het huidige token ouder is dan SESSION_ROTATE_INTERVAL_MS. Het vorige token
 * blijft SESSION_ROTATION_GRACE_MS geldig. De sessie behoudt haar aanmaakdatum,
 * dus de absolute levensduur wordt hiermee niet verlengd. Slechts één van
 * meerdere gelijktijdige aanroepen roteert daadwerkelijk.
 */
export async function rotateSessionIfDue(rawToken: string | undefined | null): Promise<SessionRotation> {
  const session = await findLiveSession(rawToken);
  if (!session || !session.mfaAt || !session.user.active) return { status: "none" };

  const now = Date.now();
  const currentHash = hashToken(rawToken as string);
  const usingPrevious = session.tokenHash !== currentHash;
  const lastRotation = (session.rotatedAt ?? session.createdAt).getTime();
  if (usingPrevious || now - lastRotation < SESSION_ROTATE_INTERVAL_MS) {
    await touchSession(session);
    return { status: "ok", rotated: false };
  }

  const newRaw = generateRawToken();
  const expiresAt = nextExpiry(session.createdAt, now);
  const result = await prisma.session.updateMany({
    where: { id: session.id, tokenHash: currentHash },
    data: {
      tokenHash: hashToken(newRaw),
      prevTokenHash: currentHash,
      rotatedAt: new Date(now),
      lastSeenAt: new Date(now),
      expiresAt,
    },
  });
  if (result.count !== 1) return { status: "ok", rotated: false };
  return { status: "ok", rotated: true, rawToken: newRaw, expiresAt };
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
  const expiresAt = new Date(Date.now() + SESSION_IDLE_TTL_MS);
  await prisma.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { id: sessionId } });
    await tx.session.create({
      data: { userId, tokenHash: hashToken(rawToken), expiresAt, mfaAt: new Date(), userAgent: userAgent || null },
    });
  });
  return { rawToken, expiresAt };
}

/**
 * Moet deze gebruiker een tweede factor doorlopen? De systeemadministrator
 * altijd (TOTP); reguliere gebruikers alleen als zij passkey-verificatie
 * zelf hebben ingeschakeld (standaard uit).
 */
export function mfaRequired(user: { role: string; mfaEnabled: boolean }): boolean {
  return user.role === "ADMIN" || user.mfaEnabled;
}

export function isRecentlyMfaVerified(mfaAt: Date | null, windowMs: number = RECENT_MFA_WINDOW_MS): boolean {
  return Boolean(mfaAt && Date.now() - mfaAt.getTime() < windowMs);
}

export async function destroySession(rawToken: string | undefined | null): Promise<void> {
  if (!rawToken) return;
  const tokenHash = hashToken(rawToken);
  await prisma.session.deleteMany({ where: { OR: [{ tokenHash }, { prevTokenHash: tokenHash }] } });
}

export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

export async function listSessionsForUser(userId: string) {
  return prisma.session.findMany({
    where: { userId, mfaAt: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, tokenHash: true, userAgent: true, createdAt: true, expiresAt: true, lastSeenAt: true },
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
export async function createMagicLinkToken(
  userId: string,
  options: { withCode?: boolean } = {}
): Promise<{ rawToken: string; expiresAt: Date; code?: string }> {
  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);
  const id = randomUUID();
  // Optionele 8-cijferige inlogcode voor een geïnstalleerde PWA: een e-maillink opent
  // op iOS in Safari (apart cookie-opslag), een code kan in de app zelf worden ingevoerd.
  const code = options.withCode ? generateLoginCode() : undefined;
  await prisma.magicLinkToken.create({
    data: { id, userId, tokenHash: hashToken(rawToken), expiresAt, codeHash: code ? hashLoginCode(id, code) : null },
  });
  return { rawToken, expiresAt, code };
}

function generateLoginCode(): string {
  return String(randomInt(0, 100_000_000)).padStart(8, "0");
}

function hashLoginCode(tokenId: string, code: string): string {
  return hashToken(`${tokenId}:${code}`);
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
 * Het verbruiken is atomair: bij gelijktijdige aanvragen slaagt er precies één.
 */
export async function consumeMagicLinkToken(rawToken: string): Promise<User | null> {
  const tokenHash = hashToken(rawToken);
  const token = await prisma.magicLinkToken.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!token || token.usedAt || token.expiresAt.getTime() < Date.now() || !token.user.active) {
    return null;
  }
  const claimed = await prisma.magicLinkToken.updateMany({
    where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  return claimed.count === 1 ? token.user : null;
}

/**
 * Inloggen met de 8-cijferige code uit de inlogmail (voor de geïnstalleerde PWA).
 * Zelfde eenmalige token als de link: gebruik van de code maakt de link ongeldig en omgekeerd.
 * Na MAGIC_CODE_MAX_ATTEMPTS foute pogingen is de code onbruikbaar.
 */
export async function consumeLoginCode(email: string, code: string): Promise<User | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active || !/^\d{8}$/.test(code)) return null;

  const tokens = await prisma.magicLinkToken.findMany({
    where: {
      userId: user.id,
      usedAt: null,
      expiresAt: { gt: new Date() },
      codeHash: { not: null },
      codeAttempts: { lt: MAGIC_CODE_MAX_ATTEMPTS },
    },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  if (tokens.length === 0) return null;

  const match = tokens.find((t) => t.codeHash === hashLoginCode(t.id, code));
  if (!match) {
    await prisma.magicLinkToken.updateMany({ where: { id: { in: tokens.map((t) => t.id) } }, data: { codeAttempts: { increment: 1 } } });
    return null;
  }
  const claimed = await prisma.magicLinkToken.updateMany({
    where: { id: match.id, usedAt: null, expiresAt: { gt: new Date() }, codeAttempts: { lt: MAGIC_CODE_MAX_ATTEMPTS } },
    data: { usedAt: new Date() },
  });
  return claimed.count === 1 ? user : null;
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

/** Ruimt verlopen sessies en verbruikte/verlopen inloglinks op (nachtelijke taak). */
export async function deleteExpiredAuthData(): Promise<{ sessions: number; magicLinks: number }> {
  const now = new Date();
  const sessions = await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  const magicLinks = await prisma.magicLinkToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } }, { usedAt: { not: null } }] },
  });
  return { sessions: sessions.count, magicLinks: magicLinks.count };
}
