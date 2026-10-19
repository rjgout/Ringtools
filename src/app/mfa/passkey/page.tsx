import { redirect } from "next/navigation";
import { getAwaitingMfaUser, safeInternalPath } from "@/lib/session";
import { hasPasskeys } from "@/lib/webauthn";
import { PasskeyEnrollPanel } from "@/components/mfa/PasskeyEnrollPanel";
import { PasskeyVerifyPanel } from "@/components/mfa/PasskeyVerifyPanel";

export default async function PasskeyMfaPage({ searchParams }: { searchParams: Promise<{ redirect?: string }> }) {
  const awaiting = await getAwaitingMfaUser();
  if (!awaiting) redirect("/login");

  const { redirect: rawRedirect } = await searchParams;
  const redirectTo = safeInternalPath(rawRedirect) || "/dashboard";

  // Passkeys zijn voor reguliere gebruikers; het adminaccount gebruikt TOTP.
  if (awaiting.user.role === "ADMIN") {
    redirect(`/mfa/totp?redirect=${encodeURIComponent(redirectTo)}`);
  }

  const alreadyHasPasskey = await hasPasskeys(awaiting.userId);

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
      </div>
    </main>
  );
}
