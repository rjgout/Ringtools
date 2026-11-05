import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Productieconfiguratie: de app gebruikt GEBUNDELDE assets (webDir) en praat met de backend via de API.
 * Er is bewust GEEN `server.url`: de app is geen wrapper om een externe website.
 *
 * Voorlopige identiteit: RINGTOOLS_APP_ID / RINGTOOLS_APP_NAME zijn configuratiepunten die met de eigenaar
 * moeten worden afgestemd vóór de eerste store-registratie. De waarden hieronder zijn alleen standaardwaarden.
 */
const config: CapacitorConfig = {
  appId: process.env.RINGTOOLS_APP_ID || "nl.ringapeldoorn.ringtools",
  appName: process.env.RINGTOOLS_APP_NAME || "Ringtools",
  webDir: "dist",
  server: {
    androidScheme: "https",
    // Geen navigatie naar externe sites binnen de WebView: alleen de gebundelde app.
    allowNavigation: [],
  },
  ios: { contentInset: "never", limitsNavigationsToAppBoundDomains: false },
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  plugins: {
    // Native HTTP voor API-aanroepen (geen CORS-afhankelijkheid, geen cookies van de WebView).
    CapacitorHttp: { enabled: true },
    SplashScreen: { launchAutoHide: false, backgroundColor: "#0b1220", showSpinner: false },
    Keyboard: { resize: "body" as never, resizeOnFullScreen: true },
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
    // Schermbescherming (E3): Android FLAG_SECURE; iOS alleen de afscherming voor de app-switcher. De niet-gedocumenteerde laagtruc voor
    // screenshots staat bewust UIT (iOS kan screenshots met openbare API niet betrouwbaar blokkeren; zie docs/APP-ONTGRENDELING-ONTWERP.md).
    PrivacyScreen: { enable: true, preventScreenshots: false },
  },
};

export default config;
