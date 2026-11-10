import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { env } from "./env";
import { MAX_ACTIVE_DEVICES, parseP256PublicKey, verifyP256Signature, TrustedDeviceError } from "./trustedDevices";

/**
 * Automatische Face ID-inrichting (E2.5, vlag `NATIVE_DEVICE_AUTO_ENROLL_ENABLED`, standaard UIT, vereist `NATIVE_DEVICE_LOGIN_ENABLED`).
 *
 * Een reeds VOLLEDIG geauthenticeerde appgebruiker richt dit toestel in zonder koppelcode:
 *  - recente volledige verificatie (API dwingt dit af): e-mail voor gewone accounts, verplichte tweede factor voor MFA-accounts;
 *  - de server geeft een eenmalige registratiechallenge uit (gebonden aan de gebruiker, kort geldig);
 *  - de app maakt een nieuwe Secure Enclave-sleutel; de handtekening over de challenge bewijst sleutelbezit EN is de bewuste bevestiging met Face ID/toestelcode;
 *  - registratie en activering voor inloggen gebeuren in één transactie (nooit gedeeltelijk), voor iOS en Android (loginprotocol 2).
 * Een koppelcode levert nooit een sessie; deze route levert ook zelf geen nieuwe sessie op: de gebruiker is al ingelogd.
 * Zonder attestatie geldt hier hetzelfde als bij E2.4a: sleutelbezit, geen bewezen hardwarebinding (docs/E2-4A-BEVEILIGINGSREVIEW.md).
 */
export const ENROLL_CONTEXT = "ringtools-device-enroll-v1";
export const ENROLL_TTL_MS = 3 * 60 * 1000;
export const MAX_ENROLL_FAILURES = 3;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ENROLLMENTS_PER_WINDOW = 10;

export function enrollmentMessage(e: { id: string; challenge: string }, userId: string, installationId: string): string {
  return `${ENROLL_CONTEXT}\n${e.id}\n${e.challenge}\n${userId}\n${installationId}`;
}

const notAvailable = () => new TrustedDeviceError(404, "Niet beschikbaar.", "not-available");
const invalid = () => new TrustedDeviceError(400, "De inrichting is verlopen of ongeldig. Probeer het opnieuw.", "invalid-enrollment");

function assertFlag() {
  if (!env.nativeDeviceAutoEnrollEnabled) throw notAvailable();
}

async function eligibleUser(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u || !u.active || u.role === "ADMIN") throw new TrustedDeviceError(403, "Niet beschikbaar voor dit account.", "forbidden");

  return u;
}

/** Aanroeper heeft al recente MFA afgedwongen. */
export async function startEnrollment(userId: string) {
  assertFlag();
  await eligibleUser(userId);
  const since = new Date(Date.now() - WINDOW_MS);
  if ((await prisma.deviceEnrollment.count({ where: { userId, createdAt: { gt: since } } })) >= MAX_ENROLLMENTS_PER_WINDOW) {
    throw new TrustedDeviceError(429, "Te veel pogingen. Probeer het later opnieuw.", "rate-limited");
  }
  const active = await prisma.trustedDevice.count({ where: { userId, revokedAt: null } });
  if (active >= MAX_ACTIVE_DEVICES) throw new TrustedDeviceError(409, "Je hebt het maximum aantal toestellen bereikt. Trek op de website eerst een toestel in.", "limit");
  const expiresAt = new Date(Date.now() + ENROLL_TTL_MS);
  // Eén lopende inrichting per gebruiker; een geannuleerde of verlopen poging laat niets achter dan deze rij.
  const [, row] = await prisma.$transaction([
    prisma.deviceEnrollment.deleteMany({ where: { userId, consumedAt: null } }),
    prisma.deviceEnrollment.create({ data: { userId, challenge: crypto.randomBytes(32).toString("base64url"), expiresAt } }),
  ]);
  return { enrollmentId: row.id, challenge: row.challenge, userId, expiresAt };
}

export type EnrollInput = { enrollmentId: string; publicKey: string; installationId: string; signature: string; platform: string; label: string };

/** Aanroeper heeft opnieuw recente volledige verificatie afgedwongen. Registreert én activeert het toestel in één transactie. */
export async function completeEnrollment(userId: string, input: EnrollInput, sessionId?: string): Promise<{ deviceId: string }> {
  assertFlag();
  if (!["IOS", "ANDROID"].includes(input.platform)) throw new TrustedDeviceError(403, "Toestelaanmelding is alleen beschikbaar in de iOS- en Android-app.", "platform-not-supported");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(input.installationId)) throw new TrustedDeviceError(400, "Ongeldig installatie-ID.", "invalid-installation");
  const label = input.label.trim().slice(0, 60) || (input.platform === "ANDROID" ? "Android" : "iPhone/iPad");
  const e = await prisma.deviceEnrollment.findUnique({ where: { id: input.enrollmentId } });
  if (!e || e.userId !== userId || e.consumedAt || e.expiresAt <= new Date() || e.failedAttempts >= MAX_ENROLL_FAILURES) throw invalid();
  await eligibleUser(userId);

  const key = parseP256PublicKey(input.publicKey);
  if (!key || !verifyP256Signature(key, enrollmentMessage(e, userId, input.installationId), input.signature)) {
    await prisma.deviceEnrollment.updateMany({ where: { id: e.id, consumedAt: null, failedAttempts: { lt: MAX_ENROLL_FAILURES } }, data: { failedAttempts: { increment: 1 } } });
    throw new TrustedDeviceError(401, "De bevestiging met het toestel is mislukt.", "invalid-proof");
  }
  const publicKey = input.publicKey.replace(/\s+/g, "");

  try {
    const device = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ active: boolean; role: string; mfaEnabled: boolean }[]>`SELECT "active", "role"::text AS "role", "mfaEnabled" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const u = rows[0];
      if (!u || !u.active || u.role === "ADMIN") throw invalid();
      const consumed = await tx.deviceEnrollment.updateMany({ where: { id: e.id, userId, consumedAt: null, expiresAt: { gt: new Date() }, failedAttempts: { lt: MAX_ENROLL_FAILURES } }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) throw invalid();
      const active = await tx.trustedDevice.count({ where: { userId, revokedAt: null } });
      if (active >= MAX_ACTIVE_DEVICES) throw new TrustedDeviceError(409, "Je hebt het maximum aantal toestellen bereikt.", "limit");
      const created = await tx.trustedDevice.create({ data: { userId, label, loginProtocol: 2, platform: input.platform as "IOS" | "ANDROID", installationId: input.installationId, publicKey, loginEnabledAt: new Date() } });
      if (sessionId) await tx.session.update({ where: { id: sessionId, userId }, data: { deviceId: created.id } });
      await tx.securityEvent.create({ data: { userId, type: "TRUSTED_DEVICE_REGISTERED", detail: `${label} (automatisch ingericht)` } });
      await tx.securityEvent.create({ data: { userId, type: "TRUSTED_DEVICE_LOGIN_ENABLED", detail: label } });
      return created;
    });
    return { deviceId: device.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new TrustedDeviceError(409, "Deze sleutel is al geregistreerd en kan niet opnieuw worden gebruikt.", "key-reused");
    throw err;
  }
}
