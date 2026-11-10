import type { Calling, Prisma, Role } from "@prisma/client";
import { STAFF_ROLES } from "./rbac";
import { TASK_ASSIGNEE_FIELD, type TaskKey } from "./status";
export type ExecutionCalling = Pick<Calling, "status" | "executionReleasedAt" | "roepenAssigneeId" | "ondersteunenAssigneeId" | "aanstellenAssigneeId">;
export function executionIsReleased(c: Pick<Calling, "status" | "executionReleasedAt">): boolean {
  return c.status === "APPROVED" && !!c.executionReleasedAt;
}
export function isReleasedAssignee(c: ExecutionCalling, userId: string): boolean {
  return executionIsReleased(c) && Object.values(TASK_ASSIGNEE_FIELD).some(field => c[field] === userId);
}
export function canSeeCalling(c: ExecutionCalling, role: Role, userId: string, participant: boolean): boolean {
  return STAFF_ROLES.includes(role) || participant || isReleasedAssignee(c, userId);
}
export function assignedCallingWhere(userId: string): Prisma.CallingWhereInput {
  return { status: "APPROVED", executionReleasedAt: { not: null }, OR: Object.values(TASK_ASSIGNEE_FIELD).map(field => ({ [field]: userId })) };
}
export function participantCallingWhere(userId: string): Prisma.CallingWhereInput {
  return { OR: [{ eligibleVoters: { some: { userId } } }, assignedCallingWhere(userId)] };
}
export function taskIsExecutable(c: Calling, task: TaskKey, userId: string): boolean {
  const prefix = task.toLowerCase() as "roepen" | "ondersteunen" | "aanstellen";
  return executionIsReleased(c) && c[TASK_ASSIGNEE_FIELD[task]] === userId && !c[`${prefix}DoneAt`];
}
