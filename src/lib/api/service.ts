import type { Calling, OndersteuningContext, Role } from "@prisma/client";
import { prisma } from "../prisma";
import { isStaff, canVotePresidium, canVoteHogeraad } from "../rbac";
import {
  getStaffDashboardCounts,
  listAttentionCallingsForStaff,
  listCallings as listRingCallings,
  getCallingDetail,
  getStillInvolvedUserIds,
  getPendingActionCount,
  listActiveUsers,
  type CallingFilter,
} from "../queries";
import { isReadyToProcess, phaseLabel, TASK_ASSIGNEE_FIELD, type TaskKey } from "../status";
import {
  createCalling,
  castVote,
  reinviteVoter,
  remindParticipants,
  removeParticipantFromRound,
  deleteCalling,
  assignTask,
  completeTask,
  markProcessed,
  releaseToHogeraad,
  registerGroupDecision,
  TASK_LABELS,
  WorkflowError,
  AuthorizationError,
} from "../workflow";
import { createCallingSchema } from "../validation";
import { ApiError } from "./http";
import { hashToken } from "../crypto";
import { listSessionsForUser, destroySessionById } from "../auth";

/** Vertaalt domeinfouten naar nette API-fouten; onbekende fouten blijven een 500. */
export async function mapErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthorizationError) throw new ApiError(403, "Je hebt hiervoor geen bevoegdheid.", "forbidden");
    if (err instanceof WorkflowError) throw new ApiError(400, err.message, "workflow");
    throw err;
  }
}

export async function requireMembership(userId: string, ringId: string) {
  const membership = ringId
    ? await prisma.ringMembership.findFirst({ where: { userId, ringId, active: true, user: { active: true }, ring: { active: true } }, include: { ring: true } })
    : null;
  if (!membership) throw new ApiError(404, "Niet gevonden.", "not-found");
  return membership;
}

export type CallingListItem = {
  id: string;
  ringId: string;
  personName: string;
  functionTitle: string;
  status: Calling["status"];
  phase: string;
  createdAt: string;
  needsMyResponse: boolean;
};

function toItem(c: Calling, needsMyResponse = false): CallingListItem {
  return {
    id: c.id,
    ringId: c.ringId,
    personName: c.personName,
    functionTitle: c.functionTitle,
    status: c.status,
    phase: phaseLabel(c),
    createdAt: c.createdAt.toISOString(),
    needsMyResponse,
  };
}

// ---- Profiel ----

export async function getMe(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const memberships = await prisma.ringMembership.findMany({
    where: { userId, active: true, ring: { active: true } },
    include: { ring: true },
    orderBy: { createdAt: "asc" },
  });
  return {
    user: { id: user.id, name: user.name, email: user.email, emailNotificationsEnabled: user.emailNotificationsEnabled, mfaEnabled: user.mfaEnabled },
    rings: memberships.map((m) => ({
      id: m.ringId,
      name: m.ring.name,
      role: m.role,
      churchFunction: m.churchFunction,
      isRingManager: m.isRingManager,
    })),
    pendingCount: await getPendingActionCount(userId),
  };
}

// ---- Overzichten ----

/** Voorstellen waarvoor deze gebruiker nog moet reageren (alleen in een lopende, niet-gepauzeerde ronde). */
async function pendingSupport(userId: string, ringId: string): Promise<CallingListItem[]> {
  const eligible = await prisma.eligibleVoter.findMany({
    where: { userId, calling: { ringId, status: { in: ["PRESIDIUM_VOTING", "PRESIDIUM_PAUSED", "HOGERAAD_VOTING", "HOGERAAD_PAUSED"] } } },
    include: { calling: true },
  });
  const votes = await prisma.vote.findMany({ where: { userId, calling: { ringId } } });
  const voted = new Set(votes.map((v) => `${v.callingId}:${v.stage}`));
  return eligible
    .filter((e) => {
      const active =
        (e.stage === "PRESIDIUM" && e.calling.status.startsWith("PRESIDIUM")) ||
        (e.stage === "HOGERAAD" && e.calling.status.startsWith("HOGERAAD"));
      return active && !voted.has(`${e.callingId}:${e.stage}`);
    })
    .map((e) => toItem(e.calling, true));
}

