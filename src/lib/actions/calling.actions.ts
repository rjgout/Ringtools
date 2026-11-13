"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { deleteCalling, WorkflowError, AuthorizationError } from "@/lib/workflow";
import { prisma } from "@/lib/prisma";

/**
 * Voorstel verwijderen op de ringpagina van de webmin (systeembeheerder). Gewone gebruikers verwijderen voorstellen in de gedeelde
 * interface (`/app`) via de API; de server controleert de bevoegdheid in beide gevallen in `deleteCalling`.
 * Vereist het veld `confirmed=yes` (het bevestigingsscherm).
 */
export async function deleteCallingAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/app");
  const callingId = String(formData.get("callingId"));
  const confirmed = formData.get("confirmed") === "yes";

  const calling = await prisma.calling.findUnique({ where: { id: callingId }, select: { ringId: true } });
  if (!calling) redirect("/ringen");
  try {
    await deleteCalling({ callingId, actorId: user.id, confirmed });
  } catch (err) {
    if (err instanceof AuthorizationError) redirect("/geen-toegang");
    if (!(err instanceof WorkflowError)) throw err;
  }
  revalidatePath(`/ringen/${calling.ringId}`);
  redirect(`/ringen/${calling.ringId}`);
}
