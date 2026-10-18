"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, requireUser } from "@/lib/session";
import { canManageWorkflow, canVoteHogeraad, canVotePresidium } from "@/lib/rbac";
import { createCallingSchema } from "@/lib/validation";
import {
  createCalling,
  castVote,
  reinviteVoter,
  assignTask,
  completeTask,
  markProcessed,
  WorkflowError,
} from "@/lib/workflow";
import { prisma } from "@/lib/prisma";
import type { OndersteuningContext } from "@prisma/client";
import { TASK_ASSIGNEE_FIELD, type TaskKey } from "@/lib/status";

export type ActionResult = { ok: boolean; message: string };

export async function createCallingAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireRole(["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR"]);

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

  const calling = await createCalling({ ...parsed.data, createdById: user.id });
  revalidatePath("/dashboard");
  redirect(`/roepingen/${calling.id}`);
}

export async function castVoteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const callingId = String(formData.get("callingId"));
  const support = formData.get("support") === "true";

  if (!canVotePresidium(user.role) && !canVoteHogeraad(user.role)) {
    redirect("/geen-toegang");
  }

  try {
    await castVote({ callingId, userId: user.id, support });
  } catch (err) {
    if (!(err instanceof WorkflowError)) throw err;
  }
  revalidatePath(`/roepingen/${callingId}`);
  revalidatePath("/dashboard");
  redirect(`/roepingen/${callingId}`);
}

export async function reinviteAction(formData: FormData): Promise<void> {
  await requireRole(["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR"]);
  const callingId = String(formData.get("callingId"));
  const userId = String(formData.get("userId"));

  try {
    await reinviteVoter({ callingId, userId });
  } catch (err) {
    if (!(err instanceof WorkflowError)) throw err;
  }
  revalidatePath(`/roepingen/${callingId}`);
  redirect(`/roepingen/${callingId}`);
}

export async function assignTaskAction(formData: FormData): Promise<void> {
  await requireRole(["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR"]);
  const callingId = String(formData.get("callingId"));
  const task = String(formData.get("task")) as TaskKey;
  const assigneeId = String(formData.get("assigneeId") || "") || null;

  try {
    await assignTask({ callingId, task, assigneeId });
  } catch (err) {
    if (!(err instanceof WorkflowError)) throw err;
  }
  revalidatePath(`/roepingen/${callingId}`);
  redirect(`/roepingen/${callingId}`);
}

export async function completeTaskAction(formData: FormData): Promise<void> {
  const user = await requireRole(["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR", "HOGERAAD"]);
  const callingId = String(formData.get("callingId"));
  const task = String(formData.get("task")) as TaskKey;
  const doneAtRaw = String(formData.get("doneAt") || "");
  const ondersteunenContext = (formData.get("ondersteunenContext") as OndersteuningContext | null) || undefined;

  if (canManageWorkflow(user.role)) {
    // Ringpresidium/secretaris/administrateur mogen elke taak registreren.
  } else if (user.role === "HOGERAAD") {
    // Een hogeraadslid mag uitsluitend de taak afronden die aan hemzelf is
    // toegewezen (sectie 3E: mag geen andere roepingen/taken beheren).
    const calling = await prisma.calling.findUnique({ where: { id: callingId } });
    const assigneeField = TASK_ASSIGNEE_FIELD[task];
    if (!calling || calling[assigneeField] !== user.id) {
      redirect("/geen-toegang");
    }
  } else {
    redirect("/geen-toegang");
  }

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
  revalidatePath(`/roepingen/${callingId}`);
  redirect(`/roepingen/${callingId}`);
}

export async function markProcessedAction(formData: FormData): Promise<void> {
  const user = await requireRole(["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR"]);
  const callingId = String(formData.get("callingId"));

  try {
    await markProcessed({ callingId, processedById: user.id });
  } catch (err) {
    if (!(err instanceof WorkflowError)) throw err;
  }
  revalidatePath("/dashboard");
  redirect("/roepingen");
}
