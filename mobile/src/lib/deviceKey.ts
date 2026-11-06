import { Capacitor } from "@capacitor/core";
import { CryptoApi } from "@perfood/capacitor-crypto-api";

/**
 * Adapter voor een hardwaregebonden toestelsleutel (E2.3). Dit is de ENIGE plek die `@perfood/capacitor-crypto-api` aanraakt, zodat de
 * plug-in vervangbaar blijft (bijv. door een eigen minimale plug-in met attestatie).
 *
 * Bekende beperkingen (bewust vastgelegd, zie docs/E2-3-TOESTELSLEUTELS-ONDERZOEK.md):
 * - Zonder attestatie kan de server NIET bewijzen dat de sleutel in hardware zit (iOS Secure Enclave / Android StrongBox of TEE).
 * - Op Android is de gebruikersverificatie een tijdvenster van ~5 s, niet gelijkwaardig aan gebruikersverificatie per handtekening.
 * - De plug-in zelf kan data en handtekening loggen; deze adapter logt nooit berichten, handtekeningen of sleutels.
 *
 * Capacitor-plug-ins zijn thenable proxies: de plug-in wordt hier nooit teruggegeven of via een async-functie doorgegeven.
 */
export class DeviceKeyError extends Error {}

export type DeviceKeyProvider = {
  available(): boolean;
  create(tag: string): Promise<string>; // SPKI base64
  sign(tag: string, message: string): Promise<string>; // DER base64
  remove(tag: string): Promise<void>;
};

const ALG = "ecdsa" as const;
const TYPE = "BIOMETRY_OR_PASSCODE" as const; // gebruikersaanwezigheid bij ondertekenen (biometrie of toestelcode)

export const nativeDeviceKeys: DeviceKeyProvider = {
  available: () => Capacitor.isNativePlatform(),
  async create(tag) {
    if (!Capacitor.isNativePlatform()) throw new DeviceKeyError("Toestelsleutels zijn alleen in de app beschikbaar.");
    const res = await CryptoApi.generateKey({ tag, algorithm: ALG, type: TYPE });
    const key = typeof res?.publicKey === "string" ? res.publicKey.replace(/\s+/g, "") : "";
    if (!key) throw new DeviceKeyError("Er kon geen toestelsleutel worden aangemaakt.");
    return key;
  },
  async sign(tag, message) {
    const res = await CryptoApi.sign({ tag, data: message, type: TYPE });
    const sig = typeof res?.signature === "string" ? res.signature.replace(/\s+/g, "") : "";
    if (!sig) throw new DeviceKeyError("Ondertekenen is mislukt.");
    return sig;
  },
  async remove(tag) {
    await CryptoApi.deleteKey({ tag, algorithm: ALG });
  },
};
