import { prisma } from "./prisma";
import { env } from "./env";
import { createMagicLinkToken } from "./auth";
import { rateLimit } from "./rateLimit";
import { sendMail, magicLinkEmail } from "./mailer";

export type LoginMailResult = { ok: boolean; message: string };

/**
 * Stuurt de inlogmail (link + 8-cijferige code) naar een bekend adres. Gedeeld door de
 * webapp en de native app. Geeft bewust hetzelfde antwoord voor onbekende, inactieve en
 * beheerdersadressen (voorkomt account enumeration); de beheerder logt nooit via e-mail in.
 */
export async function sendLoginMail(email: string, redirectTo: string | null): Promise<LoginMailResult> {
  const generic: LoginMailResult = {
    ok: true,
    message: "Als dit e-mailadres bekend is bij Ringtools, is er een inloglink naar verstuurd. Controleer je mailbox.",
  };

  const { allowed } = rateLimit(`magic:${email}`, 5, 15 * 60 * 1000);
  if (!allowed) {
    return { ok: false, message: "Te veel aanvragen voor dit e-mailadres. Probeer het later opnieuw." };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active || user.role === "ADMIN") {
    return generic;
  }

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
