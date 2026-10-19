import * as OTPAuth from "otpauth";
import crypto from "crypto";
import { prisma } from "./prisma";
import { encryptSecret, decryptSecret, hashToken } from "./crypto";
import { logSecurityEvent } from "./securityEvents";

const ISSUER = "Ringtools";
const PERIOD_SECONDS = 30;
const DIGITS = 6;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const RECOVERY_CODE_COUNT = 8;

function buildTotp(secretBase32: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

function currentCounter(): number {
  return Math.floor(Date.now() / 1000 / PERIOD_SECONDS);
}

/**
 * Maakt (of overschrijft) een nog niet bevestigde TOTP-inschrijving voor een
 * gebruiker en geeft de otpauth://-URI (voor de QR-code) en het leesbare
 * secret terug. Een reeds bevestigde inschrijving wordt pas definitief
 * vervangen zodra de nieuwe code succesvol bevestigd wordt
 * (`confirmTotpEnrollment`); tot die tijd blijft de oude, bevestigde
 * instelling (indien aanwezig) intact en bruikbaar om in te loggen.
 */
export async function startTotpEnrollment(userId: string, label: string, forceNew = false): Promise<{ uri: string; secret: string }> {
  // Hergebruik een al lopende, nog niet bevestigde inschrijving zodat de
  // QR-code niet verandert bij het verversen van de pagina — tenzij
  // `forceNew` is gevraagd (expliciet opnieuw instellen vanuit het profiel).
  const existing = await prisma.totpCredential.findUnique({ where: { userId } });
  if (!forceNew && existing && !existing.confirmedAt) {
    const secretBase32 = decryptSecret(existing.secretEncrypted);
    return { uri: buildTotp(secretBase32, label).toString(), secret: secretBase32 };
  }

  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = buildTotp(secret.base32, label);

  await prisma.totpCredential.upsert({
    where: { userId },
    update: { secretEncrypted: encryptSecret(secret.base32), confirmedAt: null, lastUsedCounter: null, failedAttempts: 0, lockedUntil: null },
    create: { userId, secretEncrypted: encryptSecret(secret.base32) },
  });

  return { uri: totp.toString(), secret: secret.base32 };
}

export type TotpOutcome = "OK" | "INVALID" | "LOCKED" | "NOT_CONFIGURED";

/**
 * Verifieert een TOTP-code tegen de (nog niet per se bevestigde) instelling
 * van de gebruiker. Voorkomt hergebruik van dezelfde geldige code (de
 * bijbehorende tijdstap wordt pas als "gebruikt" vastgelegd bij een
 * geslaagde verificatie) en past een persistente lockout toe na te veel
 * mislukte pogingen, zodat die ook een herstart van de container overleeft.
 */
export async function verifyTotpCode(userId: string, label: string, code: string): Promise<TotpOutcome> {
  const credential = await prisma.totpCredential.findUnique({ where: { userId } });
  if (!credential) return "NOT_CONFIGURED";

  if (credential.lockedUntil && credential.lockedUntil.getTime() > Date.now()) {
    return "LOCKED";
  }

  const secretBase32 = decryptSecret(credential.secretEncrypted);
  const totp = buildTotp(secretBase32, label);
  const delta = totp.validate({ token: code.trim(), window: 1 });

  const matchedCounter = delta === null ? null : currentCounter() + delta;
  const isReplay = matchedCounter !== null && credential.lastUsedCounter !== null && matchedCounter <= credential.lastUsedCounter;

  if (matchedCounter === null || isReplay) {
    const failedAttempts = credential.failedAttempts + 1;
    const lockedUntil = failedAttempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS) : null;
    await prisma.totpCredential.update({ where: { userId }, data: { failedAttempts, lockedUntil } });
    await logSecurityEvent({
      userId,
      type: lockedUntil ? "TOTP_LOCKED" : "TOTP_FAILED_ATTEMPT",
      detail: isReplay ? "Code al eerder gebruikt" : "Ongeldige code",
    });
    return lockedUntil ? "LOCKED" : "INVALID";
  }

  await prisma.totpCredential.update({
    where: { userId },
    data: { lastUsedCounter: matchedCounter, failedAttempts: 0, lockedUntil: null },
  });
  return "OK";
}

/** Bevestigt een lopende TOTP-inschrijving en genereert nieuwe herstelcodes. */
export async function confirmTotpEnrollment(userId: string, label: string, code: string): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; outcome: TotpOutcome }> {
  const outcome = await verifyTotpCode(userId, label, code);
  if (outcome !== "OK") return { ok: false, outcome };

  await prisma.totpCredential.update({ where: { userId }, data: { confirmedAt: new Date() } });
  const recoveryCodes = await regenerateRecoveryCodes(userId);
  await logSecurityEvent({ userId, type: "TOTP_ENROLLED" });
  return { ok: true, recoveryCodes };
}

export async function isTotpConfirmed(userId: string): Promise<boolean> {
  const credential = await prisma.totpCredential.findUnique({ where: { userId } });
  return Boolean(credential?.confirmedAt);
}

function randomRecoveryCode(): string {
  // 10 willekeurige tekens uit een leesbare alfabet (geen 0/O/1/I), in twee
  // groepen van vijf voor leesbaarheid: bv. "A3F7K-9MXQD".
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 10; i++) {
    if (i === 5) out += "-";
    out += alphabet[crypto.randomInt(alphabet.length)];
  }
  return out;
}

/**
 * Vervangt alle bestaande herstelcodes door een nieuwe set van 8. De ruwe
 * codes worden teruggegeven zodat de aanroeper ze één keer kan tonen; alleen
 * de hash wordt opgeslagen.
 */
export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, randomRecoveryCode);
  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId } }),
    prisma.recoveryCode.createMany({ data: codes.map((code) => ({ userId, codeHash: hashToken(code) })) }),
  ]);
  return codes;
}

/** Verbruikt een herstelcode (eenmalig). */
export async function consumeRecoveryCode(userId: string, rawCode: string): Promise<boolean> {
  const codeHash = hashToken(rawCode.trim().toUpperCase());
  const result = await prisma.recoveryCode.updateMany({
    where: { userId, codeHash, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (result.count > 0) {
    await logSecurityEvent({ userId, type: "RECOVERY_CODE_USED" });
    return true;
  }
  return false;
}
