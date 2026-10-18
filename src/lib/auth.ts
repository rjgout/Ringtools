import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { generateRawToken, hashToken } from "./crypto";
import type { User } from "@prisma/client";

export const SESSION_COOKIE_NAME = "ringtools_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dagen
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minuten

export async function createSession(userId: string): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { userId, tokenHash: hashToken(rawToken), expiresAt },
  });
  return { rawToken, expiresAt };
}

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
  if (!session.user.active) return null;
  return session.user;
}

export async function destroySession(rawToken: string | undefined | null): Promise<void> {
  if (!rawToken) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(rawToken) } });
}

export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
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
