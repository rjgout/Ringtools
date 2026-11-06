import { Capacitor } from "@capacitor/core";
import { ApiRequestError, type ApiClient } from "./api";
import { DeviceKeyError, nativeDeviceKeys, type DeviceKeyProvider } from "./deviceKey";
import { storage } from "./storage";

/** Zelfde bericht als de server (src/lib/trustedDevices.ts `registrationMessage`). */
export const REGISTRATION_CONTEXT = "ringtools-device-registration-v1";
export const registrationMessage = (challenge: string, installationId: string) => `${REGISTRATION_CONTEXT}\n${challenge}\n${installationId}`;

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type RegistrationResult = { ok: true } | { ok: false; message: string };

/**
 * Koppelt dit toestel met een koppelcode van de website. De app hoeft niet ingelogd te zijn; de code autoriseert alleen deze registratie.
 * Elke registratie krijgt een nieuw installatie-ID en een eigen sleuteltag (hergebruik van een bestaande sleutel is uitgesloten).
 * Bij elke fout wordt de net aangemaakte sleutel verwijderd.
 */
export async function registerThisDevice(api: ApiClient, rawCode: string, keys: DeviceKeyProvider = nativeDeviceKeys): Promise<RegistrationResult> {
  if (!keys.available()) return { ok: false, message: "Toestellen koppelen kan alleen in de Ringtools-app." };
  const code = normalizeCode(rawCode);
  if (code.length !== 12) return { ok: false, message: "Vul de koppelcode van 12 tekens in." };

  const installationId = randomHex(16);
  const tag = `nl.ringapeldoorn.ringtools.devicekey.${installationId}`;
  let created = false;
  let stored = false;
  try {
    const claim = await api.claimDevicePairing(code);
    const publicKey = await keys.create(tag);
    created = true;
    // Eerst lokaal vastleggen, DAARNA pas de serverregistratie afronden: lukt opslaan niet, dan ontstaat er op de server geen toestel.
    await storage.setDeviceKey(JSON.stringify({ installationId, tag }));
    stored = true;
    const signature = await keys.sign(tag, registrationMessage(claim.challenge, installationId));
    const platform = Capacitor.getPlatform() === "ios" ? "IOS" : "ANDROID";
    await api.completeDevicePairing({
      registrationToken: claim.registrationToken,
      publicKey,
      signature,
      installationId,
      platform,
      label: platform === "IOS" ? "iPhone" : "Android-toestel",
    });
    return { ok: true };
  } catch (err) {
    if (created) await keys.remove(tag).catch(() => undefined);
    if (stored) await storage.clearDeviceKey().catch(() => undefined);
    if (err instanceof ApiRequestError) return { ok: false, message: err.message };
    if (err instanceof DeviceKeyError) return { ok: false, message: err.message };
    // Annuleren van de biometrie/toestelcode of een platformfout: generieke melding, nooit details van de plug-in tonen.
    return { ok: false, message: "Koppelen is niet gelukt. Controleer of je toestel een schermvergrendeling heeft en probeer het opnieuw." };
  }
}
