import type { Prisma } from "@prisma/client";
import { env } from "./env";

/**
 * Automatische MFA (E2.3 fase 3, vlag `AUTO_ENABLE_MFA`, standaard uit).
 *
 * MFA gaat vanzelf aan zodra een gewone gebruiker zijn EERSTE bruikbare methode (passkey of authenticator-app) succesvol heeft
 * ingeschreven en bevestigd. De inschrijving/bevestiging en het inschakelen gebeuren in DEZELFDE databasetransactie:
 * 1. `lockUserForEnrollment` vergrendelt de gebruikersrij (`FOR UPDATE`, zelfde slot als `enableMfaGuarded` en het verwijderen van methoden)
 *    en telt BINNEN de transactie hoeveel bruikbare methoden er vóór de wijziging waren. Gelijktijdige inschrijvingen worden zo serieel afgehandeld.
 * 2. De aanroeper voert zijn wijziging uit (passkey aanmaken / TOTP bevestigen) in dezelfde transactie.
 * 3. `enableMfaIfFirstMethod` zet `mfaEnabled` alleen als de vlag aan staat, de gebruiker geen admin is, MFA uit stond en er vóór de
 *    wijziging geen bruikbare methode was. Bestaande accounts met een methode (ook met MFA bewust uit) worden nooit omgezet.
 * Extra voorwaarde: de app moet met de zojuist bevestigde methode kunnen inloggen (zie `enableMfaIfFirstMethod`).
 * Fouten worden NIET onderdrukt: faalt iets, dan rolt de hele inschrijving terug en ziet de gebruiker een fout (nooit een stille
 * mislukking waarbij een methode bevestigd lijkt maar MFA niet aan staat, of omgekeerd).
 */
export type EnrollmentLock = { role: string; mfaEnabled: boolean; usableBefore: number };

export async function lockUserForEnrollment(tx: Prisma.TransactionClient, userId: string): Promise<EnrollmentLock | null> {
  const rows = await tx.$queryRaw<{ role: string; mfaEnabled: boolean }[]>`SELECT "role"::text AS "role", "mfaEnabled" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  const user = rows[0];
  if (!user) return null;
  const passkeys = await tx.webAuthnCredential.count({ where: { userId } });
  const totp = user.role !== "ADMIN" && env.webTotpEnabled && Boolean((await tx.totpCredential.findUnique({ where: { userId } }))?.confirmedAt);
  return { role: user.role, mfaEnabled: user.mfaEnabled, usableBefore: passkeys + (totp ? 1 : 0) };
}

/** Aanroepen NA de wijziging, in dezelfde transactie. Geeft terug of MFA nu is ingeschakeld door deze handeling. */
export async function enableMfaIfFirstMethod(tx: Prisma.TransactionClient, userId: string, lock: EnrollmentLock, method: "passkey" | "totp"): Promise<boolean> {
  if (!env.autoEnableMfa || lock.role === "ADMIN" || lock.mfaEnabled || lock.usableBefore > 0) return false;
  // Uitsluitingsbeveiliging: een bevestigde methode mag een gebruiker nooit buiten de app sluiten. Daarom geldt de automatische
  // activatie alleen als de app met díe methode kan inloggen (authenticator-app: NATIVE_TOTP_LOGIN_ENABLED; passkey: NATIVE_PASSKEYS_ENABLED).
  // Zolang er voor passkey-only gebruikers geen veilige oplossing in de app is (o.a. de Personal Team-build), blijft hun MFA uit.
  if (method === "totp" ? !env.nativeTotpLoginEnabled : !env.nativePasskeysEnabled) return false;
  const passkeys = await tx.webAuthnCredential.count({ where: { userId } });
  const totp = env.webTotpEnabled && Boolean((await tx.totpCredential.findUnique({ where: { userId } }))?.confirmedAt);
  if (passkeys + (totp ? 1 : 0) < 1) return false; // geen bevestigde methode: niets activeren
  await tx.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
  await tx.securityEvent.create({ data: { userId, type: "MFA_VERIFIED", detail: "Verificatie automatisch ingeschakeld na eerste methode" } });
  return true;
}
