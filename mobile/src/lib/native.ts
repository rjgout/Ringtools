import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Keyboard } from "@capacitor/keyboard";
import { Network } from "@capacitor/network";
import { Share } from "@capacitor/share";
import { hideNativeSplash } from "./nativeSplash";
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
  await hideNativeSplash().catch(() => {});
}

/** Bron van toetsenbordgebeurtenissen (native plug-in of, op het web, de visualViewport). */
export type KeyboardSource = { onShow(cb: () => void): () => void; onHide(cb: () => void): () => void };

/**
 * Meldt of het schermtoetsenbord open is. Met `Keyboard.resize: "body"` krimpt de pagina bij het toetsenbord en schuift de tabbalk mee
 * omhoog, boven het toetsenbord. De app verbergt de tabbalk daarom zolang het toetsenbord open is (zoals iOS-apps dat doen).
 * Alleen de eigen luisteraars worden verwijderd.
 */
export function watchKeyboardWith(source: KeyboardSource, apply: (open: boolean) => void): () => void {
  const offShow = source.onShow(() => apply(true));
  const offHide = source.onHide(() => apply(false));
  return () => {
    offShow();
    offHide();
    apply(false);
  };
}

function nativeKeyboardSource(): KeyboardSource {
  const drop = (handle: Promise<{ remove: () => Promise<void> }>) => () => void handle.then((h) => h.remove()).catch(() => {});
  return {
    onShow: (cb) => drop(Keyboard.addListener("keyboardWillShow", () => cb())),
    onHide: (cb) => drop(Keyboard.addListener("keyboardWillHide", () => cb())),
  };
}

function webKeyboardSource(): KeyboardSource {
  // Browser: het toetsenbord verkleint de visualViewport aanzienlijk terwijl een invoerveld de focus heeft.
  const vv = window.visualViewport;
  const listeners = { show: new Set<() => void>(), hide: new Set<() => void>() };
  let open = false;
  const check = () => {
    const active = document.activeElement;
    const typing = !!active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT");
    const shrunk = !!vv && vv.height < window.innerHeight * 0.75;
    const now = typing && shrunk;
    if (now !== open) {
      open = now;
      (now ? listeners.show : listeners.hide).forEach((cb) => cb());
    }
  };
  vv?.addEventListener("resize", check);
  document.addEventListener("focusout", check);
  return {
    onShow: (cb) => (listeners.show.add(cb), () => void listeners.show.delete(cb)),
    onHide: (cb) => (
      listeners.hide.add(cb),
      () => {
        listeners.hide.delete(cb);
        vv?.removeEventListener("resize", check);
        document.removeEventListener("focusout", check);
      }
    ),
  };
}

const keyboardListeners = new Set<() => void>();
export const emitKeyboardChange = () => keyboardListeners.forEach((l) => l());
export const isKeyboardOpen = () => document.documentElement.dataset.keyboard === "open";
/** Meldt open/dicht van het toetsenbord (voor de native tabbalk). Verwijdert alleen de eigen luisteraar. */
export function subscribeKeyboard(cb: () => void): () => void {
  keyboardListeners.add(cb);
  return () => void keyboardListeners.delete(cb);
}

/** Zet `data-keyboard="open|closed"` op het documentelement; de stijlen verbergen daarmee de tabbalk. */
export function watchKeyboard(): () => void {
  const root = document.documentElement;
  return watchKeyboardWith(isNative ? nativeKeyboardSource() : webKeyboardSource(), (open) => {
    root.dataset.keyboard = open ? "open" : "closed";
    emitKeyboardChange();
  });
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