export async function getDashboard(userId: string, ringId: string) {
  const membership = await requireMembership(userId, ringId);
  const staff = isStaff(membership.role);

  const [support, counts, attention, tasks] = await Promise.all([
    pendingSupport(userId, ringId),
    staff ? getStaffDashboardCounts(ringId) : Promise.resolve(null),
    staff ? listAttentionCallingsForStaff(ringId) : Promise.resolve([] as Calling[]),
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

  return {
    ring: { id: membership.ringId, name: membership.ring.name },
    role: membership.role,
    isStaff: staff,
    counts,
    attention: attention.map((c) => toItem(c)),
    pendingSupport: support,
    myTasks: tasks.map((c) => {
      const open: string[] = [];
      for (const task of ["ROEPEN", "ONDERSTEUNEN", "AANSTELLEN"] as TaskKey[]) {
        const doneField = `${task.toLowerCase()}DoneAt` as "roepenDoneAt" | "ondersteunenDoneAt" | "aanstellenDoneAt";
        if (c[TASK_ASSIGNEE_FIELD[task]] === userId && !c[doneField]) open.push(TASK_LABELS[task]);
      }
      return { ...toItem(c), tasks: open };
    }),
  };
}

const FILTERS: CallingFilter[] = ["alle", "presidium", "hogeraad", "gepauzeerd", "goedgekeurd", "roepen", "ondersteunen", "aanstellen", "verwerken"];

export async function listCallingsFor(userId: string, ringId: string, filterRaw: string) {
  const membership = await requireMembership(userId, ringId);
  const filter = (FILTERS as string[]).includes(filterRaw) ? (filterRaw as CallingFilter) : "alle";

  if (isStaff(membership.role)) {
    return (await listRingCallings(ringId, filter)).map((c) => toItem(c));
  }
  // Niet-staf ziet alleen voorstellen waaraan hij deelneemt of waarvoor hij een taak heeft.
  const [mine, support] = await Promise.all([
    prisma.calling.findMany({
      where: {
        ringId,
        status: { not: "PROCESSED" },
        OR: [
          { eligibleVoters: { some: { userId } } },
          { roepenAssigneeId: userId },
          { ondersteunenAssigneeId: userId },
          { aanstellenAssigneeId: userId },
        ],
      },
      orderBy: { createdAt: "desc" },
    }),
    pendingSupport(userId, ringId),
  ]);
  const needs = new Set(support.map((s) => s.id));
  return mine.map((c) => toItem(c, needs.has(c.id)));
}

// ---- Detail ----

type Participant = { userId: string; name: string; support: boolean | null; lastInvitedAt: string; stillInvolved: boolean };

export async function getCallingView(userId: string, callingId: string) {
  const calling = await getCallingDetail(callingId);
  // Zelfde antwoord voor "bestaat niet" en "geen lid van de ring": niets lekken.
  if (!calling) throw new ApiError(404, "Niet gevonden.", "not-found");
  const membership = await prisma.ringMembership.findFirst({ where: { userId, ringId: calling.ringId, active: true, ring: { active: true } } });
  if (!membership) throw new ApiError(404, "Niet gevonden.", "not-found");

  const staff = isStaff(membership.role);
  const presidiumEligible = calling.eligibleVoters.filter((e) => e.stage === "PRESIDIUM");
  const hogeraadEligible = calling.eligibleVoters.filter((e) => e.stage === "HOGERAAD");
  const isParticipant = calling.eligibleVoters.some((e) => e.userId === userId);
  const isAssignee = (Object.values(TASK_ASSIGNEE_FIELD) as (keyof typeof calling)[]).some((f) => calling[f] === userId);
  if (!staff && !isParticipant && !isAssignee) throw new ApiError(403, "Je hebt geen toegang tot dit voorstel.", "forbidden");

  const [presidiumInvolved, hogeraadInvolved, assignable] = await Promise.all([
    getStillInvolvedUserIds(calling.ringId, "PRESIDIUM"),
    getStillInvolvedUserIds(calling.ringId, "HOGERAAD"),
    staff ? listActiveUsers(calling.ringId) : Promise.resolve([]),
  ]);

  const stageStatus = (stage: "PRESIDIUM" | "HOGERAAD") => {
    const prefix = stage;
    if (calling.status === `${prefix}_VOTING`) return "open" as const;
    if (calling.status === `${prefix}_PAUSED`) return "paused" as const;
    if (stage === "PRESIDIUM" && (calling.status === "PRESIDIUM_APPROVED" || calling.status.startsWith("HOGERAAD") || calling.status === "APPROVED" || calling.status === "PROCESSED")) return "done" as const;
    if (stage === "HOGERAAD" && (calling.status === "APPROVED" || calling.status === "PROCESSED")) return "done" as const;
    return "upcoming" as const;
  };

  function round(stage: "PRESIDIUM" | "HOGERAAD", eligible: typeof presidiumEligible, involved: Set<string>) {
    if (eligible.length === 0) return null;
    const votes = calling!.votes.filter((v) => v.stage === stage);
    const byUser = new Map(votes.map((v) => [v.userId, v]));
    const all: Participant[] = eligible.map((e) => ({
      userId: e.userId,
      name: e.user.name,
      support: byUser.get(e.userId)?.support ?? null,
      lastInvitedAt: e.lastInvitedAt?.toISOString() ?? e.createdAt.toISOString(),
      stillInvolved: involved.has(e.userId),
    }));
    const state = stageStatus(stage);
    const roleOk = stage === "PRESIDIUM" ? canVotePresidium(membership!.role) : canVoteHogeraad(membership!.role);
    const mine = all.find((p) => p.userId === userId);
    // Staf ziet de volledige uitslag; een deelnemer alleen de eigen reactie.
    if (!staff && !mine) return null;
    return {
      stage,
      title: stage === "PRESIDIUM" ? "Ondersteuningsronde ringpresidium" : "Ondersteuningsronde hoge raad",
      state,
      participants: staff ? all : mine ? [mine] : [],
      canRespond: roleOk && !!mine && (state === "open" || state === "paused") && mine.stillInvolved,
      myResponse: mine ? mine.support : null,
    };
  }

  const tasksVisible = staff || isAssignee;
  const tasks = tasksVisible
    ? (["ROEPEN", "ONDERSTEUNEN", "AANSTELLEN"] as TaskKey[]).map((task) => {
        const lower = task.toLowerCase() as "roepen" | "ondersteunen" | "aanstellen";
        const assigneeId = calling[`${lower}AssigneeId` as const];
        const assignee = calling[`${lower}Assignee` as const];
        const doneBy = calling[`${lower}DoneBy` as const];
        const doneAt = calling[`${lower}DoneAt` as const];
        return {
          task,
          label: TASK_LABELS[task],
          assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
          doneAt: doneAt?.toISOString() ?? null,
          doneBy: doneBy?.name ?? null,
          ondersteunenContext: task === "ONDERSTEUNEN" ? calling.ondersteunenContext : null,
          canAssign: staff && calling.status !== "PROCESSED",
          canComplete: calling.status === "APPROVED" && (staff || assigneeId === userId),
        };
      })
    : [];

  return {
    id: calling.id,
    ring: { id: calling.ring.id, name: calling.ring.name },
    personName: calling.personName,
    functionTitle: calling.functionTitle,
    status: calling.status,
    phase: phaseLabel(calling),
    createdAt: calling.createdAt.toISOString(),
    createdBy: calling.createdBy.name,
    processedAt: calling.processedAt?.toISOString() ?? null,
    me: { role: membership.role as Role, isStaff: staff },
    rounds: [round("PRESIDIUM", presidiumEligible, presidiumInvolved), round("HOGERAAD", hogeraadEligible, hogeraadInvolved)].filter(Boolean),
    tasks,
    readyToProcess: staff && isReadyToProcess(calling),
    canDelete: staff && calling.status !== "PROCESSED" && !calling.processedAt,
    assignableUsers: assignable.map((u) => ({ id: u.id, name: u.name, role: u.role })),
    awaitingRelease: calling.status === "PRESIDIUM_APPROVED",
    canRelease: staff && calling.status === "PRESIDIUM_APPROVED",
    groupDecisions: staff ? await groupDecisionViews(calling.id) : [],
    canRegisterGroupDecision: {
      PRESIDIUM: staff && (calling.status === "PRESIDIUM_VOTING" || calling.status === "PRESIDIUM_PAUSED") && !(await hasGroupDecision(calling.id, "PRESIDIUM")),
      HOGERAAD: staff && (calling.status === "HOGERAAD_VOTING" || calling.status === "HOGERAAD_PAUSED") && !(await hasGroupDecision(calling.id, "HOGERAAD")),
    },
  };
}

async function hasGroupDecision(callingId: string, stage: "PRESIDIUM" | "HOGERAAD") {
  return (await prisma.groupDecision.count({ where: { callingId, stage } })) > 0;
}

async function groupDecisionViews(callingId: string) {
  const rows = await prisma.groupDecision.findMany({ where: { callingId }, include: { registeredBy: true, presidingUser: true }, orderBy: { registeredAt: "asc" } });
  const ids = [...new Set(rows.flatMap((r) => [...r.presentUserIds, ...r.absentUserIds]))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    stage: r.stage,
    decidedOn: r.decidedOn.toISOString().slice(0, 10),
    registeredBy: r.registeredBy.name,
    registeredAt: r.registeredAt.toISOString(),
    note: r.note,
    presiding: r.presidingUser?.name ?? null,
    present: r.presentUserIds.map((id) => name.get(id) ?? "Onbekend"),
    absent: r.absentUserIds.map((id) => name.get(id) ?? "Onbekend"),
    overrodeNegativeVotes: r.overrodeNegativeVotes,
    resolutionNote: r.resolutionNote,
  }));
}

