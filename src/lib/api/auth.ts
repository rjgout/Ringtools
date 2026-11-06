import type { User } from "@prisma/client";
import { getActiveSession } from "../auth";
import { ApiError } from "./http";

export type ApiAuth = { user: User; token: string; sessionId: string; mfaAt: Date };

/** Haalt het Bearer-token uit de Authorization-header. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(header);
  return match ? match[1] : null;
}

/**
 * Authenticeert een API-verzoek met dezelfde server-side sessies als de webapp (zelfde verlenging,
 * intrekking en deactivering). Sessies zonder voltooide MFA tellen nooit mee.
 * - "user": gewone gebruikers; het beheerdersaccount (webmin) wordt hier geweigerd.
 */
export async function authenticate(request: Request, kind: "user" = "user"): Promise<ApiAuth> {
  const token = bearerToken(request);
  const session = token ? await getActiveSession(token) : null;
  if (!token || !session) throw new ApiError(401, "Je bent niet ingelogd of je sessie is verlopen.", "unauthenticated");
  const isAdmin = session.user.role === "ADMIN";
  if (kind === "user" && isAdmin) {
    throw new ApiError(403, "Systeembeheer gebeurt uitsluitend via de beveiligde website.", "admin-web-only");
  }
  return { user: session.user, token, sessionId: session.sessionId, mfaAt: session.mfaAt };
}
