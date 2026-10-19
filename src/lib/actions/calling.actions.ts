"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { requireRingRole, getActiveMembership } from "@/lib/ringContext";
import { STAFF_ROLES } from "@/lib/rbac";
import { createCallingSchema } from "@/lib/validation";
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
  WorkflowError,
  AuthorizationError,
} from "@/lib/workflow";
import { prisma } from "@/lib/prisma";
import type { OndersteuningContext } from "@prisma/client";
import { TASK_ASSIGNEE_FIELD, type TaskKey } from "@/lib/status";

export type ActionResult = { ok: boolean; message: string };

/** Leest het voorstel en eist een staflid (presidium/secretaris/administrateur) van de ring van dat voorstel. */
async function requireStaffForCalling(callingId: string) {
  const user = await requireUser();
  const calling = await prisma.calling.findUnique({ where: { id: callingId } });
  if (!calling || user.role === "ADMIN") redirect("/geen-toegang");
  const membership = await getActiveMembership(user.id, calling.ringId);
  if (!membership || !STAFF_ROLES.includes(membership.role)) redirect("/geen-toegang");
  return { user, calling, membership };
}

function backToCalling(callingId: string, query = ""): never {
  revalidatePath(`/roepingen/${callingId}`);
  revalidatePath("/dashboard");
  redirect(`/roepingen/${callingId}${query}`);
}

export async function createCallingAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireRingRole(STAFF_ROLES);

  const parsed = createCallingSchema.safeParse({
    personName: formData.get("personName"),
    functionTitle: formData.get("functionTitle"),
    roepenAssigneeId: formData.get("roepenAssigneeId") || undefined,
    ondersteunenAssigneeId: formData.get("ondersteunenAssigneeId") || undefined,
    aanstellenAssigneeId: formData.get("aanstellenAssigneeId") || undefined,
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message || "Controleer de ingevulde gegevens." };
  }

  let callingId: string;
  try {
    const calling = await createCalling({ ...parsed.data, ringId: ctx.ring.id, createdById: ctx.user.id });
    callingId = calling.id;
  } catch (err) {
    if (err instanceof WorkflowError) return { ok: false, message: err.message };
    throw err;
  }
  revalidatePath("/dashboard");
  redirect(`/roepingen/${callingId}`);
}

/** Brengt ondersteuning uit (of wijzigt een eerdere reactie). De lib controleert deelname, lidmaatschap en rol. */
export async function castVoteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (user.role === "ADMIN") redirect("/geen-toegang");
  const callingId = String(formData.get("callingId"));
  const support = formData.get("support") === "true";

  try {
    await castVote({ callingId, userId: user.id, support });
  } catch (err) {
    if (!(err instanceof WorkflowError)) throw err;
  }
  backToCalling(callingId);
}

/** "Opnieuw ondersteuning vragen" bij een gepauzeerd voorstel. */
export async function reinviteAction(formData: FormData): Promise<void> {
  const callingId = String(formData.get("callingId"));
  const userId = String(formData.get("userId"));
  const { user } = await requireStaffForCalling(callingId);

  let query = "?melding=opnieuw-gevraagd";
  try {
    await reinviteVoter({ callingId, userId, actorId: user.id });
  } catch (err) {
    if (err instanceof AuthorizationError) redirect("/geen-toegang");
    if (!(err instanceof WorkflowError)) throw err;
    query = "";
  }
  backToCalling(callingId, query);
}

/** Herinnering aan één persoon (userId) of aan iedereen die nog niet heeft gereageerd. */
export async function remindAction(formData: FormData): Promise<void> {
  const callingId = String(formData.get("callingId"));
  const userId = String(formData.get("userId") || "") || undefined;
  const { user } = await requireStaffForCalling(callingId);

  let query = "";
  try {
    const { sent, skippedRecent } = await remindParticipants({ callingId, userId, actorId: user.id });
    query = `?melding=herinnering&verstuurd=${sent}&overgeslagen=${skippedRecent}`;
  } catch (err) {
    if (err instanceof AuthorizationError) redirect("/geen-toegang");
    if (!(err instanceof WorkflowError)) throw err;
  }
  backToCalling(callingId, query);
}

