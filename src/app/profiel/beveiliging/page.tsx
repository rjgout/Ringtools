import { requireUser, getCurrentSession } from "@/lib/session";
import { listSessionsForUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isTotpConfirmed } from "@/lib/mfa";
import { TotpResetPanel } from "@/components/mfa/TotpResetPanel";
import { PasskeyManager } from "@/components/mfa/PasskeyManager";
import { SessionList } from "@/components/mfa/SessionList";

export default async function BeveiligingPage() {
  const user = await requireUser();
  const currentSession = await getCurrentSession();

  const sessions = await listSessionsForUser(user.id);

  return (
    <div className="mx-auto max-w-lg space-y-4 py-4">
      <div>
        <h1 className="text-xl font-semibold">Beveiliging</h1>
        <p className="text-sm text-[var(--text-muted)]">
          Tweefactorauthenticatie is verplicht voor toegang tot Ringtools.
        </p>
      </div>

      {user.role === "ADMIN" ? (
        <div className="glass-card space-y-3">
          <h2 className="font-semibold">Tweefactorauthenticatie (TOTP)</h2>
          <TotpResetPanel unusedRecoveryCodes={await prisma.recoveryCode.count({ where: { userId: user.id, usedAt: null } })} />
          <p className="text-xs text-[var(--text-muted)]">
            {(await isTotpConfirmed(user.id)) ? "TOTP is actief." : "TOTP is nog niet ingesteld."}
          </p>
        </div>
      ) : (
        <div className="glass-card space-y-3">
          <h2 className="font-semibold">Passkeys</h2>
          <PasskeyManager
            credentials={await prisma.webAuthnCredential.findMany({
              where: { userId: user.id },
              orderBy: { createdAt: "desc" },
              select: { id: true, deviceLabel: true, createdAt: true, lastUsedAt: true },
            })}
          />
        </div>
      )}

      <div className="glass-card space-y-3">
        <h2 className="font-semibold">Actieve sessies</h2>
        <SessionList sessions={sessions} currentSessionId={currentSession?.sessionId ?? ""} />
      </div>
    </div>
  );
}
