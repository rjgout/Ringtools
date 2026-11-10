import type { NotificationType, Prisma, User } from "@prisma/client";
import { prisma } from "./prisma";
import { sendMail } from "./mailer";
import { sendPushToUsers } from "./push";
import { STAFF_ROLES, STAGE_ROLE } from "./rbac";
import { canSeeCalling, executionIsReleased, participantCallingWhere, taskIsExecutable } from "./callingAccess";
import { ACTION_PUSH, functionalActionEmail } from "./notificationText";
import type { TaskKey } from "./status";
export type NotificationEvent = NotificationType;
/** Alleen broncompatibiliteit: callbacks worden nooit uitgevoerd of als externe inhoud gebruikt. */
export type EmailBuilder = (user: User) => { subject: string; text: string } | Promise<{ subject: string; text: string }>;
type Input = { userIds: string[]; ringId: string; event: NotificationEvent; url: string; callingId?: string; ontheffingId?: string; email?: boolean; buildEmail?: EmailBuilder; skipExisting?: boolean; taskDeliveryId?: string; dedupeKey?: string };

/** Actuele autorisatie bepaalt tevens zichtbaarheid van reeds bestaande meldingen, niet alleen nieuwe verzendingen. */
export async function notificationVisibilityWhere(userId: string, ringId?: string): Promise<Prisma.NotificationWhereInput> {
  const memberships = await prisma.ringMembership.findMany({ where: { userId, active: true, ...(ringId ? { ringId } : {}), user: { active: true }, ring: { active: true } } });
  const { visibleWhere } = await import("./ontheffingen");
  return { userId, AND: [
    { OR: memberships.map(m => ({ ringId: m.ringId, OR: [
      { callingId: null, ontheffingId: null },
      { calling: { is: { ringId: m.ringId, ...(STAFF_ROLES.includes(m.role) ? {} : participantCallingWhere(userId)) } } },
      { ontheffing: { is: visibleWhere(userId, m.ringId, m.role) } },
    ] })) },
    { OR: [
      { type: { notIn: ["TASK_ASSIGNED", "TASK_COMPLETED"] } },
      { type: "TASK_COMPLETED", calling: { is: { status: "APPROVED", executionReleasedAt: { not: null } } } },
      { type: "TASK_ASSIGNED", taskNotification: { is: { userId, state: { in: ["CLAIMED", "SENT", "UNKNOWN"] } } }, calling: { is: { status: "APPROVED", executionReleasedAt: { not: null }, OR: [{ roepenAssigneeId: userId }, { ondersteunenAssigneeId: userId }, { aanstellenAssigneeId: userId }] } } },
    ] },
  ] };
}