/** Actieve leden van de eigen ring, voor het kiezen van verantwoordelijken. Alleen voor staf; strikt per ring. */
export async function listRingMembersFor(userId: string, ringId: string) {
  const membership = await requireMembership(userId, ringId);
  if (!isStaff(membership.role)) throw new ApiError(403, "Je hebt hiervoor geen bevoegdheid.", "forbidden");
  const members = await prisma.ringMembership.findMany({
    where: { ringId, active: true, user: { active: true } },
    include: { user: true },
    orderBy: { user: { name: "asc" } },
  });
  return { members: members.map((m) => ({ id: m.userId, name: m.user.name, role: m.role as Role, churchFunction: m.churchFunction })) };
}

// ---- Acties (autorisatie zit in de lib; hier alleen toegang en vertaling) ----

async function staffForCalling(userId: string, callingId: string) {
  const calling = await prisma.calling.findUnique({ where: { id: callingId } });
  if (!calling) throw new ApiError(404, "Niet gevonden.", "not-found");
  const membership = await prisma.ringMembership.findFirst({ where: { userId, ringId: calling.ringId, active: true, ring: { active: true } } });
  if (!membership) throw new ApiError(404, "Niet gevonden.", "not-found");
  if (!isStaff(membership.role)) throw new ApiError(403, "Je hebt hiervoor geen bevoegdheid.", "forbidden");
  return { calling, membership };
}

