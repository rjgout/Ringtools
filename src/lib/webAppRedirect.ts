import { env } from "./env";

/**
 * Web/PWA v2: waar een pagina van de bestaande website voor een gewone gebruiker naartoe verwijst zodra de vlag aan staat.
 * Geeft `null` als er niet wordt doorverwezen (vlag uit, beheerder, of een pagina die blijft bestaan zoals de webmin-pagina's).
 * De bestemming is altijd een vast, intern pad; een voorstel-id wordt alleen overgenomen als het een gewoon id is.
 */
export function webAppTargetFor(pathAndQuery: string | null | undefined, opts: { isAdmin: boolean; enabled?: boolean }): string | null {
  const enabled = opts.enabled ?? env.webAppV2Enabled;
  if (!enabled || opts.isAdmin || !pathAndQuery) return null;
  const pathname = pathAndQuery.split("?")[0].replace(/\/+$/, "") || "/";
  const to = (route: string) => (route === "/" ? "/app" : `/app?to=${encodeURIComponent(route)}`);
  if (pathname === "/dashboard") return to("/");
  if (pathname === "/roepingen") return to("/voorstellen");
  if (pathname === "/roepingen/nieuw") return to("/voorstellen/nieuw");
  const detail = /^\/roepingen\/([A-Za-z0-9_-]{1,64})$/.exec(pathname);
  if (detail) return to(`/roepingen/${detail[1]}`);
  if (pathname === "/gebruikers") return to("/beheer/gebruikers");
  if (pathname === "/profiel") return to("/profiel");
  return null;
}
