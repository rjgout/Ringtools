import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Ring, RingMembership, Role, User } from "@prisma/client";
import { prisma } from "./prisma";
import { env } from "./env";
import { getCurrentUser, requireUser } from "./session";
import { canManageRingUsers } from "./rbac";

export const RING_COOKIE_NAME = "ringtools_ring";

export type MembershipWithRing = RingMembership & { ring: Ring };

export type RingContext = {
  user: User;
  ring: Ring;
  membership: RingMembership;
  /** Alle actieve ringen van deze gebruiker (voor de ringwisselaar). */
  memberships: MembershipWithRing[];
};

/**
 * De actieve ring komt uit een cookie, maar wordt ALTIJD server-side gecontroleerd
 * tegen de actieve lidmaatschappen van de ingelogde gebruiker: een gemanipuleerd
 * cookie kan dus nooit toegang tot een andere ring geven.
 */
async function resolveContext(user: User): Promise<RingContext | null> {
  const memberships = await prisma.ringMembership.findMany({
    where: { userId: user.id, active: true },
    include: { ring: true },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) return null;

  const store = await cookies();
  const wanted = store.get(RING_COOKIE_NAME)?.value;
  const chosen = memberships.find((m) => m.ringId === wanted) ?? memberships[0];
  return { user, ring: chosen.ring, membership: chosen, memberships };
}

/** Ringcontext van de ingelogde gebruiker, of null (niet ingelogd, webmin, of geen actieve ring). */
export async function getRingContext(): Promise<RingContext | null> {
  const user = await getCurrentUser();
  if (!user || user.role === "ADMIN") return null;
  return resolveContext(user);
}

/** Vereist een ingelogde, niet-admin gebruiker met een actieve ring. */
export async function requireRingContext(): Promise<RingContext> {
  const user = await requireUser();
  if (user.role === "ADMIN") redirect("/geen-toegang");
  const ctx = await resolveContext(user);
  if (!ctx) redirect("/geen-toegang");
  return ctx;
}

/** Vereist één van de toegestane workflowrollen in de actieve ring. */
export async function requireRingRole(roles: Role[]): Promise<RingContext> {
  const ctx = await requireRingContext();
  if (!roles.includes(ctx.membership.role)) redirect("/geen-toegang");
  return ctx;
}

/** Vereist de administratieve bevoegdheid ringbeheerder in de actieve ring. */
export async function requireRingManager(): Promise<RingContext> {
  const ctx = await requireRingContext();
  if (!canManageRingUsers(ctx.user.role, ctx.membership)) redirect("/geen-toegang");
  return ctx;
}

/** Zet de actieve ring (alleen toegestaan voor een ring waarvan de gebruiker actief lid is). */
export async function setActiveRing(userId: string, ringId: string): Promise<boolean> {
  const membership = await prisma.ringMembership.findFirst({ where: { userId, ringId, active: true } });
  if (!membership) return false;
  const store = await cookies();
  store.set(RING_COOKIE_NAME, ringId, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return true;
}

/** Lidmaatschap van een gebruiker in een specifieke ring (voor autorisatie per voorstel, onafhankelijk van de actieve ring). */
export async function getActiveMembership(userId: string, ringId: string): Promise<RingMembership | null> {
  const membership = await prisma.ringMembership.findUnique({ where: { userId_ringId: { userId, ringId } } });
  return membership && membership.active ? membership : null;
}