export async function createCallingFor(userId: string, ringId: string, body: Record<string, unknown>) {
  const membership = await requireMembership(userId, ringId);
  if (!isStaff(membership.role)) throw new ApiError(403, "Je hebt hiervoor geen bevoegdheid.", "forbidden");
  const parsed = createCallingSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message || "Controleer de ingevulde gegevens.", "validation");
  const calling = await mapErrors(() => createCalling({ ...parsed.data, ringId, createdById: userId }));
  return { id: calling.id };
}

export async function castVoteFor(userId: string, callingId: string, support: boolean) {
  await mapErrors(() => castVote({ callingId, userId, support }));
  return { ok: true };
}

export async function remindFor(userId: string, callingId: string, targetUserId?: string) {
  await staffForCalling(userId, callingId);
  return mapErrors(() => remindParticipants({ callingId, actorId: userId, userId: targetUserId || undefined }));
}

export async function reinviteFor(userId: string, callingId: string, targetUserId: string) {
  await staffForCalling(userId, callingId);
  await mapErrors(() => reinviteVoter({ callingId, userId: targetUserId, actorId: userId }));
  return { ok: true };
}

export async function removeParticipantFor(userId: string, callingId: string, targetUserId: string) {
  await staffForCalling(userId, callingId);
  await mapErrors(() => removeParticipantFromRound({ callingId, userId: targetUserId, actorId: userId }));
  return { ok: true };
}

