import type { Prisma, Role, User } from "@prisma/client";
import { prisma } from "./prisma";
import { destroyAllSessionsForUser } from "./auth";
import { ASSIGNABLE_ROLES } from "./rbac";
import { AuthorizationError, addParticipantToRunningRounds } from "./workflow";

export { AuthorizationError };

/** Een functionele fout bij ringbeheer (bedoeld om aan de gebruiker te tonen). */
export class RingError extends Error {}

type Db = Prisma.TransactionClient;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertMembershipRole(role: Role): void {
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw new RingError("Deze rol kan niet binnen een ring worden toegekend.");
  }
}

async function loadActiveActor(db: Db, actorId: string): Promise<User> {
  const actor = await db.user.findUnique({ where: { id: actorId } });
  if (!actor || !actor.active) throw new AuthorizationError();
  return actor;
}

/**
 * De uitvoerder wordt altijd uit de database geladen (nooit vertrouwd op
 * gegevens van de client): de webmin mag elke ring beheren, een ringbeheerder
 * uitsluitend zijn eigen ring.
 */
async function assertCanManageRing(db: Db, actorId: string, ringId: string): Promise<User> {
  const actor = await loadActiveActor(db, actorId);
  if (actor.role === "ADMIN") return actor;
  const membership = await db.ringMembership.findUnique({ where: { userId_ringId: { userId: actor.id, ringId } } });
  if (!membership || !membership.active || !membership.isRingManager) throw new AuthorizationError();
  return actor;
}

async function lockRing(tx: Db, ringId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Ring" WHERE "id" = ${ringId} FOR UPDATE`;
}

/** Een ring moet altijd minstens één actieve ringbeheerder (actief account én lidmaatschap) hebben. */
async function assertHasActiveManager(tx: Db, ringId: string): Promise<void> {
  const managers = await tx.ringMembership.count({
    where: { ringId, isRingManager: true, active: true, user: { active: true } },
  });
  if (managers < 1) {
    throw new RingError("Een ring moet altijd minstens één actieve ringbeheerder hebben.");
  }
}

async function resolveUser(
  tx: Db,
  opts: { actor: User; existingUserId?: string; name?: string; email?: string; role: Role }
): Promise<{ user: User; isNew: boolean }> {
  if (opts.existingUserId) {
    // Bestaande accounts koppelen aan een ring is voorbehouden aan de
    // webmin: een ringbeheerder mag geen gebruikers van andere ringen
    // opzoeken of overnemen.
    if (opts.actor.role !== "ADMIN") throw new AuthorizationError();
    const user = await tx.user.findUnique({ where: { id: opts.existingUserId } });
    if (!user || user.role === "ADMIN") throw new RingError("Deze gebruiker bestaat niet.");
    return { user, isNew: false };
  }

  const name = opts.name?.trim() ?? "";
  const email = normalizeEmail(opts.email ?? "");
  if (name.length < 2) throw new RingError("Vul een naam in.");
  if (!email.includes("@")) throw new RingError("Vul een geldig e-mailadres in.");

  const existing = await tx.user.findUnique({ where: { email } });
  if (existing) {
    if (opts.actor.role === "ADMIN" && existing.role !== "ADMIN") {
      return { user: existing, isNew: false };
    }
    throw new RingError(
      "Dit e-mailadres is al in gebruik. Alleen de systeembeheerder kan een bestaand account aan een (extra) ring koppelen."
    );
  }

  // `User.role` is voor niet-adminaccounts alleen nog een historisch veld;
  // alle rechten komen uit RingMembership.
  const user = await tx.user.create({ data: { name, email, role: opts.role, active: true } });
  return { user, isNew: true };
}

export type NewMemberInput = {
  existingUserId?: string;
  name?: string;
  email?: string;
  churchFunction: string;
  role: Role;
};

/** Alleen de systeemadministrator (webmin) kan een nieuwe ring aanmaken, direct met de eerste ringbeheerder. */
export async function createRing(input: { actorId: string; ringName: string } & NewMemberInput) {
  assertMembershipRole(input.role);
  const name = input.ringName.trim();
  if (name.length < 2) throw new RingError("Vul de naam van de ring in.");

  const result = await prisma.$transaction(async (tx) => {
    const actor = await loadActiveActor(tx, input.actorId);
    if (actor.role !== "ADMIN") throw new AuthorizationError();

    const duplicate = await tx.ring.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
    if (duplicate) throw new RingError("Er bestaat al een ring met deze naam.");

    const ring = await tx.ring.create({ data: { name } });
    const { user, isNew } = await resolveUser(tx, { ...input, actor });
    const membership = await tx.ringMembership.create({
      data: {
        userId: user.id,
        ringId: ring.id,
        role: input.role,
        churchFunction: input.churchFunction.trim(),
        isRingManager: true,
        active: true,
      },
    });
    return { ring, user, membership, isNew };
  });

  return result;
}

export async function renameRing(input: { actorId: string; ringId: string; name: string }) {
  const name = input.name.trim();
  if (name.length < 2) throw new RingError("Vul de naam van de ring in.");
  return prisma.$transaction(async (tx) => {
    const actor = await loadActiveActor(tx, input.actorId);
    if (actor.role !== "ADMIN") throw new AuthorizationError();
    const duplicate = await tx.ring.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, NOT: { id: input.ringId } },
    });
    if (duplicate) throw new RingError("Er bestaat al een ring met deze naam.");
    return tx.ring.update({ where: { id: input.ringId }, data: { name } });
  });
}

