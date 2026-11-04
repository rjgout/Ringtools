import type { User } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma";
import { env } from "../env";
import { rateLimit } from "../rateLimit";
import { createSession, destroySession, getSessionAwaitingMfa, promoteSessionToMfaVerified } from "../auth";
import { logSecurityEvent } from "../securityEvents";
import { hasPasskeys, startPasskeyAuthentication, verifyPasskeyAuthentication } from "../webauthn";
import { ApiError } from "./http";
import type { ApiAuth } from "./auth";

/**
 * C5.2 – Native MFA met passkeys.
 *
 * Stroom: e-mailcode (identiteit) → beperkte *pending-login* (sessie met `mfaAt = null`, 10 minuten) → native passkey-ceremonie →
 * server verifieert de assertion (RP ID, toegestane origins, eenmalige challenge, teller, user verification) → pas dan een volledige sessie.
 * Een pending-login werkt op geen enkele andere route (`authenticate()` accepteert alleen sessies met `mfaAt`).
 * Alles staat achter `NATIVE_PASSKEYS_ENABLED`; uit = het oude, veilige gedrag (403 `mfa-not-supported`).
 */

const WINDOW = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const PENDING_AGENT = "Ringtools-app (wacht op passkey)";
const FULL_AGENT = "Ringtools-app";

const lockedUntil = new Map<string, number>();
const isLocked = (userId: string) => (lockedUntil.get(userId) ?? 0) > Date.now();

const NOT_SUPPORTED =
  "Voor jouw account is passkey-verificatie ingeschakeld. Inloggen met een passkey wordt in de app nog niet ondersteund. Log voorlopig in via de webapp; je beveiliging blijft ongewijzigd.";

const assertionSchema = z
  .object({
    id: z.string().min(1).max(1024),
    rawId: z.string().min(1).max(1024),
    type: z.literal("public-key"),
    response: z.object({ clientDataJSON: z.string().min(1).max(8192), authenticatorData: z.string().min(1).max(8192), signature: z.string().min(1).max(8192) }).passthrough(),
  })
  .passthrough();

export type PendingLogin = { mfaRequired: true; method: "passkey"; pendingToken: string; expiresAt: string };

/**
 * Na een geslaagde e-mailcode voor een account met verplichte MFA. Geeft nooit een volledige sessie.
 * - Functie uit: oude, veilige weigering (de code is dan al verbruikt, net als voorheen).
 * - Geen passkey geregistreerd: de app kan er geen inschrijven (dat blijft webapp-only); veilige melding.
 */
export async function beginMfaLogin(user: User): Promise<PendingLogin> {
  if (!env.nativePasskeysEnabled) throw new ApiError(403, NOT_SUPPORTED, "mfa-not-supported");
  if (isLocked(user.id)) throw new ApiError(429, "Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw.", "locked");
  if (!(await hasPasskeys(user.id))) {
    throw new ApiError(403, "Er is nog geen passkey ingesteld voor jouw account. Stel die eerst in via de webapp en log daarna hier in.", "mfa-enrollment-required");
  }
  // Maximaal één wachtende app-login per gebruiker; wachtende webinlogpogingen blijven onaangeroerd.
  await prisma.session.deleteMany({ where: { userId: user.id, mfaAt: null, userAgent: PENDING_AGENT } });
  const pending = await createSession(user.id, PENDING_AGENT);
  return { mfaRequired: true, method: "passkey", pendingToken: pending.rawToken, expiresAt: pending.expiresAt.toISOString() };
}

async function pendingFor(pendingToken: string) {
  const awaiting = await getSessionAwaitingMfa(pendingToken);
  // Alleen een door de app aangemaakte wachtende sessie van een gewone gebruiker; nooit de webmin.
  if (!awaiting || awaiting.user.role === "ADMIN" || !awaiting.user.mfaEnabled || awaiting.sessionId.length === 0) {
    throw new ApiError(401, "Je inlogsessie is verlopen. Log opnieuw in.", "unauthenticated");
  }
  const session = await prisma.session.findUnique({ where: { id: awaiting.sessionId }, select: { userAgent: true } });
  if (session?.userAgent !== PENDING_AGENT) throw new ApiError(401, "Je inlogsessie is verlopen. Log opnieuw in.", "unauthenticated");
  return awaiting;
}

