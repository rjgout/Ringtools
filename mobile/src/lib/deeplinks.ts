import type { PluginListenerHandle } from "@capacitor/core";
import { parseTarget, routeFor } from "./links";

/** De stukjes van Capacitor die de deeplink-afhandeling nodig heeft (injecteerbaar voor tests). */
export type DeepLinkSources = {
  getLaunchUrl: () => Promise<{ url?: string } | undefined | null>;
  onUrlOpen: (cb: (e: { url: string }) => void) => Promise<PluginListenerHandle>;
  onPushTap: (cb: (e: { notification: { data?: Record<string, unknown> } }) => void) => Promise<PluginListenerHandle>;
};

/**
 * Koppelt universele links/app-links (koude start via getLaunchUrl, draaiende app en hervatten via appUrlOpen) en
 * het tikken op een pushmelding aan één bestemmingsfunctie. Alleen herkende bestemmingen op de eigen host worden
 * doorgegeven. Geeft een functie terug die uitsluitend DE EIGEN listeners verwijdert.
 */
export function installDeepLinkHandlers(sources: DeepLinkSources, ownHost: string, onRoute: (route: string) => void): () => void {
  let active = true;
  const handle = (url?: string | null) => {
    if (!active) return;
    const target = parseTarget(url, ownHost);
    if (target) onRoute(routeFor(target));
  };

  void sources.getLaunchUrl().then((r) => handle(r?.url)).catch(() => {});
  const handles: Promise<PluginListenerHandle>[] = [
    sources.onUrlOpen((e) => handle(e.url)),
    sources.onPushTap((a) => handle(String(a.notification.data?.url ?? ""))),
  ];

  return () => {
    active = false;
    for (const h of handles) void h.then((x) => x.remove()).catch(() => {});
  };
}
