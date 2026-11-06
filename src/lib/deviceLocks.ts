import type { Prisma } from "@prisma/client";

/**
 * Vaste vergrendelvolgorde voor alles wat sessies van een vertrouwd toestel aanmaakt of beëindigt (E2.4a):
 *   1. gebruikersrij (`FOR UPDATE`), 2. toestelrij (`FOR UPDATE`), 3. daarna pas sessies lezen/schrijven.
 * Gelijktijdige inlog, herverificatie, intrekken, uitzetten en een webmin-reset worden zo serieel afgehandeld; elke volgorde eindigt met
 * ofwel een mislukte inlog, ofwel een sessie die door de latere intrekking weer wordt verwijderd. Nooit een geldige sessie bij een ingetrokken toestel.
 */
export type LockedDevice = { userId: string; revokedAt: Date | null; loginEnabledAt: Date | null };
export type LockResult = { user: { active: boolean; role: string } | null; device: LockedDevice | null };

export async function lockUserThenDevice(tx: Prisma.TransactionClient, userId: string, deviceId: string): Promise<LockResult> {
  const users = await tx.$queryRaw<{ active: boolean; role: string }[]>`SELECT "active", "role"::text AS "role" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  const devices = await tx.$queryRaw<LockedDevice[]>`SELECT "userId", "revokedAt", "loginEnabledAt" FROM "TrustedDevice" WHERE "id" = ${deviceId} FOR UPDATE`;
  return { user: users[0] ?? null, device: devices[0] ?? null };
}

/** Alleen voor tests: stelt een bewerking op een vaste plek (na het vergrendelen) uit, zodat beide uitvoeringsvolgorden deterministisch te testen zijn. */
export const lockHooks: Partial<Record<"loginAfterLock" | "revokeAfterLock" | "disableAfterLock" | "promoteAfterLock", () => Promise<void>>> = {};
export async function runHook(name: keyof typeof lockHooks): Promise<void> {
  await lockHooks[name]?.();
}
