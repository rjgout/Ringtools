import { prisma } from "./prisma";
import type { Calling } from "@prisma/client";

export async function listActiveUsers() {
  return prisma.user.findMany({
    where: { active: true, role: { not: "ADMIN" } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
}

export async function getStaffDashboardCounts() {
  const [presidium, hogeraad, paused, approved, readyToProcess, roepenOpen, ondersteunenOpen, aanstellenOpen] =
    await Promise.all([
      prisma.calling.count({ where: { status: { in: ["PRESIDIUM_VOTING", "PRESIDIUM_PAUSED"] } } }),
      prisma.calling.count({ where: { status: { in: ["HOGERAAD_VOTING", "HOGERAAD_PAUSED"] } } }),
      prisma.calling.count({ where: { status: { in: ["PRESIDIUM_PAUSED", "HOGERAAD_PAUSED"] } } }),
      prisma.calling.count({ where: { status: "APPROVED" } }),
      prisma.calling.count({
        where: { status: "APPROVED", processedAt: null, roepenDoneAt: { not: null }, ondersteunenDoneAt: { not: null }, aanstellenDoneAt: { not: null } },
      }),
      prisma.calling.count({ where: { status: "APPROVED", roepenDoneAt: null } }),
      prisma.calling.count({ where: { status: "APPROVED", ondersteunenDoneAt: null } }),
      prisma.calling.count({ where: { status: "APPROVED", aanstellenDoneAt: null } }),
    ]);

  return { presidium, hogeraad, paused, approved, readyToProcess, roepenOpen, ondersteunenOpen, aanstellenOpen };
}

export async function listAttentionCallingsForStaff(): Promise<Calling[]> {
  return prisma.calling.findMany({
    where: { status: { in: ["PRESIDIUM_PAUSED", "HOGERAAD_PAUSED"] } },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });
}

export type CallingFilter =
  | "alle"
  | "presidium"
  | "hogeraad"
  | "gepauzeerd"
  | "goedgekeurd"
  | "roepen"
  | "ondersteunen"
  | "aanstellen"
  | "verwerken";

export async function listCallings(filter: CallingFilter = "alle"): Promise<Calling[]> {
  const where: Record<string, unknown> = {};
  switch (filter) {
    case "presidium":
      where.status = { in: ["PRESIDIUM_VOTING", "PRESIDIUM_PAUSED"] };
      break;
    case "hogeraad":
      where.status = { in: ["HOGERAAD_VOTING", "HOGERAAD_PAUSED"] };
      break;
    case "gepauzeerd":
      where.status = { in: ["PRESIDIUM_PAUSED", "HOGERAAD_PAUSED"] };
      break;
    case "goedgekeurd":
      where.status = "APPROVED";
      break;
    case "roepen":
      where.status = "APPROVED";
      where.roepenDoneAt = null;
      break;
    case "ondersteunen":
      where.status = "APPROVED";
      where.ondersteunenDoneAt = null;
      break;
    case "aanstellen":
      where.status = "APPROVED";
      where.aanstellenDoneAt = null;
      break;
    case "verwerken":
      where.status = "APPROVED";
      where.processedAt = null;
      where.roepenDoneAt = { not: null };
      where.ondersteunenDoneAt = { not: null };
      where.aanstellenDoneAt = { not: null };
      break;
    case "alle":
    default:
      where.status = { not: "PROCESSED" };
      break;
  }

  return prisma.calling.findMany({ where, orderBy: { createdAt: "desc" } });
}

export async function getCallingDetail(id: string) {
  return prisma.calling.findUnique({
    where: { id },
    include: {
      createdBy: true,
      processedBy: true,
      roepenAssignee: true,
      roepenDoneBy: true,
      ondersteunenAssignee: true,
      ondersteunenDoneBy: true,
      aanstellenAssignee: true,
      aanstellenDoneBy: true,
      eligibleVoters: { include: { user: true } },
      votes: { include: { user: true } },
    },
  });
}

export type CallingDetail = NonNullable<Awaited<ReturnType<typeof getCallingDetail>>>;

export async function getHogeraadOverview(userId: string) {
  const [eligible, votes, tasks] = await Promise.all([
    prisma.eligibleVoter.findMany({
      where: { userId, stage: "HOGERAAD" },
      include: { calling: true },
    }),
    prisma.vote.findMany({ where: { userId, stage: "HOGERAAD" } }),
    prisma.calling.findMany({
      where: {
        status: "APPROVED",
        OR: [
          { roepenAssigneeId: userId, roepenDoneAt: null },
          { ondersteunenAssigneeId: userId, ondersteunenDoneAt: null },
          { aanstellenAssigneeId: userId, aanstellenDoneAt: null },
        ],
      },
    }),
  ]);

  const votedCallingIds = new Set(votes.map((v) => v.callingId));
  const pendingVotes = eligible
    .map((e) => e.calling)
    .filter((c) => (c.status === "HOGERAAD_VOTING" || c.status === "HOGERAAD_PAUSED") && !votedCallingIds.has(c.id));

  return { pendingVotes, tasks };
}
