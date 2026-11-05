import { Capacitor } from "@capacitor/core";

/**
 * Schermbescherming (plug-in @capacitor-community/privacy-screen):
 *  - Android: FLAG_SECURE op het appvenster → geen schermafbeeldingen/schermopnames en geen inhoud in de recente-apps-weergave.
 *  - iOS: bij `willResignActive` legt de plug-in synchroon een neutrale weergave over de app, vóór de momentopname van de app-switcher.
 *    Schermafbeeldingen en schermopnames zijn op iOS met openbare API NIET betrouwbaar te blokkeren; de plug-in kan ze alleen melden
 *    (en bevat een niet-gedocumenteerde laagtruc die we bewust uitzetten: `preventScreenshots: false` in capacitor.config.ts).
 * Faalt de plug-in, dan blijft de JS-afscherming (PrivacyCover) en de vergrendeling gewoon werken.
 */
export async function enablePrivacyScreen(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { PrivacyScreen } = await import("@capacitor-community/privacy-screen");
    await PrivacyScreen.enable();
  } catch {
    /* geen native afscherming beschikbaar; de JS-afscherming blijft */
  }
}
