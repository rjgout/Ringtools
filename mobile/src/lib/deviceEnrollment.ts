import { Capacitor } from "@capacitor/core";
import { ApiRequestError, type ApiClient } from "./api";
import { DeviceLoginError, RECOVERY_HINT, deviceLoginSupported, readDeviceKeyRef, type DeviceKeyRef } from "./deviceLogin";
import { nativeDeviceKeys, type DeviceKeyProvider } from "./deviceKey";
import { storage } from "./storage";

/**
 * Automatische Face ID-inrichting (E2.5): een reeds VOLLEDIG ingelogde gebruiker (recente tweede factor, door de server afgedwongen) richt dit toestel
 * in, zonder koppelcode. De handtekening over de serverchallenge bewijst sleutelbezit én is de bewuste bevestiging met Face ID/toestelcode.
 * Een bestaande lokale koppeling van een ANDER account wordt nooit stilzwijgend overschreven (expliciete bevestiging), en bij elke mislukking blijft de
 * vorige toestand intact. Logt nooit challenges, berichten of handtekeningen.
 */
export const ENROLL_CONTEXT = "ringtools-device-enroll-v1";
/** Zelfde bericht als de server (src/lib/deviceEnrollment.ts `enrollmentMessage`). */
export const enrollMessage = (enrollmentId: string, challenge: string, userId: string, installationId: string) => `${ENROLL_CONTEXT}\n${enrollmentId}\n${challenge}\n${userId}\n${installationId}`;

export type DeviceState =
  | { kind: "enabled" } //   dit toestel is ingesteld en geactiveerd voor dit account
  | { kind: "registered" } // gekoppeld (bijv. via code) maar nog niet geactiveerd voor inloggen
  | { kind: "none" } //      geen lokale sleutel
  | { kind: "replace-own" } // lokale sleutel van dit account bestaat niet meer op de server (ingetrokken): veilig te vervangen
  | { kind: "conflict"; ownerName?: string } // lokale sleutel hoort bij een ander (of onbekend) account: alleen na expliciete bevestiging vervangen
  | { kind: "unknown" }; //   status niet op te halen

export async function describeDevice(api: Pick<ApiClient, "deviceStatus">, userId: string): Promise<DeviceState> {
  const ref = await readDeviceKeyRef();
  if (!ref) return { kind: "none" };
  try {
    const st = await api.deviceStatus(ref.installationId);
    if (st.registered) return st.loginEnabled ? { kind: "enabled" } : { kind: "registered" };
  } catch {
    return { kind: "unknown" };
  }
  return ref.userId === userId ? { kind: "replace-own" } : { kind: "conflict", ownerName: ref.name };
}

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type EnrollResult = { ok: true } | { ok: false; cancelled: boolean; message: string };

export async function enrollThisDevice(
  api: Pick<ApiClient, "deviceEnrollChallenge" | "deviceEnrollComplete">,
  me: { id: string; name: string },
  keys: DeviceKeyProvider = nativeDeviceKeys,
  platform: string = Capacitor.getPlatform()
): Promise<EnrollResult> {
  if (!deviceLoginSupported(keys, platform)) return { ok: false, cancelled: false, message: "Inloggen met Face ID is alleen op iPhone beschikbaar." };
  const previousRaw = await storage.getDeviceKey().catch(() => null);
  const previous: DeviceKeyRef | null = await readDeviceKeyRef();
  const installationId = randomHex(16);
  const tag = `nl.ringapeldoorn.ringtools.devicekey.${installationId}`;
  let created = false;
  let stored = false;
  try {
    const ch = await api.deviceEnrollChallenge();
    const publicKey = await keys.create(tag);
    created = true;
    let signature: string;
    try {
      signature = await keys.sign(tag, enrollMessage(ch.enrollmentId, ch.challenge, ch.userId, installationId)); // Face ID / toestelcode
    } catch {
      throw new DeviceLoginError("Instellen is geannuleerd. Je kunt Face ID later instellen via je profiel.", "cancelled");
    }
    // Eerst lokaal vastleggen (voor welk account), dan pas de serverregistratie afronden: mislukt opslaan, dan ontstaat er op de server niets.
    await storage.setDeviceKey(JSON.stringify({ installationId, tag, userId: ch.userId, name: me.name }));
    stored = true;
    await api.deviceEnrollComplete({ enrollmentId: ch.enrollmentId, publicKey, installationId, signature, platform: "IOS", label: "iPhone" });
    if (previous && previous.tag !== tag) await keys.remove(previous.tag).catch(() => undefined); // pas na succes de oude lokale sleutel opruimen
    return { ok: true };
  } catch (err) {
    if (created) await keys.remove(tag).catch(() => undefined);
    if (stored) {
      // Herstel de vorige lokale toestand exact (geen stilzwijgend verlies van een bestaande koppeling).
      if (previousRaw) await storage.setDeviceKey(previousRaw).catch(() => undefined);
      else await storage.clearDeviceKey().catch(() => undefined);
    }
    if (err instanceof DeviceLoginError) return { ok: false, cancelled: true, message: err.message };
    if (err instanceof ApiRequestError) {
      if (err.code === "mfa-required") return { ok: false, cancelled: false, message: "Stel eerst extra verificatie in op de website. Daarna kun je Face ID instellen." };
      return { ok: false, cancelled: false, message: err.message };
    }
    return { ok: false, cancelled: false, message: `Instellen is niet gelukt. ${RECOVERY_HINT}` };
  }
}
