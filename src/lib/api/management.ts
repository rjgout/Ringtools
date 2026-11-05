import type { Role } from "@prisma/client";
import { prisma } from "../prisma";
import { rateLimit } from "../rateLimit";
import {
  consumeLoginCode,
  createSession,
  getSessionAwaitingMfa,
  isRecentlyMfaVerified,
  promoteSessionToMfaVerified,
  verifyAdminPassword,
} from "../auth";
import { consumeRecoveryCodeLimited, isTotpConfirmed, verifyTotpCode } from "../mfa";
import { logSecurityEvent } from "../securityEvents";
import { addMemberSchema, createRingSchema, recoveryCodeSchema, ringNameSchema, totpCodeSchema, updateMemberSchema } from "../validation";
import { AuthorizationError, RingError, addMember, createRing, listRingMembers, listRingsOverview, renameRing, setRingActive, updateMember } from "../rings";
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

// ---- Webmin: native inloggen met wachtwoord + verplichte TOTP ----

/** Stap 1: wachtwoord. Geeft alleen een tijdelijk token dat nergens als sessie wordt geaccepteerd. */
export async function adminLogin(body: Record<string, unknown>, clientKey: string) {
  const username = str(body.username).trim();
  const password = str(body.password);
  if (!username || !password) throw new ApiError(400, "Vul gebruikersnaam en wachtwoord in.", "validation");
  if (!rateLimit(`admin-login:${username.toLowerCase()}`, 10, WINDOW).allowed || !rateLimit(`admin-login-ip:${clientKey}`, 30, WINDOW).allowed) {
    throw new ApiError(429, "Te veel inlogpogingen. Probeer het later opnieuw.", "rate-limited");
  }
  const user = await verifyAdminPassword(username, password);
  if (!user) throw new ApiError(401, "Onjuiste gebruikersnaam of wachtwoord.", "invalid-credentials");
  if (!(await isTotpConfirmed(user.id))) {
    // TOTP wordt eenmalig ingesteld in de technische beheeromgeving (web); zonder TOTP geen mobiele sessie.
    throw new ApiError(403, "Stel eerst TOTP in via de technische beheeromgeving (web). Daarna kun je hier inloggen.", "totp-not-configured");
  }
  const pending = await createSession(user.id, "Ringtools-app (webmin)");
  return { pendingToken: pending.rawToken, expiresAt: pending.expiresAt.toISOString() };
}

/** Stap 2: TOTP-code of herstelcode in dezelfde (wachtende) sessie. Pas daarna ontstaat een volledige sessie. */
export async function adminVerifyTotp(pendingToken: string, body: Record<string, unknown>) {
  const awaiting = await getSessionAwaitingMfa(pendingToken);
  if (!awaiting || awaiting.user.role !== "ADMIN") throw new ApiError(401, "Je inlogsessie is verlopen. Log opnieuw in.", "unauthenticated");
  if (!rateLimit(`totp-login:${awaiting.userId}`, 10, WINDOW).allowed) throw new ApiError(429, "Te veel pogingen. Probeer het later opnieuw.", "rate-limited");

  const recovery = str(body.recoveryCode);
  if (recovery) {
    const parsed = recoveryCodeSchema.safeParse(recovery);
    const outcome = parsed.success ? await consumeRecoveryCodeLimited(awaiting.userId, parsed.data) : "INVALID";
    if (outcome === "LOCKED") throw new ApiError(429, "Te veel herstelpogingen. Probeer het over 15 minuten opnieuw.", "locked");
    if (outcome !== "OK") throw new ApiError(401, "Ongeldige of al gebruikte herstelcode.", "invalid-code");
  } else {
    const code = totpCodeSchema.safeParse(str(body.code));
    if (!code.success) throw new ApiError(400, code.error.issues[0]?.message ?? "Ongeldige code.", "validation");
    const outcome = await verifyTotpCode(awaiting.userId, awaiting.user.email, code.data);
    if (outcome === "LOCKED") throw new ApiError(429, "Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw, of gebruik een herstelcode.", "locked");
    if (outcome !== "OK") throw new ApiError(401, "Ongeldige code.", "invalid-code");
  }
  const session = await promoteSessionToMfaVerified(awaiting.sessionId, awaiting.userId, "Ringtools-app (webmin)");
  await logSecurityEvent({ userId: awaiting.userId, type: "MFA_VERIFIED" });
  return { token: session.rawToken, expiresAt: session.expiresAt.toISOString() };
}

