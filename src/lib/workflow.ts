import type { Calling, OndersteuningContext, Prisma, User } from "@prisma/client";
import { prisma } from "./prisma";
import { env } from "./env";
import { createMagicLinkToken } from "./auth";
import { voteInviteEmail, taskAssignedEmail, reminder30Email } from "./mailer";
import { allTasksDone, isReadyToProcess, phaseLabel, type TaskKey } from "./status";
import { notify } from "./notifications";

export class WorkflowError extends Error {}

function callingPath(callingId: string): string {
  return `/roepingen/${callingId}`;
}

function callingUrl(callingId: string): string {
  return `${env.appBaseUrl}${callingPath(callingId)}`;
}

async function buildMagicVoteLink(userId: string, callingId: string): Promise<string> {
  const { rawToken } = await createMagicLinkToken(userId);
  const redirect = encodeURIComponent(callingPath(callingId));
  return `${env.appBaseUrl}/auth/magic/${rawToken}?redirect=${redirect}`;
}

/**
 * Stuurt stemuitnodigingen naar (een deel van) de stemgerechtigden van een
 * fase via het centrale notificatieproces: een interne melding, een
 * generieke pushmelding, en (als de ontvanger dat aan heeft staan) een
 * gedetailleerde e-mail met een persoonlijke magic-link.
 */
async function notifyVoters(
  calling: Calling,
  userIds: string[],
  opts: { isReinvite: boolean; event: "NEW_PROPOSAL" | "ADVANCED_TO_HOGERAAD" | "REINVITE" }
) {
  await notify({
    userIds,
    event: opts.event,
    url: callingPath(calling.id),
    callingId: calling.id,
    buildEmail: async (user: User) => {
      const link = await buildMagicVoteLink(user.id, calling.id);
      return voteInviteEmail({
        name: user.name,
        personName: calling.personName,
        functionTitle: calling.functionTitle,
        link,
        isReinvite: opts.isReinvite,
      });
    },
  });
}

export async function notifyTaskAssignee(callingId: string, task: TaskKey, assigneeId: string) {
  const calling = await prisma.calling.findUniqueOrThrow({ where: { id: callingId } });
  const label = TASK_LABELS[task];

  await notify({
    userIds: [assigneeId],
    event: "TASK_ASSIGNED",
    url: callingPath(calling.id),
    callingId: calling.id,
    buildEmail: (user) =>
      taskAssignedEmail({
        name: user.name,
        taskLabel: label,
        personName: calling.personName,
        functionTitle: calling.functionTitle,
        link: callingUrl(calling.id),
      }),
  });
}

/** Informeert het ringpresidium (generieke tekst, geen vertrouwelijke inhoud) dat een voorstel is gepauzeerd. */
async function notifyPaused(calling: Calling): Promise<void> {
  const presidiumUsers = await prisma.user.findMany({ where: { role: "RINGPRESIDIUM", active: true }, select: { id: true } });
  await notify({
    userIds: presidiumUsers.map((u) => u.id),
    event: "PAUSED",
    url: callingPath(calling.id),
    callingId: calling.id,
  });
}

/** Informeert de aanmaker van de roeping dat een toegewezen taak is afgerond. */
async function notifyTaskCompleted(calling: Calling): Promise<void> {
  await notify({
    userIds: [calling.createdById],
    event: "TASK_COMPLETED",
    url: callingPath(calling.id),
    callingId: calling.id,
  });
}

export const TASK_LABELS: Record<TaskKey, string> = {
  ROEPEN: "Roepen",
  ONDERSTEUNEN: "Ondersteunen",
  AANSTELLEN: "Aanstellen",
};

// Matcht de veldnamen in prisma/schema.prisma (roepenAssigneeId, roepenDoneById,
// roepenDoneAt, enz.) zodat assignTask/completeTask hier niet met foutgevoelige
// stringmanipulatie de veldnaam hoeven af te leiden.
const TASK_FIELD_PREFIX: Record<TaskKey, "roepen" | "ondersteunen" | "aanstellen"> = {
  ROEPEN: "roepen",
  ONDERSTEUNEN: "ondersteunen",
  AANSTELLEN: "aanstellen",
};

