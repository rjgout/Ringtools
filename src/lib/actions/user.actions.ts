"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { canAssignRole } from "@/lib/rbac";
import { createUserSchema, updateUserSchema } from "@/lib/validation";
import { destroyAllSessionsForUser } from "@/lib/auth";

const MANAGER_ROLES = ["ADMIN", "RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR"] as const;

export type ActionResult = { ok: boolean; message: string };

export async function createUserAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireRole([...MANAGER_ROLES]);

  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message || "Controleer de ingevulde gegevens." };
  }
  if (!canAssignRole("RINGPRESIDIUM", parsed.data.role)) {
    return { ok: false, message: "Deze rol kan niet via dit scherm worden toegekend." };
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return { ok: false, message: "Er bestaat al een gebruiker met dit e-mailadres." };
  }

  await prisma.user.create({ data: { ...parsed.data, active: true } });
  revalidatePath("/gebruikers");
  return { ok: true, message: `Gebruiker ${parsed.data.name} is aangemaakt.` };
}

export async function updateUserAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireRole([...MANAGER_ROLES]);

  const parsed = updateUserSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    active: formData.get("active") === "on",
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message || "Controleer de ingevulde gegevens." };
  }

  const target = await prisma.user.findUnique({ where: { id: parsed.data.id } });
  if (!target || target.role === "ADMIN") {
    return { ok: false, message: "Dit account kan niet via dit scherm worden beheerd." };
  }
  if (!canAssignRole("RINGPRESIDIUM", parsed.data.role)) {
    return { ok: false, message: "Deze rol kan niet via dit scherm worden toegekend." };
  }

  const existing = await prisma.user.findFirst({ where: { email: parsed.data.email, NOT: { id: parsed.data.id } } });
  if (existing) {
    return { ok: false, message: "Er bestaat al een andere gebruiker met dit e-mailadres." };
  }

  await prisma.user.update({
    where: { id: parsed.data.id },
    data: { name: parsed.data.name, email: parsed.data.email, role: parsed.data.role, active: parsed.data.active },
  });

  if (!parsed.data.active) {
    await destroyAllSessionsForUser(parsed.data.id);
  }

  revalidatePath("/gebruikers");
  return { ok: true, message: "Gebruiker bijgewerkt." };
}
