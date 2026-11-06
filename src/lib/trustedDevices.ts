import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { env } from "./env";
import { hashToken, generateRawToken } from "./crypto";
import { logSecurityEvent } from "./securityEvents";

/**
 * Vertrouwde toestellen (E2.3, vlag `TRUSTED_DEVICES_ENABLED`, standaard uit).
 *
 * Koppelcode (optie A): de website maakt, na recente MFA, een eenmalige code. De app hoeft niet ingelogd te zijn. De code autoriseert
 * UITSLUITEND een toestelregistratie: geen sessie, geen MFA-goedkeuring. Twee stappen:
 *   1. claim: code (hash, eenmalig, korte geldigheid) -> registratietoken + challenge;
 *   2. complete: publieke sleutel (ECDSA P-256, SPKI) + handtekening over de challenge = bewijs van bezit van de privésleutel.
 *
 * Beperkingen (bewust vastgelegd):
 * - Zonder attestatie kan de server NIET bewijzen dat de sleutel in hardware zit (Secure Enclave/StrongBox/TEE); dat is een aanname van de app.
 * - Een geregistreerd toestel is GEEN zelfstandige MFA-methode. `verifyDeviceSignature` is alleen een bouwsteen voor E2.4 en is nergens als route of inlogstap beschikbaar.
 */
export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const CLAIM_TTL_MS = 5 * 60 * 1000;
export const MAX_CLAIM_FAILURES = 3;
export const MAX_ACTIVE_DEVICES = 5;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 tekens, 12 tekens = 60 bits
export const REGISTRATION_CONTEXT = "ringtools-device-registration-v1";

export class TrustedDeviceError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

export function trustedDevicesAvailable(): boolean {
  return env.trustedDevicesEnabled;
}

export function normalizePairingCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function newPairingCode(): string {
  let out = "";
  for (let i = 0; i < 12; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return out;
}
export function formatPairingCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1-");
}

/** Maakt een koppelcode. Alleen voor niet-admin gebruikers met verplichte MFA; aanroeper heeft recente MFA al afgedwongen. */
export async function createPairing(userId: string): Promise<{ code: string; expiresAt: Date }> {
  if (!env.trustedDevicesEnabled) throw new TrustedDeviceError(404, "Niet beschikbaar.", "not-available");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active || user.role === "ADMIN") throw new TrustedDeviceError(403, "Niet beschikbaar voor dit account.", "forbidden");
  if (!user.mfaEnabled) throw new TrustedDeviceError(403, "Schakel eerst verificatie in om een toestel te koppelen.", "mfa-required");
  const active = await prisma.trustedDevice.count({ where: { userId, revokedAt: null } });
  if (active >= MAX_ACTIVE_DEVICES) throw new TrustedDeviceError(409, "Je hebt het maximum aantal toestellen bereikt. Trek eerst een toestel in.", "limit");

  const code = newPairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  // Eén lopende koppelcode per gebruiker: een nieuwe vervangt de vorige.
  await prisma.$transaction([
    prisma.mfaPairing.deleteMany({ where: { userId, consumedAt: null } }),
    prisma.mfaPairing.create({ data: { userId, codeHash: hashToken(code), expiresAt } }),
  ]);
  await logSecurityEvent({ userId, type: "TRUSTED_DEVICE_PAIRING_CREATED" });
  return { code: formatPairingCode(code), expiresAt };
}

