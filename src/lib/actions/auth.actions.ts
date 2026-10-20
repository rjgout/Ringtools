"use server";

import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import {
  createMagicLinkToken,
  createSession,
  createVerifiedSession,
  mfaRequired,
  consumeLoginCode,
  destroySession,
  verifyAdminPassword,
  previewMagicLinkToken,
  consumeMagicLinkToken,
} from "@/lib/auth";
import { setSessionCookie, clearSessionCookie, getSessionCookieValue, safeInternalPath, getRequestUserAgent } from "@/lib/session";
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
    const { rawToken, code } = await createMagicLinkToken(user.id, { withCode: true });
    const link = redirectTo
      ? `${env.appBaseUrl}/auth/magic/${rawToken}?redirect=${encodeURIComponent(redirectTo)}`
      : `${env.appBaseUrl}/auth/magic/${rawToken}`;
    const { subject, text } = magicLinkEmail(user.name, link, code);
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

/**
 * Rondt een geslaagde identiteitscontrole (magic link of inlogcode) af: reguliere
 * gebruikers zonder ingeschakelde passkey-verificatie krijgen direct een volledige
 * sessie; anders volgt de passkeystap. Alleen de sessie van DEZE browser wordt
 * vervangen; sessies op andere apparaten (bijv. de geïnstalleerde app) blijven bestaan.
 */
async function completeLogin(user: User, redirectTo: string): Promise<never> {
  const previous = await getSessionCookieValue();
  if (previous) await destroySession(previous);

  if (!mfaRequired(user)) {
    // Passkey-verificatie is optioneel en staat voor deze gebruiker uit:
    // de magic link geeft meteen volledige toegang.
    const full = await createVerifiedSession(user.id, await getRequestUserAgent());
    await setSessionCookie(full.rawToken);
    redirect(redirectTo);
  }
  const { rawToken } = await createSession(user.id, await getRequestUserAgent());
  await setSessionCookie(rawToken, true);
  redirect(`/mfa/passkey?redirect=${encodeURIComponent(redirectTo)}`);
}

export async function confirmMagicLinkAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") || "");
  const redirectTo = safeInternalPath(String(formData.get("redirect") || "")) || "/dashboard";

  const user = await consumeMagicLinkToken(token);
  if (!user) {
    redirect("/login?error=link-ongeldig");
  }
  // Een magic link bevestigt alleen de identiteit; met passkey-verificatie
  // ingeschakeld geeft dit nog GEEN volledige toegang (zie src/lib/auth.ts).
  await completeLogin(user, redirectTo);
}

/** Inloggen met de 8-cijferige code uit de inlogmail, bedoeld voor de geïnstalleerde app. */
export async function loginWithCodeAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  const code = String(formData.get("code") || "").replace(/\s+/g, "");
  const redirectTo = safeInternalPath(String(formData.get("redirect") || "")) || "/dashboard";
  const failure: ActionResult = { ok: false, message: "Deze code is onjuist of verlopen. Vraag zo nodig een nieuwe inloglink aan." };

  if (!parsed.success || !/^\d{8}$/.test(code)) return failure;

  const { allowed } = rateLimit(`login-code:${parsed.data}`, 10, 15 * 60 * 1000);
  if (!allowed) return { ok: false, message: "Te veel pogingen. Probeer het later opnieuw." };

  const user = await consumeLoginCode(parsed.data, code);
  if (!user || user.role === "ADMIN") return failure;
  await completeLogin(user, redirectTo);
  return failure; // onbereikbaar: completeLogin stuurt altijd door
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

  // Wachtwoord is pas de eerste factor; TOTP is verplicht voor volledige toegang.
  const { rawToken } = await createSession(user.id, await getRequestUserAgent());
  await setSessionCookie(rawToken, true);
  redirect("/mfa/totp");
}

export async function logoutAction(): Promise<void> {
  const raw = await getSessionCookieValue();
  await destroySession(raw);
  await clearSessionCookie();
  redirect("/login");
}