export async function createCalling(input: {
  personName: string;
  functionTitle: string;
  createdById: string;
  roepenAssigneeId?: string | null;
  ondersteunenAssigneeId?: string | null;
  aanstellenAssigneeId?: string | null;
}): Promise<Calling> {
  const presidiumVoters = await prisma.user.findMany({
    where: { role: "RINGPRESIDIUM", active: true },
  });

  const calling = await prisma.calling.create({
    data: {
      personName: input.personName.trim(),
      functionTitle: input.functionTitle.trim(),
      createdById: input.createdById,
      status: "PRESIDIUM_VOTING",
      roepenAssigneeId: input.roepenAssigneeId || null,
      ondersteunenAssigneeId: input.ondersteunenAssigneeId || null,
      aanstellenAssigneeId: input.aanstellenAssigneeId || null,
      eligibleVoters: {
        create: presidiumVoters.map((u) => ({ stage: "PRESIDIUM" as const, userId: u.id })),
      },
    },
  });

  await notifyVoters(calling, presidiumVoters.map((u) => u.id), {
    isReinvite: false,
    event: "NEW_PROPOSAL",
  });

  for (const [task, assigneeId] of [
    ["ROEPEN", input.roepenAssigneeId],
    ["ONDERSTEUNEN", input.ondersteunenAssigneeId],
    ["AANSTELLEN", input.aanstellenAssigneeId],
  ] as const) {
    if (assigneeId) await notifyTaskAssignee(calling.id, task, assigneeId);
  }

  return calling;
}

function stageForStatus(status: Calling["status"]): "PRESIDIUM" | "HOGERAAD" | null {
  if (status === "PRESIDIUM_VOTING" || status === "PRESIDIUM_PAUSED") return "PRESIDIUM";
  if (status === "HOGERAAD_VOTING" || status === "HOGERAAD_PAUSED") return "HOGERAAD";
  return null;
}

export async function castVote(input: { callingId: string; userId: string; support: boolean }): Promise<Calling> {
  const calling = await prisma.calling.findUniqueOrThrow({ where: { id: input.callingId } });
  const stage = stageForStatus(calling.status);
  if (!stage) {
    throw new WorkflowError("Deze roeping staat momenteel niet open voor stemming.");
  }

  const eligible = await prisma.eligibleVoter.findUnique({
    where: { callingId_stage_userId: { callingId: calling.id, stage, userId: input.userId } },
  });
  if (!eligible) {
    throw new WorkflowError("Je bent niet stemgerechtigd voor deze stemronde.");
  }

  await prisma.vote.upsert({
    where: { callingId_stage_userId: { callingId: calling.id, stage, userId: input.userId } },
    update: { support: input.support },
    create: { callingId: calling.id, stage, userId: input.userId, support: input.support },
  });

  return recomputeCallingState(calling.id);
}

