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
import { promoteSessionToMfaVerified, SessionNoLongerValidError, destroySessionById, markSessionFactorProved, hasFreshFactorProof } from "@/lib/auth";
import { startTotpEnrollment, verifyTotpCode, confirmTotpEnrollment, consumeRecoveryCode, regenerateRecoveryCodes, isTotpConfirmed } from "@/lib/mfa";
import { enrolledMethods, totpAllowedForUser, removePasskeyGuarded, removeTotpGuarded, enableMfaGuarded } from "@/lib/mfaMethods";
import { sendMail, mfaResetEmail } from "@/lib/mailer";
import { hasPasskeys } from "@/lib/webauthn";
import { logSecurityEvent } from "@/lib/securityEvents";
import { rateLimit } from "@/lib/rateLimit";
import { totpCodeSchema, recoveryCodeSchema } from "@/lib/validation";

export type ActionResult = { ok: boolean; message: string };
export type TotpEnrollResult = { ok: boolean; message: string; recoveryCodes?: string[] };

/** Promotie van de sessie; een gelijktijdig verzoek dat al gewonnen heeft laat deze sessie verlopen zijn (terug naar inloggen, geen fout). */
async function promoteOrLogin(sessionId: string, userId: string): Promise<{ rawToken: string }> {
  try {
    return await promoteSessionToMfaVerified(sessionId, userId, await getRequestUserAgent());
  } catch (err) {
    if (err instanceof SessionNoLongerValidError) redirect("/login");
    throw err;
  }
}

async function finishAwaitingMfaLogin(sessionId: string, userId: string, redirectTo: string): Promise<never> {
  const { rawToken } = await promoteOrLogin(sessionId, userId);
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

  const regular = awaiting.user.role !== "ADMIN";
  // Gewone gebruiker (E2.1): een nieuwe factor inschrijven met alleen het bewijs van de e-mailcode mag uitsluitend als er nog GEEN
  // methode is (bv. na een reset door webmin). Anders zou wie de mailbox heeft een zwakkere factor naast een passkey kunnen zetten.
  if (regular && (!totpAllowedForUser(awaiting.user.role) || (await enrolledMethods(awaiting.user)).length > 0)) {
    return { ok: false, message: "Niet beschikbaar voor dit account." };
  }

  const { allowed } = rateLimit(`totp-enroll:${awaiting.userId}`, 10, 15 * 60 * 1000);
  if (!allowed) return { ok: false, message: "Te veel pogingen. Probeer het later opnieuw." };

  const result = await confirmTotpEnrollment(awaiting.userId, awaiting.user.email, parsed.data);
  if (!result.ok) {
    return { ok: false, message: result.outcome === "LOCKED" ? "Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw." : "Ongeldige code. Controleer de tijd op je apparaat en probeer het opnieuw." };
  }
  // Bewijs in DEZE sessie dat de factor net is ingeschreven/bevestigd; alleen dit staat afronden toe.
  await markSessionFactorProved(awaiting.sessionId);
  return { ok: true, message: "", recoveryCodes: result.recoveryCodes };
}

