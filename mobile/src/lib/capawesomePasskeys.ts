import { PasskeyCancelledError, PasskeyError, registerPasskeyProvider, type PasskeyAssertion, type PasskeyProvider, type PasskeyRequestOptions } from "./passkeys";

/**
 * Adapter voor `@capawesome/capacitor-passkeys` (exact 0.1.2) achter onze `PasskeyProvider`-interface.
 * Alleen AUTHENTICATIE: de bestaande roadmap houdt het registreren van passkeys webapp-only (vereist een recente MFA-verificatie; zie docs/PASSKEYS-NATIVE.md).
 * De adapter beslist niets over beveiliging: de server geeft de challenge uit en verifieert de assertion (RP ID, origin, user verification, teller).
 * Defensief aan de clientkant: de RP ID uit de serveropties moet gelijk zijn aan de eigen backendhost, de challenge moet geldig base64url zijn,
 * user verification wordt altijd als 'required' gevraagd en er loopt nooit meer dan één ceremonie tegelijk.
 */

/** De delen van de plug-in die we gebruiken (injecteerbaar voor tests). */
export type PasskeysPluginLike = {
  isAvailable(): Promise<{ available: boolean }>;
  getPasskey(options: { challenge: string; rpId: string; allowCredentials?: { id: string; type: "public-key" }[]; timeout?: number; userVerification: "required" }): Promise<{
    id: string;
    rawId: string;
    type: "public-key";
    response: { authenticatorData: string; clientDataJSON: string; signature: string; userHandle?: string };
  }>;
};

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export const PASSKEY_MESSAGES = {
  "not-supported": "Dit toestel ondersteunt inloggen met een passkey niet. Log voorlopig in via de webapp; je beveiliging blijft ongewijzigd.",
  "domain-not-associated": "De app is nog niet gekoppeld aan de website voor passkeys. Log voorlopig in via de webapp; je beveiliging blijft ongewijzigd.",
  "no-credential": "Er is op dit toestel geen passkey voor jouw account gevonden. Probeer een ander toestel of log in via de webapp.",
  "invalid-options": "De passkey-verificatie kon niet worden gestart. Log voorlopig in via de webapp; je beveiliging blijft ongewijzigd.",
  failed: "De verificatie is niet gelukt. Probeer het opnieuw.",
} as const;

/** Plug-in-foutcodes (`ErrorCode` van de plug-in) naar onze eigen fouten. Onbekende codes zijn een gewone, herhaalbare mislukking. */
export function mapPluginError(err: unknown): Error {
  const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code?: unknown }).code) : "";
  if (code === "CANCELED") return new PasskeyCancelledError();
  if (code === "NOT_SUPPORTED") return new PasskeyError("not-supported", PASSKEY_MESSAGES["not-supported"]);
  if (code === "DOMAIN_NOT_ASSOCIATED") return new PasskeyError("domain-not-associated", PASSKEY_MESSAGES["domain-not-associated"]);
  if (code === "NO_CREDENTIAL") return new PasskeyError("no-credential", PASSKEY_MESSAGES["no-credential"]);
  return new PasskeyError("failed", PASSKEY_MESSAGES.failed);
}

export function createCapawesomeProvider(plugin: PasskeysPluginLike, expectedRpId: string): PasskeyProvider {
  let busy = false;
  return {
    async authenticate(options: PasskeyRequestOptions): Promise<PasskeyAssertion> {
      if (typeof options.challenge !== "string" || options.challenge.length < 16 || options.challenge.length > 512 || !BASE64URL.test(options.challenge)) {
        throw new PasskeyError("invalid-options", PASSKEY_MESSAGES["invalid-options"]);
      }
      // De RP ID komt van de server, maar mag nooit een ander domein zijn dan onze eigen backend.
      if (!options.rpId || options.rpId.toLowerCase() !== expectedRpId.toLowerCase()) {
        throw new PasskeyError("invalid-options", PASSKEY_MESSAGES["invalid-options"]);
      }
      if (busy) throw new PasskeyError("failed", PASSKEY_MESSAGES.failed); // één ceremonie tegelijk (de plug-in bewaart per aanroep één afhandeling)
      busy = true;
      try {
        let available = false;
        try {
          available = (await plugin.isAvailable()).available === true;
        } catch (err) {
          throw mapPluginError(err);
        }
        if (!available) throw new PasskeyError("not-supported", PASSKEY_MESSAGES["not-supported"]);

        let result;
        try {
          result = await plugin.getPasskey({
            challenge: options.challenge,
            rpId: options.rpId,
            allowCredentials: options.allowCredentials?.filter((c) => typeof c.id === "string" && BASE64URL.test(c.id)).map((c) => ({ id: c.id, type: "public-key" as const })),
            ...(typeof options.timeout === "number" && options.timeout > 0 ? { timeout: Math.min(options.timeout, 120_000) } : {}),
            userVerification: "required", // altijd, ongeacht wat de opties zeggen; de server controleert de UV-vlag in de assertion bovendien zelf
          });
        } catch (err) {
          throw mapPluginError(err);
        }

        const r = result?.response;
        if (!result || result.type !== "public-key" || typeof result.id !== "string" || typeof result.rawId !== "string" || !r ||
            typeof r.authenticatorData !== "string" || typeof r.clientDataJSON !== "string" || typeof r.signature !== "string") {
          throw new PasskeyError("failed", PASSKEY_MESSAGES.failed);
        }
        return {
          id: result.id,
          rawId: result.rawId,
          type: "public-key",
          response: { clientDataJSON: r.clientDataJSON, authenticatorData: r.authenticatorData, signature: r.signature, ...(typeof r.userHandle === "string" && r.userHandle ? { userHandle: r.userHandle } : {}) },
          clientExtensionResults: {},
        };
      } finally {
        busy = false;
      }
    },
  };
}

/**
 * Koppelt de plug-in aan de app — uitsluitend op een native toestel en nooit in een beperkte (Personal Team-)build.
 * Het registreren van de provider schakelt niets in: zolang `NATIVE_PASSKEYS_ENABLED` op de server uit staat geeft de server voor
 * accounts met verplichte MFA nog steeds `403 mfa-not-supported`.
 */
export async function registerCapawesomePasskeys(opts: { isNative: boolean; passkeysCapable: boolean; rpId: string }): Promise<boolean> {
  if (!opts.isNative || !opts.passkeysCapable) return false;
  const { Passkeys } = await import("@capawesome/capacitor-passkeys");
  registerPasskeyProvider(createCapawesomeProvider(Passkeys as unknown as PasskeysPluginLike, opts.rpId));
  return true;
}