export async function deleteCallingFor(userId: string, callingId: string, confirmed: boolean) {
  await staffForCalling(userId, callingId);
  await mapErrors(() => deleteCalling({ callingId, actorId: userId, confirmed }));
  return { ok: true };
}

function parseTask(raw: string): TaskKey {
  const task = raw.toUpperCase();
  if (task !== "ROEPEN" && task !== "ONDERSTEUNEN" && task !== "AANSTELLEN") throw new ApiError(400, "Onbekende taak.", "validation");
  return task;
}

export async function assignTaskFor(userId: string, callingId: string, taskRaw: string, assigneeId: string | null) {
  await staffForCalling(userId, callingId);
  await mapErrors(() => assignTask({ callingId, task: parseTask(taskRaw), assigneeId }));
  return { ok: true };
}

export async function completeTaskFor(userId: string, callingId: string, taskRaw: string, body: Record<string, unknown>) {
  const task = parseTask(taskRaw);
  const calling = await prisma.calling.findUnique({ where: { id: callingId } });
  if (!calling) throw new ApiError(404, "Niet gevonden.", "not-found");
  const membership = await prisma.ringMembership.findFirst({ where: { userId, ringId: calling.ringId, active: true, ring: { active: true } } });
  if (!membership) throw new ApiError(404, "Niet gevonden.", "not-found");
  // Staf registreert elke taak; anderen alleen de aan henzelf toegewezen taak.
  if (!isStaff(membership.role) && calling[TASK_ASSIGNEE_FIELD[task]] !== userId) {
    throw new ApiError(403, "Je hebt hiervoor geen bevoegdheid.", "forbidden");
  }
  const doneAt = typeof body.doneAt === "string" && !Number.isNaN(Date.parse(body.doneAt)) ? new Date(body.doneAt) : new Date();
  const ctx = body.ondersteunenContext;
  const ondersteunenContext = ctx === "AVONDMAALSVERGADERING" || ctx === "RINGCONFERENTIE" ? (ctx as OndersteuningContext) : undefined;
  await mapErrors(() => completeTask({ callingId, task, doneById: userId, doneAt, ondersteunenContext }));
  return { ok: true };
}

export async function releaseFor(userId: string, callingId: string) {
  await staffForCalling(userId, callingId);
  const result = await mapErrors(() => releaseToHogeraad({ callingId, actorId: userId }));
  return { ok: true, released: result.released, alreadyReleased: result.alreadyReleased };
}

export async function groupDecisionFor(userId: string, callingId: string, body: Record<string, unknown>) {
  await staffForCalling(userId, callingId);
  const stage = body.stage === "PRESIDIUM" || body.stage === "HOGERAAD" ? body.stage : null;
  if (!stage) throw new ApiError(400, "Geef aan voor welke fase het besluit geldt.", "validation");
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const result = await mapErrors(() =>
    registerGroupDecision({
      callingId,
      actorId: userId,
      stage,
      decidedOn: typeof body.decidedOn === "string" ? body.decidedOn : "",
      agreed: body.agreed === true,
      note: typeof body.note === "string" ? body.note : undefined,
      presidingUserId: typeof body.presidingUserId === "string" ? body.presidingUserId : undefined,
      presentUserIds: list(body.presentUserIds),
      absentUserIds: list(body.absentUserIds),
      resolveNegative: body.resolveNegative === true,
      resolutionNote: typeof body.resolutionNote === "string" ? body.resolutionNote : undefined,
    })
  );
  // Optioneel direct vrijgeven na een gezamenlijk presidiumakkoord (dezelfde expliciete, geautoriseerde handeling).
  if (stage === "PRESIDIUM" && body.releaseNow === true) await mapErrors(() => releaseToHogeraad({ callingId, actorId: userId }));
  return { ok: true, alreadyRegistered: result.alreadyRegistered };
}

