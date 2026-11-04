import "server-only";
import { mfaRequired } from "./auth";
import { prisma } from "./prisma";
import { hasPasskeys } from "./webauthn";
import { isTotpConfirmed } from "./mfa";
import { getAwaitingMfaUser, getCurrentSession } from "./session";

/**
 * Eén wezer voor de WebAuthn-API-routes: wie vraagt deze ceremonie aan, en
 * in welke context? "pending" = nog niet volledig ingelogd (de passkey is
 * hier de verplichte tweede factor om de login af te ronden). "full" = al
 * volledig ingelogd (een passkey toevoegen/een herverificatie uitvoeren
 * vanuit /profiel/beveiliging).
 */
export type MfaActor = {
  userId: string;
  sessionId: string;
  mode: "pending" | "full";
  mfaAt: Date | null;
  email: string;
  name: string;
  /** Moet deze gebruiker (nog) een tweede factor doorlopen? */
  mfaRequired: boolean;
};

/**
 * Mag een wachtende sessie (alleen eerste factor) zélf een passkey
 * inschrijven en daarmee de login afronden? Alleen voor een eerste
 * inschrijving: niet voor het adminaccount (TOTP), en niet als de gebruiker al
 * een passkey of bevestigde TOTP heeft — anders zou het bezit van alleen de
 * eerste factor (wachtwoord/mailbox) de tweede factor kunnen vervangen.
 */
export async function mayEnrollFirstFactorWhilePending(actor: MfaActor): Promise<boolean> {
  if (actor.mode !== "pending") return true;
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { role: true } });
  if (!user || user.role === "ADMIN") return false;
  return !(await hasPasskeys(actor.userId)) && !(await isTotpConfirmed(actor.userId));
}

export async function resolveMfaActor(): Promise<MfaActor | null> {
  const awaiting = await getAwaitingMfaUser();
  if (awaiting) {
    return { userId: awaiting.userId, sessionId: awaiting.sessionId, mode: "pending", mfaAt: null, email: awaiting.user.email, name: awaiting.user.name, mfaRequired: true };
  }
  const active = await getCurrentSession();
  if (active) {
    return { userId: active.user.id, sessionId: active.sessionId, mode: "full", mfaAt: active.mfaAt, email: active.user.email, name: active.user.name, mfaRequired: mfaRequired(active.user) };
  }
  return null;
}
