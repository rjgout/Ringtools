import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { getAwaitingMfaUser, safeInternalPath } from "@/lib/session";
import { startTotpEnrollment, isTotpConfirmed } from "@/lib/mfa";
import { loginPlan, totpAllowedForUser } from "@/lib/mfaMethods";
import { TotpEnrollForm } from "@/components/mfa/TotpEnrollForm";
import { TotpVerifyForm } from "@/components/mfa/TotpVerifyForm";

export default async function TotpMfaPage({ searchParams }: { searchParams: Promise<{ redirect?: string }> }) {
  const awaiting = await getAwaitingMfaUser();
  if (!awaiting) redirect("/login");

  const { redirect: rawRedirect } = await searchParams;
  const redirectTo = safeInternalPath(rawRedirect) || "/dashboard";

  const isAdmin = awaiting.user.role === "ADMIN";
  const toPasskey = `/mfa/passkey?redirect=${encodeURIComponent(redirectTo)}`;
  // Gewone gebruikers: alleen met WEB_TOTP_ENABLED (E2.1, standaard uit). Zonder vlag blijft TOTP uitsluitend voor het adminaccount.
  if (!isAdmin && !totpAllowedForUser(awaiting.user.role)) redirect(toPasskey);

  let confirmed = true;
  let canSwitch = false;
  const hasRecoveryCodes = !isAdmin && (await prisma.recoveryCode.count({ where: { userId: awaiting.userId, usedAt: null } })) > 0;
  if (isAdmin) {
    confirmed = await isTotpConfirmed(awaiting.userId);
  } else {
    const { plan } = await loginPlan(awaiting.user);
    // Alleen een passkey (of niets bruikbaars): TOTP hoort hier niet. Heeft de gebruiker al een andere methode, dan wordt er hier
    // géén zwakkere factor bijgezet met alleen een e-mailcode.
    if (plan === "passkey" || plan === "unavailable") redirect(toPasskey);
    confirmed = plan === "totp" || plan === "choose";
    canSwitch = plan === "choose";
  }

  let enrollment: { qrDataUrl: string; secret: string } | null = null;
  if (!confirmed) {
    const { uri, secret } = await startTotpEnrollment(awaiting.userId, awaiting.user.email);
    enrollment = { qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 240 }), secret };
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="glass-card w-full max-w-sm">
        <div className="mb-5 text-center">
          <h1 className="text-xl font-semibold">Ringtools</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Welkom, {awaiting.user.name}</p>
        </div>
        {confirmed || !enrollment ? (
          <TotpVerifyForm redirectTo={redirectTo} allowRecovery={isAdmin || hasRecoveryCodes} switchHref={canSwitch ? toPasskey : undefined} />
        ) : (
          <TotpEnrollForm qrDataUrl={enrollment.qrDataUrl} secret={enrollment.secret} redirectTo={redirectTo} />
        )}
      </div>
    </main>
  );
}
