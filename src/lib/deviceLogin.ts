import crypto from "crypto";
import { prisma } from "./prisma";
import { env } from "./env";
import { generateRawToken, hashToken } from "./crypto";
import { SESSION_TTL_MS } from "./auth";
import { parseP256PublicKey, verifyP256Signature, TrustedDeviceError } from "./trustedDevices";
import { lockUserThenDevice, runHook } from "./deviceLocks";

/**
 * Wachtwoordloos inloggen met een vertrouwd toestel (E2.4a, vlag `NATIVE_DEVICE_LOGIN_ENABLED`, standaard UIT).
 *
 * Wat de server WEL bewijst: bezit van de privésleutel die bij registratie is opgegeven (ECDSA P-256-handtekening over een eenmalige,
 * aan toestel/account/doel gebonden challenge).
 * Wat de server NIET kan bewijzen (geen attestatie): dat de sleutel in de Secure Enclave zit en dat bij elke handtekening gebruikersverificatie
 * plaatsvindt. Op iOS wordt dat door het besturingssysteem afgedwongen (sleutel met `.userPresence` in de Secure Enclave, `SecKeyCreateSignature`
 * vraagt per handtekening Face ID of toestelcode), maar de server ziet dat niet. Daarom: alleen na expliciete activering, alleen iOS, en
 * een sessie via deze route telt NIET als recente MFA (zie `createDeviceSession`).
 *
 * Nieuwe Android-registraties (protocol 2) vragen expliciet lokale verificatie vóór iedere ondertekening. Het OS-venster blijft 5 s; oude Android-registraties blijven uitgesloten.
 */
export const LOGIN_CONTEXT = "ringtools-device-login-v1";
export const ACTIVATE_CONTEXT = "ringtools-device-login-activate-v1";
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;
export const MAX_CHALLENGE_FAILURES = 3;
const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const MAX_CHALLENGES_PER_WINDOW = 10;
const MAX_DEAD_CHALLENGES_PER_WINDOW = 5;
/** Toegang zonder recente MFA: `mfaAt` ligt in het verleden, dus gevoelige acties vragen altijd een verse tweede factor. */
export const DEVICE_SESSION_MFA_AT = new Date(1000);

type Purpose = "LOGIN" | "ACTIVATE";

export function deviceChallengeMessage(purpose: Purpose, ch: { id: string; challenge: string }, device: { id: string; installationId: string }): string {
  const context = purpose === "LOGIN" ? LOGIN_CONTEXT : ACTIVATE_CONTEXT;
  return `${context}\n${ch.id}\n${ch.challenge}\n${device.id}\n${device.installationId}`;
}

const unavailable = () => new TrustedDeviceError(403, "Inloggen met dit toestel is niet beschikbaar: het toestel is niet geactiveerd of ingetrokken. Log in met je andere methode.", "device-login-unavailable");
const notAvailable = () => new TrustedDeviceError(404, "Niet beschikbaar.", "not-available");

function assertFlag() {
  if (!env.nativeDeviceLoginEnabled) throw notAvailable();
}

async function findDevice(installationId: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(installationId)) return null;
  return prisma.trustedDevice.findUnique({ where: { installationId }, include: { user: true } });
}

function loginEligible(d: NonNullable<Awaited<ReturnType<typeof findDevice>>>): boolean {
  return !d.revokedAt && !!d.loginEnabledAt && (d.platform === "IOS" || (d.platform === "ANDROID" && d.loginProtocol >= 2)) && d.user.active && d.user.accountKind === "NORMAL" && d.user.role !== "ADMIN";
}

