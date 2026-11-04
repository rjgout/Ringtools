import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Keyboard } from "@capacitor/keyboard";
import { Network } from "@capacitor/network";
import { Share } from "@capacitor/share";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform() as "ios" | "android" | "web";

/** Statusbar volgt het thema; splashscreen verdwijnt pas als de eerste weergave klaar is. */
export async function setupNativeChrome() {
  if (!isNative) return;
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => void StatusBar.setStyle({ style: dark.matches ? Style.Dark : Style.Light }).catch(() => {});
  apply();
  dark.addEventListener("change", apply);
  if (platform === "android") void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
  await Keyboard.setAccessoryBarVisible({ isVisible: true }).catch(() => {});
  await SplashScreen.hide().catch(() => {});
}

/** Android-terugknop: eerst terug in de app, bij de eerste scherm de app naar de achtergrond. */
export function onBackButton(handler: () => boolean) {
  if (platform !== "android") return () => {};
  const sub = App.addListener("backButton", () => {
    if (!handler()) void App.minimizeApp();
  });
  return () => void sub.then((s) => s.remove());
}

export async function onNetworkChange(cb: (online: boolean) => void) {
  const status = await Network.getStatus().catch(() => ({ connected: true }));
  cb(status.connected);
  const sub = await Network.addListener("networkStatusChange", (s) => cb(s.connected));
  return () => void sub.remove();
}

/** Deelt tekst via het native deelmenu. Er wordt geen persoonlijke gegevens of token meegegeven. */
export async function shareText(title: string, text: string) {
  if ((await Share.canShare()).value) await Share.share({ title, text, dialogTitle: title });
}
