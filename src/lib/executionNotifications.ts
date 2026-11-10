import { STAFF_ROLES } from "./rbac";
import type { Calling, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { executionIsReleased, taskIsExecutable } from "./callingAccess";
import { notify } from "./notifications";
import { ACTION_PUSH } from "./notificationText";
import { TASK_ASSIGNEE_FIELD, type TaskKey } from "./status";
const TASKS: TaskKey[] = ["ROEPEN", "ONDERSTEUNEN", "AANSTELLEN"];

/** Onder de roepingvergrendeling, in dezelfde transactie als vrijgave/toewijzing. */
export async function queueExecutionNotifications(tx: Prisma.TransactionClient, c: Calling, only?: TaskKey) {
  if (!executionIsReleased(c)) return;
  for (const task of only ? [only] : TASKS) {
    const userId = c[TASK_ASSIGNEE_FIELD[task]];
    if (!userId || !taskIsExecutable(c, task, userId)) continue;
    const previous = await tx.taskNotification.findFirst({ where: { callingId: c.id, task, releaseGeneration: c.executionGeneration }, orderBy: { revision: "desc" } });
    if (previous?.userId === userId && previous.state !== "CANCELLED") continue; // Zelfde toewijzing opslaan / herhaalde vrijgave is geen nieuwe gebeurtenis.
    await tx.taskNotification.create({ data: { callingId: c.id, userId, task, revision: c.executionRevision, releaseGeneration: c.executionGeneration } });
  }
}
async function current(tx: Prisma.TransactionClient, id: string) {
  const delivery = await tx.taskNotification.findUnique({ where: { id } });
  if (!delivery || !TASKS.includes(delivery.task as TaskKey)) return null;
  const c = await tx.calling.findUnique({ where: { id: delivery.callingId } });
  if (!c || c.executionGeneration !== delivery.releaseGeneration || !taskIsExecutable(c, delivery.task as TaskKey, delivery.userId)) return null;
  const member = await tx.ringMembership.findFirst({ where: { ringId: c.ringId, userId: delivery.userId, active: true, user: { active: true }, ring: { active: true } } });
  return member ? { delivery, c } : null;
}
/** Testhaak: pauze tussen duurzaam reserveren en de laatste verzendcontrole. Geen productiegedrag. */
export const executionDeliveryHooks: { beforeSend?: () => Promise<void> } = {};
export async function dispatchExecutionNotification(id: string): Promise<boolean> {
  const row = await prisma.taskNotification.findUnique({ where: { id } });
  if (!row || row.state !== "PENDING") return false;
  const reserved = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Calling" WHERE id=${row.callingId} FOR UPDATE`;
    const state = await current(tx, id);
    if (!state) { await tx.taskNotification.updateMany({ where: { id, state: "PENDING" }, data: { state: "CANCELLED" } }); return false; }
    const claimed = await tx.taskNotification.updateMany({ where: { id, state: "PENDING" }, data: { state: "CLAIMED", claimedAt: new Date() } });
    if (!claimed.count) return false;
    await tx.notification.create({ data: { userId: row.userId, ringId: state.c.ringId, callingId: row.callingId, taskNotificationId: id, type: "TASK_ASSIGNED", title: ACTION_PUSH.title, message: ACTION_PUSH.body, targetUrl: `/roepingen/${row.callingId}` } });
    return true;
  });
  if (!reserved) return false;
  try {
    await executionDeliveryHooks.beforeSend?.();
    // Serialiseert verzending met pauzeren, hertoewijzen, afronden en verwijderen. Een latere blokkade kan een
    // eerdere verzending niet terughalen; een reeds opgeslagen blokkade wordt hier altijd vóór I/O gezien.
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Calling" WHERE id=${row.callingId} FOR UPDATE`;
      const state = await current(tx, id);
      if (!state || state.delivery.state !== "CLAIMED") { await tx.taskNotification.updateMany({ where: { id, state: "CLAIMED" }, data: { state: "CANCELLED" } }); return; }
      await notify({ userIds: [row.userId], ringId: state.c.ringId, event: "TASK_ASSIGNED", url: `/roepingen/${row.callingId}`, callingId: row.callingId, taskDeliveryId: id, email: true });
      await tx.taskNotification.update({ where: { id }, data: { state: "SENT", sentAt: new Date() } });
    }, { timeout: 150000, maxWait: 5000 });
    return true;
  } catch {
    // SMTP/push en PostgreSQL hebben geen gezamenlijke transactie. Bij een onbekende afleverstatus nooit
    // automatisch opnieuw versturen: het duurzame interne bericht blijft beschikbaar, geen dubbele externe melding.
    await prisma.taskNotification.updateMany({ where: { id, state: "CLAIMED" }, data: { state: "UNKNOWN" } });
    console.error("[notify] Externe uitvoeringstaakmelding heeft een onbekende afleverstatus; geen automatische herverzending.");
    return false;
  }
}
export async function dispatchExecutionNotifications(callingId?: string) {
  await prisma.taskNotification.updateMany({ where: { state: "CLAIMED", claimedAt: { lt: new Date(Date.now() - 180000) } }, data: { state: "UNKNOWN" } });
  const pending = await prisma.taskNotification.findMany({ where: { state: "PENDING", ...(callingId ? { callingId } : {}) }, orderBy: { createdAt: "asc" }, take: 50 });
  let attempted = 0;
  for (const row of pending) if (await dispatchExecutionNotification(row.id)) attempted++;
  return attempted;
}

/** Definitief akkoord geeft de bevoegde staf een echte handeling: expliciet vrijgeven voor uitvoering. */
export async function notifyAwaitingExecution(callingId?: string) {
  const callings = await prisma.calling.findMany({ where: { status: "APPROVED", executionReleasedAt: null, ...(callingId ? { id: callingId } : { notifications: { none: { type: "EXECUTION_AWAITING_RELEASE" } } }) }, take: 50 });
  for (const c of callings) {
    const staff = await prisma.ringMembership.findMany({ where: { ringId: c.ringId, active: true, role: { in: STAFF_ROLES }, user: { active: true }, ring: { active: true } }, select: { userId: true } });
    await notify({ userIds: staff.map(s => s.userId), ringId: c.ringId, event: "EXECUTION_AWAITING_RELEASE", callingId: c.id, url: `/roepingen/${c.id}`, email: true, dedupeKey: `execution-ready:${c.id}:${c.executionGeneration}` });
  }
}
