import type { Calling, OndersteuningContext, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { env } from "./env";
import { createMagicLinkToken } from "./auth";
import { sendMail, voteInviteEmail, taskAssignedEmail, reminder30Email } from "./mailer";
import { allTasksDone, isReadyToProcess, phaseLabel, type TaskKey } from "./status";

export class WorkflowError extends Error {}

function callingUrl(callingId: string): string {
  return `${env.appBaseUrl}/callings/${callingId}`;
}

async function buildMagicVoteLink(userId: string, callingId: string): Promise<string> {
  const { rawToken } = await createMagicLinkToken(userId);
  const redirect = encodeURIComponent(`/callings/${callingId}`);
  return `${env.appBaseUrl}/auth/magic/${rawToken}?redirect=${redirect}`;
}

/** Stuurt stemuitnodigingen naar (een deel van) de stemgerechtigden van een fase. Fouten bij verzending worden gelogd, niet gegooid: een mislukte e-mail mag nooit een voorstel/stem laten verdwijnen. */
async function notifyVoters(
  calling: Calling,
  stage: "PRESIDIUM" | "HOGERAAD",
  userIds: string[],
  isReinvite: boolean
) {
  const users = await prisma.user.findMany({ where: { id: { in: userIds } } });
  for (const user of users) {
    try {
      const link = await buildMagicVoteLink(user.id, calling.id);
      const { subject, text } = voteInviteEmail({
        name: user.name,
        personName: calling.personName,
        functionTitle: calling.functionTitle,
        link,
        isReinvite,
      });
      await sendMail({ to: user.email, subject, text });
    } catch (err) {
      console.error(`[workflow] Versturen stemuitnodiging naar ${user.email} mislukt:`, err);
    }
  }
}

export async function notifyTaskAssignee(callingId: string, task: TaskKey, assigneeId: string) {
  const [calling, user] = await Promise.all([
    prisma.calling.findUniqueOrThrow({ where: { id: callingId } }),
    prisma.user.findUniqueOrThrow({ where: { id: assigneeId } }),
  ]);
  const label = TASK_LABELS[task];
  try {
    const { subject, text } = taskAssignedEmail({
      name: user.name,
      taskLabel: label,
      personName: calling.personName,
      functionTitle: calling.functionTitle,
      link: callingUrl(calling.id),
    });
    await sendMail({ to: user.email, subject, text });
  } catch (err) {
    console.error(`[workflow] Versturen taakmelding naar ${user.email} mislukt:`, err);
  }
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

  await notifyVoters(calling, "PRESIDIUM", presidiumVoters.map((u) => u.id), false);

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
  const { calling, hogeraadVoterIds } = await prisma.$transaction(async (tx) => {
    const calling = await tx.calling.findUniqueOrThrow({ where: { id: callingId } });
    const stage = stageForStatus(calling.status);
    if (!stage) return { calling, hogeraadVoterIds: null as string[] | null };

    const [eligibleVoters, votes] = await Promise.all([
      tx.eligibleVoter.findMany({ where: { callingId, stage } }),
      tx.vote.findMany({ where: { callingId, stage } }),
    ]);

    const anyNegative = votes.some((v) => !v.support);
    const allVoted = eligibleVoters.length > 0 && votes.length === eligibleVoters.length;
    const allPositive = allVoted && votes.every((v) => v.support);

    if (anyNegative) {
      const pausedStatus = stage === "PRESIDIUM" ? "PRESIDIUM_PAUSED" : "HOGERAAD_PAUSED";
      const updated = await tx.calling.update({ where: { id: callingId }, data: { status: pausedStatus } });
      return { calling: updated, hogeraadVoterIds: null };
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
          return { calling: updated, hogeraadVoterIds: null };
        }

        await tx.eligibleVoter.createMany({
          data: hogeraadVoters.map((u) => ({ callingId, stage: "HOGERAAD" as const, userId: u.id })),
          skipDuplicates: true,
        });
        const updated = await tx.calling.update({ where: { id: callingId }, data: { status: "HOGERAAD_VOTING" } });
        return { calling: updated, hogeraadVoterIds: hogeraadVoters.map((u) => u.id) };
      } else {
        const updated = await tx.calling.update({
          where: { id: callingId },
          data: { status: "APPROVED", approvedAt: new Date() },
        });
        return { calling: updated, hogeraadVoterIds: null };
      }
    }

    // Niemand tegen, maar nog niet iedereen heeft gestemd: open/hervat.
    const votingStatus = stage === "PRESIDIUM" ? "PRESIDIUM_VOTING" : "HOGERAAD_VOTING";
    const updated = await tx.calling.update({ where: { id: callingId }, data: { status: votingStatus } });
    return { calling: updated, hogeraadVoterIds: null };
  });

  // Bewust buiten de transactie: een mislukte e-mail mag de al opgeslagen
  // statusovergang niet terugdraaien.
  if (hogeraadVoterIds) {
    await notifyVoters(calling, "HOGERAAD", hogeraadVoterIds, false);
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
  await notifyVoters(calling, stage, [input.userId], true);
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
  const data: Record<string, unknown> = {
    [`${prefix}DoneById`]: input.doneById,
    [`${prefix}DoneAt`]: input.doneAt,
  };
  if (input.task === "ONDERSTEUNEN") {
    data.ondersteunenContext = input.ondersteunenContext;
  }

  return prisma.calling.update({ where: { id: input.callingId }, data: data as Prisma.CallingUpdateInput });
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

  for (const calling of due) {
    for (const user of presidiumUsers) {
      try {
        const { subject, text } = reminder30Email({
          name: user.name,
          personName: calling.personName,
          functionTitle: calling.functionTitle,
          phaseLabel: phaseLabel(calling),
          link: callingUrl(calling.id),
        });
        await sendMail({ to: user.email, subject, text });
      } catch (err) {
        console.error(`[cron] Herinnering naar ${user.email} mislukt voor roeping ${calling.id}:`, err);
      }
    }
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
