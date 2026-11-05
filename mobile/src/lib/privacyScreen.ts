import { Capacitor } from "@capacitor/core";

/**
 * Schermbescherming (plug-in @capacitor-community/privacy-screen):
 *  - Android: FLAG_SECURE op het appvenster → geen schermafbeeldingen/schermopnames en geen inhoud in de recente-apps-weergave.
 *  - iOS: bij `willResignActive` legt de plug-in synchroon een neutrale weergave over de app, vóór de momentopname van de app-switcher
 *    (alleen zolang de bescherming is ingeschakeld). Schermafbeeldingen en schermopnames zijn op iOS met openbare API NIET betrouwbaar
 *    te blokkeren; de plug-in bevat een niet-gedocumenteerde laagtruc die we bewust uitzetten (`preventScreenshots: false`).
 *
 * FAIL-CLOSED: de bescherming geldt als voorwaarde voor toegang. `ensurePrivacyScreen()` geeft alleen `true` als de plug-in
 * beschikbaar is én `enable()` aantoonbaar is geslaagd binnen de tijdslimiet. In alle andere gevallen (plug-in niet geregistreerd,
 * niet te laden, fout, hangende aanroep) is het resultaat `false` en blijft de app vergrendeld/geblokkeerd (zie LockController).
 */
export const PROTECTION_TIMEOUT_MS = 3_000;

export type PrivacyPluginLike = { enable(): Promise<void> };

export type PrivacyScreenDeps = {
  /** Alleen een gewone ontwikkelbrowser is "niet native": daar bestaat geen native bescherming en is er niets te verifiëren. */
  native?: boolean;
  load?: () => Promise<PrivacyPluginLike | null>;
  timeoutMs?: number;
};

async function loadPlugin(): Promise<PrivacyPluginLike | null> {
  if (!Capacitor.isPluginAvailable("PrivacyScreen")) return null; // niet native geregistreerd (bijv. verkeerd gebouwd project)
  const { PrivacyScreen } = await import("@capacitor-community/privacy-screen");
  return PrivacyScreen as unknown as PrivacyPluginLike;
}

export async function ensurePrivacyScreen(deps: PrivacyScreenDeps = {}): Promise<boolean> {
  const native = deps.native ?? Capacitor.isNativePlatform();
  if (!native) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const attempt = (async () => {
      const plugin = await (deps.load ?? loadPlugin)();
      if (!plugin) return false;
      await plugin.enable();
      return true;
    })();
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), deps.timeoutMs ?? PROTECTION_TIMEOUT_MS);
    });
    return await Promise.race([attempt, timeout]);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
