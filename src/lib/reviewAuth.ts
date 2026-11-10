import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { rateLimit } from "./rateLimit";
import { generateRawToken, hashToken } from "./crypto";
import { SESSION_TTL_MS } from "./auth";
import { ApiError } from "./api/http";

const INVALID = "E-mailadres of wachtwoord is onjuist, of het demoaccount is niet beschikbaar.";
const WINDOW = 15 * 60 * 1000;
// Gelijke bcrypt-kosten voor een onbekend adres; dit is een hash zonder bruikbaar account/wachtwoord.
const DUMMY = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.5aVEW8OHLjG5wE70p/PnGN1jR3VsA7K";
export async function loginReviewAccount(email: string, password: string, clientKey: string) {
  email = email.trim().toLowerCase();
  if (!rateLimit(`review-ip:${clientKey}`, 20, WINDOW).allowed || !rateLimit(`review-login:${email}`, 5, WINDOW).allowed) {
    throw new ApiError(429, "Te veel pogingen. Probeer het over 15 minuten opnieuw.", "rate-limited");
  }
  const u = await prisma.user.findUnique({ where: { email }, include: { reviewCredential: true, reviewRing: true } });
  const validShape = u?.accountKind === "REVIEW" && u.role !== "ADMIN" && u.active && u.reviewRing?.active && u.reviewRing.isDemo && !u.reviewRing.demoResetting;
  const credential = validShape ? u?.reviewCredential : null;
  const plausible = password.length >= 1 && Buffer.byteLength(password, "utf8") <= 72;
  const proved = await bcrypt.compare(plausible ? password : "invalid", credential?.passwordHash ?? DUMMY);
  const ok = await prisma.$transaction(async tx => {
    if (!u || !credential) return false;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${u.id} FOR UPDATE`;
    const current = await tx.user.findUnique({ where: { id: u.id }, include: { reviewCredential: true, reviewRing: true } });
    const c = current?.reviewCredential;
    if (!current?.active || current.accountKind !== "REVIEW" || current.role === "ADMIN" || !current.reviewRing?.active || !current.reviewRing.isDemo || current.reviewRing.demoResetting || !c || c.passwordHash !== credential.passwordHash) return false;
    if (c.lockedUntil && c.lockedUntil > new Date()) return false;
    if (!plausible || !proved) {
      const attempts = c.lockedUntil && c.lockedUntil <= new Date() ? 1 : c.failedAttempts + 1;
      await tx.reviewCredential.update({ where: { userId: u.id }, data: { failedAttempts: attempts, lockedUntil: attempts >= 5 ? new Date(Date.now() + WINDOW) : null } });
      await tx.securityEvent.create({ data: { userId: u.id, type: "REVIEW_LOGIN_FAILED" } });
      return false;
    }
    await tx.reviewCredential.update({ where: { userId: u.id }, data: { failedAttempts: 0, lockedUntil: null } });
    const token = generateRawToken(); const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await tx.session.create({ data: { userId: u.id, tokenHash: hashToken(token), expiresAt, mfaAt: new Date(), userAgent: "Ringtools-app (review)" } });
    await tx.securityEvent.create({ data: { userId: u.id, type: "REVIEW_LOGIN" } });
    return { userId: u.id, token, expiresAt };
  });
  if (!ok) throw new ApiError(401, INVALID, "invalid-review-login");
  return ok;
}
