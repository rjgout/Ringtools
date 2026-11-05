import { env } from "./env";
import { hasPasskeys } from "./webauthn";
import { isTotpConfirmed } from "./mfa";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

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

// ---- Gelijktijdigheidsveilig beheer van methoden (E2.1) ----
//
// Invariant: een account met ingeschakelde verificatie (`mfaEnabled`) houdt altijd minstens één BRUIKBARE methode. Het verwijderen van
// een passkey of authenticator-app, en het inschakelen van verificatie, gebeuren daarom in één transactie die eerst de gebruikersrij
// vergrendelt (`SELECT … FOR UPDATE`). Twee gelijktijdige verwijderingen (bv. de laatste passkey én de laatste authenticator-app)
// worden zo serieel afgehandeld: de tweede ziet de uitkomst van de eerste en wordt geweigerd.

type Tx = Prisma.TransactionClient;
export type GuardResult = { ok: true } | { ok: false; message: string };

async function lockUser(tx: Tx, userId: string): Promise<{ role: string; mfaEnabled: boolean } | null> {
  const rows = await tx.$queryRaw<{ role: string; mfaEnabled: boolean }[]>`SELECT "role"::text AS "role", "mfaEnabled" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  return rows[0] ?? null;
}

async function usableCounts(tx: Tx, userId: string, role: string) {
  const passkeys = await tx.webAuthnCredential.count({ where: { userId } });
  const totp = totpAllowedForUser(role) && Boolean((await tx.totpCredential.findUnique({ where: { userId } }))?.confirmedAt);
  return { passkeys, totp };
}

export async function removePasskeyGuarded(userId: string, credentialId: string): Promise<GuardResult & { deviceLabel?: string | null }> {
  return prisma.$transaction(async (tx) => {
    const user = await lockUser(tx, userId);
    if (!user) return { ok: false as const, message: "Account niet gevonden." };
    const credential = await tx.webAuthnCredential.findFirst({ where: { id: credentialId, userId } });
    if (!credential) return { ok: false as const, message: "Deze passkey is niet gevonden." };
    const { passkeys, totp } = await usableCounts(tx, userId, user.role);
    if (user.mfaEnabled && passkeys - 1 + (totp ? 1 : 0) < 1) {
      return {
        ok: false as const,
        message: totp
          ? "Je kunt je laatste verificatiemethode niet verwijderen."
          : "Je kunt je laatste passkey niet verwijderen: zonder passkey kun je niet meer inloggen. Registreer eerst een nieuwe passkey.",
      };
    }
    await tx.webAuthnCredential.delete({ where: { id: credential.id } });
    return { ok: true as const, deviceLabel: credential.deviceLabel };
  });
}

/** Verwijdert de authenticator-app (en de bijbehorende herstelcodes) van een gewone gebruiker. */
export async function removeTotpGuarded(userId: string): Promise<GuardResult> {
  return prisma.$transaction(async (tx) => {
    const user = await lockUser(tx, userId);
    if (!user) return { ok: false as const, message: "Account niet gevonden." };
    if (user.role === "ADMIN") return { ok: false as const, message: "Voor het beheerdersaccount is TOTP verplicht." };
    const credential = await tx.totpCredential.findUnique({ where: { userId } });
    if (!credential) return { ok: false as const, message: "Er is geen authenticator-app ingesteld." };
    const passkeys = await tx.webAuthnCredential.count({ where: { userId } });
    if (user.mfaEnabled && passkeys < 1) {
      return { ok: false as const, message: "Je kunt je laatste verificatiemethode niet verwijderen zolang verificatie aan staat. Registreer eerst een passkey of schakel verificatie uit." };
    }
    await tx.recoveryCode.deleteMany({ where: { userId } });
    await tx.totpCredential.delete({ where: { userId } });
    return { ok: true as const };
  });
}

/** Schakelt verificatie in, maar alleen met minstens één bruikbare methode (en serieel t.o.v. verwijderen). */
export async function enableMfaGuarded(userId: string): Promise<GuardResult> {
  return prisma.$transaction(async (tx) => {
    const user = await lockUser(tx, userId);
    if (!user) return { ok: false as const, message: "Account niet gevonden." };
    if (user.role === "ADMIN") return { ok: false as const, message: "Voor het beheerdersaccount is verificatie altijd verplicht." };
    const { passkeys, totp } = await usableCounts(tx, userId, user.role);
    if (passkeys + (totp ? 1 : 0) < 1) {
      return { ok: false as const, message: totpAllowedForUser(user.role) ? "Stel eerst een passkey of authenticator-app in voordat je verificatie inschakelt." : "Registreer eerst een passkey voordat je verificatie inschakelt." };
    }
    await tx.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
    return { ok: true as const };
  });
}
