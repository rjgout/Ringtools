import type { User } from "@prisma/client";
import { getActiveSession, SESSION_ABSOLUTE_TTL_MS, SESSION_COOKIE_NAME } from "../auth";
import { env } from "../env";
import { ApiError } from "./http";

/** `via`: hoe de aanvrager zich bekendmaakte. "cookie" = de beveiligde webomgeving (web/PWA v2); "bearer" = de native app. */
export type ApiAuth = { user: User; token: string; sessionId: string; mfaAt: Date; via: "bearer" | "cookie" };

/** Vaste eigen header van de webclient. Een formulier, afbeelding of link van een andere site kan deze nooit meesturen (CSRF-bescherming, dwingt bij cross-origin een preflight af die de API nooit toestaat). */
export const WEB_CLIENT_HEADER = "x-ringtools-web";

/** Haalt het Bearer-token uit de Authorization-header. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(header);
  return match ? match[1] : null;
}

/** Meldt het verzoek zich als webclient (eigen header aanwezig, met welke waarde dan ook)? */
export function isWebClientRequest(request: Request): boolean {
  return request.headers.has(WEB_CLIENT_HEADER);
}

function sessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie") || "";
  let found: string | null = null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0 || part.slice(0, i).trim() !== SESSION_COOKIE_NAME) continue;
    if (found !== null) return null; // dubbele cookie: niet raden welke geldt
    found = part.slice(i + 1).trim();
  }
  return found && /^[A-Za-z0-9_-]{20,200}$/.test(found) ? found : null;
}

/**
 * Controleert dat een verzoek van de webclient werkelijk uit de eigen webomgeving komt. Alle voorwaarden moeten gelden (fail-closed):
 * 1. de functievlag staat aan;
 * 2. er is GEEN Authorization-header (geen vermenging van token- en cookie-aanmelding);
 * 3. de eigen header heeft exact de waarde "1";
 * 4. `Origin` is, indien aanwezig, exact de oorsprong van APP_BASE_URL; `Sec-Fetch-Site` is, indien aanwezig, exact "same-origin";
 *    minstens één van beide moet aanwezig zijn (een verzoek zonder enige herkomst wordt geweigerd);
 * 5. wijzigende verzoeken (POST) hebben een JSON-inhoudstype (geen formulierinzending).
 * Er worden bewust nergens CORS-headers gezet: een andere oorsprong kan de API met cookies niet aanroepen of uitlezen.
 */
export function assertTrustedWebRequest(request: Request): void {
  const refuse = (code: string) => new ApiError(403, "Dit verzoek is niet toegestaan.", code);
  if (!env.webAppV2Enabled) throw new ApiError(401, "Je bent niet ingelogd of je sessie is verlopen.", "unauthenticated");
  if (request.headers.has("authorization")) throw new ApiError(400, "Dit verzoek is niet toegestaan.", "mixed-auth");
  if (request.headers.get(WEB_CLIENT_HEADER) !== "1") throw refuse("web-header");
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  let expected: string;
  try {
    expected = new URL(env.appBaseUrl).origin;
  } catch {
    throw refuse("web-origin");
  }
  if (origin === null && site === null) throw refuse("web-origin");
  if (origin !== null && origin !== expected) throw refuse("web-origin");
  if (site !== null && site !== "same-origin") throw refuse("web-origin");
  if (request.method !== "GET" && !/^application\/json\b/i.test(request.headers.get("content-type") || "")) throw refuse("web-content-type");
}

/**
 * Authenticeert een API-verzoek met dezelfde server-side sessies als de webapp (zelfde verlenging,
 * intrekking en deactivering). Sessies zonder voltooide MFA tellen nooit mee.
 * - Native app: Bearer-token in de Authorization-header (ongewijzigd).
 * - Webomgeving (vlag WEB_APP_V2_ENABLED): de HttpOnly-sessiecookie, uitsluitend na `assertTrustedWebRequest`. Een cookie zonder de
 *   eigen header telt nooit; een Bearer-token samen met de eigen header wordt geweigerd.
 * - "user": gewone gebruikers; het beheerdersaccount (webmin) wordt hier geweigerd.
 */
export async function authenticate(request: Request, kind: "user" = "user"): Promise<ApiAuth> {
  const web = isWebClientRequest(request);
  if (web) assertTrustedWebRequest(request);
  const token = web ? sessionCookie(request) : bearerToken(request);
  const session = token ? await getActiveSession(token) : null;
  if (!token || !session) throw new ApiError(401, "Je bent niet ingelogd of je sessie is verlopen.", "unauthenticated");
  const isAdmin = session.user.role === "ADMIN";
  if (kind === "user" && isAdmin) {
    throw new ApiError(403, "Systeembeheer gebeurt uitsluitend via de beveiligde website.", "admin-web-only");
  }
  return { user: session.user, token, sessionId: session.sessionId, mfaAt: session.mfaAt, via: web ? "cookie" : "bearer" };
}

/** Set-Cookie voor de sessiecookie, met dezelfde eigenschappen als `setSessionCookie` (HttpOnly, SameSite=Lax, Secure volgens de omgeving). */
export function sessionCookieHeader(rawToken: string | null): string {
  const base = `${SESSION_COOKIE_NAME}=${rawToken ?? ""}; Path=/; HttpOnly; SameSite=Lax${env.cookieSecure ? "; Secure" : ""}`;
  return rawToken ? `${base}; Max-Age=${Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000)}` : `${base}; Max-Age=0`;
}
