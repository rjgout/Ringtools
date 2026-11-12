import { Capacitor, registerPlugin } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";

/** Beide native beeldlagen via hetzelfde bestaande gereedmoment verbergen. */
export async function hideNativeSplash(): Promise<void> {
  try { await SplashScreen.hide(); } catch { /* Oudere/ontbrekende native bridge mag opstarten niet blokkeren. */ }
  if (Capacitor.getPlatform() === "android") {
    try {
      // Geen plug-inproxy uit een async functie teruggeven (thenable Capacitor-proxy).
      await registerPlugin<{ hide(): Promise<void> }>("RingtoolsSplash").hide();
    } catch { /* Compatibel met een oudere Android-bundel zonder deze beeldlaag. */ }
  }
}
