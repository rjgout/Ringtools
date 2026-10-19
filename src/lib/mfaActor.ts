import "server-only";
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
};

export async function resolveMfaActor(): Promise<MfaActor | null> {
  const awaiting = await getAwaitingMfaUser();
  if (awaiting) {
    return { userId: awaiting.userId, sessionId: awaiting.sessionId, mode: "pending", mfaAt: null, email: awaiting.user.email, name: awaiting.user.name };
  }
  const active = await getCurrentSession();
  if (active) {
    return { userId: active.user.id, sessionId: active.sessionId, mode: "full", mfaAt: active.mfaAt, email: active.user.email, name: active.user.name };
  }
  return null;
}
