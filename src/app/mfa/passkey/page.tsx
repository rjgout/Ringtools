import { redirect } from "next/navigation";
import { getAwaitingMfaUser, safeInternalPath } from "@/lib/session";
import { hasPasskeys } from "@/lib/webauthn";
import { isTotpConfirmed } from "@/lib/mfa";
import { PasskeyEnrollPanel } from "@/components/mfa/PasskeyEnrollPanel";
import { enrolledMethods, totpAllowedForUser } from "@/lib/mfaMethods";
import Link from "next/link";
import { PasskeyVerifyPanel } from "@/components/mfa/PasskeyVerifyPanel";

export default async function PasskeyMfaPage({ searchParams }: { searchParams: Promise<{ redirect?: string; methode?: string }> }) {
  const awaiting = await getAwaitingMfaUser();
  if (!awaiting) redirect("/login");

  const { redirect: rawRedirect, methode } = await searchParams;
  const redirectTo = safeInternalPath(rawRedirect) || "/dashboard";

  // Passkeys zijn voor reguliere gebruikers; het adminaccount gebruikt TOTP.
  if (awaiting.user.role === "ADMIN") {
    redirect(`/mfa/totp?redirect=${encodeURIComponent(redirectTo)}`);
  }

  const alreadyHasPasskey = await hasPasskeys(awaiting.userId);
  const q = `redirect=${encodeURIComponent(redirectTo)}`;
  const totpOn = totpAllowedForUser(awaiting.user.role);
  const methods = totpOn ? await enrolledMethods(awaiting.user) : [];
  const hasTotp = methods.includes("totp");

  // Vlag uit terwijl dit account alleen een authenticator-app heeft: er is geen bruikbare methode. Fail-closed en duidelijk, geen
  // inschrijving met alleen een e-mailcode (er bestaat immers een methode). De webmin kan het account resetten.
  if (!totpOn && !alreadyHasPasskey && (await isTotpConfirmed(awaiting.userId))) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-4">
        <div className="glass-card w-full max-w-sm space-y-3 text-center">
          <h1 className="text-xl font-semibold">Ringtools</h1>
          <p className="text-sm">Inloggen met een authenticator-app is op dit moment niet beschikbaar.</p>
          <p className="text-sm text-[var(--text-muted)]">Neem contact op met je ringbeheerder; die kan de systeembeheerder vragen je verificatie te resetten.</p>
          <Link href="/login" className="btn-ghost block w-full">Terug naar inloggen</Link>
        </div>
      </main>
    );
  }

  // E2.1 (vlag): keuze tussen de ingeschreven methoden. Zonder vlag verandert dit scherm niet.
  if (totpOn && hasTotp && !alreadyHasPasskey) redirect(`/mfa/totp?${q}`);
  if (totpOn && hasTotp && alreadyHasPasskey && methode !== "passkey") {
    return (
      <main className="flex min-h-dvh items-center justify-center p-4">
        <div className="glass-card w-full max-w-sm space-y-4">
          <div className="text-center">
            <h1 className="text-xl font-semibold">Ringtools</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Hoe wil je bevestigen, {awaiting.user.name}?</p>
          </div>
          <Link href={`/mfa/passkey?${q}&methode=passkey`} className="btn-primary block w-full text-center">
            Met een passkey
          </Link>
          <Link href={`/mfa/totp?${q}`} className="btn-ghost block w-full text-center">
            Met een authenticator-app
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="glass-card w-full max-w-sm">
        <div className="mb-5 text-center">
          <h1 className="text-xl font-semibold">Ringtools</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Welkom, {awaiting.user.name}</p>
        </div>
        {alreadyHasPasskey ? (
          <PasskeyVerifyPanel redirectTo={redirectTo} />
        ) : (
          <PasskeyEnrollPanel redirectTo={redirectTo} />
        )}
        {totpOn && !alreadyHasPasskey && !hasTotp && (
          <Link href={`/mfa/totp?${q}`} className="mt-4 block w-full text-center text-sm text-[var(--text-muted)] underline">
            Liever een authenticator-app instellen
          </Link>
        )}
      </div>
    </main>
  );
}
