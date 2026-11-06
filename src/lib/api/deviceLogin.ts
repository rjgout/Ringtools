import { rateLimit } from "../rateLimit";
import { TrustedDeviceError } from "../trustedDevices";
import { activationChallenge, confirmActivation, deviceLoginStatus, loginChallenge, loginWithDevice } from "../deviceLogin";
import { ApiError, str } from "./http";
import { requireFreshAuth } from "./management";
import type { ApiAuth } from "./auth";

const WINDOW = 15 * 60 * 1000;

async function errors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TrustedDeviceError) throw new ApiError(err.status, err.message, err.code);
    throw err;
  }
}

function limit(kind: string, key: string, max: number) {
  if (!rateLimit(`${kind}:${key}`, max, WINDOW).allowed) throw new ApiError(429, "Te veel pogingen. Probeer het later opnieuw.", "rate-limited");
}

// ---- Publiek: inloggen met een geactiveerd toestel (de handtekening is het bewijs; er is nog geen sessie) ----

export async function deviceChallengeApi(body: Record<string, unknown>, clientKey: string) {
  limit("devlogin-ch-ip", clientKey, 30);
  const installationId = str(body.installationId);
  limit("devlogin-ch-dev", installationId, 15);
  const c = await errors(() => loginChallenge(installationId));
  return { challengeId: c.challengeId, challenge: c.challenge, deviceId: c.deviceId, expiresAt: c.expiresAt.toISOString() };
}

export async function deviceLoginApi(body: Record<string, unknown>, clientKey: string) {
  limit("devlogin-ip", clientKey, 30);
  const installationId = str(body.installationId);
  limit("devlogin-dev", installationId, 15);
  return errors(() => loginWithDevice({ installationId, challengeId: str(body.challengeId), signature: str(body.signature), userAgent: "iPhone/iPad (toestel)" }));
}

// ---- Ingelogd + recente MFA: een geregistreerd toestel activeren als inlogmethode ----

export async function activationChallengeApi(auth: ApiAuth, body: Record<string, unknown>) {
  requireFreshAuth(auth); // een via een toestel verkregen sessie telt nooit als recente MFA
  limit("devlogin-act", auth.user.id, 10);
  const c = await errors(() => activationChallenge(auth.user.id, str(body.installationId)));
  return { challengeId: c.challengeId, challenge: c.challenge, deviceId: c.deviceId, expiresAt: c.expiresAt.toISOString() };
}

export async function activationConfirmApi(auth: ApiAuth, body: Record<string, unknown>) {
  requireFreshAuth(auth);
  limit("devlogin-act", auth.user.id, 10);
  await errors(() => confirmActivation(auth.user.id, str(body.installationId), str(body.challengeId), str(body.signature)));
  return { ok: true };
}

export async function deviceStatusApi(auth: ApiAuth, body: Record<string, unknown>) {
  return deviceLoginStatus(auth.user.id, str(body.installationId));
}
