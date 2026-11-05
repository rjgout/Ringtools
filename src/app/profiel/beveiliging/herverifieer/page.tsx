import { redirect } from "next/navigation";
import { getCurrentSession, safeInternalPath } from "@/lib/session";
import { ReverifyTotpForm } from "@/components/mfa/ReverifyTotpForm";
import { enrolledMethods } from "@/lib/mfaMethods";
import { PasskeyVerifyPanel } from "@/components/mfa/PasskeyVerifyPanel";

export default async function ReverifyPage({ searchParams }: { searchParams: Promise<{ redirect?: string }> }) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const { redirect: rawRedirect } = await searchParams;
  const redirectTo = safeInternalPath(rawRedirect) || "/profiel/beveiliging";

  const methods = session.user.role === "ADMIN" ? [] : await enrolledMethods(session.user);
  const offerTotp = methods.includes("totp");
  const offerPasskey = methods.includes("passkey") || !offerTotp; // ongewijzigd gedrag zolang er geen TOTP is

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="glass-card w-full max-w-sm">
        <div className="mb-5 text-center">
          <h1 className="text-xl font-semibold">Bevestig je identiteit</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Deze actie raakt je beveiligingsinstellingen. Verifieer opnieuw om door te gaan.
          </p>
        </div>
        {session.user.role === "ADMIN" ? (
          <ReverifyTotpForm redirectTo={redirectTo} />
        ) : (
          <div className="space-y-6">
            {offerPasskey && <PasskeyVerifyPanel redirectTo={redirectTo} />}
            {offerTotp && (
              <div className="space-y-2">
                {offerPasskey && <p className="text-center text-xs text-[var(--text-muted)]">of met je authenticator-app</p>}
                <ReverifyTotpForm redirectTo={redirectTo} />
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
