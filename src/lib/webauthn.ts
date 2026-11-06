import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { env } from "./env";
import { logSecurityEvent } from "./securityEvents";
import { enableMfaIfFirstMethod, lockUserForEnrollment } from "./autoMfa";

const RP_NAME = "Ringtools";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * RP ID en verwachte origin worden afgeleid van APP_BASE_URL — dezelfde
 * instelling die ook de e-maillinks opbouwt. Zo is er geen extra, los te
 * configureren environment variable nodig, en wordt in productie
 * uitsluitend het eigen domein (https://ringapeldoorn.nl) geaccepteerd.
 */
function getRpId(): string {
  return new URL(env.appBaseUrl).hostname;
}

function getExpectedOrigin(): string {
  return env.appBaseUrl;
}

/**
 * Android-origin van een app-passkey: `android:apk-key-hash:<base64url van de SHA-256 van het ondertekeningscertificaat>`.
 * Alleen geldige 32-byte-vingerafdrukken uit de configuratie tellen mee; er is geen wildcard en niets wordt afgeleid van wat de client opgeeft.
 */
export function androidOriginsFromFingerprints(fingerprints: string[]): string[] {
  const origins: string[] = [];
  for (const fp of fingerprints) {
    const hex = fp.replace(/:/g, "");
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) continue;
    origins.push(`android:apk-key-hash:${Buffer.from(hex, "hex").toString("base64url")}`);
  }
  return origins;
}

/**
 * Toegestane origins voor het verifiëren van een assertion. De webapp accepteert uitsluitend de eigen website-origin;
 * alleen de native route voegt de expliciet geconfigureerde Android-app-origins toe. (Op iOS is de origin van een app-passkey
 * gelijk aan `https://<RP ID>`, dus gelijk aan de website-origin.) Elke andere origin wordt geweigerd.
 */
export function allowedOrigins(native: boolean): string[] {
  return native ? [getExpectedOrigin(), ...androidOriginsFromFingerprints(env.androidCertFingerprints)] : [getExpectedOrigin()];
}

async function storeChallenge(userId: string, challenge: string): Promise<void> {
  await prisma.webAuthnChallenge.upsert({
    where: { userId },
    update: { challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
    create: { userId, challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
  });
}

/**
 * Verbruikt de challenge van een gebruiker atomair: één `DELETE … RETURNING`. Bij gelijktijdige verzoeken wacht het tweede op de
 * rijvergrendeling en vindt daarna niets meer (P2025), zodat een challenge nooit twee keer kan slagen. Een verlopen challenge is
 * ook verbruikt (en dus weg) maar levert niets op.
 */
async function takeChallenge(userId: string): Promise<string | null> {
  try {
    const row = await prisma.webAuthnChallenge.delete({ where: { userId } });
    return row.expiresAt.getTime() < Date.now() ? null : row.challenge;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") return null; // al verbruikt (of nooit uitgegeven)
    throw err;
  }
}

export async function hasPasskeys(userId: string): Promise<boolean> {
  const count = await prisma.webAuthnCredential.count({ where: { userId } });
  return count > 0;
}

export async function startPasskeyRegistration(userId: string, userName: string, userDisplayName: string) {
  const existing = await prisma.webAuthnCredential.findMany({ where: { userId } });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: getRpId(),
    userName,
    userDisplayName,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: c.transports ? c.transports.split(",") : undefined,
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  });

  await storeChallenge(userId, options.challenge);
  return options;
}

export async function verifyPasskeyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  deviceLabel?: string
): Promise<{ ok: true; mfaAutoEnabled: boolean } | { ok: false; reason: string }> {
  const challenge = await takeChallenge(userId);
  if (!challenge) return { ok: false, reason: "Verificatie verlopen, probeer het opnieuw." };

  let result: VerifiedRegistrationResponse;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: getExpectedOrigin(),
      expectedRPID: getRpId(),
      requireUserVerification: true,
    });
  } catch {
    return { ok: false, reason: "De passkey kon niet worden geverifieerd." };
  }

  if (!result.verified || !result.registrationInfo) {
    return { ok: false, reason: "De passkey kon niet worden geverifieerd." };
  }

  const { credential } = result.registrationInfo;
  const label = deviceLabel?.trim() || null;
  // Passkey aanmaken en (bij de eerste methode, vlag AUTO_ENABLE_MFA) MFA inschakelen: één transactie met rijvergrendeling.
  const mfaAutoEnabled = await prisma.$transaction(async (tx) => {
    const lock = await lockUserForEnrollment(tx, userId);
    if (!lock) throw new Error("Account niet gevonden.");
    await tx.webAuthnCredential.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        transports: credential.transports?.join(","),
        deviceLabel: label,
      },
    });
    await tx.securityEvent.create({ data: { userId, type: "PASSKEY_REGISTERED", detail: label ?? undefined } });
    return enableMfaIfFirstMethod(tx, userId, lock, "passkey");
  });
  return { ok: true, mfaAutoEnabled };
}

export async function startPasskeyAuthentication(userId: string) {
  const existing = await prisma.webAuthnCredential.findMany({ where: { userId } });
  if (existing.length === 0) return null;

  const options = await generateAuthenticationOptions({
    rpID: getRpId(),
    userVerification: "required",
    allowCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: c.transports ? c.transports.split(",") : undefined,
    })),
  });

  await storeChallenge(userId, options.challenge);
  return options;
}

export async function verifyPasskeyAuthentication(
  userId: string,
  response: AuthenticationResponseJSON,
  opts: { native?: boolean } = {}
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const challenge = await takeChallenge(userId);
  if (!challenge) return { ok: false, reason: "Verificatie verlopen, probeer het opnieuw." };

  const stored = await prisma.webAuthnCredential.findUnique({ where: { credentialId: response.id } });
  if (!stored || stored.userId !== userId) {
    await logSecurityEvent({ userId, type: "PASSKEY_LOGIN_FAILED", detail: "Onbekende passkey" });
    return { ok: false, reason: "Deze passkey is niet bekend." };
  }

  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: allowedOrigins(!!opts.native),
      expectedRPID: getRpId(),
      requireUserVerification: true,
      advancedFIDOConfig: { userVerification: "required" },
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(stored.publicKey),
        counter: Number(stored.counter),
        transports: stored.transports ? stored.transports.split(",") : undefined,
      },
    });

    if (!result.verified) {
      await logSecurityEvent({ userId, type: "PASSKEY_LOGIN_FAILED" });
      return { ok: false, reason: "De passkey kon niet worden geverifieerd." };
    }

    await prisma.webAuthnCredential.update({
      where: { id: stored.id },
      data: { counter: BigInt(result.authenticationInfo.newCounter), lastUsedAt: new Date() },
    });
    return { ok: true };
  } catch {
    await logSecurityEvent({ userId, type: "PASSKEY_LOGIN_FAILED", detail: "Afwijkende teller (mogelijk gekloond apparaat)" });
    return { ok: false, reason: "De passkey kon niet worden geverifieerd." };
  }
}
