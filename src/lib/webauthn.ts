import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";
import { prisma } from "./prisma";
import { env } from "./env";
import { logSecurityEvent } from "./securityEvents";

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

async function storeChallenge(userId: string, challenge: string): Promise<void> {
  await prisma.webAuthnChallenge.upsert({
    where: { userId },
    update: { challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
    create: { userId, challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
  });
}

async function takeChallenge(userId: string): Promise<string | null> {
  const row = await prisma.webAuthnChallenge.findUnique({ where: { userId } });
  if (!row) return null;
  await prisma.webAuthnChallenge.delete({ where: { userId } }).catch(() => {});
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row.challenge;
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
): Promise<{ ok: true } | { ok: false; reason: string }> {
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
  await prisma.webAuthnCredential.create({
    data: {
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      transports: credential.transports?.join(","),
      deviceLabel: deviceLabel?.trim() || null,
    },
  });
  await logSecurityEvent({ userId, type: "PASSKEY_REGISTERED", detail: deviceLabel?.trim() || undefined });
  return { ok: true };
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
  response: AuthenticationResponseJSON
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
      expectedOrigin: getExpectedOrigin(),
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