/** Herberekent de status van een roeping op basis van de daadwerkelijke stemmen (idempotent, veilig na elke stemwijziging opnieuw uit te voeren). */
async function recomputeCallingState(callingId: string): Promise<Calling> {
  const { calling, hogeraadVoterIds, justPaused } = await prisma.$transaction(async (tx) => {
    const calling = await tx.calling.findUniqueOrThrow({ where: { id: callingId } });
    const stage = stageForStatus(calling.status);
    if (!stage) return { calling, hogeraadVoterIds: null as string[] | null, justPaused: false };

    const [eligibleVoters, votes] = await Promise.all([
      tx.eligibleVoter.findMany({ where: { callingId, stage } }),
      tx.vote.findMany({ where: { callingId, stage } }),
    ]);

    const anyNegative = votes.some((v) => !v.support);
    const allVoted = eligibleVoters.length > 0 && votes.length === eligibleVoters.length;
    const allPositive = allVoted && votes.every((v) => v.support);

    if (anyNegative) {
      const pausedStatus = stage === "PRESIDIUM" ? "PRESIDIUM_PAUSED" : "HOGERAAD_PAUSED";
      const wasAlreadyPaused = calling.status === pausedStatus;
      const updated = await tx.calling.update({ where: { id: callingId }, data: { status: pausedStatus } });
      return { calling: updated, hogeraadVoterIds: null, justPaused: !wasAlreadyPaused };
    }

    if (allPositive) {
      if (stage === "PRESIDIUM") {
        const hogeraadVoters = await tx.user.findMany({ where: { role: "HOGERAAD", active: true } });

        if (hogeraadVoters.length === 0) {
          // Niemand om over te stemmen in de hoge raad: er is dan niets om op
          // te wachten, dus de roeping is direct volledig goedgekeurd.
          const updated = await tx.calling.update({
            where: { id: callingId },
            data: { status: "APPROVED", approvedAt: new Date() },
          });
          return { calling: updated, hogeraadVoterIds: null, justPaused: false };
        }

        await tx.eligibleVoter.createMany({
          data: hogeraadVoters.map((u) => ({ callingId, stage: "HOGERAAD" as const, userId: u.id })),
          skipDuplicates: true,
        });
        const updated = await tx.calling.update({ where: { id: callingId }, data: { status: "HOGERAAD_VOTING" } });
        return { calling: updated, hogeraadVoterIds: hogeraadVoters.map((u) => u.id), justPaused: false };
      } else {
        const updated = await tx.calling.update({
          where: { id: callingId },
          data: { status: "APPROVED", approvedAt: new Date() },
        });
        return { calling: updated, hogeraadVoterIds: null, justPaused: false };
      }
    }

    // Niemand tegen, maar nog niet iedereen heeft gestemd: open/hervat.
    const votingStatus = stage === "PRESIDIUM" ? "PRESIDIUM_VOTING" : "HOGERAAD_VOTING";
    const updated = await tx.calling.update({ where: { id: callingId }, data: { status: votingStatus } });
    return { calling: updated, hogeraadVoterIds: null, justPaused: false };
  });

  // Bewust buiten de transactie: een mislukte melding mag de al opgeslagen
  // statusovergang niet terugdraaien.
  if (justPaused) {
    await notifyPaused(calling);
  }
  if (hogeraadVoterIds) {
    await notifyVoters(calling, hogeraadVoterIds, {
      isReinvite: false,
      event: "ADVANCED_TO_HOGERAAD",
    });
  }

  return calling;
}

export async function reinviteVoter(input: { callingId: string; userId: string }): Promise<void> {
  const calling = await prisma.calling.findUniqueOrThrow({ where: { id: input.callingId } });
  const stage = stageForStatus(calling.status);
  if (!stage || !calling.status.endsWith("PAUSED")) {
    throw new WorkflowError("Opnieuw uitnodigen is alleen mogelijk voor een gepauzeerd voorstel.");
  }
  const eligible = await prisma.eligibleVoter.findUnique({
    where: { callingId_stage_userId: { callingId: calling.id, stage, userId: input.userId } },
  });
  if (!eligible) {
    throw new WorkflowError("Deze persoon is niet stemgerechtigd voor deze fase.");
  }
  await notifyVoters(calling, [input.userId], { isReinvite: true, event: "REINVITE" });
}

export async function assignTask(input: { callingId: string; task: TaskKey; assigneeId: string | null }): Promise<Calling> {
  const calling = await prisma.calling.findUniqueOrThrow({ where: { id: input.callingId } });
  if (calling.status === "PROCESSED") {
    throw new WorkflowError("Deze roeping is al verwerkt.");
  }
  const dbField = `${TASK_FIELD_PREFIX[input.task]}AssigneeId`;

  const updated = await prisma.calling.update({
    where: { id: input.callingId },
    data: { [dbField]: input.assigneeId } as Prisma.CallingUpdateInput,
  });

  if (input.assigneeId) {
    await notifyTaskAssignee(input.callingId, input.task, input.assigneeId);
  }

  return updated;
}

