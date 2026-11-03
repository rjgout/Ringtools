import type { User } from "@prisma/client";
import { getActiveSession } from "../auth";
import { ApiError } from "./http";

export type ApiAuth = { user: User; token: string; sessionId: string };

/** Haalt het Bearer-token uit de Authorization-header. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(header);
  return match ? match[1] : null;
}

/**
 * Authenticeert een API-verzoek met dezelfde server-side sessies als de webapp
 * (zelfde verlenging, intrekking en deactivering). De beheerder (webmin) gebruikt
 * altijd de webapp; ringbeheer en gebruikersbeheer ook.
 */
export async function authenticate(request: Request): Promise<ApiAuth> {
  const token = bearerToken(request);
  const session = token ? await getActiveSession(token) : null;
  if (!token || !session) throw new ApiError(401, "Je bent niet ingelogd of je sessie is verlopen.", "unauthenticated");
  if (session.user.role === "ADMIN") {
    throw new ApiError(403, "Het beheerdersaccount gebruikt de webapp.", "admin-web-only");
  }
  return { user: session.user, token, sessionId: session.sessionId };
}
