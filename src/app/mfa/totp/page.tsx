import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getAwaitingMfaUser, safeInternalPath } from "@/lib/session";
import { startTotpEnrollment, isTotpConfirmed } from "@/lib/mfa";
import { enrolledMethods, totpAllowedForUser } from "@/lib/mfaMethods";
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
  if (isAdmin) {
    confirmed = await isTotpConfirmed(awaiting.userId);
  } else {
    const methods = await enrolledMethods(awaiting.user);
    confirmed = methods.includes("totp");
    // Heeft de gebruiker al een andere methode (passkey), dan wordt er hier géén zwakkere factor bijgezet met alleen een e-mailcode.
    if (!confirmed && methods.length > 0) redirect(toPasskey);
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
          <TotpVerifyForm redirectTo={redirectTo} allowRecovery={isAdmin} />
        ) : (
          <TotpEnrollForm qrDataUrl={enrollment.qrDataUrl} secret={enrollment.secret} redirectTo={redirectTo} />
        )}
      </div>
    </main>
  );
}
