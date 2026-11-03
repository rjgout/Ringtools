"use server";

import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import {
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
import { sendLoginMail } from "@/lib/loginMail";

export type ActionResult = { ok: boolean; message: string };

export async function requestMagicLinkAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { ok: false, message: "Vul een geldig e-mailadres in." };
  }
  return sendLoginMail(parsed.data, safeInternalPath(String(formData.get("redirect") || "")));
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