/** Rondt de login af na een geslaagde TOTP- of passkey-inschrijving (recovery codes zijn al getoond/bevestigd). */
export async function finalizeAwaitingMfaEnrollmentAction(formData: FormData): Promise<void> {
  const awaiting = await getAwaitingMfaUser();
  if (!awaiting) redirect("/login");

  // Afronden mag alleen met bewijs uit déze sessie (zojuist ingeschreven/bevestigde
  // factor); dat er elders een factor bestaat is geen bewijs.
  if (!hasFreshFactorProof(awaiting)) redirect("/login");
  const configured =
    awaiting.user.role === "ADMIN"
      ? (await isTotpConfirmed(awaiting.userId)) || (await hasPasskeys(awaiting.userId))
      : (await enrolledMethods(awaiting.user)).length > 0;
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

  // Gewone gebruiker (E2.1): alleen met de vlag aan en een BEVESTIGDE TOTP-instelling (een onbevestigde rij is geen bewijs).
  if (awaiting.user.role !== "ADMIN" && !(await enrolledMethods(awaiting.user)).includes("totp")) {
    return { ok: false, message: "Niet beschikbaar voor dit account." };
  }

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

  // Gewone gebruiker: herstelcodes horen bij de authenticator-app; zonder bevestigde TOTP (of met vlag uit) bestaan ze niet.
  if (awaiting.user.role !== "ADMIN" && !(await enrolledMethods(awaiting.user)).includes("totp")) {
    return { ok: false, message: "Niet beschikbaar voor dit account." };
  }

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

  if (session.user.role !== "ADMIN" && !(await enrolledMethods(session.user)).includes("totp")) {
    return { ok: false, message: "Niet beschikbaar voor dit account." };
  }

  const { allowed } = rateLimit(`totp-reverify:${session.user.id}`, 10, 15 * 60 * 1000);
  if (!allowed) return { ok: false, message: "Te veel pogingen. Probeer het later opnieuw." };

  const outcome = await verifyTotpCode(session.user.id, session.user.email, parsed.data);
  if (outcome !== "OK") {
    return { ok: false, message: outcome === "LOCKED" ? "Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw." : "Ongeldige code." };
  }

  const { rawToken } = await promoteOrLogin(session.sessionId, session.user.id);
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
  if (session.user.role !== "ADMIN") throw new Error("Niet beschikbaar voor dit account.");
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

  const { allowed } = rateLimit(`totp-reenroll:${session.user.id}`, 10, 15 * 60 * 1000);
  if (!allowed) return { ok: false, message: "Te veel pogingen. Probeer het later opnieuw." };

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
  // Beheerder, of een gewone gebruiker met een bevestigde authenticator-app (vlag aan); de oude set vervalt direct.
  if (session.user.role !== "ADMIN" && !(await enrolledMethods(session.user)).includes("totp")) {
    return { ok: false, message: "Niet beschikbaar voor dit account." };
  }

  const codes = await regenerateRecoveryCodes(session.user.id);
  await logSecurityEvent({ userId: session.user.id, type: "RECOVERY_CODES_REGENERATED" });
  revalidatePath("/profiel/beveiliging");
  return { ok: true, message: "Nieuwe herstelcodes gegenereerd.", recoveryCodes: codes };
}

export async function removePasskeyAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireRecentMfa("/profiel/beveiliging/herverifieer");
  const credentialId = String(formData.get("credentialId") || "");

  // Eén transactie met rijvergrendeling: de laatste bruikbare methode kan niet worden weggehaald, ook niet door twee gelijktijdige verwijderingen.
  const result = await removePasskeyGuarded(session.user.id, credentialId);
  if (!result.ok) return { ok: false, message: result.message };

  await logSecurityEvent({ userId: session.user.id, type: "PASSKEY_REMOVED", detail: result.deviceLabel ?? undefined });
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

// ---- Admin: MFA-reset voor een andere gebruiker (noodprocedure) ----

/**
 * Noodprocedure van de webmin. Vereist recente MFA van de webmin, een uitdrukkelijke bevestiging dat de identiteit van de gebruiker
 * buiten Ringtools is gecontroleerd én het intypen van het e-mailadres van de gebruiker. De reset is ÉÉN transactie: alle passkeys,
 * challenges, de authenticator-app, herstelcodes en sessies verdwijnen samen met het auditspoor, of er verandert niets. Daarna volgt
 * een melding per e-mail aan de gebruiker (best effort; een mislukte mail maakt de reset niet ongedaan).
 *
 * Eindtoestand: `mfaEnabled` blijft aan, de gebruiker heeft geen methode en geen sessie; bij de volgende e-mailcode-login is een EERSTE
 * inschrijving toegestaan (er is dan werkelijk geen bestaande methode), zie `mayEnrollFirstFactorWhilePending`.
 */
export async function resetUserMfaAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireRole(["ADMIN"]);
  const session = await requireRecentMfa("/profiel/beveiliging/herverifieer");
  if (session.user.id !== admin.id) return { ok: false, message: "Niet toegestaan." };

  const targetId = String(formData.get("userId") || "");
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target || target.role === "ADMIN") {
    return { ok: false, message: "Dit account kan niet via dit scherm worden gereset." };
  }
  if (formData.get("identityChecked") !== "yes") {
    return { ok: false, message: "Bevestig eerst dat je de identiteit van de gebruiker buiten Ringtools hebt gecontroleerd." };
  }
  if (String(formData.get("confirmEmail") || "").trim().toLowerCase() !== target.email.toLowerCase()) {
    return { ok: false, message: "Het ingetypte e-mailadres komt niet overeen met dat van de gebruiker." };
  }

  await prisma.$transaction([
    prisma.webAuthnCredential.deleteMany({ where: { userId: target.id } }),
    prisma.webAuthnChallenge.deleteMany({ where: { userId: target.id } }),
    prisma.recoveryCode.deleteMany({ where: { userId: target.id } }),
    prisma.totpCredential.deleteMany({ where: { userId: target.id } }),
    prisma.session.deleteMany({ where: { userId: target.id } }),
    prisma.securityEvent.create({
      data: { userId: target.id, actorUserId: admin.id, type: "MFA_RESET_BY_ADMIN", detail: `Gereset door ${admin.name}; identiteit gecontroleerd` },
    }),
  ]);

  let notified = true;
  try {
    const mail = mfaResetEmail(target.name);
    await sendMail({ to: target.email, subject: mail.subject, text: mail.text });
  } catch (err) {
    notified = false;
    console.error("[mfa] Melding van MFA-reset kon niet worden verstuurd:", err instanceof Error ? err.message : err);
  }

  revalidatePath("/gebruikers");
  return {
    ok: true,
    message: `Verificatie van ${target.name} is gereset; alle sessies zijn ingetrokken. Bij de volgende inlog stelt deze gebruiker opnieuw een methode in.${notified ? " De gebruiker is per e-mail op de hoogte gebracht." : " Let op: de e-mailmelding aan de gebruiker kon niet worden verstuurd; breng de gebruiker zelf op de hoogte."}`,
  };
}


