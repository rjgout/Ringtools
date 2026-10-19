import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getAwaitingMfaUser, safeInternalPath } from "@/lib/session";
import { startTotpEnrollment, isTotpConfirmed } from "@/lib/mfa";
import { TotpEnrollForm } from "@/components/mfa/TotpEnrollForm";
import { TotpVerifyForm } from "@/components/mfa/TotpVerifyForm";

export default async function TotpMfaPage({ searchParams }: { searchParams: Promise<{ redirect?: string }> }) {
  const awaiting = await getAwaitingMfaUser();
  if (!awaiting) redirect("/login");

  const { redirect: rawRedirect } = await searchParams;
  const redirectTo = safeInternalPath(rawRedirect) || "/dashboard";

  // TOTP is uitsluitend voor het adminaccount; andere rollen horen hier niet.
  if (awaiting.user.role !== "ADMIN") {
    redirect(`/mfa/passkey?redirect=${encodeURIComponent(redirectTo)}`);
  }

  const confirmed = await isTotpConfirmed(awaiting.userId);

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
          <TotpVerifyForm redirectTo={redirectTo} />
        ) : (
          <TotpEnrollForm qrDataUrl={enrollment.qrDataUrl} secret={enrollment.secret} redirectTo={redirectTo} />
        )}
      </div>
    </main>
  );
}