/** Stap 1: wisselt een geldige code (atomisch, eenmalig) in voor een registratietoken en een challenge. */
export async function claimPairing(rawCode: string): Promise<{ registrationToken: string; challenge: string; expiresAt: Date }> {
  if (!env.trustedDevicesEnabled) throw new TrustedDeviceError(404, "Niet beschikbaar.", "not-available");
  const code = normalizePairingCode(rawCode);
  const invalid = new TrustedDeviceError(400, "De koppelcode is ongeldig of verlopen.", "invalid-code");
  if (code.length !== 12) throw invalid;

  const registrationToken = generateRawToken();
  const challenge = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const claimExpiresAt = new Date(now.getTime() + CLAIM_TTL_MS);
  // Eén statement: alleen de eerste van gelijktijdige claims wint.
  const claimed = await prisma.mfaPairing.updateMany({
    where: { codeHash: hashToken(code), claimedAt: null, consumedAt: null, expiresAt: { gt: now } },
    data: { claimedAt: now, claimTokenHash: hashToken(registrationToken), challenge, claimExpiresAt },
  });
  if (claimed.count !== 1) throw invalid;
  return { registrationToken, challenge, expiresAt: claimExpiresAt };
}

/** Bericht dat het toestel moet ondertekenen; bindt challenge en installatie-ID aan deze registratie. */
export function registrationMessage(challenge: string, installationId: string): string {
  return `${REGISTRATION_CONTEXT}\n${challenge}\n${installationId}`;
}

/** Valideert een SPKI-publieke sleutel (base64): alleen ECDSA P-256. Geeft het sleutelobject of null. */
export function parseP256PublicKey(spkiBase64: string): crypto.KeyObject | null {
  try {
    const clean = spkiBase64.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.length > 400) return null;
    const key = crypto.createPublicKey({ key: Buffer.from(clean, "base64"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") return null;
    return key;
  } catch {
    return null;
  }
}

/** ECDSA P-256/SHA-256, DER-handtekening in base64 (Android voegt regeleinden toe; die worden genegeerd). */
export function verifyP256Signature(key: crypto.KeyObject, message: string, signatureBase64: string): boolean {
  try {
    const clean = signatureBase64.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.length > 200) return false;
    return crypto.verify("sha256", Buffer.from(message, "utf8"), { key, dsaEncoding: "der" }, Buffer.from(clean, "base64"));
  } catch {
    return false;
  }
}

export type CompleteInput = {
  registrationToken: string;
  publicKey: string;
  signature: string;
  installationId: string;
  platform: "IOS" | "ANDROID";
  label: string;
};

/** Stap 2: controleert bewijs van bezit van de privésleutel en registreert het toestel (eenmalig). */
export async function completePairing(input: CompleteInput): Promise<{ deviceId: string }> {
  if (!env.trustedDevicesEnabled) throw new TrustedDeviceError(404, "Niet beschikbaar.", "not-available");
  const invalid = new TrustedDeviceError(400, "De koppeling is ongeldig of verlopen. Vraag een nieuwe koppelcode aan.", "invalid-registration");
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(input.registrationToken)) throw invalid;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(input.installationId)) throw new TrustedDeviceError(400, "Ongeldig installatie-ID.", "invalid-installation");
  if (input.platform !== "IOS" && input.platform !== "ANDROID") throw new TrustedDeviceError(400, "Ongeldig platform.", "invalid-platform");
  const label = input.label.trim().slice(0, 60) || (input.platform === "IOS" ? "iPhone" : "Android-toestel");

  const pairing = await prisma.mfaPairing.findUnique({ where: { claimTokenHash: hashToken(input.registrationToken) } });
  const now = new Date();
  if (!pairing || pairing.consumedAt || !pairing.claimedAt || !pairing.claimExpiresAt || pairing.claimExpiresAt <= now || pairing.failedAttempts >= MAX_CLAIM_FAILURES || !pairing.challenge) throw invalid;

  const key = parseP256PublicKey(input.publicKey);
  const proofOk = key !== null && verifyP256Signature(key, registrationMessage(pairing.challenge, input.installationId), input.signature);
  if (!proofOk) {
    // Atomair tellen, begrensd op het maximum: gelijktijdige foute pogingen kunnen de teller nooit voorbij de limiet laten lopen.
    await prisma.mfaPairing.updateMany({ where: { id: pairing.id, consumedAt: null, failedAttempts: { lt: MAX_CLAIM_FAILURES } }, data: { failedAttempts: { increment: 1 } } });
    throw new TrustedDeviceError(400, "Het bewijs van bezit van de sleutel is ongeldig.", "invalid-proof");
  }
  const publicKey = input.publicKey.replace(/\s+/g, "");

  try {
    return await prisma.$transaction(async (tx) => {
      // Eenmalig verbruiken (bescherming tegen gelijktijdige verzoeken): precies één transactie wint.
      const consumed = await tx.mfaPairing.updateMany({ where: { id: pairing.id, consumedAt: null, claimExpiresAt: { gt: new Date() }, failedAttempts: { lt: MAX_CLAIM_FAILURES } }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) throw invalid;
      const rows = await tx.$queryRaw<{ role: string; mfaEnabled: boolean; active: boolean }[]>`SELECT "role"::text AS "role", "mfaEnabled", "active" FROM "User" WHERE "id" = ${pairing.userId} FOR UPDATE`;
      const user = rows[0];
      if (!user || !user.active || user.role === "ADMIN" || !user.mfaEnabled) throw invalid;
      const active = await tx.trustedDevice.count({ where: { userId: pairing.userId, revokedAt: null } });
      if (active >= MAX_ACTIVE_DEVICES) throw new TrustedDeviceError(409, "Je hebt het maximum aantal toestellen bereikt.", "limit");
      const device = await tx.trustedDevice.create({
        data: { userId: pairing.userId, label, platform: input.platform, installationId: input.installationId, publicKey },
      });
      return { deviceId: device.id };
    }).then(async (res) => {
      await logSecurityEvent({ userId: pairing.userId, type: "TRUSTED_DEVICE_REGISTERED", detail: label });
      return res;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new TrustedDeviceError(409, "Deze sleutel is al geregistreerd en kan niet opnieuw worden gebruikt.", "key-reused");
    }
    throw err;
  }
}

export async function listTrustedDevices(userId: string) {
  return prisma.trustedDevice.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, platform: true, createdAt: true, lastUsedAt: true, revokedAt: true, loginEnabledAt: true },
  });
}