// ---- Optionele passkey-verificatie voor reguliere gebruikers ----

export async function enableUserMfaAction(): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.role === "ADMIN") return { ok: false, message: "Voor het beheerdersaccount is verificatie altijd verplicht." };

  const result = await enableMfaGuarded(session.user.id);
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/profiel/beveiliging");
  return { ok: true, message: "Verificatie is ingeschakeld. Bij de volgende inlog bevestig je met een van je ingestelde methoden." };
}

export async function disableUserMfaAction(): Promise<ActionResult> {
  const session = await requireRecentMfa("/profiel/beveiliging/herverifieer");
  if (session.user.role === "ADMIN") return { ok: false, message: "Voor het beheerdersaccount is verificatie altijd verplicht." };

  await prisma.user.update({ where: { id: session.user.id }, data: { mfaEnabled: false } });
  revalidatePath("/profiel/beveiliging");
  return { ok: true, message: "Verificatie is uitgeschakeld. Inloggen kan voortaan met alleen de inlogcode uit je e-mail." };
}

// ---- E2.1: authenticator-app (TOTP) beheren door een gewone gebruiker (vlag WEB_TOTP_ENABLED) ----

/** Start de inschrijving van een authenticator-app. Met MFA aan vereist dit een recente verificatie (geen methode erbij met alleen een e-mailcode). */
export async function startUserTotpEnrollmentAction(): Promise<TotpEnrollmentView> {
  const session = await requireRecentMfa("/profiel/beveiliging/herverifieer");
  if (!totpAllowedForUser(session.user.role)) throw new Error("Niet beschikbaar voor dit account.");
  if (await isTotpConfirmed(session.user.id)) throw new Error("Er is al een authenticator-app ingesteld.");
  const { uri, secret } = await startTotpEnrollment(session.user.id, session.user.email);
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 240 });
  return { qrDataUrl, secret };
}

export async function confirmUserTotpEnrollmentAction(_prev: TotpEnrollResult | null, formData: FormData): Promise<TotpEnrollResult> {
  const session = await requireRecentMfa("/profiel/beveiliging/herverifieer");
  if (!totpAllowedForUser(session.user.role)) return { ok: false, message: "Niet beschikbaar voor dit account." };

  const parsed = totpCodeSchema.safeParse(formData.get("code"));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Ongeldige code." };

  const { allowed } = rateLimit(`totp-enroll:${session.user.id}`, 10, 15 * 60 * 1000);
  if (!allowed) return { ok: false, message: "Te veel pogingen. Probeer het later opnieuw." };

  const result = await confirmTotpEnrollment(session.user.id, session.user.email, parsed.data);
  if (!result.ok) {
    return { ok: false, message: result.outcome === "LOCKED" ? "Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw." : "Ongeldige code. Controleer de tijd op je apparaat en probeer het opnieuw." };
  }
  revalidatePath("/profiel/beveiliging");
  return { ok: true, message: "Authenticator-app is ingesteld.", recoveryCodes: result.recoveryCodes };
}

/** Verwijdert de authenticator-app en de herstelcodes. Recente MFA vereist; de laatste methode kan niet weg zolang verificatie aan staat. */
export async function removeUserTotpAction(): Promise<ActionResult> {
  const session = await requireRecentMfa("/profiel/beveiliging/herverifieer");
  const result = await removeTotpGuarded(session.user.id);
  if (!result.ok) return { ok: false, message: result.message };
  await logSecurityEvent({ userId: session.user.id, type: "TOTP_RESET", detail: "Authenticator-app verwijderd door gebruiker" });
  revalidatePath("/profiel/beveiliging");
  return { ok: true, message: "Authenticator-app en herstelcodes verwijderd." };
}
