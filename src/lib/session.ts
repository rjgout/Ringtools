import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role, User } from "@prisma/client";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS, getSessionUser } from "./auth";
import { env } from "./env";

export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE_NAME)?.value;
  return getSessionUser(raw);
}

export async function setSessionCookie(rawToken: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
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