export async function markProcessedFor(userId: string, callingId: string) {
  await staffForCalling(userId, callingId);
  await mapErrors(() => markProcessed({ callingId, processedById: userId }));
  return { ok: true };
}

// ---- Meldingen en apparaten ----

export async function listNotificationsFor(userId: string, ringId: string) {
  await requireMembership(userId, ringId);
  const where = { userId, ringId };
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
  ]);
  return {
    unreadCount,
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      callingId: n.callingId,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
  };
}

export async function markNotificationsRead(userId: string, ringId: string, id: string | null) {
  await requireMembership(userId, ringId);
  // Altijd begrensd op de eigen meldingen in deze ring.
  await prisma.notification.updateMany({
    where: { userId, ringId, readAt: null, ...(id ? { id } : {}) },
    data: { readAt: new Date() },
  });
  return { ok: true };
}

/** APNs-tokens zijn hex, FCM-tokens bevatten letters, cijfers en : _ - . Lengte ruim begrensd. */
const DEVICE_TOKEN = /^[A-Za-z0-9_:.\-=]{20,4096}$/;
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export async function registerDevice(userId: string, token: string, platform: string, deviceId?: string) {
  if (!DEVICE_TOKEN.test(token) || (platform !== "ios" && platform !== "android")) {
    throw new ApiError(400, "Ongeldig apparaattoken.", "validation");
  }
  if (deviceId && !DEVICE_ID.test(deviceId)) throw new ApiError(400, "Ongeldig apparaat-ID.", "validation");
  const provider = platform === "ios" ? "apns" : "fcm";
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Tokenrotatie: een nieuw token voor dezelfde installatie vervangt het oude.
    if (deviceId) await tx.devicePushToken.deleteMany({ where: { userId, deviceId, NOT: { token } } });
    // Een token hoort bij één gebruiker: bij overname door een andere gebruiker op hetzelfde apparaat verhuist het.
    await tx.devicePushToken.upsert({
      where: { token },
      update: { userId, platform, provider, deviceId: deviceId ?? null, active: true, lastSeenAt: now },
      create: { userId, token, platform, provider, deviceId: deviceId ?? null, lastSeenAt: now },
    });
  });
  return { ok: true };
}

export async function listDevices(userId: string) {
  const rows = await prisma.devicePushToken.findMany({ where: { userId }, orderBy: { lastSeenAt: "desc" } });
  return { devices: rows.map((d) => ({ id: d.id, platform: d.platform, active: d.active, lastSeenAt: d.lastSeenAt.toISOString() })) };
}

export async function setDeviceActive(userId: string, id: string, active: boolean) {
  const result = await prisma.devicePushToken.updateMany({ where: { id, userId }, data: { active } });
  if (result.count === 0) throw new ApiError(404, "Apparaat niet gevonden.", "not-found");
  return { ok: true };
}

export async function unregisterDeviceToken(token: string) {
  if (DEVICE_TOKEN.test(token)) await prisma.devicePushToken.deleteMany({ where: { token } });
  return { ok: true };
}

export async function unregisterDevice(userId: string, token: string) {
  await prisma.devicePushToken.deleteMany({ where: { userId, token } });
  return { ok: true };
}

export async function listMySessions(userId: string, currentToken: string) {
  const currentHash = hashToken(currentToken);
  const sessions = await listSessionsForUser(userId);
  return {
    sessions: sessions.map((s) => ({
      id: s.id,
      device: s.userAgent ?? "Onbekend apparaat",
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      current: s.tokenHash === currentHash,
    })),
  };
}

export async function revokeMySession(userId: string, sessionId: string) {
  await destroySessionById(userId, sessionId);
  return { ok: true };
}
