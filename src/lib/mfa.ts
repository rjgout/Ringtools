import * as OTPAuth from "otpauth";
import crypto from "crypto";
import { prisma } from "./prisma";
import { encryptSecret, decryptSecret, hashToken } from "./crypto";
import { logSecurityEvent } from "./securityEvents";
import { autoEnableMfaAfterFirstMethod, usableMethodCount } from "./autoMfa";

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

const LOCKOUT_MINUTES = LOCKOUT_MS / 60000;

/**
 * Registreert een mislukte poging in één SQL-statement (tellen; een eerder verlopen lockout begint de teller opnieuw) en
 * vergrendelt bij de vijfde fout. Databaseklok (UTC). Geeft terug of de instelling nu vergrendeld is.
 */
async function registerFailedAttempt(userId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ locked: boolean }[]>`
    UPDATE "TotpCredential" SET
      "failedAttempts" = CASE WHEN "lockedUntil" IS NOT NULL AND "lockedUntil" <= timezone('UTC', now()) THEN 1 ELSE "failedAttempts" + 1 END,
      "lockedUntil" = CASE WHEN "lockedUntil" IS NOT NULL AND "lockedUntil" <= timezone('UTC', now()) THEN NULL ELSE "lockedUntil" END
    WHERE "userId" = ${userId}
    RETURNING "failedAttempts" >= ${MAX_FAILED_ATTEMPTS} AS locked`;
  if (!rows[0]?.locked) return false;
  await prisma.$executeRaw`UPDATE "TotpCredential" SET "lockedUntil" = timezone('UTC', now()) + make_interval(mins => ${LOCKOUT_MINUTES}::int) WHERE "userId" = ${userId} AND "lockedUntil" IS NULL`;
  return true;
}

/**
 * Claimt een TOTP-tijdstap atomair. Slaagt alleen als de teller strikt oploopt (geen replay) EN de instelling niet vergrendeld is
 * (ook niet "bijna": failedAttempts < MAX dekt het venster tussen tellen en vergrendelen) — alles in dezelfde UPDATE. Een code
 * wordt dus nooit geaccepteerd nadat een lockout effectief is geworden; gelijktijdige verzoeken serialiseren op de rij.
 */
export async function claimTotpStep(userId: string, counter: number): Promise<boolean> {
  const count = await prisma.$executeRaw`
    UPDATE "TotpCredential" SET "lastUsedCounter" = ${counter}, "failedAttempts" = 0, "lockedUntil" = NULL
    WHERE "userId" = ${userId}
      AND ("lastUsedCounter" IS NULL OR "lastUsedCounter" < ${counter})
      AND ("lockedUntil" IS NULL OR "lockedUntil" <= timezone('UTC', now()))
      AND ("lockedUntil" IS NOT NULL OR "failedAttempts" < ${MAX_FAILED_ATTEMPTS})`;
  return count === 1;
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
  if (!(await claimTotpStep(userId, matchedCounter))) {
    // Vergrendeld, replay of gelijktijdig geclaimd: een geldige code telt dan niet.
    const fresh = await prisma.totpCredential.findUnique({ where: { userId } });
    if (fresh?.lockedUntil && fresh.lockedUntil.getTime() > Date.now()) return "LOCKED";
    return fail("Code al eerder gebruikt");
  }
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
  const userRow = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  const hadUsableMethodBefore = !userRow || (await usableMethodCount(userId, userRow.role)) > 0;
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
    // Alleen als de instelling nu niet vergrendeld is (zelfde voorwaarde als bij het claimen van een code).
    const swapped = await prisma.totpCredential.updateMany({
      where: { userId, OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }] },
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
    if (swapped.count !== 1) return { ok: false, outcome: "LOCKED" };
    const recoveryCodes = opts.issueRecoveryCodes === false ? [] : await regenerateRecoveryCodes(userId);
    await logSecurityEvent({ userId, type: "TOTP_ENROLLED" });
    await autoEnableMfaAfterFirstMethod(userId, hadUsableMethodBefore);
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
  await autoEnableMfaAfterFirstMethod(userId, hadUsableMethodBefore);
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

export type RecoveryOutcome = "OK" | "INVALID" | "LOCKED";
const RECOVERY_MAX_ATTEMPTS = 5;

/**
 * Herstelcode gebruiken met persistente begrenzing (database, overleeft herstarts van de container). Elke poging wordt VÓÓR de controle
 * atomair geteld ("reserveren"), zodat ook parallelle gokpogingen meetellen; na 5 pogingen zonder succes volgt een tijdelijke lockout van
 * 15 minuten (nooit permanent; een verlopen lockout begint opnieuw). Een geslaagde herstelcode zet de teller terug. De lockout geldt
 * alleen voor herstelcodes en blokkeert TOTP niet. Zonder TOTP-instelling (dus zonder herstelcodes) is het antwoord altijd INVALID.
 */
export async function consumeRecoveryCodeLimited(userId: string, rawCode: string): Promise<RecoveryOutcome> {
  // Reserveren, tellen én (bij de 5e poging) vergrendelen in één statement: geen venster waarin parallelle pogingen extra gokken kunnen doen,
  // en geen toestand die na een crash "half vergrendeld" blijft. De 5e poging zelf wordt nog wel gecontroleerd en ontgrendelt bij succes.
  const reserved = await prisma.$queryRaw<{ attempts: number }[]>`
    UPDATE "TotpCredential" SET
      "recoveryFailedAttempts" = CASE WHEN "recoveryLockedUntil" IS NOT NULL THEN 1 ELSE "recoveryFailedAttempts" + 1 END,
      "recoveryLockedUntil" = CASE
        WHEN (CASE WHEN "recoveryLockedUntil" IS NOT NULL THEN 1 ELSE "recoveryFailedAttempts" + 1 END) >= ${RECOVERY_MAX_ATTEMPTS}::int
        THEN timezone('UTC', now()) + make_interval(mins => ${LOCKOUT_MINUTES}::int) ELSE NULL END
    WHERE "userId" = ${userId}
      AND ("recoveryLockedUntil" IS NULL OR "recoveryLockedUntil" <= timezone('UTC', now()))
    RETURNING "recoveryFailedAttempts" AS attempts`;
  if (reserved.length === 0) {
    const exists = await prisma.totpCredential.findUnique({ where: { userId }, select: { id: true } });
    return exists ? "LOCKED" : "INVALID";
  }

  const ok = await consumeRecoveryCode(userId, rawCode);
  if (ok) {
    await prisma.$executeRaw`UPDATE "TotpCredential" SET "recoveryFailedAttempts" = 0, "recoveryLockedUntil" = NULL WHERE "userId" = ${userId}`;
    return "OK";
  }
  if (reserved[0].attempts >= RECOVERY_MAX_ATTEMPTS) {
    await logSecurityEvent({ userId, type: "TOTP_LOCKED", detail: "Herstelcodes tijdelijk vergrendeld" });
    return "LOCKED";
  }
  return "INVALID";
}
