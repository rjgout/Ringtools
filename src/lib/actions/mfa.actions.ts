"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import {
  getAwaitingMfaUser,
  getCurrentSession,
  setSessionCookie,
  safeInternalPath,
  getRequestUserAgent,
  requireRole,
  requireRecentMfa,
} from "@/lib/session";
import { promoteSessionToMfaVerified, destroySessionById } from "@/lib/auth";
import { startTotpEnrollment, verifyTotpCode, confirmTotpEnrollment, consumeRecoveryCode, regenerateRecoveryCodes, isTotpConfirmed } from "@/lib/mfa";
import { hasPasskeys } from "@/lib/webauthn";
import { logSecurityEvent } from "@/lib/securityEvents";
import { rateLimit } from "@/lib/rateLimit";
import { totpCodeSchema, recoveryCodeSchema } from "@/lib/validation";

export type ActionResult = { ok: boolean; message: string };
export type TotpEnrollResult = { ok: boolean; message: string; recoveryCodes?: string[] };

async function finishAwaitingMfaLogin(sessionId: string, userId: string, redirectTo: string): Promise<never> {
  const { rawToken } = await promoteSessionToMfaVerified(sessionId, userId, await getRequestUserAgent());
  await setSessionCookie(rawToken);
  await logSecurityEvent({ userId, type: "MFA_VERIFIED" });
  redirect(redirectTo);
}

/** Bevestigt een lopende TOTP-inschrijving (tijdens inloggen). Rondt de login nog NIET af — dat gebeurt pas na het tonen/bevestigen van de herstelcodes. */
export async function confirmTotpEnrollmentLoginAction(_prev: TotpEnrollResult | null, formData: FormData): Promise<TotpEnrollResult> {
  const awaiting = await getAwaitingMfaUser();
  if (!awaiting) return { ok: false, message: "Sessie verlopen. Log opnieuw in." };

  const parsed = totpCodeSchema.safeParse(formData.get("code"));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Ongeldige code." };

  const { allowed } = rateLimit(`totp-enroll:${awaiting.userId}`, 10, 15 * 60 * 1000);
  if (!allowed) return { ok: false, message: "Te veel pogingen. Probeer het later opnieuw." };

  const result = await confirmTotpEnrollment(awaiting.userId, awaiting.user.email, parsed.data);
  if (!result.ok) {
    return { ok: false, message: result.outcome === "LOCKED" ? "Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw." : "Ongeldige code. Controleer de tijd op je apparaat en probeer het opnieuw." };
  }
  return { ok: true, message: "", recoveryCodes: result.recoveryCodes };
}

/** Rondt de login af na een geslaagde TOTP- of passkey-inschrijving (recovery codes zijn al getoond/bevestigd). */
export async function finalizeAwaitingMfaEnrollmentAction(formData: FormData): Promise<void> {
  const awaiting = await getAwaitingMfaUser();
  if (!awaiting) redirect("/login");

  const configured = (await isTotpConfirmed(awaiting.userId)) || (await hasPasskeys(awaiting.userId));
  if (!configured) redirect("/login");

  const redirectTo = safeInternalPath(String(formData.get("redirect") || "")) || "/dashboard";
  await finishAwaitingMfaLogin(awaiting.sessionId, awaiting.userId, redirectTo);
}

/** Verifieert een TOTP-code bij het inloggen (adminaccount met al bevestigde TOTP). */
export async function verifyTotpLoginAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const awaiting = await getAwaitingMfaUser();
  if (!awaiting) return { ok: false, message: "Sessie verlopen. Log opnieuw in." };

  const parsed = totpCodeSchema.safeParse(formData.get("code"));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Ongeldige code." };

  const { allowed } = rateLimit(`totp-login:${awaiting.userId}`, 10, 15 * 60 * 1000);
  if (!allowed) return { ok: false, message: "Te veel pogingen. Probeer het later opnieuw." };

  const outcome = await verifyTotpCode(awaiting.userId, awaiting.user.email, parsed.data);
  if (outcome !== "OK") {
    return {
      ok: false,
      message:
        outcome === "LOCKED"
          ? "Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw, of gebruik een herstelcode."
          : "Ongeldige code.",
    };
  }

  const redirectTo = safeInternalPath(String(formData.get("redirect") || "")) || "/dashboard";
  await finishAwaitingMfaLogin(awaiting.sessionId, awaiting.userId, redirectTo);
  return { ok: true, message: "" };
}