/** Trekt een toestel in (idempotent, atomisch). Een ingetrokken sleutel is nooit meer bruikbaar of opnieuw te registreren (publicKey blijft uniek). */
export async function revokeTrustedDevice(userId: string, deviceId: string, actorId: string): Promise<boolean> {
  // E2.4a: ook alle sessies die via dit toestel zijn aangemaakt gaan direct weg (zelfde transactie).
  const revoked = await prisma.$transaction(async (tx) => {
    const result = await tx.trustedDevice.updateMany({ where: { id: deviceId, userId, revokedAt: null }, data: { revokedAt: new Date(), revokedById: actorId, loginEnabledAt: null } });
    if (result.count === 1) await tx.session.deleteMany({ where: { deviceId, userId } });
    return result.count === 1;
  });
  if (revoked) await logSecurityEvent({ userId, actorUserId: actorId, type: "TRUSTED_DEVICE_REVOKED" });
  return revoked;
}

/**
 * Bouwsteen voor E2.4 (NIET als MFA-methode of route beschikbaar): controleert een handtekening van een niet-ingetrokken toestel van een
 * actieve gebruiker. Het bericht wordt door de aanroeper (server) opgesteld, nooit door de client.
 */
export async function verifyDeviceSignature(deviceId: string, message: string, signatureBase64: string): Promise<boolean> {
  const device = await prisma.trustedDevice.findUnique({ where: { id: deviceId }, include: { user: { select: { active: true } } } });
  if (!device || device.revokedAt || !device.user.active) return false;
  const key = parseP256PublicKey(device.publicKey);
  if (!key || !verifyP256Signature(key, message, signatureBase64)) return false;
  await prisma.trustedDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } });
  return true;
}
