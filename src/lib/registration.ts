import { randomInt, randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { env } from "./env";
import { hashToken, generateRawToken } from "./crypto";
import { normalizeEmail } from "./invitations";
import { MAGIC_LINK_TTL_MS, MAGIC_CODE_MAX_ATTEMPTS, SESSION_TTL_MS } from "./auth";
import { sendMail, loginCodeEmail } from "./mailer";
import { rateLimit } from "./rateLimit";
import { claimPendingAssignments } from "./declarations/finance";

/**
 * Zelfregistratie van een kerklid (declaratiemodule). Alleen actief met DECLARATIONS_ENABLED. Een onbekend e-mailadres krijgt een
 * eenmalige code (purpose "registration"); pas na bevestiging van die code ontstaat een account met de rol KERKLID en geen lidmaatschap van een ring.
 * Het antwoord verraadt nooit of een adres al bestaat; een bestaand account (ook ambigu) wordt hier nooit overgenomen.
 */
export async function sendRegistrationCode(emailInput: string): Promise<boolean> {
  if (!env.declarationsEnabled) return false;
  const email = normalizeEmail(emailInput);
  // Misbruikbeperking van open registratie: per adres en globaal per uur.
  if (!rateLimit(`registration:${email}`, 3, 60 * 60 * 1000).allowed) return false;
  if (!rateLimit("registration:global", 300, 60 * 60 * 1000).allowed) return false;
  const existing = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE lower(btrim(email)) = ${email} LIMIT 1`;
  if (existing.length) return false;
  const id = randomUUID();
  const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
  await prisma.invitationLoginCode.create({ data: { id, purpose: "registration", email, codeHash: hashToken(`${id}:${code}`), expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS) } });
  try {
    const mail = loginCodeEmail(email.split("@")[0], code);
    await sendMail({ to: email, subject: mail.subject, text: mail.text });
    return true;
  } catch {
    await prisma.invitationLoginCode.deleteMany({ where: { id } });
    return false;
  }
}

function provisionalName(email: string): string {
  const local = email.split("@")[0].replace(/[._+-]+/g, " ").replace(/\d+/g, "").trim();
  return (local ? local.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : "Kerklid").slice(0, 60) || "Kerklid";
}

export async function loginRegisteringPerson(emailInput: string, code: string, userAgent: string): Promise<{ userId: string; token: string; expiresAt: Date } | null> {
  if (!env.declarationsEnabled) return null;
  const email = normalizeEmail(emailInput);
  if (!/^\d{8}$/.test(code)) return null;
  const candidates = await prisma.invitationLoginCode.findMany({ where: { email, purpose: "registration", usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: MAGIC_CODE_MAX_ATTEMPTS } }, orderBy: { createdAt: "desc" }, take: 3 });
  const match = candidates.find((c) => c.codeHash === hashToken(`${c.id}:${code}`));
  if (!match) {
    if (candidates.length) await prisma.invitationLoginCode.updateMany({ where: { id: { in: candidates.map((c) => c.id) } }, data: { attempts: { increment: 1 } } });
    return null;
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${email}, 0))`;
    const existing = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE lower(btrim(email)) = ${email} LIMIT 1`;
    if (existing.length) return null; // nooit een bestaand account (met MFA) omzeilen
    const claimedCode = await tx.invitationLoginCode.updateMany({ where: { id: match.id, usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: MAGIC_CODE_MAX_ATTEMPTS } }, data: { usedAt: new Date() } });
    if (claimedCode.count !== 1) return null;
    const user = await tx.user.create({ data: { email, name: provisionalName(email), role: "KERKLID", active: true, activatedAt: new Date() } });
    // Eerder door een ringbeheerder aangewezen financiële functies voor dit (nu geverifieerde) adres worden hier atomair gekoppeld.
    await claimPendingAssignments(tx, user);
    const token = generateRawToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await tx.session.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt, mfaAt: new Date(), userAgent } });
    return { userId: user.id, token, expiresAt };
  });
}
