import { prisma } from "@/lib/prisma";

export async function resetDatabase() {
  // Volgorde belangrijk vanwege foreign keys zonder cascade op User.
  await prisma.vote.deleteMany();
  await prisma.eligibleVoter.deleteMany();
  await prisma.calling.deleteMany();
  await prisma.magicLinkToken.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.smtpSettings.deleteMany();
}

export async function createTestUser(role: "RINGPRESIDIUM" | "RINGSECRETARIS" | "RINGADMINISTRATEUR" | "HOGERAAD" | "ADMIN", name: string) {
  return prisma.user.create({
    data: {
      name,
      email: `${name.toLowerCase().replace(/\s+/g, ".")}@test.ringapeldoorn.nl`,
      role,
      active: true,
    },
  });
}
