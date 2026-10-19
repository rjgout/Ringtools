import { prisma } from "./prisma";
import type { Calling, Role } from "@prisma/client";
import { STAGE_ROLE } from "./rbac";

/** Actieve leden van een ring (voor keuzelijsten, zoals verantwoordelijken voor taken). */
export async function listActiveUsers(ringId: string) {
  const rows = await prisma.ringMembership.findMany({
    where: { ringId, active: true, user: { active: true } },
    orderBy: { user: { name: "asc" } },
    select: { userId: true, role: true, user: { select: { name: true } } },
  });
  return rows.map((m) => ({ id: m.userId, name: m.user.name, role: m.role }));
}

export async function getStaffDashboardCounts(ringId: string) {
  const base = { ringId };
  const [presidium, hogeraad, paused, approved, readyToProcess, roepenOpen, ondersteunenOpen, aanstellenOpen] =
    await Promise.all([
      prisma.calling.count({ where: { ...base, status: { in: ["PRESIDIUM_VOTING", "PRESIDIUM_PAUSED"] } } }),
      prisma.calling.count({ where: { ...base, status: { in: ["HOGERAAD_VOTING", "HOGERAAD_PAUSED"] } } }),
      prisma.calling.count({ where: { ...base, status: { in: ["PRESIDIUM_PAUSED", "HOGERAAD_PAUSED"] } } }),
      prisma.calling.count({ where: { ...base, status: "APPROVED" } }),
      prisma.calling.count({
        where: {
          ...base,
          status: "APPROVED",
          processedAt: null,
          roepenDoneAt: { not: null },
          ondersteunenDoneAt: { not: null },
          aanstellenDoneAt: { not: null },
        },
      }),
      prisma.calling.count({ where: { ...base, status: "APPROVED", roepenDoneAt: null } }),
      prisma.calling.count({ where: { ...base, status: "APPROVED", ondersteunenDoneAt: null } }),
      prisma.calling.count({ where: { ...base, status: "APPROVED", aanstellenDoneAt: null } }),
    ]);

  return { presidium, hogeraad, paused, approved, readyToProcess, roepenOpen, ondersteunenOpen, aanstellenOpen };
}

export async function listAttentionCallingsForStaff(ringId: string): Promise<Calling[]> {
  return prisma.calling.findMany({
    where: { ringId, status: { in: ["PRESIDIUM_PAUSED", "HOGERAAD_PAUSED"] } },
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

export async function listCallings(ringId: string, filter: CallingFilter = "alle"): Promise<Calling[]> {
  const where: Record<string, unknown> = { ringId };
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
      ring: true,
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

/**
 * Per deelnemer aan een ondersteuningsronde: is die persoon NU nog actief
 * betrokken (actief lid van de ring met de juiste rol)? Gebruikt om
 * gedeactiveerde of van rol veranderde deelnemers expliciet te markeren.
 */
export async function getStillInvolvedUserIds(ringId: string, stage: "PRESIDIUM" | "HOGERAAD"): Promise<Set<string>> {
  const rows = await prisma.ringMembership.findMany({
    where: { ringId, role: STAGE_ROLE[stage] as Role, active: true, user: { active: true } },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}

export async function getHogeraadOverview(userId: string, ringId: string) {
  const [eligible, votes, tasks] = await Promise.all([
    prisma.eligibleVoter.findMany({
      where: { userId, stage: "HOGERAAD", calling: { ringId } },
      include: { calling: true },
    }),
    prisma.vote.findMany({ where: { userId, stage: "HOGERAAD", calling: { ringId } } }),
    prisma.calling.findMany({
      where: {
        ringId,
        status: "APPROVED",
        OR: [
          { roepenAssigneeId: userId, roepenDoneAt: null },
          { ondersteunenAssigneeId: userId, ondersteunenDoneAt: null },
          { aanstellenAssigneeId: userId, aanstellenDoneAt: null },
        ],
      },
    }),
  ]);

  const respondedCallingIds = new Set(votes.map((v) => v.callingId));
  const pendingVotes = eligible
    .map((e) => e.calling)
    .filter((c) => (c.status === "HOGERAAD_VOTING" || c.status === "HOGERAAD_PAUSED") && !respondedCallingIds.has(c.id));

  return { pendingVotes, tasks };
}

/** Aantal openstaande acties over alle actieve ringen van een gebruiker (voor de app-badge op het apparaat). */
export async function getPendingActionCount(userId: string): Promise<number> {
  const memberships = await prisma.ringMembership.findMany({ where: { userId, active: true } });
  let count = 0;
  for (const m of memberships) {
    if (m.role === "HOGERAAD") {
      const { pendingVotes, tasks } = await getHogeraadOverview(userId, m.ringId);
      count += pendingVotes.length + tasks.length;
    } else {
      const counts = await getStaffDashboardCounts(m.ringId);
      count += counts.paused + counts.readyToProcess;
    }
  }
  return count;
}

/** Workflowrol per gebruiker binnen één ring (voor weergave naast namen). */
export async function getRoleByUserId(ringId: string): Promise<Map<string, Role>> {
  const rows = await prisma.ringMembership.findMany({ where: { ringId }, select: { userId: true, role: true } });
  return new Map(rows.map((r) => [r.userId, r.role]));
}
