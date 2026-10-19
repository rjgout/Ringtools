import { redirect } from "next/navigation";
import { getCurrentSession, safeInternalPath } from "@/lib/session";
import { ReverifyTotpForm } from "@/components/mfa/ReverifyTotpForm";
import { PasskeyVerifyPanel } from "@/components/mfa/PasskeyVerifyPanel";

export default async function ReverifyPage({ searchParams }: { searchParams: Promise<{ redirect?: string }> }) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const { redirect: rawRedirect } = await searchParams;
  const redirectTo = safeInternalPath(rawRedirect) || "/profiel/beveiliging";

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
          <PasskeyVerifyPanel redirectTo={redirectTo} />
        )}
      </div>
    </main>
  );
}
