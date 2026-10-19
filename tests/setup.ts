import { prisma } from "@/lib/prisma";
import { createCalling as createCallingInRing } from "@/lib/workflow";

let defaultRingId: string | null = null;

export async function resetDatabase() {
  // Volgorde belangrijk vanwege foreign keys zonder cascade op User/Ring.
  await prisma.vote.deleteMany();
  await prisma.eligibleVoter.deleteMany();
  await prisma.calling.deleteMany();
  await prisma.magicLinkToken.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.ring.deleteMany();
  await prisma.smtpSettings.deleteMany();
  defaultRingId = null;
}

export async function createTestRing(name: string) {
  return prisma.ring.create({ data: { name } });
}

/** Standaard testring: wordt per test (na resetDatabase) lazy aangemaakt. */
export async function getTestRing() {
  if (!defaultRingId) {
    defaultRingId = (await createTestRing("Testring")).id;
  }
  return prisma.ring.findUniqueOrThrow({ where: { id: defaultRingId } });
}

type TestRole = "RINGPRESIDIUM" | "RINGSECRETARIS" | "RINGADMINISTRATEUR" | "HOGERAAD" | "ADMIN";

/**
 * Maakt een gebruiker aan. Niet-adminaccounts worden lid van `opts.ringId`
 * (standaard de testring) met de opgegeven workflowrol; `User.role` blijft
 * alleen een historisch veld.
 */
export async function createTestUser(
  role: TestRole,
  name: string,
  opts: { ringId?: string; churchFunction?: string; isRingManager?: boolean; active?: boolean; email?: string } = {}
) {
  const user = await prisma.user.create({
    data: {
      name,
      email: opts.email ?? `${name.toLowerCase().replace(/\s+/g, ".")}@test.ringapeldoorn.nl`,
      role,
      active: true,
    },
  });
  if (role !== "ADMIN") {
    const ringId = opts.ringId ?? (await getTestRing()).id;
    await prisma.ringMembership.create({
      data: {
        userId: user.id,
        ringId,
        role,
        churchFunction: opts.churchFunction ?? "Testfunctie",
        isRingManager: opts.isRingManager ?? false,
        active: opts.active ?? true,
      },
    });
  }
  return user;
}

/** createCalling binnen de testring, tenzij een andere ring is opgegeven. */
export async function createCalling(
  input: Omit<Parameters<typeof createCallingInRing>[0], "ringId"> & { ringId?: string }
) {
  return createCallingInRing({ ...input, ringId: input.ringId ?? (await getTestRing()).id });
}
