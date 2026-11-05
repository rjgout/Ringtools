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

const PENDING_SECRET_TTL_MS = 30 * 60 * 1000;

/**
 * Maakt een TOTP-inschrijving en geeft de otpauth://-URI (voor de QR-code) en
 * het leesbare secret terug.
 *
 * - Nog geen (bevestigde) TOTP: de rij zelf blijft onbevestigd tot de code klopt
 *   (login-inschrijving; het wachtwoord alleen is dan al de enige factor).
 * - `forceNew` bij een BEVESTIGDE TOTP (opnieuw instellen): het nieuwe secret wordt
 *   apart in `pendingSecretEncrypted` bewaard. Het werkende secret en
 *   `confirmedAt` blijven onaangeroerd, zodat een niet afgeronde herinschrijving
 *   de login nooit terugbrengt tot alleen een wachtwoord. Pas
 *   `confirmTotpEnrollment` wisselt het secret om.
 */
export async function startTotpEnrollment(userId: string, label: string, forceNew = false): Promise<{ uri: string; secret: string }> {
  const existing = await prisma.totpCredential.findUnique({ where: { userId } });

  if (existing?.confirmedAt) {
    // Een bevestigde TOTP wordt hier alleen via een expliciet opnieuw instellen (forceNew) aangeraakt.
    if (!forceNew) throw new Error("TOTP is al bevestigd.");
    const secret = new OTPAuth.Secret({ size: 20 });
    await prisma.totpCredential.update({
      where: { userId },
      data: { pendingSecretEncrypted: encryptSecret(secret.base32), pendingCreatedAt: new Date() },
    });
    return { uri: buildTotp(secret.base32, label).toString(), secret: secret.base32 };
  }

  // Hergebruik een al lopende, nog niet bevestigde inschrijving zodat de QR-code niet verandert.
  if (!forceNew && existing) {
    const secretBase32 = decryptSecret(existing.secretEncrypted);
    return { uri: buildTotp(secretBase32, label).toString(), secret: secretBase32 };
  }

  const secret = new OTPAuth.Secret({ size: 20 });
  await prisma.totpCredential.upsert({
    where: { userId },
    update: { secretEncrypted: encryptSecret(secret.base32), confirmedAt: null, lastUsedCounter: null, failedAttempts: 0, lockedUntil: null, pendingSecretEncrypted: null, pendingCreatedAt: null },
    create: { userId, secretEncrypted: encryptSecret(secret.base32) },
  });
  return { uri: buildTotp(secret.base32, label).toString(), secret: secret.base32 };
}

export type TotpOutcome = "OK" | "INVALID" | "LOCKED" | "NOT_CONFIGURED";

/**
 * Registreert een mislukte poging atomair (`increment`, geen lees-schrijf-race tussen gelijktijdige pogingen) en vergrendelt bij de
 * vijfde fout. Geeft terug of de instelling nu vergrendeld is.
 */
async function registerFailedAttempt(userId: string): Promise<boolean> {
  const updated = await prisma.totpCredential.update({ where: { userId }, data: { failedAttempts: { increment: 1 } } });
  if (updated.failedAttempts < MAX_FAILED_ATTEMPTS) return false;
  await prisma.totpCredential.update({ where: { userId }, data: { lockedUntil: new Date(Date.now() + LOCKOUT_MS) } });
  return true;
}

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

  async function fail(detail: string): Promise<TotpOutcome> {
    const locked = await registerFailedAttempt(userId);
    await logSecurityEvent({ userId, type: locked ? "TOTP_LOCKED" : "TOTP_FAILED_ATTEMPT", detail });
    return locked ? "LOCKED" : "INVALID";
  }

  if (matchedCounter === null || isReplay) return fail(isReplay ? "Code al eerder gebruikt" : "Ongeldige code");

  // Atomair "claimen" van deze tijdstap: alleen de aanroep die lastUsedCounter werkelijk verhoogt, slaagt. Twee gelijktijdige
  // verzoeken met dezelfde code zien allebei een oude waarde, maar de voorwaarde in de UPDATE laat er precies één door.
  const claimed = await prisma.totpCredential.updateMany({
    where: { userId, OR: [{ lastUsedCounter: null }, { lastUsedCounter: { lt: matchedCounter } }] },
    data: { lastUsedCounter: matchedCounter, failedAttempts: 0, lockedUntil: null },
  });
  if (claimed.count !== 1) return fail("Code al eerder gebruikt");
  return "OK";
}

/** Bevestigt een lopende TOTP-inschrijving en genereert nieuwe herstelcodes. */
export async function confirmTotpEnrollment(
  userId: string,
  label: string,
  code: string,
  opts: { issueRecoveryCodes?: boolean } = {}
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; outcome: TotpOutcome }> {
  const credential = await prisma.totpCredential.findUnique({ where: { userId } });
  const pendingValid =
    !!credential?.pendingSecretEncrypted && !!credential.pendingCreatedAt && Date.now() - credential.pendingCreatedAt.getTime() <= PENDING_SECRET_TTL_MS;

  if (credential && pendingValid) {
    // Opnieuw instellen: de code moet kloppen met het NIEUWE secret; dat vervangt dan het oude.
    if (credential.lockedUntil && credential.lockedUntil.getTime() > Date.now()) return { ok: false, outcome: "LOCKED" };
    const pendingBase32 = decryptSecret(credential.pendingSecretEncrypted as string);
    const delta = buildTotp(pendingBase32, label).validate({ token: code.trim(), window: 1 });
    if (delta === null) {
      const locked = await registerFailedAttempt(userId);
      await logSecurityEvent({ userId, type: locked ? "TOTP_LOCKED" : "TOTP_FAILED_ATTEMPT", detail: "Ongeldige code (opnieuw instellen)" });
      return { ok: false, outcome: locked ? "LOCKED" : "INVALID" };
    }
    await prisma.totpCredential.update({
      where: { userId },
      data: {
        secretEncrypted: credential.pendingSecretEncrypted as string,
        pendingSecretEncrypted: null,
        pendingCreatedAt: null,
        confirmedAt: new Date(),
        lastUsedCounter: currentCounter() + delta,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });
    const recoveryCodes = opts.issueRecoveryCodes === false ? [] : await regenerateRecoveryCodes(userId);
    await logSecurityEvent({ userId, type: "TOTP_ENROLLED" });
    return { ok: true, recoveryCodes };
  }

  // Eerste inschrijving: bevestig het (onbevestigde) secret van de rij zelf. Een al
  // bevestigde TOTP zonder lopende herinschrijving is hier niets te bevestigen.
  if (credential?.confirmedAt) return { ok: false, outcome: "INVALID" };
  const outcome = await verifyTotpCode(userId, label, code);
  if (outcome !== "OK") return { ok: false, outcome };

  await prisma.totpCredential.update({ where: { userId }, data: { confirmedAt: new Date() } });
  const recoveryCodes = opts.issueRecoveryCodes === false ? [] : await regenerateRecoveryCodes(userId);
  await logSecurityEvent({ userId, type: "TOTP_ENROLLED" });
  return { ok: true, recoveryCodes };
}

/** Verwijdert de TOTP-instelling en alle herstelcodes van een gebruiker (beheer door de gebruiker zelf of reset door webmin). */
export async function removeTotp(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId } }),
    prisma.totpCredential.deleteMany({ where: { userId } }),
  ]);
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
