import { App as CapApp } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import { Capacitor } from "@capacitor/core";
import { LockController } from "./appLock";
import { createLazyAppLockProvider, loadNativeAppLockProvider } from "./biometricAppLock";
import { ensurePrivacyScreen } from "./privacyScreen";

/** De platformgebeurtenissen die de vergrendeling nodig heeft (injecteerbaar voor tests). */
export type LockSources = {
  /** `active=false` bij inactief of achtergrond (ook systeemoverlays). Geeft een functie terug die uitsluitend deze listener verwijdert. */
  onAppState(cb: (active: boolean) => void): () => void;
  /** Android-terugknop zolang de app vergrendeld is: de app naar de achtergrond, nooit terug in verborgen schermen. */
  onBackWhileLocked(): () => void;
  /** Het splashscreen staat op `launchAutoHide: false`; het ontgrendelscherm moet het zelf wegnemen. */
  hideSplash(): void;
};

const native = Capacitor.isNativePlatform();

export const nativeLockSources: LockSources = {
  onAppState(cb) {
    if (!native) {
      // Alleen een ontwikkelbrowser: zichtbaarheid van het tabblad als voor-/achtergrond.
      const handler = () => cb(document.visibilityState === "visible");
      document.addEventListener("visibilitychange", handler);
      return () => document.removeEventListener("visibilitychange", handler);
    }
    const sub = CapApp.addListener("appStateChange", (s) => cb(s.isActive));
    return () => void sub.then((h) => h.remove()).catch(() => {});
  },
  onBackWhileLocked() {
    if (Capacitor.getPlatform() !== "android") return () => {};
    const sub = CapApp.addListener("backButton", () => void CapApp.minimizeApp().catch(() => {}));
    return () => void sub.then((h) => h.remove()).catch(() => {});
  },
  hideSplash() {
    if (native) void SplashScreen.hide().catch(() => {});
  },
};

/** De enige vergrendelingsinstantie van de app. Native altijd aan (verplicht voor alle gebruikers, alle rollen, ook in de Personal Team-build). */
export const appLock = new LockController({
  enabled: native,
  provider: createLazyAppLockProvider(loadNativeAppLockProvider),
  isAppActive: async () => (await CapApp.getState()).isActive,
  // Fail-closed: zonder aantoonbaar actieve schermbescherming geen toegang (zie privacyScreen.ts).
  screenProtection: () => ensurePrivacyScreen(),
});
