import { randomInt, randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { hashToken, generateRawToken } from "./crypto";
import { findLoginInvitation, acceptInvitationsForVerifiedUser, normalizeEmail } from "./invitations";
import { MAGIC_LINK_TTL_MS, MAGIC_CODE_MAX_ATTEMPTS, SESSION_TTL_MS } from "./auth";
import { sendMail, loginCodeEmail } from "./mailer";

/** Voor een uitnodiging zonder account: alleen een kortlevend e-mailbewijs bewaren, geen User aanmaken. */
export async function sendInvitationLoginCode(email: string): Promise<boolean> {
  email = normalizeEmail(email);
  const inv = await findLoginInvitation(email);
  if (!inv) return false;
  // Ambigue oudere accounts mogen nooit via deze route worden overgenomen.
  const existing = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE lower(btrim(email)) = ${email} LIMIT 2`;
  if (existing.length) return false;
  const id = randomUUID();
  const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
  await prisma.invitationLoginCode.create({ data: { id, email, codeHash: hashToken(`${id}:${code}`), expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS) } });
  try {
    const mail = loginCodeEmail(inv.name, code);
    await sendMail({ to: email, subject: mail.subject, text: mail.text });
    return true;
  } catch {
    await prisma.invitationLoginCode.deleteMany({ where: { id } });
    // Geen account enumeration via SMTP-uitkomst.
    return false;
  }
}

export async function loginInvitedPerson(email: string, code: string, userAgent: string) {
  email = normalizeEmail(email);
  if (!/^\d{8}$/.test(code)) return null;
  const candidates = await prisma.invitationLoginCode.findMany({ where: { email, usedAt: null, expiresAt: { gt: new Date() },
    attempts: { lt: MAGIC_CODE_MAX_ATTEMPTS } }, orderBy: { createdAt: "desc" }, take: 3 });
  const match = candidates.find(c => c.codeHash === hashToken(`${c.id}:${code}`));
  if (!match) {
    await prisma.invitationLoginCode.updateMany({ where: { id: { in: candidates.map(c => c.id) } }, data: { attempts: { increment: 1 } } });
    return null;
  }
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${email}, 0))`;
    const inv = await findLoginInvitation(email, tx);
    if (!inv) return null;
    const existing = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE lower(btrim(email)) = ${email} LIMIT 2`;
    if (existing.length) return null; // opnieuw normale code aanvragen, nooit beveiliging van een bestaand account omzeilen
    const claimed = await tx.invitationLoginCode.updateMany({ where: { id: match.id, usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: MAGIC_CODE_MAX_ATTEMPTS } }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) return null;
    const user = await tx.user.create({ data: { email, name: inv.name, role: inv.role, active: true, activatedAt: new Date() } });
    await acceptInvitationsForVerifiedUser(tx, user.id);
    const memberships = await tx.ringMembership.count({ where: { userId: user.id, active: true } });
    if (!memberships) throw new InvitationLoginUnavailable(); // rollback: geen account, activatie of verbruik achterlaten
    const token = generateRawToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await tx.session.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt, mfaAt: new Date(), userAgent } });
    return { userId: user.id, token, expiresAt };
  }).catch(err => { if (err instanceof InvitationLoginUnavailable) return null; throw err; });
}
class InvitationLoginUnavailable extends Error {}
