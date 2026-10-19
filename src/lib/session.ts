import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Role, User } from "@prisma/client";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  AWAITING_MFA_TTL_MS,
  getSessionUser,
  getSessionAwaitingMfa,
  getActiveSession,
  isRecentlyMfaVerified,
  mfaRequired,
  type AwaitingMfaSession,
  type ActiveSession,
} from "./auth";
import { env } from "./env";

export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE_NAME)?.value;
  return getSessionUser(raw);
}

/** Voor de /mfa/*-pagina's: wie is deze (nog niet volledig ingelogde) sessie? */
export async function getAwaitingMfaUser(): Promise<AwaitingMfaSession | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE_NAME)?.value;
  return getSessionAwaitingMfa(raw);
}

/** Huidige volledig ingelogde sessie, inclusief sessie-id en `mfaAt`. */
export async function getCurrentSession(): Promise<ActiveSession | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE_NAME)?.value;
  return getActiveSession(raw);
}

/** Vereist een recente (≤15 min) geslaagde MFA-verificatie op de huidige sessie. */
export async function requireRecentMfa(reverifyPath: string): Promise<ActiveSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  // Zonder ingeschakelde tweede factor is er niets om opnieuw te verifiëren.
  if (mfaRequired(session.user) && !isRecentlyMfaVerified(session.mfaAt)) {
    redirect(reverifyPath);
  }
  return session;
}

export async function getRequestUserAgent(): Promise<string | null> {
  const store = await headers();
  return store.get("user-agent");
}

/** `awaitingMfa` gebruikt de korte TTL, zodat de cookie niet langer leeft dan de sessie-rij in de database. */
export async function setSessionCookie(rawToken: string, awaitingMfa = false): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor((awaitingMfa ? AWAITING_MFA_TTL_MS : SESSION_TTL_MS) / 1000),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

export async function getSessionCookieValue(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value;
}

/** Vereist een ingelogde, actieve gebruiker. Stuurt zo nodig door naar /login. */
export async function requireUser(next?: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  }
  return user;
}

/** Vereist een ingelogde gebruiker met één van de toegestane rollen. */
export async function requireRole(roles: Role[], next?: string): Promise<User> {
  const user = await requireUser(next);
  if (!roles.includes(user.role)) {
    redirect("/geen-toegang");
  }
  return user;
}

/** Valideert dat een opgegeven doel-pad veilig intern is (voorkomt open redirect). */
export function safeInternalPath(path: string | undefined | null): string | null {
  if (!path) return null;
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  return path;
}
