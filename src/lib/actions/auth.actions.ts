"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import {
  createMagicLinkToken,
  createSession,
  destroySession,
  verifyAdminPassword,
  previewMagicLinkToken,
  consumeMagicLinkToken,
} from "@/lib/auth";
import { setSessionCookie, clearSessionCookie, getSessionCookieValue, safeInternalPath } from "@/lib/session";
import { rateLimit } from "@/lib/rateLimit";
import { emailSchema } from "@/lib/validation";
import { sendMail, magicLinkEmail } from "@/lib/mailer";

export type ActionResult = { ok: boolean; message: string };

export async function requestMagicLinkAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  const generic: ActionResult = {
    ok: true,
    message: "Als dit e-mailadres bekend is bij Ringtools, is er een inloglink naar verstuurd. Controleer je mailbox.",
  };

  if (!parsed.success) {
    return { ok: false, message: "Vul een geldig e-mailadres in." };
  }
  const email = parsed.data;

  const { allowed } = rateLimit(`magic:${email}`, 5, 15 * 60 * 1000);
  if (!allowed) {
    return { ok: false, message: "Te veel aanvragen voor dit e-mailadres. Probeer het later opnieuw." };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Bewust geen onderscheid in de boodschap maken als het adres niet bestaat
  // of inactief is (voorkomt account enumeration).
  if (!user || !user.active || user.role === "ADMIN") {
    return generic;
  }

  const redirectTo = safeInternalPath(String(formData.get("redirect") || ""));

  try {
    const { rawToken } = await createMagicLinkToken(user.id);
    const link = redirectTo
      ? `${env.appBaseUrl}/auth/magic/${rawToken}?redirect=${encodeURIComponent(redirectTo)}`
      : `${env.appBaseUrl}/auth/magic/${rawToken}`;
    const { subject, text } = magicLinkEmail(user.name, link);
    await sendMail({ to: user.email, subject, text });
  } catch (err) {
    console.error("[auth] Versturen inloglink mislukt:", err);
    return {
      ok: false,
      message: "Er ging iets mis bij het versturen van de inloglink. Probeer het later opnieuw of neem contact op met het ringpresidium.",
    };
  }

  return generic;
}

export async function previewMagicLinkAction(token: string) {
  return previewMagicLinkToken(token);
}

export async function confirmMagicLinkAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") || "");
  const redirectTo = safeInternalPath(String(formData.get("redirect") || "")) || "/dashboard";

  const user = await consumeMagicLinkToken(token);
  if (!user) {
    redirect("/login?error=link-ongeldig");
  }

  const { rawToken } = await createSession(user.id);
  await setSessionCookie(rawToken);
  redirect(redirectTo);
}

export async function adminLoginAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");

  if (!username || !password) {
    return { ok: false, message: "Vul gebruikersnaam en wachtwoord in." };
  }

  const { allowed } = rateLimit(`admin-login:${username.toLowerCase()}`, 10, 15 * 60 * 1000);
  if (!allowed) {
    return { ok: false, message: "Te veel inlogpogingen. Probeer het later opnieuw." };
  }

  const user = await verifyAdminPassword(username, password);
  if (!user) {
    return { ok: false, message: "Onjuiste gebruikersnaam of wachtwoord." };
  }

  const { rawToken } = await createSession(user.id);
  await setSessionCookie(rawToken);
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  const raw = await getSessionCookieValue();
  await destroySession(raw);
  await clearSessionCookie();
  redirect("/login");
}