/** Herverificatie van de ingelogde webmin met een verse TOTP-code (voor gevoelige beheeracties). */
export async function adminReauth(auth: ApiAuth, body: Record<string, unknown>) {
  if (!rateLimit(`totp-reverify:${auth.user.id}`, 10, WINDOW).allowed) throw new ApiError(429, "Te veel pogingen. Probeer het later opnieuw.", "rate-limited");
  const code = totpCodeSchema.safeParse(str(body.code));
  if (!code.success) throw new ApiError(400, code.error.issues[0]?.message ?? "Ongeldige code.", "validation");
  const outcome = await verifyTotpCode(auth.user.id, auth.user.email, code.data);
  if (outcome === "LOCKED") throw new ApiError(429, "Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw.", "locked");
  if (outcome !== "OK") throw new ApiError(401, "Ongeldige code.", "invalid-code");
  const session = await promoteSessionToMfaVerified(auth.sessionId, auth.user.id, "Ringtools-app (webmin)");
  await logSecurityEvent({ userId: auth.user.id, type: "MFA_VERIFIED" });
  return { token: session.rawToken, expiresAt: session.expiresAt.toISOString() };
}

/** Herverificatie van een gewone gebruiker met een verse e-mailcode (zonder passkey-verificatie; die volgt in Fase C). */
export async function userReauth(auth: ApiAuth, body: Record<string, unknown>) {
  if (auth.user.mfaEnabled) throw new ApiError(403, "Herverificatie met een passkey wordt in de app nog niet ondersteund.", "mfa-not-supported");
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
  return {
    users: members.map((m) => ({
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

// ---- Ringbeheer (alleen webmin) ----

export async function listRingsFor() {
  return { rings: await listRingsOverview() };
}

export async function createRingFor(auth: ApiAuth, body: Record<string, unknown>) {
  requireFreshAuth(auth);
  const parsed = createRingSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message || "Controleer de ingevulde gegevens.", "validation");
  const { ring, user } = await ringErrors(() =>
    createRing({ actorId: auth.user.id, ringName: parsed.data.name, existingUserId: parsed.data.existingUserId, name: parsed.data.userName, email: parsed.data.userEmail, churchFunction: parsed.data.churchFunction, churchFunctionCode: parsed.data.churchFunctionCode, role: parsed.data.role })
  );
  return { id: ring.id, name: ring.name, firstManager: { userId: user.id, name: user.name } };
}

export async function renameRingFor(auth: ApiAuth, ringId: string, body: Record<string, unknown>) {
  requireFreshAuth(auth);
  const name = ringNameSchema.safeParse(body.name);
  if (!name.success) throw new ApiError(400, name.error.issues[0]?.message ?? "Ongeldige naam.", "validation");
  await ringErrors(() => renameRing({ actorId: auth.user.id, ringId, name: name.data }));
  return { ok: true };
}

export async function setRingActiveFor(auth: ApiAuth, ringId: string, body: Record<string, unknown>) {
  requireFreshAuth(auth);
  if (typeof body.active !== "boolean") throw new ApiError(400, "Geef aan of de ring actief moet zijn.", "validation");
  await ringErrors(() => setRingActive({ actorId: auth.user.id, ringId, active: body.active as boolean }));
  return { ok: true };
}

/** Zoekt bestaande (niet-admin) accounts om aan een ring te koppelen. Alleen webmin; beperkt aantal, met e-mailadres. */
export async function searchUsersFor(query: string) {
  const q = query.trim();
  if (q.length < 2) return { users: [] };
  const users = await prisma.user.findMany({
    where: { role: { not: "ADMIN" }, active: true, OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] },
    orderBy: { name: "asc" },
    take: 20,
    select: { id: true, name: true, email: true },
  });
  return { users };
}