async function throttle(deviceId: string) {
  const since = new Date(Date.now() - THROTTLE_WINDOW_MS);
  const [issued, dead] = await Promise.all([
    prisma.deviceLoginChallenge.count({ where: { deviceId, createdAt: { gt: since } } }),
    prisma.deviceLoginChallenge.count({ where: { deviceId, createdAt: { gt: since }, failedAttempts: { gte: MAX_CHALLENGE_FAILURES } } }),
  ]);
  if (issued >= MAX_CHALLENGES_PER_WINDOW || dead >= MAX_DEAD_CHALLENGES_PER_WINDOW) throw new TrustedDeviceError(429, "Te veel pogingen. Probeer het later opnieuw.", "rate-limited");
}

async function newChallenge(deviceId: string, purpose: Purpose) {  // het antwoord bevat het toestel-ID (nodig voor het te ondertekenen bericht; niet geheim)
  await throttle(deviceId);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  const row = await prisma.deviceLoginChallenge.create({ data: { deviceId, purpose, challenge: crypto.randomBytes(32).toString("base64url"), expiresAt } });
  return { challengeId: row.id, challenge: row.challenge, deviceId, expiresAt };
}

/** Verifieert de handtekening zonder de challenge te verbruiken; telt een fout atomair (begrensd) op de challenge. */
async function checkProof(purpose: Purpose, device: { id: string; installationId: string; publicKey: string }, challengeId: string, signature: string) {
  const ch = await prisma.deviceLoginChallenge.findUnique({ where: { id: challengeId } });
  const now = new Date();
  const invalid = new TrustedDeviceError(400, "De aanmelding is verlopen of ongeldig. Probeer het opnieuw.", "invalid-challenge");
  if (!ch || ch.deviceId !== device.id || ch.purpose !== purpose || ch.consumedAt || ch.expiresAt <= now || ch.failedAttempts >= MAX_CHALLENGE_FAILURES) throw invalid;
  const key = parseP256PublicKey(device.publicKey);
  const ok = key !== null && verifyP256Signature(key, deviceChallengeMessage(purpose, ch, device), signature);
  if (!ok) {
    await prisma.deviceLoginChallenge.updateMany({ where: { id: ch.id, consumedAt: null, failedAttempts: { lt: MAX_CHALLENGE_FAILURES } }, data: { failedAttempts: { increment: 1 } } });
    throw new TrustedDeviceError(401, "De verificatie met het toestel is mislukt.", "invalid-proof");
  }
  return ch;
}

// ---- Activeren als inlogmethode (ingelogde sessie, recente MFA — afgedwongen door de aanroeper) ----

async function ownedActivatableDevice(userId: string, installationId: string) {
  const d = await findDevice(installationId);
  if (!d || d.userId !== userId || d.revokedAt || !d.user.active || d.user.accountKind !== "NORMAL" || d.user.role === "ADMIN" || !d.user.mfaEnabled) throw unavailable();
  if (!(d.platform === "IOS" || (d.platform === "ANDROID" && d.loginProtocol >= 2))) throw new TrustedDeviceError(403, "Wachtwoordloos inloggen is alleen op iPhone beschikbaar.", "platform-not-supported");
  return d;
}

export async function activationChallenge(userId: string, installationId: string) {
  assertFlag();
  const d = await ownedActivatableDevice(userId, installationId);
  return newChallenge(d.id, "ACTIVATE");
}

export async function confirmActivation(userId: string, installationId: string, challengeId: string, signature: string): Promise<void> {
  assertFlag();
  const d = await ownedActivatableDevice(userId, installationId);
  const ch = await checkProof("ACTIVATE", d, challengeId, signature);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const consumed = await tx.deviceLoginChallenge.updateMany({ where: { id: ch.id, consumedAt: null, expiresAt: { gt: new Date() }, failedAttempts: { lt: MAX_CHALLENGE_FAILURES } }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw new TrustedDeviceError(400, "De activering is verlopen of ongeldig.", "invalid-challenge");
    const enabled = await tx.trustedDevice.updateMany({ where: { id: d.id, userId, revokedAt: null }, data: { loginEnabledAt: new Date() } });
    if (enabled.count !== 1) throw unavailable();
    await tx.securityEvent.create({ data: { userId, type: "TRUSTED_DEVICE_LOGIN_ENABLED", detail: d.label } });
  });
}