async function options(userId: string) {
  if (!env.nativePasskeysEnabled) throw new ApiError(403, NOT_SUPPORTED, "mfa-not-supported");
  if (isLocked(userId)) throw new ApiError(429, "Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw.", "locked");
  if (!rateLimit(`passkey-options:${userId}`, 10, WINDOW).allowed) throw new ApiError(429, "Te veel pogingen. Probeer het later opnieuw.", "rate-limited");
  const opts = await startPasskeyAuthentication(userId);
  if (!opts) throw new ApiError(403, "Er is nog geen passkey ingesteld voor jouw account.", "mfa-enrollment-required");
  return { options: opts };
}

async function verify(userId: string, body: Record<string, unknown>): Promise<void> {
  if (!env.nativePasskeysEnabled) throw new ApiError(403, NOT_SUPPORTED, "mfa-not-supported");
  if (isLocked(userId)) throw new ApiError(429, "Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw.", "locked");
  if (!rateLimit(`passkey-verify:${userId}`, 10, WINDOW).allowed) throw new ApiError(429, "Te veel pogingen. Probeer het later opnieuw.", "rate-limited");
  const parsed = assertionSchema.safeParse(body.response);
  if (!parsed.success) throw new ApiError(400, "Ongeldig verzoek.", "validation");
  const result = await verifyPasskeyAuthentication(userId, parsed.data as never, { native: true });
  if (!result.ok) {
    if (!rateLimit(`passkey-fail:${userId}`, MAX_FAILURES, WINDOW).allowed) {
      lockedUntil.set(userId, Date.now() + WINDOW);
      await prisma.session.deleteMany({ where: { userId, mfaAt: null, userAgent: PENDING_AGENT } });
      await logSecurityEvent({ userId, type: "PASSKEY_LOGIN_FAILED", detail: "App: vergrendeld na te veel mislukte pogingen" });
      throw new ApiError(429, "Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw.", "locked");
    }
    throw new ApiError(401, result.reason, "passkey-failed");
  }
}

/** Stap 1 (pending-login): opties voor de native passkey-ceremonie. */
export async function loginPasskeyOptions(pendingToken: string) {
  const awaiting = await pendingFor(pendingToken);
  return options(awaiting.userId);
}

/** Stap 2 (pending-login): verifieert de assertion; pas daarna volledige sessie (nieuw token, oude pending-sessie vervalt). */
export async function loginPasskeyVerify(pendingToken: string, body: Record<string, unknown>) {
  const awaiting = await pendingFor(pendingToken);
  await verify(awaiting.userId, body);
  const session = await promoteSessionToMfaVerified(awaiting.sessionId, awaiting.userId, FULL_AGENT);
  await logSecurityEvent({ userId: awaiting.userId, type: "MFA_VERIFIED", detail: "App: passkey" });
  return { userId: awaiting.userId, token: session.rawToken, expiresAt: session.expiresAt.toISOString() };
}

/** De gebruiker annuleert de passkey-stap: de wachtende sessie wordt direct opgeruimd (idempotent). */
export async function cancelPendingLogin(pendingToken: string) {
  const awaiting = await getSessionAwaitingMfa(pendingToken);
  if (awaiting) await destroySession(pendingToken);
  return { ok: true };
}

function assertMfaUser(auth: ApiAuth) {
  if (!auth.user.mfaEnabled) throw new ApiError(400, "Voor jouw account is geen passkey-verificatie ingeschakeld.", "validation");
}

/** Herverificatie voor gevoelige beheeracties van een ingelogde gebruiker met verplichte MFA: ook met een passkey. */
export async function reauthPasskeyOptions(auth: ApiAuth) {
  assertMfaUser(auth);
  return options(auth.user.id);
}

export async function reauthPasskeyVerify(auth: ApiAuth, body: Record<string, unknown>) {
  assertMfaUser(auth);
  await verify(auth.user.id, body);
  const session = await promoteSessionToMfaVerified(auth.sessionId, auth.user.id, FULL_AGENT);
  await logSecurityEvent({ userId: auth.user.id, type: "MFA_VERIFIED", detail: "App: passkey (herverificatie)" });
  return { token: session.rawToken, expiresAt: session.expiresAt.toISOString() };
}

/** Voor tests: wist de tijdelijke vergrendelingen. */
export function resetPasskeyLocks() {
  lockedUntil.clear();
}
