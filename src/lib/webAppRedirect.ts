/**
 * Web/PWA: de gedeelde interface (`/app`, dezelfde React-client als de iOS-app) is de enige gebruikersomgeving voor gewone gebruikers.
 * De adressen van de vroegere webpagina's blijven bestaan als doorverwijzing (e-maillinks, pushmeldingen, universele links en bladwijzers
 * verwijzen ernaar) en wijzen naar hetzelfde scherm. De webmin (beheerder) houdt zijn eigen pagina's.
 * De bestemming is altijd een vast, intern pad; een voorstel-id wordt alleen overgenomen als het een gewoon id is.
 */
const toApp = (route: string) => (route === "/" ? "/app" : `/app?to=${encodeURIComponent(route)}`);

/** Paden van de vroegere gebruikerspagina's die de webmin nooit gebruikt. */
const isRetiredUserPath = (pathname: string) => pathname === "/roepingen" || pathname.startsWith("/roepingen/") || pathname === "/gebruikers";

/**
 * Waar een pagina uit de beveiligde website (`src/app/(app)`) naartoe verwijst:
 * - gewone gebruiker: het bijbehorende scherm in `/app`, of het overzicht als er geen eigen scherm is;
 * - beheerder: blijft op de webmin-pagina's; alleen de vroegere gebruikerspagina's gaan naar het webmin-overzicht (`/dashboard`).
 * `null` = niet doorverwijzen.
 */
export function webAppTargetFor(pathAndQuery: string | null | undefined, opts: { isAdmin: boolean }): string | null {
  const pathname = (pathAndQuery ?? "").split("?")[0].replace(/\/+$/, "") || "/";
  if (opts.isAdmin) return isRetiredUserPath(pathname) ? "/dashboard" : null;
  if (pathname === "/dashboard") return toApp("/");
  if (pathname === "/roepingen") return toApp("/voorstellen");
  if (pathname === "/roepingen/nieuw") return toApp("/voorstellen/nieuw");
  const detail = /^\/roepingen\/([A-Za-z0-9_-]{1,64})$/.exec(pathname);
  if (detail) return toApp(`/roepingen/${detail[1]}`);
  if (pathname === "/gebruikers") return toApp("/beheer/gebruikers");
  if (pathname === "/profiel") return toApp("/profiel");
  return toApp("/");
}
