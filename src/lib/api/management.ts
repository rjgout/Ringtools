import type { Role } from "@prisma/client";
import { prisma } from "../prisma";
import { rateLimit } from "../rateLimit";
import { env } from "../env";
import { consumeLoginCode, isRecentlyMfaVerified, promoteSessionToMfaVerified } from "../auth";
import { isTotpConfirmed, verifyTotpCode } from "../mfa";
import { logSecurityEvent } from "../securityEvents";
import { addMemberSchema, updateMemberSchema } from "../validation";
import { AuthorizationError, RingError, addMember, listRingMembers, updateMember } from "../rings";
import { latestInvitationsByEmail } from "../invitations";
import { ApiError, str } from "./http";
import type { ApiAuth } from "./auth";

const WINDOW = 15 * 60 * 1000;

/** Vertaalt fouten uit de ringbeheer-lib naar API-fouten (zonder gegevens van andere ringen te lekken). */
export async function ringErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthorizationError) throw new ApiError(403, "Je hebt hiervoor geen bevoegdheid.", "forbidden");
    if (err instanceof RingError) throw new ApiError(400, err.message, "ring");
    throw err;
  }
}

export async function requireMembershipFor(userId: string, ringId: string) {
  const m = await prisma.ringMembership.findFirst({ where: { userId, ringId, active: true, user: { active: true }, ring: { active: true } } });
  if (!m) throw new ApiError(404, "Niet gevonden.", "not-found");
  return m;
}

/** Gevoelige beheeracties vereisen een recente tweede factor (≤ 15 min); anders volgt eerst herverificatie. */
export function requireFreshAuth(auth: ApiAuth) {
  if (!isRecentlyMfaVerified(auth.mfaAt)) {
    throw new ApiError(403, "Bevestig eerst opnieuw je identiteit voor deze beheeractie.", "reauth-required");
  }
}

/** Herverificatie van een gewone gebruiker met een verse e-mailcode (zonder passkey-verificatie; die volgt in Fase C). */
export async function userReauth(auth: ApiAuth, body: Record<string, unknown>) {
  if (auth.user.mfaEnabled) {
    // Accounts met verplichte MFA bevestigen met hun tweede factor, nooit met een e-mailcode alleen. In de app is dat (functievlag) de authenticator-app.
    const totp = str(body.code).replace(/\s+/g, "");
    if (!env.nativeTotpLoginEnabled || !/^\d{6}$/.test(totp) || !(await isTotpConfirmed(auth.user.id))) {
      throw new ApiError(403, "Herverificatie met een passkey wordt in de app nog niet ondersteund.", "mfa-not-supported");
    }
    if (!rateLimit(`totp-reverify:${auth.user.id}`, 10, WINDOW).allowed) throw new ApiError(429, "Te veel pogingen. Probeer het later opnieuw.", "rate-limited");
    const outcome = await verifyTotpCode(auth.user.id, auth.user.email, totp);
    if (outcome === "LOCKED") throw new ApiError(429, "Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw.", "locked");
    if (outcome !== "OK") throw new ApiError(401, "Ongeldige code.", "invalid-code");
    const session = await promoteSessionToMfaVerified(auth.sessionId, auth.user.id, "Ringtools-app");
    await logSecurityEvent({ userId: auth.user.id, type: "MFA_VERIFIED", detail: "App: authenticator-app (herverificatie)" });
    return { token: session.rawToken, expiresAt: session.expiresAt.toISOString() };
  }
  if (!rateLimit(`reauth-code:${auth.user.id}`, 10, WINDOW).allowed) throw new ApiError(429, "Te veel pogingen. Probeer het later opnieuw.", "rate-limited");
  const code = str(body.code).replace(/\s+/g, "");
  const user = /^\d{8}$/.test(code) ? await consumeLoginCode(auth.user.email, code) : null;
  if (!user || user.id !== auth.user.id) throw new ApiError(401, "Deze code is onjuist of verlopen.", "invalid-code");
  const session = await promoteSessionToMfaVerified(auth.sessionId, auth.user.id, "Ringtools-app");
  return { token: session.rawToken, expiresAt: session.expiresAt.toISOString() };
}

// ---- Gebruikersbeheer (ringbeheerder: eigen ring; webmin: elke ring) ----

export async function assertCanSeeRingUsers(actor: ApiAuth["user"], ringId: string) {
  if (actor.role === "ADMIN") {
    if (!(await prisma.ring.findUnique({ where: { id: ringId } }))) throw new ApiError(404, "Niet gevonden.", "not-found");
    return;
  }
  const m = await prisma.ringMembership.findFirst({ where: { userId: actor.id, ringId, active: true, isRingManager: true, ring: { active: true } } });
  // Zelfde antwoord voor "bestaat niet" en "niet jouw ring": geen informatie over andere ringen.
  if (!m) throw new ApiError(404, "Niet gevonden.", "not-found");
}

export async function listUsersFor(auth: ApiAuth, ringId: string) {
  await assertCanSeeRingUsers(auth.user, ringId);
  const members = await listRingMembers(ringId);
  const invites = await latestInvitationsByEmail(ringId, members.map((m) => m.user.email));
  return {
    users: members.map((m) => ({
      activatedAt: m.user.activatedAt?.toISOString() ?? null,
      invitation: invites.get(m.user.email.trim().toLowerCase()) ?? null,
      membershipId: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      churchFunction: m.churchFunction,
      churchFunctionCode: m.churchFunctionCode,
      role: m.role as Role,
      isRingManager: m.isRingManager,
      appointAuthority: m.appointAuthority,
      activated: !!m.user.activatedAt,
      active: m.active && m.user.active,
      otherRingCount: m.otherRingCount,
    })),
  };
}

export async function addUserFor(auth: ApiAuth, ringId: string, body: Record<string, unknown>) {
  requireFreshAuth(auth);
  await assertCanSeeRingUsers(auth.user, ringId);
  // Ringbeheerders nodigen uit (C5.1): zo kan niemand zonder instemming aan een ring worden gekoppeld en lekt er niets over bestaande accounts.
  if (auth.user.role !== "ADMIN") throw new ApiError(403, "Nodig iemand uit via 'Uitnodigen'.", "use-invitation");
  const parsed = addMemberSchema.safeParse({ ...body, ringId });
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message || "Controleer de ingevulde gegevens.", "validation");
  const { user, joinedRounds } = await ringErrors(() => addMember({ actorId: auth.user.id, ...parsed.data }));
  return { userId: user.id, name: user.name, joinedRounds };
}

export async function updateUserFor(auth: ApiAuth, membershipId: string, body: Record<string, unknown>) {
  requireFreshAuth(auth);
  const parsed = updateMemberSchema.safeParse({ ...body, membershipId });
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message || "Controleer de ingevulde gegevens.", "validation");
  const m = await prisma.ringMembership.findUnique({ where: { id: membershipId } });
  if (!m) throw new ApiError(404, "Niet gevonden.", "not-found");
  await assertCanSeeRingUsers(auth.user, m.ringId);
  const { joinedRounds } = await ringErrors(() => updateMember({ actorId: auth.user.id, ...parsed.data }));
  return { ok: true, joinedRounds };
}