/** Voegt een gebruiker toe aan een ring (nieuw account, of — alleen voor de webmin — een bestaand account). */
export async function addMember(input: { actorId: string; ringId: string; isRingManager: boolean } & NewMemberInput) {
  assertMembershipRole(input.role);

  const created = await prisma.$transaction(async (tx) => {
    const actor = await assertCanManageRing(tx, input.actorId, input.ringId);
    const ring = await tx.ring.findUnique({ where: { id: input.ringId } });
    if (!ring) throw new RingError("Deze ring bestaat niet.");

    const { user, isNew } = await resolveUser(tx, { ...input, actor });
    const existingMembership = await tx.ringMembership.findUnique({
      where: { userId_ringId: { userId: user.id, ringId: input.ringId } },
    });
    if (existingMembership) throw new RingError("Deze persoon is al lid van deze ring.");

    const membership = await tx.ringMembership.create({
      data: {
        userId: user.id,
        ringId: input.ringId,
        role: input.role,
        churchFunction: input.churchFunction.trim(),
        isRingManager: input.isRingManager,
        active: true,
      },
    });
    return { user, membership, isNew };
  });

  // Nieuwe deelnemer aan lopende ondersteuningsrondes van de eigen groep.
  const joinedRounds = await addParticipantToRunningRounds(created.membership);
  return { ...created, joinedRounds };
}

/**
 * Wijzigt een lidmaatschap. Rondes die al lopen worden hierdoor nooit
 * stilzwijgend gewijzigd: een gedeactiveerd of van rol veranderd lid blijft
 * als "niet meer betrokken" zichtbaar in lopende rondes tot een bevoegde
 * persoon dat expliciet afhandelt (zie removeParticipantFromRound).
 */
export async function updateMember(input: {
  actorId: string;
  membershipId: string;
  churchFunction: string;
  role: Role;
  isRingManager: boolean;
  active: boolean;
  name?: string;
  email?: string;
}) {
  assertMembershipRole(input.role);

  const outcome = await prisma.$transaction(async (tx) => {
    const before = await tx.ringMembership.findUnique({ where: { id: input.membershipId }, include: { user: true } });
    if (!before) throw new RingError("Dit lidmaatschap bestaat niet.");
    const actor = await assertCanManageRing(tx, input.actorId, before.ringId);

    await lockRing(tx, before.ringId);

    const wantsProfileChange =
      (input.name !== undefined && input.name.trim() !== before.user.name) ||
      (input.email !== undefined && normalizeEmail(input.email) !== before.user.email);
    if (wantsProfileChange) {
      const otherMemberships = await tx.ringMembership.count({
        where: { userId: before.userId, NOT: { ringId: before.ringId } },
      });
      if (actor.role !== "ADMIN" && otherMemberships > 0) {
        throw new RingError(
          "Naam en e-mailadres van iemand die ook lid is van een andere ring kan alleen de systeembeheerder wijzigen."
        );
      }
      if (input.email !== undefined) {
        const email = normalizeEmail(input.email);
        const taken = await tx.user.findFirst({ where: { email, NOT: { id: before.userId } } });
        if (taken) throw new RingError("Er bestaat al een andere gebruiker met dit e-mailadres.");
      }
      await tx.user.update({
        where: { id: before.userId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.email !== undefined ? { email: normalizeEmail(input.email) } : {}),
        },
      });
    }

    const after = await tx.ringMembership.update({
      where: { id: before.id },
      data: {
        churchFunction: input.churchFunction.trim(),
        role: input.role,
        isRingManager: input.isRingManager,
        active: input.active,
      },
    });

    await assertHasActiveManager(tx, before.ringId);

    const otherActive = await tx.ringMembership.count({
      where: { userId: before.userId, active: true, NOT: { id: before.id } },
    });
    return { before, after, hasOtherActiveMembership: otherActive > 0 };
  });

  const { before, after, hasOtherActiveMembership } = outcome;

  if (before.active && !after.active && !hasOtherActiveMembership) {
    // Geen enkele actieve ring meer: bestaande sessies direct intrekken.
    await destroyAllSessionsForUser(after.userId);
  }

  let joinedRounds = 0;
  if (after.active && (!before.active || before.role !== after.role)) {
    joinedRounds = await addParticipantToRunningRounds(after);
  }
  return { membership: after, joinedRounds };
}

/** Leden van een ring, voor beheerschermen (alleen aanroepen na autorisatiecontrole). */
export async function listRingMembers(ringId: string) {
  const members = await prisma.ringMembership.findMany({
    where: { ringId },
    include: { user: true },
    orderBy: [{ active: "desc" }, { user: { name: "asc" } }],
  });
  const others = await prisma.ringMembership.groupBy({
    by: ["userId"],
    where: { userId: { in: members.map((m) => m.userId) }, NOT: { ringId } },
    _count: { _all: true },
  });
  const otherByUser = new Map(others.map((o) => [o.userId, o._count._all]));
  return members.map((m) => ({ ...m, otherRingCount: otherByUser.get(m.userId) ?? 0 }));
}

/** Alle actieve lidmaatschappen van een gebruiker, inclusief de ring. */
export async function listActiveMemberships(userId: string) {
  return prisma.ringMembership.findMany({
    where: { userId, active: true, ring: {} },
    include: { ring: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function listRingsOverview() {
  const rings = await prisma.ring.findMany({
    orderBy: { name: "asc" },
    include: {
      memberships: { include: { user: { select: { name: true, active: true } } } },
      _count: { select: { callings: true } },
    },
  });
  return rings.map((r) => ({
    id: r.id,
    name: r.name,
    callingCount: r._count.callings,
    memberCount: r.memberships.filter((m) => m.active).length,
    managers: r.memberships.filter((m) => m.isRingManager && m.active && m.user.active).map((m) => m.user.name),
  }));
}
