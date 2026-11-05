import { redirect } from "next/navigation";
import Link from "next/link";
import { getAwaitingMfaUser, safeInternalPath } from "@/lib/session";
import { loginPlan, totpAllowedForUser } from "@/lib/mfaMethods";
import { PasskeyEnrollPanel } from "@/components/mfa/PasskeyEnrollPanel";
import { PasskeyVerifyPanel } from "@/components/mfa/PasskeyVerifyPanel";

export default async function PasskeyMfaPage({ searchParams }: { searchParams: Promise<{ redirect?: string; methode?: string }> }) {
  const awaiting = await getAwaitingMfaUser();
  if (!awaiting) redirect("/login");

  const { redirect: rawRedirect, methode } = await searchParams;
  const redirectTo = safeInternalPath(rawRedirect) || "/dashboard";
  const q = `redirect=${encodeURIComponent(redirectTo)}`;

  // Passkeys zijn voor reguliere gebruikers; het adminaccount gebruikt TOTP (ongewijzigd).
  if (awaiting.user.role === "ADMIN") redirect(`/mfa/totp?${q}`);

  const { plan } = await loginPlan(awaiting.user);
  if (plan === "totp") redirect(`/mfa/totp?${q}`);

  const shell = (children: React.ReactNode) => (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="glass-card w-full max-w-sm">{children}</div>
    </main>
  );

  // Alleen een authenticator-app terwijl die op dit moment niet beschikbaar is: fail-closed, geen inschrijving met alleen een e-mailcode.
  if (plan === "unavailable") {
    return shell(
      <div className="space-y-3 text-center">
        <h1 className="text-xl font-semibold">Ringtools</h1>
        <p className="text-sm">Inloggen met een authenticator-app is op dit moment niet beschikbaar.</p>
        <p className="text-sm text-[var(--text-muted)]">Neem contact op met je ringbeheerder; die kan de systeembeheerder vragen je verificatie te resetten.</p>
        <Link href="/login" className="btn-ghost block w-full">
          Terug naar inloggen
        </Link>
      </div>
    );
  }

  // Beide methoden: keuzescherm met de passkey als voorkeur (phishingbestendig). Wisselen kan zonder nieuwe e-mailcode.
  if (plan === "choose" && methode !== "passkey") {
    return shell(
      <div className="space-y-4" data-testid="mfa-chooser">
        <div className="text-center">
          <h1 className="text-xl font-semibold">Ringtools</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Hoe wil je bevestigen, {awaiting.user.name}?</p>
        </div>
        <Link href={`/mfa/passkey?${q}&methode=passkey`} className="btn-primary block w-full text-center">
          <span className="block font-semibold">Met een passkey</span>
          <span className="block text-xs font-normal opacity-90">Aanbevolen · Face ID, Touch ID of schermcode · beschermt tegen phishing</span>
        </Link>
        <Link href={`/mfa/totp?${q}`} className="btn-ghost block w-full text-center">
          <span className="block font-semibold">Met een authenticator-app</span>
          <span className="block text-xs font-normal text-[var(--text-muted)]">Zescijferige code uit je app</span>
        </Link>
      </div>
    );
  }

  const head = (
    <div className="mb-5 text-center">
      <h1 className="text-xl font-semibold">Ringtools</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">Welkom, {awaiting.user.name}</p>
    </div>
  );

  if (plan === "enroll") {
    return shell(
      <>
        {head}
        <PasskeyEnrollPanel redirectTo={redirectTo} />
        {totpAllowedForUser(awaiting.user.role) && (
          <Link href={`/mfa/totp?${q}`} className="mt-4 block w-full text-center text-sm text-[var(--text-muted)] underline">
            Liever een authenticator-app instellen
          </Link>
        )}
      </>
    );
  }

  // plan: passkey (alleen een passkey) of choose + methode=passkey
  return shell(
    <>
      {head}
      <PasskeyVerifyPanel redirectTo={redirectTo} alternativeHref={plan === "choose" ? `/mfa/totp?${q}` : undefined} />
      {plan === "choose" && (
        <Link href={`/mfa/passkey?${q}`} className="mt-3 block w-full text-center text-sm text-[var(--text-muted)] underline">
          Alle methoden bekijken
        </Link>
      )}
    </>
  );
}
