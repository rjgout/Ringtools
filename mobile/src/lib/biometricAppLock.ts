import { Capacitor } from "@capacitor/core";
import type { AppLockProvider, AppLockResult, LockFailure } from "./appLock";

/** Het deel van @aparajita/capacitor-biometric-auth dat we gebruiken (injecteerbaar voor tests). */
export type BiometricPluginLike = {
  checkBiometry(): Promise<{ deviceIsSecure: boolean }>;
  authenticate(options: Record<string, unknown>): Promise<void>;
};

const STRONG = 1; // AndroidBiometryStrength.strong (ordinal in de plug-in)

/**
 * Mapt de foutcodes van de plug-in op onze eigen resultaten. Alles wat onbekend is wordt "error" (blijft vergrendeld).
 * Annuleren (gebruiker, systeem of app) is nooit succes.
 */
export function mapBiometricError(code: unknown): LockFailure {
  switch (code) {
    case "userCancel":
    case "systemCancel":
    case "appCancel":
      return "cancelled";
    case "authenticationFailed":
      return "failed";
    case "biometryLockout":
      return "lockout";
    case "passcodeNotSet":
    case "noDeviceCredential":
      return "no-device-security";
    case "biometryNotAvailable":
    case "biometryNotEnrolled":
      return "unavailable";
    default:
      return "error";
  }
}

/**
 * Adapter voor de systeemverificatie: iOS LocalAuthentication (`deviceOwnerAuthentication`: Face ID/Touch ID met terugval op de toestelcode)
 * en Android BiometricPrompt (BIOMETRIC_STRONG | DEVICE_CREDENTIAL; op Android 9–10 beperkt de Android-API dit tot WEAK | DEVICE_CREDENTIAL).
 * Er wordt geen eigen terugval aangeboden. De plug-in slaat niets op en doet geen netwerkverkeer.
 */
export function createBiometricAppLockProvider(plugin: BiometricPluginLike): AppLockProvider {
  return {
    async deviceSecure() {
      const info = await plugin.checkBiometry();
      return info.deviceIsSecure === true;
    },
    async authenticate(): Promise<AppLockResult> {
      try {
        await plugin.authenticate({
          reason: "Ontgrendel Ringtools",
          cancelTitle: "Annuleren",
          allowDeviceCredential: true,
          androidTitle: "Ringtools ontgrendelen",
          androidSubtitle: "Bevestig dat jij het bent",
          androidConfirmationRequired: false,
          androidBiometryStrength: STRONG,
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: mapBiometricError((err as { code?: unknown } | null)?.code) };
      }
    },
  };
}

/** Laadt de echte plug-in (alleen native; nooit in een gewone browser, waar de plug-in een simulatie zou bevatten). */
export async function loadNativeAppLockProvider(): Promise<AppLockProvider | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    return createBiometricAppLockProvider(BiometricAuth as unknown as BiometricPluginLike);
  } catch {
    return null; // plug-in niet te laden: de app blijft geblokkeerd (fail-closed)
  }
}

/**
 * Provider die de echte plug-in pas bij het eerste gebruik laadt. Lukt het laden niet, dan meldt ze "niet beschikbaar" (de app blijft
 * geblokkeerd) in plaats van ooit toegang te geven.
 */
export function createLazyAppLockProvider(load: () => Promise<AppLockProvider | null>): AppLockProvider {
  let cached: Promise<AppLockProvider | null> | null = null;
  const get = () => (cached ??= load());
  return {
    async deviceSecure() {
      const p = await get();
      if (!p) throw new Error("app-lock-provider-unavailable");
      return p.deviceSecure();
    },
    async authenticate() {
      const p = await get();
      return p ? p.authenticate() : { ok: false, reason: "error" };
    },
  };
}
