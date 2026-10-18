"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { smtpSettingsSchema, adminPasswordChangeSchema } from "@/lib/validation";
import { encryptSecret } from "@/lib/crypto";
import { hashPassword } from "@/lib/auth";
import { sendTestMail, SmtpNotConfiguredError } from "@/lib/mailer";
import { rateLimit } from "@/lib/rateLimit";

export type ActionResult = { ok: boolean; message: string };

export async function updateSmtpSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireRole(["ADMIN"]);

  const parsed = smtpSettingsSchema.safeParse({
    host: formData.get("host"),
    port: formData.get("port"),
    security: formData.get("security"),
    username: formData.get("username") || "",
    password: formData.get("password") || "",
    fromAddress: formData.get("fromAddress"),
    fromName: formData.get("fromName"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message || "Controleer de ingevulde gegevens." };
  }

  const data: Record<string, unknown> = {
    host: parsed.data.host,
    port: parsed.data.port,
    security: parsed.data.security,
    username: parsed.data.username || null,
    fromAddress: parsed.data.fromAddress,
    fromName: parsed.data.fromName,
  };
  // Alleen overschrijven als er daadwerkelijk een nieuw wachtwoord is
  // ingevuld: zo kun je de overige instellingen aanpassen zonder het
  // wachtwoord opnieuw te moeten intypen, en wordt het nooit als platte
  // tekst teruggestuurd naar het formulier.
  if (parsed.data.password) {
    data.encryptedPassword = encryptSecret(parsed.data.password);
  }

  await prisma.smtpSettings.update({ where: { id: 1 }, data });
  revalidatePath("/instellingen");
  return { ok: true, message: "SMTP-instellingen opgeslagen." };
}

export async function sendTestMailAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireRole(["ADMIN"]);
  const to = String(formData.get("to") || admin.email);

  const { allowed } = rateLimit(`testmail:${admin.id}`, 5, 15 * 60 * 1000);
  if (!allowed) {
    return { ok: false, message: "Te veel testmails aangevraagd. Probeer het later opnieuw." };
  }

  try {
    await sendTestMail(to);
    return { ok: true, message: `Testbericht verstuurd naar ${to}.` };
  } catch (err) {
    if (err instanceof SmtpNotConfiguredError) {
      return { ok: false, message: err.message };
    }
    console.error("[instellingen] Testmail mislukt:", err);
    return { ok: false, message: "Versturen van het testbericht is mislukt. Controleer de SMTP-instellingen." };
  }
}

export async function changeAdminPasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireRole(["ADMIN"]);

  const parsed = adminPasswordChangeSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message || "Controleer de ingevulde gegevens." };
  }

  if (!admin.passwordHash || !(await bcrypt.compare(parsed.data.currentPassword, admin.passwordHash))) {
    return { ok: false, message: "Je huidige wachtwoord is onjuist." };
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({ where: { id: admin.id }, data: { passwordHash } });

  return { ok: true, message: "Wachtwoord gewijzigd." };
}