export async function completeTask(input: {
  callingId: string;
  task: TaskKey;
  doneById: string;
  doneAt: Date;
  ondersteunenContext?: OndersteuningContext;
}): Promise<Calling> {
  const calling = await prisma.calling.findUniqueOrThrow({ where: { id: input.callingId } });
  if (calling.status !== "APPROVED") {
    throw new WorkflowError("Taken kunnen alleen worden afgerond nadat de roeping volledig is goedgekeurd.");
  }
  if (input.task === "ONDERSTEUNEN" && !input.ondersteunenContext) {
    throw new WorkflowError("Geef aan of de ondersteuning in een avondmaalsvergadering of ringconferentie plaatsvond.");
  }

  const prefix = TASK_FIELD_PREFIX[input.task];
  const wasAlreadyDone = calling[`${prefix}DoneAt` as const] !== null;
  const data: Record<string, unknown> = {
    [`${prefix}DoneById`]: input.doneById,
    [`${prefix}DoneAt`]: input.doneAt,
  };
  if (input.task === "ONDERSTEUNEN") {
    data.ondersteunenContext = input.ondersteunenContext;
  }

  const updated = await prisma.calling.update({ where: { id: input.callingId }, data: data as Prisma.CallingUpdateInput });

  // Alleen bij de eerste keer afronden melden, niet bij een correctie van een
  // al afgeronde taak (voorkomt dubbele meldingen).
  if (!wasAlreadyDone) {
    await notifyTaskCompleted(updated);
  }

  return updated;
}

export async function markProcessed(input: { callingId: string; processedById: string }): Promise<Calling> {
  const calling = await prisma.calling.findUniqueOrThrow({ where: { id: input.callingId } });
  if (!isReadyToProcess(calling)) {
    throw new WorkflowError("Deze roeping is nog niet gereed om verwerkt te worden.");
  }
  return prisma.calling.update({
    where: { id: input.callingId },
    data: { status: "PROCESSED", processedAt: new Date(), processedById: input.processedById },
  });
}

// ---- Achtergrondtaken (aangeroepen door de scheduler, zie cron.ts) ----

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function sendDue30DayReminders(): Promise<number> {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
  const due = await prisma.calling.findMany({
    where: { status: { not: "PROCESSED" }, reminder30SentAt: null, createdAt: { lte: cutoff } },
  });
  if (due.length === 0) return 0;

  const presidiumUsers = await prisma.user.findMany({ where: { role: "RINGPRESIDIUM", active: true } });
  const presidiumIds = presidiumUsers.map((u) => u.id);

  for (const calling of due) {
    await notify({
      userIds: presidiumIds,
      event: "REMINDER_30_DAYS",
      url: callingPath(calling.id),
      callingId: calling.id,
      buildEmail: (user) =>
        reminder30Email({
          name: user.name,
          personName: calling.personName,
          functionTitle: calling.functionTitle,
          phaseLabel: phaseLabel(calling),
          link: callingUrl(calling.id),
        }),
    });
    // Pas na het (proberen te) versturen markeren, zodat een gedeeltelijke
    // storing bij de volgende cron-run opnieuw wordt opgepakt. Bij
    // succesvolle verzending voorkomt dit duplicaten bij elke volgende run.
    await prisma.calling.update({ where: { id: calling.id }, data: { reminder30SentAt: new Date() } });
  }

  return due.length;
}

export async function deleteDueProcessedCallings(): Promise<number> {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
  const due = await prisma.calling.findMany({
    where: { status: "PROCESSED", processedAt: { lte: cutoff } },
    select: { id: true },
  });
  if (due.length === 0) return 0;
  await prisma.calling.deleteMany({ where: { id: { in: due.map((c) => c.id) } } });
  return due.length;
}

export { allTasksDone, isReadyToProcess, phaseLabel };