/** Verwijdert een niet meer betrokken deelnemer expliciet uit de ronde. */
export async function removeParticipantAction(formData: FormData): Promise<void> {
  const callingId = String(formData.get("callingId"));
  const userId = String(formData.get("userId"));
  const { user } = await requireStaffForCalling(callingId);

  let query = "?melding=deelnemer-verwijderd";
  try {
    await removeParticipantFromRound({ callingId, userId, actorId: user.id });
  } catch (err) {
    if (err instanceof AuthorizationError) redirect("/geen-toegang");
    if (!(err instanceof WorkflowError)) throw err;
    query = "";
  }
  backToCalling(callingId, query);
}

/**
 * Verwijdert een voorstel definitief. Vereist het veld `confirmed=yes` (het
 * bevestigingsscherm) en wordt in de lib opnieuw op bevoegdheid binnen de
 * ring van het voorstel gecontroleerd (staf van die ring, of webmin).
 */
export async function deleteCallingAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const callingId = String(formData.get("callingId"));
  const confirmed = formData.get("confirmed") === "yes";

  const calling = await prisma.calling.findUnique({ where: { id: callingId }, select: { ringId: true } });

  try {
    await deleteCalling({ callingId, actorId: user.id, confirmed });
  } catch (err) {
    if (err instanceof AuthorizationError) redirect("/geen-toegang");
    if (!(err instanceof WorkflowError)) throw err;
    backToCalling(callingId, "?melding=niet-verwijderd");
  }
  revalidatePath("/dashboard");
  revalidatePath("/roepingen");
  if (user.role === "ADMIN" && calling) {
    revalidatePath(`/ringen/${calling.ringId}`);
    redirect(`/ringen/${calling.ringId}`);
  }
  redirect("/roepingen?melding=verwijderd");
}

export async function assignTaskAction(formData: FormData): Promise<void> {
  const callingId = String(formData.get("callingId"));
  await requireStaffForCalling(callingId);
  const task = String(formData.get("task")) as TaskKey;
  const assigneeId = String(formData.get("assigneeId") || "") || null;

  try {
    await assignTask({ callingId, task, assigneeId });
  } catch (err) {
    if (!(err instanceof WorkflowError)) throw err;
  }
  backToCalling(callingId);
}

export async function completeTaskAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (user.role === "ADMIN") redirect("/geen-toegang");
  const callingId = String(formData.get("callingId"));
  const task = String(formData.get("task")) as TaskKey;
  const doneAtRaw = String(formData.get("doneAt") || "");
  const ondersteunenContext = (formData.get("ondersteunenContext") as OndersteuningContext | null) || undefined;

  const calling = await prisma.calling.findUnique({ where: { id: callingId } });
  if (!calling) redirect("/geen-toegang");
  const membership = await getActiveMembership(user.id, calling.ringId);
  if (!membership) redirect("/geen-toegang");

  // Staf van de ring mag elke taak registreren; anderen alleen de taak die
  // aan henzelf is toegewezen.
  const isStaff = STAFF_ROLES.includes(membership.role);
  const isAssignee = calling[TASK_ASSIGNEE_FIELD[task]] === user.id;
  if (!isStaff && !isAssignee) redirect("/geen-toegang");

  try {
    await completeTask({
      callingId,
      task,
      doneById: user.id,
      doneAt: doneAtRaw ? new Date(doneAtRaw) : new Date(),
      ondersteunenContext,
    });
  } catch (err) {
    if (!(err instanceof WorkflowError)) throw err;
  }
  backToCalling(callingId);
}

export async function markProcessedAction(formData: FormData): Promise<void> {
  const callingId = String(formData.get("callingId"));
  const { user } = await requireStaffForCalling(callingId);

  try {
    await markProcessed({ callingId, processedById: user.id });
  } catch (err) {
    if (!(err instanceof WorkflowError)) throw err;
  }
  revalidatePath("/dashboard");
  redirect("/roepingen");
}
