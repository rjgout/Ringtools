import { env } from "./env";
import { hasPasskeys } from "./webauthn";
import { isTotpConfirmed } from "./mfa";

/**
 * Tweede-factormethoden voor het web (E2.1).
 *
 * - Het beheerdersaccount (webmin) gebruikt uitsluitend TOTP en wordt hier nooit meegenomen (eigen, ongewijzigde pad).
 * - Voor gewone gebruikers is TOTP alleen een geldige methode zolang `WEB_TOTP_ENABLED` aan staat (standaard uit). Met de vlag uit
 *   telt een eventueel aanwezige TOTP-rij NIET: fail-closed, geen gedrag verandert.
 * - Een methode telt pas als hij bevestigd is.
 */
export type MfaMethod = "passkey" | "totp";

export function totpAllowedForUser(role: string): boolean {
  return role !== "ADMIN" && env.webTotpEnabled;
}

export async function enrolledMethods(user: { id: string; role: string }): Promise<MfaMethod[]> {
  if (user.role === "ADMIN") return [];
  const methods: MfaMethod[] = [];
  if (await hasPasskeys(user.id)) methods.push("passkey");
  if (totpAllowedForUser(user.role) && (await isTotpConfirmed(user.id))) methods.push("totp");
  return methods;
}
