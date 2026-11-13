/**
 * Paden van de webomgeving. De client staat op `/app` en gebruikt hash-routes (`/app#/voorstellen`), net als de app.
 * Voor doorverwijzingen via de website (inloggen, herverificatie) wordt de bestemming als `/app?to=<pad>` meegegeven: een gewoon intern pad
 * zonder hekje, dat de bestaande serverzijdige controle op veilige interne paden doorstaat.
 */
export const WEB_APP_BASE = "/app";

/** Alleen interne app-routes: begint met één "/", geen "//", geen backslash of stuurtekens. */
export function safeAppRoute(route: string | null | undefined): string | null {
  if (!route || !route.startsWith("/") || route.startsWith("//") || route.includes("\\") || /[\u0000-\u001f\u007f]/.test(route)) return null;
  return route;
}

export function appUrlFor(route: string): string {
  const safe = safeAppRoute(route);
  return safe && safe !== "/" ? `${WEB_APP_BASE}?to=${encodeURIComponent(safe)}` : WEB_APP_BASE;
}

/** De route die nu open staat (uit de hash), als terugkeeradres. */
export function currentAppTarget(loc: Pick<Location, "hash"> = window.location): string {
  return appUrlFor(loc.hash.replace(/^#/, "") || "/");
}

export const toLogin = (target: string) => `/login?next=${encodeURIComponent(target)}`;
export const toReverify = (target: string) => `/profiel/beveiliging/herverifieer?redirect=${encodeURIComponent(target)}`;

/** Bij het opstarten: `?to=<pad>` omzetten naar de hash-route en uit de adresbalk halen. Geeft de route terug (of null). */
export function consumeTargetParam(loc: Location = window.location, history: History = window.history): string | null {
  const params = new URLSearchParams(loc.search);
  const to = safeAppRoute(params.get("to"));
  if (!params.has("to")) return null;
  history.replaceState(null, "", `${loc.pathname}${to ? `#${to}` : loc.hash}`);
  return to;
}