/** Herstelcode-login voor het adminaccount (TOTP-apparaat niet beschikbaar). */
export async function useRecoveryCodeLoginAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const awaiting = await getAwaitingMfaUser();
  if (!awaiting) return { ok: false, message: "Sessie verlopen. Log opnieuw in." };

  const parsed = recoveryCodeSchema.safeParse(formData.get("code"));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Ongeldige herstelcode." };

  const { allowed } = rateLimit(`recovery-login:${awaiting.userId}`, 10, 15 * 60 * 1000);
  if (!allowed) return { ok: false, message: "Te veel pogingen. Probeer het later opnieuw." };

  const ok = await consumeRecoveryCode(awaiting.userId, parsed.data);
  if (!ok) return { ok: false, message: "Ongeldige of al gebruikte herstelcode." };

  const redirectTo = safeInternalPath(String(formData.get("redirect") || "")) || "/dashboard";
  await finishAwaitingMfaLogin(awaiting.sessionId, awaiting.userId, redirectTo);
  return { ok: true, message: "" };
}

/** Herverifieert een al volledig ingelogde sessie (stap-up) voor gevoelige profielacties. */
export async function reverifyTotpAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, message: "Sessie verlopen. Log opnieuw in." };

  const parsed = totpCodeSchema.safeParse(formData.get("code"));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Ongeldige code." };

  const { allowed } = rateLimit(`totp-reverify:${session.user.id}`, 10, 15 * 60 * 1000);
  if (!allowed) return { ok: false, message: "Te veel pogingen. Probeer het later opnieuw." };

  const outcome = await verifyTotpCode(session.user.id, session.user.email, parsed.data);
  if (outcome !== "OK") {
    return { ok: false, message: outcome === "LOCKED" ? "Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw." : "Ongeldige code." };
  }

  const { rawToken } = await promoteSessionToMfaVerified(session.sessionId, session.user.id, await getRequestUserAgent());
  await setSessionCookie(rawToken);
  await logSecurityEvent({ userId: session.user.id, type: "MFA_VERIFIED" });
  const redirectTo = safeInternalPath(String(formData.get("redirect") || "")) || "/profiel/beveiliging";
  redirect(redirectTo);
}

// ---- Beveiligingsinstellingen (vereisen een recent geverifieerde sessie) ----

export type TotpEnrollmentView = { qrDataUrl: string; secret: string };

/** Start een nieuwe TOTP-inschrijving vanuit /profiel/beveiliging (admin, altijd een vers secret). */
export async function startTotpReenrollmentAction(): Promise<TotpEnrollmentView> {
  const session = await requireRecentMfa("/profiel/beveiliging/herverifieer");
  const { uri, secret } = await startTotpEnrollment(session.user.id, session.user.email, true);
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 240 });
  return { qrDataUrl, secret };
}

/** Opnieuw instellen van TOTP vanuit /profiel/beveiliging (admin). Rondt direct af: de gebruiker is al volledig ingelogd. */
export async function confirmTotpReenrollmentAction(_prev: TotpEnrollResult | null, formData: FormData): Promise<TotpEnrollResult> {
  const session = await requireRecentMfa("/profiel/beveiliging/herverifieer");
  if (session.user.role !== "ADMIN") return { ok: false, message: "Niet beschikbaar voor dit account." };

  const parsed = totpCodeSchema.safeParse(formData.get("code"));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Ongeldige code." };

  const result = await confirmTotpEnrollment(session.user.id, session.user.email, parsed.data);
  if (!result.ok) {
    return { ok: false, message: result.outcome === "LOCKED" ? "Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw." : "Ongeldige code." };
  }
  await logSecurityEvent({ userId: session.user.id, type: "TOTP_RESET" });
  revalidatePath("/profiel/beveiliging");
  return { ok: true, message: "TOTP is opnieuw ingesteld.", recoveryCodes: result.recoveryCodes };
}

export async function regenerateRecoveryCodesAction(): Promise<{ ok: boolean; message: string; recoveryCodes?: string[] }> {
  const session = await requireRecentMfa("/profiel/beveiliging/herverifieer");
  if (session.user.role !== "ADMIN") return { ok: false, message: "Niet beschikbaar voor dit account." };

  const codes = await regenerateRecoveryCodes(session.user.id);
  await logSecurityEvent({ userId: session.user.id, type: "RECOVERY_CODES_REGENERATED" });
  revalidatePath("/profiel/beveiliging");
  return { ok: true, message: "Nieuwe herstelcodes gegenereerd.", recoveryCodes: codes };
}

