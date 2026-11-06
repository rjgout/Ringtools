import { Capacitor } from "@capacitor/core";
import { ApiRequestError, type ApiClient } from "./api";
import { nativeDeviceKeys, type DeviceKeyProvider } from "./deviceKey";
import { storage } from "./storage";

/**
 * Wachtwoordloos inloggen met een geactiveerd vertrouwd toestel (E2.4a). Alleen iPhone/iPad: op Android blijft dit uit omdat de sleutel daar een
 * authenticatievenster van 5 s heeft in plaats van verificatie per handtekening. De server beslist; deze module ondertekent alleen een
 * serverchallenge. Er is GEEN automatische herregistratie en GEEN terugval naar een zwakkere methode.
 * Logt nooit challenges, berichten, handtekeningen of sleutels.
 */
export const LOGIN_CONTEXT = "ringtools-device-login-v1";
export const ACTIVATE_CONTEXT = "ringtools-device-login-activate-v1";
export type Purpose = "LOGIN" | "ACTIVATE";

/** Zelfde bericht als de server (src/lib/deviceLogin.ts `deviceChallengeMessage`). */
export function challengeMessage(purpose: Purpose, ch: { challengeId: string; challenge: string; deviceId: string }, installationId: string): string {
  return `${purpose === "LOGIN" ? LOGIN_CONTEXT : ACTIVATE_CONTEXT}\n${ch.challengeId}\n${ch.challenge}\n${ch.deviceId}\n${installationId}`;
}

export class DeviceLoginError extends Error {
  constructor(message: string, public code: "no-key" | "cancelled" | "unsupported") {
    super(message);
  }
}

export const RECOVERY_HINT = "Lukt het niet? Log in met je e-mailcode en authenticator-app en koppel dit toestel opnieuw.";

/** Lokale verwijzing naar de toestelsleutel. `userId`/`name` (optioneel, niet geheim) leggen vast voor wélk account Face ID hier is ingesteld. */
export type DeviceKeyRef = { installationId: string; tag: string; userId?: string; name?: string };

export async function readDeviceKeyRef(): Promise<DeviceKeyRef | null> {
  try {
    const raw = await storage.getDeviceKey();
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<DeviceKeyRef>;
    return typeof v.installationId === "string" && typeof v.tag === "string"
      ? { installationId: v.installationId, tag: v.tag, ...(typeof v.userId === "string" ? { userId: v.userId } : {}), ...(typeof v.name === "string" ? { name: v.name } : {}) }
      : null;
  } catch {
    return null;
  }
}

/** Alleen iPhone/iPad met native toestelsleutels. */
export function deviceLoginSupported(keys: DeviceKeyProvider = nativeDeviceKeys, platform: string = Capacitor.getPlatform()): boolean {
  return platform === "ios" && keys.available();
}

async function signChallenge(keys: DeviceKeyProvider, ref: DeviceKeyRef, message: string): Promise<string> {
  try {
    return await keys.sign(ref.tag, message);
  } catch {
    // Geannuleerde Face ID, verdwenen of ongeldige sleutel: nooit een sessie, nooit automatisch herregistreren.
    throw new DeviceLoginError(`De verificatie met dit toestel is geannuleerd of mislukt. Er is niet ingelogd. ${RECOVERY_HINT}`, "cancelled");
  }
}

export async function loginWithDeviceKey(api: ApiClient, keys: DeviceKeyProvider = nativeDeviceKeys, platform: string = Capacitor.getPlatform()) {
  if (!deviceLoginSupported(keys, platform)) throw new DeviceLoginError("Inloggen met dit toestel is alleen op iPhone beschikbaar.", "unsupported");
  const ref = await readDeviceKeyRef();
  if (!ref) throw new DeviceLoginError(`Dit toestel is nog niet gekoppeld. ${RECOVERY_HINT}`, "no-key");
  const ch = await api.deviceChallenge(ref.installationId);
  const signature = await signChallenge(keys, ref, challengeMessage("LOGIN", ch, ref.installationId));
  return api.deviceLogin({ installationId: ref.installationId, challengeId: ch.challengeId, signature });
}

export async function activateDeviceLoginKey(api: ApiClient, keys: DeviceKeyProvider = nativeDeviceKeys, platform: string = Capacitor.getPlatform()): Promise<void> {
  if (!deviceLoginSupported(keys, platform)) throw new DeviceLoginError("Inloggen met dit toestel is alleen op iPhone beschikbaar.", "unsupported");
  const ref = await readDeviceKeyRef();
  if (!ref) throw new DeviceLoginError(`Dit toestel is nog niet gekoppeld. ${RECOVERY_HINT}`, "no-key");
  const ch = await api.deviceActivateChallenge(ref.installationId);
  const signature = await signChallenge(keys, ref, challengeMessage("ACTIVATE", ch, ref.installationId));
  await api.deviceActivateConfirm({ installationId: ref.installationId, challengeId: ch.challengeId, signature });
}

export function deviceLoginMessage(err: unknown): string {
  if (err instanceof DeviceLoginError) return err.message;
  if (err instanceof ApiRequestError) return err.code === "device-login-unavailable" ? `${err.message} ${RECOVERY_HINT}` : err.message;
  return "Inloggen met dit toestel is niet gelukt.";
}
