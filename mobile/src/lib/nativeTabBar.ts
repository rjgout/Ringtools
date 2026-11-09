/**
 * Native iOS-tabbalk (UITabBar, op iOS 26+ het systeem-Liquid Glass) via de eigen, lokale Capacitor-plug-in `NativeTabBar`
 * (ios/App/App/NativeTabBarPlugin.swift). Alleen iOS; Android, PWA en browser houden de React-balk (`TabBar` in components/ui.tsx).
 *
 * Alles wat bepaalt WAT er getoond wordt (tabs, volgorde, rechten, tellers) staat in `buildTabs` en wordt door beide balken gedeeld,
 * zodat de native balk en de webbalk nooit uiteenlopen. De server blijft beslissen over rechten; de balk toont alleen.
 *
 * Capacitor-plug-ins zijn thenable proxies: de plug-in wordt hier nooit teruggegeven uit een async-functie (zie AGENTS.md);
 * alle aanroepen lopen via het gewone object `bridge`.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { TabId } from "./navigation";

export type TabDescriptor = { id: TabId; label: string; symbol: string; badge: number; a11y: string };

/** SF Symbols (herkenbaar, beschikbaar vanaf iOS 18). De ".fill"-variant voor de geselecteerde tab bepaalt native. */
export const TAB_SYMBOLS: Record<TabId, string> = {
  overzicht: "house",
  voorstellen: "doc.text",
  beheer: "slider.horizontal.3",
  meldingen: "bell",
  profiel: "person.crop.circle",
};

/** De tabs voor de huidige gebruiker. "Beheer" bestaat alleen voor ringbeheerders. Tellers: overzicht (wachtend) en meldingen (ongelezen). */
export function buildTabs(opts: { unread: number; pending: number; canManageUsers: boolean }): TabDescriptor[] {
  const tab = (id: TabId, label: string, badge = 0, a11y?: string): TabDescriptor => ({ id, label, symbol: TAB_SYMBOLS[id], badge: Math.max(0, badge), a11y: a11y ?? label });
  return [
    tab("overzicht", "Overzicht", opts.pending, opts.pending > 0 ? `Overzicht, ${opts.pending} wachten op jou` : "Overzicht"),
    tab("voorstellen", "Voorstellen"),
    ...(opts.canManageUsers ? [tab("beheer", "Beheer")] : []),
    tab("meldingen", "Meldingen", opts.unread, opts.unread > 0 ? `Meldingen, ${opts.unread} ongelezen` : "Meldingen"),
    tab("profiel", "Profiel"),
  ];
}

type Handle = { remove: () => Promise<void> };
type Raw = {
  update(o: { tabs: TabDescriptor[]; selected: TabId; tint?: string; hidden: boolean }): Promise<{ height?: number }>;
  setHidden(o: { hidden: boolean }): Promise<void>;
  remove(): Promise<void>;
  addListener(name: "tabSelected", cb: (e: { id: string }) => void): Promise<Handle>;
  addListener(name: "layout", cb: (e: { height: number }) => void): Promise<Handle>;
};

/** Smalle laag boven de plug-in; in tests te vervangen. Alle fouten worden aan de aanroeper doorgegeven (die valt dan terug op de webbalk). */
export type NativeTabBarBridge = {
  update(o: { tabs: TabDescriptor[]; selected: TabId; tint?: string; hidden: boolean }): Promise<{ height: number }>;
  setHidden(hidden: boolean): Promise<void>;
  remove(): Promise<void>;
  onSelect(cb: (id: string) => void): () => void;
  onLayout(cb: (height: number) => void): () => void;
};

let plugin: Raw | null = null;
function raw(): Raw {
  if (!plugin) plugin = registerPlugin<Raw>("NativeTabBar") as Raw;
  return plugin;
}

const dropHandle = (h: Promise<Handle>) => () => void h.then((x) => x.remove()).catch(() => {});

const pluginBridge: NativeTabBarBridge = {
  update: async (o) => {
    const r = await raw().update(o);
    return { height: typeof r?.height === "number" ? r.height : 0 };
  },
  setHidden: async (hidden) => {
    await raw().setHidden({ hidden });
  },
  remove: async () => {
    await raw().remove();
  },
  onSelect: (cb) => dropHandle(raw().addListener("tabSelected", (e) => cb(e.id))),
  onLayout: (cb) => dropHandle(raw().addListener("layout", (e) => cb(e.height))),
};

let override: NativeTabBarBridge | null = null;
/** Alleen voor tests. */
export function setNativeTabBarBridgeForTests(b: NativeTabBarBridge | null) {
  override = b;
}

/** De native balk is alleen bedoeld voor iOS in de app (niet voor de browser, PWA en Android). */
export function nativeTabBarSupported(): boolean {
  if (override) return true;
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios" && Capacitor.isPluginAvailable("NativeTabBar");
}

export function getNativeTabBarBridge(): NativeTabBarBridge {
  return override ?? pluginBridge;
}
