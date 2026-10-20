import type { Calling, CallingStatus, OndersteuningContext, Prisma, Role, User } from "@prisma/client";
import { prisma } from "./prisma";
import { createOpenLink } from "./openLinks";
import { supportInviteEmail, supportReminderEmail, taskAssignedEmail, reminder30Email } from "./mailer";
import { allTasksDone, isReadyToProcess, phaseLabel, type TaskKey } from "./status";
import { notify } from "./notifications";
import { STAFF_ROLES, STAGE_ROLE } from "./rbac";

export class WorkflowError extends Error {}

/** De uitvoerder heeft geen bevoegdheid binnen de ring van dit voorstel. */
export class AuthorizationError extends Error {
  constructor(message = "Je hebt hier geen toegang toe.") {
    super(message);
  }
}

type Db = Prisma.TransactionClient;
type Stage = "PRESIDIUM" | "HOGERAAD";

/** Minimale wachttijd tussen twee uitnodigingen/herinneringen voor dezelfde persoon in dezelfde ronde. */
export const REMINDER_COOLDOWN_MS = 60 * 60 * 1000;

const STAGE_STATUSES: Record<Stage, CallingStatus[]> = {
  PRESIDIUM: ["PRESIDIUM_VOTING", "PRESIDIUM_PAUSED"],
  HOGERAAD: ["HOGERAAD_VOTING", "HOGERAAD_PAUSED"],
};

function callingPath(callingId: string): string {
  return `/roepingen/${callingId}`;
}