/** Zet wachtwoordloos inloggen voor een toestel uit en beëindigt de via dat toestel aangemaakte sessies (recente MFA door de aanroeper). */
export async function disableDeviceLogin(userId: string, deviceId: string, actorId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const lock = await lockUserThenDevice(tx, userId, deviceId);
    await runHook("disableAfterLock");
    if (!lock.device || lock.device.userId !== userId || !lock.device.loginEnabledAt) return false;
    await tx.trustedDevice.update({ where: { id: deviceId }, data: { loginEnabledAt: null } });
    await tx.session.deleteMany({ where: { deviceId } });
    await tx.securityEvent.create({ data: { userId, actorUserId: actorId, type: "TRUSTED_DEVICE_LOGIN_DISABLED" } });
    return true;
  });
}

// ---- Inloggen ----

export async function loginChallenge(installationId: string) {
  assertFlag();
  const d = await findDevice(installationId);
  if (!d || !loginEligible(d)) throw unavailable();
  return newChallenge(d.id, "LOGIN");
}

/** Verifieert de handtekening en geeft — pas dan, atomair en eenmalig — een nieuwe sessie uit. */
export async function loginWithDevice(input: { installationId: string; challengeId: string; signature: string; userAgent?: string | null }) {
  assertFlag();
  const d = await findDevice(input.installationId);
  if (!d || !loginEligible(d)) throw unavailable();
  const ch = await checkProof("LOGIN", d, input.challengeId, input.signature);

  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.$transaction(async (tx) => {
    // Vaste volgorde: gebruiker, dan toestel (beide FOR UPDATE), en pas daarna de toestand beoordelen. Een gelijktijdige intrekking/uitzetten/reset
    // wint altijd: wacht deze transactie, dan ziet ze daarna het ingetrokken toestel; was zij eerst, dan verwijdert de intrekking haar sessie.
    const lock = await lockUserThenDevice(tx, d.userId, d.id);
    await runHook("loginAfterLock");
    if (!lock.user || !lock.user.active || lock.user.accountKind !== "NORMAL" || lock.user.role === "ADMIN" || !lock.device || lock.device.revokedAt || !lock.device.loginEnabledAt) throw unavailable();
    const consumed = await tx.deviceLoginChallenge.updateMany({ where: { id: ch.id, consumedAt: null, expiresAt: { gt: new Date() }, failedAttempts: { lt: MAX_CHALLENGE_FAILURES } }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw new TrustedDeviceError(400, "De aanmelding is verlopen of ongeldig. Probeer het opnieuw.", "invalid-challenge");
    await tx.session.create({ data: { userId: d.userId, tokenHash: hashToken(rawToken), expiresAt, mfaAt: DEVICE_SESSION_MFA_AT, deviceId: d.id, userAgent: input.userAgent || null } });
    await tx.trustedDevice.update({ where: { id: d.id }, data: { lastUsedAt: new Date() } });
    await tx.user.updateMany({ where: { id: d.userId, activatedAt: null }, data: { activatedAt: new Date() } });
    await tx.securityEvent.create({ data: { userId: d.userId, type: "TRUSTED_DEVICE_LOGIN", detail: d.label } });
  });
  return { userId: d.userId, token: rawToken, expiresAt };
}

/** Status van het lokale toestel voor de ingelogde gebruiker (voor de knop in de app); onthult niets over andermans toestellen. */
export async function deviceLoginStatus(userId: string, installationId: string): Promise<{ registered: boolean; loginEnabled: boolean }> {
  const d = await findDevice(installationId);
  if (!d || d.userId !== userId || d.revokedAt) return { registered: false, loginEnabled: false };
  return { registered: true, loginEnabled: !!d.loginEnabledAt && (d.platform === "IOS" || (d.platform === "ANDROID" && d.loginProtocol >= 2)) };
}