/** Hercontrole voor elk kanaal en iedere retry. Externe inhoud wordt uitsluitend hier bepaald. */
export async function notify(params: Input): Promise<void> {
  const { ringId, event, callingId, ontheffingId } = params;
  if (callingId && ontheffingId) return;
  const ring = await prisma.ring.findFirst({ where: { id: ringId, active: true } });
  if (!ring || !params.userIds.length) return;
  let users = await prisma.user.findMany({ where: { id: { in: [...new Set(params.userIds)] }, active: true, memberships: { some: { ringId, active: true } } }, include: { memberships: { where: { ringId, active: true } } } });
  let url = "/dashboard";
  if (callingId) {
    const calling = await prisma.calling.findUnique({ where: { id: callingId }, include: { eligibleVoters: true, votes: true } });
    if (!calling || calling.ringId !== ringId) return;
    url = `/roepingen/${encodeURIComponent(calling.id)}`;
    if (event === "TASK_ASSIGNED") {
      if (!params.taskDeliveryId || !executionIsReleased(calling)) return;
      const delivery = await prisma.taskNotification.findUnique({ where: { id: params.taskDeliveryId }, include: { notification: true } });
      if (!delivery || delivery.state !== "CLAIMED" || !delivery.notification || delivery.callingId !== callingId || delivery.releaseGeneration !== calling.executionGeneration || !["ROEPEN", "ONDERSTEUNEN", "AANSTELLEN"].includes(delivery.task)) return;
      users = users.filter(u => u.id === delivery.userId && taskIsExecutable(calling, delivery.task as TaskKey, u.id));
    } else if (["NEW_PROPOSAL", "ADVANCED_TO_HOGERAAD", "REINVITE", "SUPPORT_REMINDER"].includes(event)) {
      const stage = calling.status === "PRESIDIUM_VOTING" || calling.status === "PRESIDIUM_PAUSED" ? "PRESIDIUM" : calling.status === "HOGERAAD_VOTING" || calling.status === "HOGERAAD_PAUSED" ? "HOGERAAD" : null;
      if (!stage || event === "NEW_PROPOSAL" && stage !== "PRESIDIUM" || event === "ADVANCED_TO_HOGERAAD" && stage !== "HOGERAAD") return;
      users = users.filter(u => u.memberships[0]?.role === STAGE_ROLE[stage] && calling.eligibleVoters.some(v => v.userId === u.id && v.stage === stage));
    } else {
      if (event === "EXECUTION_AWAITING_RELEASE" && (calling.status !== "APPROVED" || calling.executionReleasedAt)) return;
      if (event === "EXECUTION_AWAITING_RELEASE") users = users.filter(u => STAFF_ROLES.includes(u.memberships[0].role));
      if (event === "AWAITING_RELEASE" && calling.status !== "PRESIDIUM_APPROVED") return;
      if (event === "PAUSED" && !["PRESIDIUM_PAUSED", "HOGERAAD_PAUSED"].includes(calling.status)) return;
      if (event === "TASK_COMPLETED" && !executionIsReleased(calling)) return;
      if (event === "REMINDER_30_DAYS" && calling.status === "PROCESSED") return;
      users = users.filter(u => canSeeCalling(calling, u.memberships[0].role, u.id, calling.eligibleVoters.some(v => v.userId === u.id)));
    }
  } else if (event === "TASK_ASSIGNED" || event === "TASK_COMPLETED") return;
  if (ontheffingId) {
    const { visibleWhere } = await import("./ontheffingen");
    const permitted = await Promise.all(users.map(async u => (await prisma.ontheffing.count({ where: { id: ontheffingId, ...visibleWhere(u.id, ringId, u.memberships[0].role) } })) ? u.id : null));
    users = users.filter(u => permitted.includes(u.id));
    url = `/ontheffingen/${encodeURIComponent(ontheffingId)}`;
  }
  if (params.skipExisting && (callingId || ontheffingId)) {
    const existing = await prisma.notification.findMany({ where: { ...(ontheffingId ? { ontheffingId } : { callingId }), type: event, userId: { in: users.map(u => u.id) } }, select: { userId: true } });
    users = users.filter(u => !existing.some(n => n.userId === u.id));
  }
  if (!users.length) return;
  if (!params.taskDeliveryId) {
    const inserted = await prisma.notification.createManyAndReturn({ skipDuplicates: true, select: { userId: true }, data: users.map(u => ({ userId: u.id, ringId, type: event, title: ACTION_PUSH.title, message: ACTION_PUSH.body, targetUrl: url, callingId: callingId ?? null, ontheffingId: ontheffingId ?? null, deliveryKey: params.dedupeKey ? `${params.dedupeKey}:${u.id}` : null })) });
    users = users.filter(u => inserted.some(n => n.userId === u.id));
  }
  if (!users.length) return;
  if (ring.isDemo) return;
  await sendPushToUsers(users.map(u => u.id), { ...ACTION_PUSH, url, tag: "ringtools-action" });
  // Vertrouwelijke ontheffingen behouden hun bestaande verbod op e-mail.
  if (!ontheffingId && !event.startsWith("CONFIDENTIAL_") && (params.email || params.buildEmail)) for (const user of users) {
    if (!user.emailNotificationsEnabled) continue;
    try { await sendMail({ to: user.email, ...functionalActionEmail() }); }
    catch {
      if (params.taskDeliveryId) throw new Error("external-delivery-uncertain");
      console.error("[notify] Functionele e-mail niet bevestigd.");
    }
  }
}