export async function removePasskeyAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireRecentMfa("/profiel/beveiliging/herverifieer");
  const credentialId = String(formData.get("credentialId") || "");

  const count = await prisma.webAuthnCredential.count({ where: { userId: session.user.id } });
  // Alleen wie passkey-verificatie heeft ingeschakeld heeft de laatste passkey nodig om in te loggen.
  if (count <= 1 && session.user.mfaEnabled) {
    return { ok: false, message: "Je kunt je laatste passkey niet verwijderen: zonder passkey kun je niet meer inloggen. Registreer eerst een nieuwe passkey." };
  }

  const credential = await prisma.webAuthnCredential.findFirst({ where: { id: credentialId, userId: session.user.id } });
  if (!credential) return { ok: false, message: "Deze passkey is niet gevonden." };

  await prisma.webAuthnCredential.delete({ where: { id: credential.id } });
  await logSecurityEvent({ userId: session.user.id, type: "PASSKEY_REMOVED", detail: credential.deviceLabel ?? undefined });
  revalidatePath("/profiel/beveiliging");
  return { ok: true, message: "Passkey verwijderd." };
}

export async function revokeSessionAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireRecentMfa("/profiel/beveiliging/herverifieer");
  const sessionId = String(formData.get("sessionId") || "");
  if (sessionId === session.sessionId) {
    return { ok: false, message: "Je kunt je huidige sessie hier niet beëindigen; gebruik 'Uitloggen'." };
  }
  await destroySessionById(session.user.id, sessionId);
  await logSecurityEvent({ userId: session.user.id, type: "SESSION_REVOKED" });
  revalidatePath("/profiel/beveiliging");
  return { ok: true, message: "Sessie beëindigd." };
}

// ---- Admin: MFA-reset voor een andere gebruiker ----

export async function resetUserMfaAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireRole(["ADMIN"]);
  const session = await requireRecentMfa("/profiel/beveiliging/herverifieer");
  if (session.user.id !== admin.id) return { ok: false, message: "Niet toegestaan." };

  const targetId = String(formData.get("userId") || "");
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target || target.role === "ADMIN") {
    return { ok: false, message: "Dit account kan niet via dit scherm worden gereset." };
  }

  await prisma.$transaction([
    prisma.webAuthnCredential.deleteMany({ where: { userId: target.id } }),
    prisma.webAuthnChallenge.deleteMany({ where: { userId: target.id } }),
    prisma.session.deleteMany({ where: { userId: target.id } }),
  ]);
  await logSecurityEvent({
    userId: target.id,
    actorUserId: admin.id,
    type: "MFA_RESET_BY_ADMIN",
    detail: `Gereset door ${admin.name}`,
  });

  revalidatePath("/gebruikers");
  return { ok: true, message: `MFA van ${target.name} is gereset. Deze gebruiker moet bij de volgende magic link opnieuw een passkey registreren.` };
}


// ---- Optionele passkey-verificatie voor reguliere gebruikers ----

export async function enableUserMfaAction(): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.role === "ADMIN") return { ok: false, message: "Voor het beheerdersaccount is verificatie altijd verplicht." };

  if (!(await hasPasskeys(session.user.id))) {
    return { ok: false, message: "Registreer eerst een passkey voordat je verificatie inschakelt." };
  }
  await prisma.user.update({ where: { id: session.user.id }, data: { mfaEnabled: true } });
  revalidatePath("/profiel/beveiliging");
  return { ok: true, message: "Passkey-verificatie is ingeschakeld. Bij de volgende inlog bevestig je met je passkey." };
}

export async function disableUserMfaAction(): Promise<ActionResult> {
  const session = await requireRecentMfa("/profiel/beveiliging/herverifieer");
  if (session.user.role === "ADMIN") return { ok: false, message: "Voor het beheerdersaccount is verificatie altijd verplicht." };

  await prisma.user.update({ where: { id: session.user.id }, data: { mfaEnabled: false } });
  revalidatePath("/profiel/beveiliging");
  return { ok: true, message: "Passkey-verificatie is uitgeschakeld. Inloggen kan voortaan met alleen de inloglink." };
}
