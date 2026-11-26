import { prisma } from "../prisma";
import { activationFor, loadScopes, ADMIN_ROLES } from "./finance";
import { DeclarationError, assertDeclarationsEnabled } from "./service";

export type DestinationView = { ringId: string; ringName: string; activated: boolean; units: { unitId: string; name: string; kind: "WIJK" | "GEMEENTE"; activated: boolean }[] };

/** Alle beschikbare bestemmingen (ringen en units met hun activeringsstatus) voor de keuze bij het onboarden en declareren. */
export async function listDestinations(): Promise<DestinationView[]> {
  const rings = await prisma.ring.findMany({ where: { active: true, isDemo: false }, orderBy: { name: "asc" }, select: { id: true, name: true, units: { where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true } } } });
  return Promise.all(rings.map(async (r) => ({
    ringId: r.id, ringName: r.name, activated: (await activationFor(r.id, null)).activated,
    units: await Promise.all(r.units.map(async (u) => ({ unitId: u.id, name: u.name, kind: u.kind, activated: (await activationFor(r.id, u.id)).activated }))),
  })));
}

export async function getDeclarationContext(userId: string) {
  assertDeclarationsEnabled();
  const [user, profile, scopes] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } }),
    prisma.declarationProfile.findUnique({ where: { userId } }),
    loadScopes(userId),
  ]);
  return {
    name: user.name,
    onboarded: !!profile?.onboardedAt,
    preferredRingId: profile?.preferredRingId ?? null,
    preferredUnitId: profile?.preferredUnitId ?? null,
    destinations: await listDestinations(),
    official: { administer: scopes.some((s) => ADMIN_ROLES.includes(s.role)), president: scopes.some((s) => s.role === "RING_PRESIDENT_READ") },
  };
}

/** Naam bevestigen en voorkeursring/-unit opslaan (onboarding of later via het profiel). */
export async function saveDeclarationProfile(userId: string, input: { name: unknown; ringId: unknown; unitId?: unknown }) {
  assertDeclarationsEnabled();
  const name = typeof input.name === "string" ? input.name.normalize("NFC").replace(/\s+/g, " ").trim() : "";
  if (name.length < 2 || name.length > 100 || /[\u0000-\u001f<>]/.test(name)) throw new DeclarationError(400, "Vul je volledige naam in (2 tot 100 tekens).", "validation");
  const ringId = typeof input.ringId === "string" ? input.ringId : "";
  const unitId = typeof input.unitId === "string" && input.unitId ? input.unitId : null;
  const ring = await prisma.ring.findFirst({ where: { id: ringId, active: true, isDemo: false }, select: { id: true } });
  if (!ring) throw new DeclarationError(404, "Kies een ring uit de lijst.", "not-found");
  if (unitId && !(await prisma.ringUnit.findFirst({ where: { id: unitId, ringId, active: true }, select: { id: true } }))) throw new DeclarationError(404, "Kies een wijk of gemeente uit deze ring.", "not-found");
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { name } }),
    prisma.declarationProfile.upsert({ where: { userId }, create: { userId, preferredRingId: ringId, preferredUnitId: unitId, onboardedAt: new Date() }, update: { preferredRingId: ringId, preferredUnitId: unitId, onboardedAt: new Date() } }),
  ]);
}