/** Actieve leden van een ring met een bepaalde workflowrol (account én lidmaatschap actief). */
async function activeMemberIds(db: Db, ringId: string, role: Role): Promise<string[]> {
  const rows = await db.ringMembership.findMany({
    where: { ringId, role, active: true, user: { active: true } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/** Zekerstellen dat alle opgegeven gebruikers actief lid van deze ring zijn (tenantisolatie). */
async function assertActiveRingMembers(db: Db, ringId: string, userIds: string[]): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  const count = await db.ringMembership.count({
    where: { ringId, userId: { in: unique }, active: true, user: { active: true } },
  });
  if (count !== unique.length) {
    throw new WorkflowError("Deze persoon is geen actief lid van deze ring.");
  }
}

async function requireRingStaff(actorId: string, ringId: string): Promise<void> {
  const m = await prisma.ringMembership.findUnique({
    where: { userId_ringId: { userId: actorId, ringId } },
    include: { user: true },
  });
  if (!m || !m.active || !m.user.active || !STAFF_ROLES.includes(m.role)) {
    throw new AuthorizationError();
  }
}

/** Blokkeert de roeping-rij voor de duur van de transactie (serialiseert gelijktijdige wijzigingen in een ronde). */
async function lockCalling(tx: Db, callingId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Calling" WHERE "id" = ${callingId} FOR UPDATE`;
}

/**
 * Stuurt ondersteuningsverzoeken naar (een deel van) de deelnemers van een
 * ronde via het centrale notificatieproces: een interne melding, een
 * generieke pushmelding, en (als de ontvanger dat aan heeft staan) een
 * gedetailleerde e-mail met een persoonlijke koppeling naar het voorstel (/open/<token>).
 */
async function notifyParticipants(
  calling: Calling,
  userIds: string[],
  opts: { event: "NEW_PROPOSAL" | "ADVANCED_TO_HOGERAAD" | "REINVITE" | "SUPPORT_REMINDER" }
) {
  await notify({
    userIds,
    ringId: calling.ringId,
    event: opts.event,
    url: callingPath(calling.id),
    callingId: calling.id,
    buildEmail: async (user: User) => {
      const link = await createOpenLink(user.id, calling.id);
      if (opts.event === "SUPPORT_REMINDER") {
        return supportReminderEmail({ name: user.name, personName: calling.personName, functionTitle: calling.functionTitle, link });
      }
      return supportInviteEmail({
        name: user.name,
        personName: calling.personName,
        functionTitle: calling.functionTitle,
        link,
        isReinvite: opts.event === "REINVITE",
      });
    },
  });
}

export async function notifyTaskAssignee(callingId: string, task: TaskKey, assigneeId: string) {
  const calling = await prisma.calling.findUniqueOrThrow({ where: { id: callingId } });
  const label = TASK_LABELS[task];

  await notify({
    userIds: [assigneeId],
    ringId: calling.ringId,
    event: "TASK_ASSIGNED",
    url: callingPath(calling.id),
    callingId: calling.id,
    buildEmail: async (user) =>
      taskAssignedEmail({
        name: user.name,
        taskLabel: label,
        personName: calling.personName,
        functionTitle: calling.functionTitle,
        link: await createOpenLink(user.id, calling.id),
      }),
  });
}

/** Informeert het ringpresidium van de ring (generieke tekst) dat een voorstel is gepauzeerd. */
async function notifyPaused(calling: Calling): Promise<void> {
  const presidiumIds = await activeMemberIds(prisma, calling.ringId, "RINGPRESIDIUM");
  await notify({
    userIds: presidiumIds,
    ringId: calling.ringId,
    event: "PAUSED",
    url: callingPath(calling.id),
    callingId: calling.id,
  });
}

/** Informeert de aanmaker van de roeping dat een toegewezen taak is afgerond. */
async function notifyTaskCompleted(calling: Calling): Promise<void> {
  await notify({
    userIds: [calling.createdById],
    ringId: calling.ringId,
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
  ringId: string;
  personName: string;
  functionTitle: string;
  createdById: string;
  roepenAssigneeId?: string | null;
  ondersteunenAssigneeId?: string | null;
  aanstellenAssigneeId?: string | null;
}): Promise<Calling> {
  const assigneeIds = [input.roepenAssigneeId, input.ondersteunenAssigneeId, input.aanstellenAssigneeId].filter(
    (id): id is string => !!id
  );

  const { calling, presidiumIds } = await prisma.$transaction(async (tx) => {
    // Aanmaker en verantwoordelijken moeten actief lid van DEZE ring zijn.
    await assertActiveRingMembers(tx, input.ringId, [input.createdById, ...assigneeIds]);

    const presidiumIds = await activeMemberIds(tx, input.ringId, "RINGPRESIDIUM");
    const now = new Date();
    const calling = await tx.calling.create({
      data: {
        ringId: input.ringId,
        personName: input.personName.trim(),
        functionTitle: input.functionTitle.trim(),
        createdById: input.createdById,
        status: "PRESIDIUM_VOTING",
        roepenAssigneeId: input.roepenAssigneeId || null,
        ondersteunenAssigneeId: input.ondersteunenAssigneeId || null,
        aanstellenAssigneeId: input.aanstellenAssigneeId || null,
        eligibleVoters: {
          create: presidiumIds.map((userId) => ({ stage: "PRESIDIUM" as const, userId, lastInvitedAt: now })),
        },
      },
    });
    return { calling, presidiumIds };
  });

  await notifyParticipants(calling, presidiumIds, { event: "NEW_PROPOSAL" });

  for (const [task, assigneeId] of [
    ["ROEPEN", input.roepenAssigneeId],
    ["ONDERSTEUNEN", input.ondersteunenAssigneeId],
    ["AANSTELLEN", input.aanstellenAssigneeId],
  ] as const) {
    if (assigneeId) await notifyTaskAssignee(calling.id, task, assigneeId);
  }

  return calling;
}

function stageForStatus(status: Calling["status"]): Stage | null {
  if (status === "PRESIDIUM_VOTING" || status === "PRESIDIUM_PAUSED") return "PRESIDIUM";
  if (status === "HOGERAAD_VOTING" || status === "HOGERAAD_PAUSED") return "HOGERAAD";
  return null;
}

/** Brengt ondersteuning uit (of wijzigt een eerdere reactie) zolang de ronde openstaat. */
export async function castVote(input: { callingId: string; userId: string; support: boolean }): Promise<Calling> {
  const calling = await prisma.calling.findUniqueOrThrow({ where: { id: input.callingId } });
  const stage = stageForStatus(calling.status);
  if (!stage) {
    throw new WorkflowError("Voor dit voorstel is momenteel geen ondersteuningsronde open.");
  }

  const [eligible, membership] = await Promise.all([
    prisma.eligibleVoter.findUnique({
      where: { callingId_stage_userId: { callingId: calling.id, stage, userId: input.userId } },
    }),
    prisma.ringMembership.findUnique({
      where: { userId_ringId: { userId: input.userId, ringId: calling.ringId } },
      include: { user: true },
    }),
  ]);
  // Naast de bevroren deelnemerslijst moet iemand NU nog actief lid van de
  // ring zijn met de juiste rol: een gedeactiveerd of van functie veranderd
  // lid kan niet meer reageren (bestaande reacties blijven wel staan).
  if (!eligible || !membership || !membership.active || !membership.user.active || membership.role !== STAGE_ROLE[stage]) {
    throw new WorkflowError("Je kunt voor deze ondersteuningsronde geen ondersteuning uitbrengen.");
  }

  await prisma.vote.upsert({
    where: { callingId_stage_userId: { callingId: calling.id, stage, userId: input.userId } },
    update: { support: input.support },
    create: { callingId: calling.id, stage, userId: input.userId, support: input.support },
  });

  return recomputeCallingState(calling.id);
}

/**
 * Herberekent de status van een roeping op basis van de daadwerkelijke
 * reacties (idempotent, veilig na elke wijziging opnieuw uit te voeren). De
 * roeping-rij wordt voor de duur van de transactie vergrendeld, zodat een
 * gelijktijdige wijziging van de deelnemerslijst (nieuw lid, verwijderde
 * deelnemer) nooit tot een ronde kan leiden die op verouderde gegevens wordt
 * afgesloten.
 */
async function recomputeCallingState(callingId: string): Promise<Calling> {
  const { calling, hogeraadVoterIds, justPaused } = await prisma.$transaction(async (tx) => {
    await lockCalling(tx, callingId);
    const calling = await tx.calling.findUniqueOrThrow({ where: { id: callingId } });
    const stage = stageForStatus(calling.status);
    if (!stage) return { calling, hogeraadVoterIds: null as string[] | null, justPaused: false };

    const [eligibleVoters, votes] = await Promise.all([
      tx.eligibleVoter.findMany({ where: { callingId, stage } }),
      tx.vote.findMany({ where: { callingId, stage } }),
    ]);

    const anyNegative = votes.some((v) => !v.support);
    const allVoted = eligibleVoters.length > 0 && eligibleVoters.every((e) => votes.some((v) => v.userId === e.userId));
    const allPositive = allVoted && votes.every((v) => v.support);

    if (anyNegative) {
      const pausedStatus = stage === "PRESIDIUM" ? "PRESIDIUM_PAUSED" : "HOGERAAD_PAUSED";
      const wasAlreadyPaused = calling.status === pausedStatus;
      const updated = await tx.calling.update({ where: { id: callingId }, data: { status: pausedStatus } });
      return { calling: updated, hogeraadVoterIds: null, justPaused: !wasAlreadyPaused };
    }

    if (allPositive) {
      if (stage === "PRESIDIUM") {
        const hogeraadIds = await activeMemberIds(tx, calling.ringId, "HOGERAAD");

        if (hogeraadIds.length === 0) {
          // Niemand om ondersteuning aan te vragen in de hoge raad: er is dan
          // niets om op te wachten, dus de roeping is direct volledig goedgekeurd.
          const updated = await tx.calling.update({
            where: { id: callingId },
            data: { status: "APPROVED", approvedAt: new Date() },
          });
          return { calling: updated, hogeraadVoterIds: null, justPaused: false };
        }

        const now = new Date();
        await tx.eligibleVoter.createMany({
          data: hogeraadIds.map((userId) => ({ callingId, stage: "HOGERAAD" as const, userId, lastInvitedAt: now })),
          skipDuplicates: true,
        });
        const updated = await tx.calling.update({ where: { id: callingId }, data: { status: "HOGERAAD_VOTING" } });
        return { calling: updated, hogeraadVoterIds: hogeraadIds, justPaused: false };
      } else {
        const updated = await tx.calling.update({
          where: { id: callingId },
          data: { status: "APPROVED", approvedAt: new Date() },
        });
        return { calling: updated, hogeraadVoterIds: null, justPaused: false };
      }
    }

    // Niemand heeft aangegeven niet te ondersteunen, maar nog niet iedereen
    // heeft gereageerd: open/hervat.
    const openStatus = stage === "PRESIDIUM" ? "PRESIDIUM_VOTING" : "HOGERAAD_VOTING";
    const updated = await tx.calling.update({ where: { id: callingId }, data: { status: openStatus } });
    return { calling: updated, hogeraadVoterIds: null, justPaused: false };
  });

  // Bewust buiten de transactie: een mislukte melding mag de al opgeslagen
  // statusovergang niet terugdraaien.
  if (justPaused) {
    await notifyPaused(calling);
  }
  if (hogeraadVoterIds) {
    await notifyParticipants(calling, hogeraadVoterIds, { event: "ADVANCED_TO_HOGERAAD" });
  }

  return calling;
}

/** Vraagt een persoon opnieuw om ondersteuning (alleen bij een gepauzeerd voorstel); de eerdere reactie blijft staan tot de persoon hem zelf wijzigt. */
export async function reinviteVoter(input: { callingId: string; userId: string; actorId: string }): Promise<void> {
  const calling = await prisma.calling.findUniqueOrThrow({ where: { id: input.callingId } });
  await requireRingStaff(input.actorId, calling.ringId);

  const stage = stageForStatus(calling.status);
  if (!stage || !calling.status.endsWith("PAUSED")) {
    throw new WorkflowError("Opnieuw ondersteuning vragen is alleen mogelijk voor een gepauzeerd voorstel.");
  }
  const eligible = await prisma.eligibleVoter.findUnique({
    where: { callingId_stage_userId: { callingId: calling.id, stage, userId: input.userId } },
  });
  if (!eligible) {
    throw new WorkflowError("Deze persoon neemt niet deel aan deze ondersteuningsronde.");
  }
  await assertActiveRingMembers(prisma, calling.ringId, [input.userId]);

  await prisma.eligibleVoter.update({ where: { id: eligible.id }, data: { lastInvitedAt: new Date() } });
  await notifyParticipants(calling, [input.userId], { event: "REINVITE" });
}

/**
 * Handmatige herinnering aan personen die nog niet hebben gereageerd. Per
 * persoon wordt atomair "geclaimd" (lastInvitedAt) of er langer dan de
 * wachttijd geleden iets is verstuurd; zo geeft herhaald of gelijktijdig
 * klikken nooit dubbele berichten. Respecteert de notificatievoorkeuren via
 * het centrale notify().
 */
export async function remindParticipants(input: {
  callingId: string;
  actorId: string;
  userId?: string;
}): Promise<{ sent: number; skippedRecent: number }> {
  const calling = await prisma.calling.findUniqueOrThrow({ where: { id: input.callingId } });
  await requireRingStaff(input.actorId, calling.ringId);

  const stage = stageForStatus(calling.status);
  if (!stage) {
    throw new WorkflowError("Voor dit voorstel is geen ondersteuningsronde open.");
  }

  const [eligible, votes] = await Promise.all([
    prisma.eligibleVoter.findMany({ where: { callingId: calling.id, stage } }),
    prisma.vote.findMany({ where: { callingId: calling.id, stage }, select: { userId: true } }),
  ]);
  const responded = new Set(votes.map((v) => v.userId));
  let pending = eligible.filter((e) => !responded.has(e.userId));

  if (input.userId) {
    pending = pending.filter((e) => e.userId === input.userId);
    if (pending.length === 0) {
      throw new WorkflowError("Deze persoon heeft al gereageerd of neemt niet deel aan deze ronde.");
    }
  }

  // Alleen nog actieve deelnemers met de juiste rol (niet-actieve personen
  // ontvangen nooit een herinnering).
  const stillMembers = new Set(
    (
      await prisma.ringMembership.findMany({
        where: { ringId: calling.ringId, role: STAGE_ROLE[stage], active: true, user: { active: true } },
        select: { userId: true },
      })
    ).map((m) => m.userId)
  );
  pending = pending.filter((e) => stillMembers.has(e.userId));

  const cutoff = new Date(Date.now() - REMINDER_COOLDOWN_MS);
  const claimedUserIds: string[] = [];
  let skippedRecent = 0;
  for (const e of pending) {
    const claimed = await prisma.eligibleVoter.updateMany({
      where: { id: e.id, OR: [{ lastInvitedAt: null }, { lastInvitedAt: { lt: cutoff } }] },
      data: { lastInvitedAt: new Date() },
    });
    if (claimed.count === 1) claimedUserIds.push(e.userId);
    else skippedRecent += 1;
  }

  if (claimedUserIds.length > 0) {
    await notifyParticipants(calling, claimedUserIds, { event: "SUPPORT_REMINDER" });
  }
  return { sent: claimedUserIds.length, skippedRecent };
}

/**
 * Voegt een nieuw (of opnieuw geactiveerd/van rol veranderd) ringlid toe aan
 * de nog niet afgeronde ondersteuningsrondes van zijn eigen groep binnen
 * dezelfde ring, en stuurt een persoonlijk ondersteuningsverzoek. Afgeronde
 * rondes worden niet aangeraakt. Bestaande reacties blijven behouden.
 */
export async function addParticipantToRunningRounds(membership: { userId: string; ringId: string; role: Role }): Promise<number> {
  const stage: Stage | null =
    membership.role === STAGE_ROLE.PRESIDIUM ? "PRESIDIUM" : membership.role === STAGE_ROLE.HOGERAAD ? "HOGERAAD" : null;
  if (!stage) return 0;

  const added = await prisma.$transaction(async (tx) => {
    const callings = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Calling"
      WHERE "ringId" = ${membership.ringId} AND "status"::text = ANY(${STAGE_STATUSES[stage] as string[]})
      FOR UPDATE`;

    const addedCallingIds: string[] = [];
    for (const { id } of callings) {
      const existing = await tx.eligibleVoter.findUnique({
        where: { callingId_stage_userId: { callingId: id, stage, userId: membership.userId } },
      });
      if (existing) continue;
      await tx.eligibleVoter.create({
        data: { callingId: id, stage, userId: membership.userId, lastInvitedAt: new Date() },
      });
      addedCallingIds.push(id);
    }
    return addedCallingIds;
  });

  if (added.length === 0) return 0;
  const callings = await prisma.calling.findMany({ where: { id: { in: added } } });
  for (const calling of callings) {
    await notifyParticipants(calling, [membership.userId], {
      event: stage === "PRESIDIUM" ? "NEW_PROPOSAL" : "ADVANCED_TO_HOGERAAD",
    });
  }
  return added.length;
}

/**
 * Verwijdert een deelnemer die niet meer bij de ronde hoort (gedeactiveerd,
 * andere rol) expliciet uit een lopende ronde, inclusief diens eventuele
 * reactie. Dit gebeurt nooit automatisch. Het kan ertoe leiden dat de
 * overige, al positieve reacties de ronde alsnog voltooien — de gebruiker
 * wordt daar in de interface vooraf expliciet over geïnformeerd.
 */
export async function removeParticipantFromRound(input: {
  callingId: string;
  userId: string;
  actorId: string;
}): Promise<Calling> {
  const calling = await prisma.calling.findUniqueOrThrow({ where: { id: input.callingId } });
  await requireRingStaff(input.actorId, calling.ringId);

  const stage = stageForStatus(calling.status);
  if (!stage) throw new WorkflowError("Voor dit voorstel is geen ondersteuningsronde open.");

  await prisma.$transaction(async (tx) => {
    await lockCalling(tx, calling.id);
    const fresh = await tx.calling.findUniqueOrThrow({ where: { id: calling.id } });
    if (stageForStatus(fresh.status) !== stage) {
      throw new WorkflowError("De ondersteuningsronde is intussen gewijzigd of afgerond.");
    }

    const membership = await tx.ringMembership.findUnique({
      where: { userId_ringId: { userId: input.userId, ringId: calling.ringId } },
      include: { user: true },
    });
    const stillInvolved = !!membership && membership.active && membership.user.active && membership.role === STAGE_ROLE[stage];
    if (stillInvolved) {
      throw new WorkflowError("Deze persoon is nog actief betrokken en kan niet uit de ronde worden verwijderd.");
    }

    await tx.vote.deleteMany({ where: { callingId: calling.id, stage, userId: input.userId } });
    await tx.eligibleVoter.deleteMany({ where: { callingId: calling.id, stage, userId: input.userId } });
  });

  return recomputeCallingState(calling.id);
}

/**
 * Verwijdert een nog niet verwerkt roepingsvoorstel definitief, inclusief
 * alle ondersteuningsreacties, deelnemerslijsten, taken en interne meldingen
 * (database-cascade, in één transactie). Gebruikersaccounts en de ring blijven
 * bestaan. Vereist expliciete bevestiging en bevoegdheid binnen de ring.
 */
export async function deleteCalling(input: { callingId: string; actorId: string; confirmed: boolean }): Promise<void> {
  if (!input.confirmed) {
    throw new WorkflowError("Bevestig dat je dit voorstel definitief wilt verwijderen.");
  }
  const calling = await prisma.calling.findUnique({ where: { id: input.callingId } });
  if (!calling) throw new WorkflowError("Dit voorstel bestaat niet (meer).");

  const actor = await prisma.user.findUnique({ where: { id: input.actorId } });
  if (!actor || !actor.active) throw new AuthorizationError();
  if (actor.role !== "ADMIN") {
    await requireRingStaff(input.actorId, calling.ringId);
  }

  await prisma.$transaction(async (tx) => {
    await lockCalling(tx, calling.id);
    const fresh = await tx.calling.findUnique({ where: { id: calling.id } });
    if (!fresh) return;
    if (fresh.status === "PROCESSED" || fresh.processedAt) {
      throw new WorkflowError("Verwerkte voorstellen worden automatisch 30 dagen na verwerking verwijderd.");
    }
    // Cascade verwijdert Vote, EligibleVoter en Notification van dit voorstel.
    await tx.calling.delete({ where: { id: calling.id } });
  });
}

export async function assignTask(input: { callingId: string; task: TaskKey; assigneeId: string | null }): Promise<Calling> {
  const calling = await prisma.calling.findUniqueOrThrow({ where: { id: input.callingId } });
  if (calling.status === "PROCESSED") {
    throw new WorkflowError("Deze roeping is al verwerkt.");
  }
  if (input.assigneeId) {
    await assertActiveRingMembers(prisma, calling.ringId, [input.assigneeId]);
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

  const presidiumByRing = new Map<string, string[]>();

  for (const calling of due) {
    if (!presidiumByRing.has(calling.ringId)) {
      presidiumByRing.set(calling.ringId, await activeMemberIds(prisma, calling.ringId, "RINGPRESIDIUM"));
    }
    await notify({
      userIds: presidiumByRing.get(calling.ringId)!,
      ringId: calling.ringId,
      event: "REMINDER_30_DAYS",
      url: callingPath(calling.id),
      callingId: calling.id,
      buildEmail: async (user) =>
        reminder30Email({
          name: user.name,
          personName: calling.personName,
          functionTitle: calling.functionTitle,
          phaseLabel: phaseLabel(calling),
          link: await createOpenLink(user.id, calling.id),
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
