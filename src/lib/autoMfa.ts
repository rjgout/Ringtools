import { prisma } from "./prisma";
import { env } from "./env";
import { logSecurityEvent } from "./securityEvents";

/**
 * Automatische MFA (E2.3 fase 3, vlag `AUTO_ENABLE_MFA`, standaard uit).
 *
 * MFA gaat vanzelf aan zodra een gewone gebruiker zijn EERSTE bruikbare methode (passkey of authenticator-app) succesvol heeft
 * ingeschreven en bevestigd. Regels:
 * - Alleen met de vlag aan, voor niet-admin gebruikers, en alleen wanneer de gebruiker vóór deze inschrijving GEEN bruikbare methode
 *   had (`hadUsableMethodBefore === false`). Een bestaand account met een methode (ook met MFA bewust uit) wordt nooit omgezet.
 * - Een onvolledige of mislukte inschrijving activeert niets: de aanroeper roept dit pas ná de bevestiging aan.
 * - Eén transactie met rijvergrendeling op de gebruiker (zelfde slot als `enableMfaGuarded`/verwijderen): er wordt opnieuw geteld en
 *   alleen ingeschakeld als er nu minstens één bruikbare methode is. Bij een fout blijft de gebruiker zoals voorheen (MFA uit).
 */
export async function usableMethodCount(userId: string, role: string): Promise<number> {
  const passkeys = await prisma.webAuthnCredential.count({ where: { userId } });
  const totp = role !== "ADMIN" && env.webTotpEnabled && Boolean((await prisma.totpCredential.findUnique({ where: { userId } }))?.confirmedAt);
  return passkeys + (totp ? 1 : 0);
}

export async function autoEnableMfaAfterFirstMethod(userId: string, hadUsableMethodBefore: boolean): Promise<boolean> {
  if (!env.autoEnableMfa || hadUsableMethodBefore) return false;
  try {
    const enabled = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ role: string; mfaEnabled: boolean }[]>`SELECT "role"::text AS "role", "mfaEnabled" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const user = rows[0];
      if (!user || user.role === "ADMIN" || user.mfaEnabled) return false;
      const passkeys = await tx.webAuthnCredential.count({ where: { userId } });
      const totp = env.webTotpEnabled && Boolean((await tx.totpCredential.findUnique({ where: { userId } }))?.confirmedAt);
      if (passkeys + (totp ? 1 : 0) < 1) return false;
      await tx.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
      return true;
    });
    if (enabled) await logSecurityEvent({ userId, type: "MFA_VERIFIED", detail: "Verificatie automatisch ingeschakeld na eerste methode" });
    return enabled;
  } catch {
    return false; // veilig: MFA blijft uit, de inschrijving zelf is al bevestigd
  }
}
