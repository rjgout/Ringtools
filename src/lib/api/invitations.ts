import { z } from "zod";
import { prisma } from "../prisma";
import { activateInvitation, createInvitation, InvitationError, listInvitations, previewInvitation, resendInvitation, revokeInvitation, updateInvitation } from "../invitations";
import { churchFunctionCodeSchema, emailSchema } from "../validation";
import { rateLimit } from "../rateLimit";
import { ApiError, str } from "./http";
import { assertCanSeeRingUsers, requireFreshAuth, ringErrors } from "./management";
import type { ApiAuth } from "./auth";
import * as svc from "./service";

const roleSchema = z.enum(["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR", "HOGERAAD"], { message: "Kies een rol binnen Ringtools." });

const createSchema = z.object({
  name: z.string().trim().min(2, "Vul een naam in.").max(200),
  email: emailSchema,
  role: roleSchema,
  churchFunction: z.string().trim().max(200).optional(),
  churchFunctionCode: churchFunctionCodeSchema.optional(),
  isRingManager: z.boolean().optional(),
});

const updateSchema = createSchema.omit({ name: true, email: true });

function fail(parsed: { success: false; error: z.ZodError }): never {
  throw new ApiError(400, parsed.error.issues[0]?.message || "Controleer de ingevulde gegevens.", "validation");
}

/** Vertaalt uitnodigingsfouten naar API-fouten met begrijpelijke Nederlandse meldingen. */
async function invitationErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await ringErrors(fn);
  } catch (err) {
    if (err instanceof InvitationError) {
      const status = err.code === "rate-limited" ? 429 : err.code === "expired" ? 410 : 400;
      throw new ApiError(status, err.message, `invitation-${err.code}`);
    }
    throw err;
  }
}

export async function listInvitationsFor(auth: ApiAuth, ringId: string) {
  await assertCanSeeRingUsers(auth.user, ringId);
  return { invitations: await listInvitations(ringId) };
}

export async function createInvitationFor(auth: ApiAuth, ringId: string, body: Record<string, unknown>) {
  requireFreshAuth(auth);
  await assertCanSeeRingUsers(auth.user, ringId);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) fail(parsed);
  if (!rateLimit(`invite-create:${auth.user.id}`, 30, 60 * 60 * 1000).allowed) throw new ApiError(429, "Je hebt veel uitnodigingen verstuurd. Probeer het later opnieuw.", "rate-limited");
  return invitationErrors(() => createInvitation({ actorId: auth.user.id, ringId, ...parsed.data }));
}

async function ringOfInvitation(auth: ApiAuth, invitationId: string): Promise<string> {
  const inv = await prisma.ringInvitation.findUnique({ where: { id: invitationId }, select: { ringId: true } });
  if (!inv) throw new ApiError(404, "Niet gevonden.", "not-found");
  await assertCanSeeRingUsers(auth.user, inv.ringId); // 404 voor wie deze ring niet beheert
  return inv.ringId;
}

export async function resendInvitationFor(auth: ApiAuth, invitationId: string) {
  requireFreshAuth(auth);
  await ringOfInvitation(auth, invitationId);
  if (!rateLimit(`invite-resend:${auth.user.id}`, 30, 60 * 60 * 1000).allowed) throw new ApiError(429, "Je hebt veel uitnodigingen verstuurd. Probeer het later opnieuw.", "rate-limited");
  return invitationErrors(() => resendInvitation({ actorId: auth.user.id, invitationId }));
}

export async function revokeInvitationFor(auth: ApiAuth, invitationId: string) {
  requireFreshAuth(auth);
  await ringOfInvitation(auth, invitationId);
  return invitationErrors(() => revokeInvitation({ actorId: auth.user.id, invitationId }));
}

export async function updateInvitationFor(auth: ApiAuth, invitationId: string, body: Record<string, unknown>) {
  requireFreshAuth(auth);
  await ringOfInvitation(auth, invitationId);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) fail(parsed);
  return invitationErrors(() => updateInvitation({ actorId: auth.user.id, invitationId, ...parsed.data }));
}

// ---- Publiek (ontvanger): voorvertoning en activatie ----

export async function previewInvitationApi(body: Record<string, unknown>, clientKey: string) {
  if (!rateLimit(`invite-preview:${clientKey}`, 60, 15 * 60 * 1000).allowed) throw new ApiError(429, "Te veel pogingen. Probeer het later opnieuw.", "rate-limited");
  return previewInvitation(str(body.token));
}

export async function activateInvitationApi(body: Record<string, unknown>, clientKey: string) {
  const token = str(body.token);
  const credentials = token ? { token } : { email: str(body.email), code: str(body.code) };
  const result = await invitationErrors(() =>
    activateInvitation(credentials, clientKey, { issueSession: body.issueSession === true, deviceName: str(body.deviceName) })
  );
  const base = { ok: true as const, email: result.email, ringName: result.ringName, mfaRequired: result.mfaRequired };
  // Zonder verplichte MFA: direct een gewone volledige sessie (het token staat alleen in deze JSON-respons, nooit in een URL of log).
  // Met verplichte MFA (of als de aanroeper geen sessie wil): geen token; inloggen verloopt dan via de bestaande route en tweede factor.
  if (!result.session) return { ...base, signedIn: false };
  return {
    ...base,
    signedIn: true,
    token: result.session.rawToken,
    expiresAt: result.session.expiresAt.toISOString(),
    ...(await svc.getMe(result.userId)),
  };
}
