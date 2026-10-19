import { requireUser, getCurrentSession } from "@/lib/session";
import { listSessionsForUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isTotpConfirmed } from "@/lib/mfa";
import { TotpResetPanel } from "@/components/mfa/TotpResetPanel";
import { UserMfaToggle } from "@/components/mfa/UserMfaToggle";
import { PasskeyManager } from "@/components/mfa/PasskeyManager";
import { SessionList } from "@/components/mfa/SessionList";

export default async function BeveiligingPage() {
  const user = await requireUser();
  const currentSession = await getCurrentSession();

  const sessions = await listSessionsForUser(user.id);
  const passkeys =
    user.role === "ADMIN"
      ? []
      : await prisma.webAuthnCredential.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          select: { id: true, deviceLabel: true, createdAt: true, lastUsedAt: true },
        });

  return (
    <div className="mx-auto max-w-lg space-y-4 py-4">
      <div>
        <h1 className="text-xl font-semibold">Beveiliging</h1>
        <p className="text-sm text-[var(--text-muted)]">
          {user.role === "ADMIN" ? "Tweefactorauthenticatie is verplicht voor het beheerdersaccount." : "Extra verificatie met een passkey is optioneel."}
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
          <h2 className="font-semibold">Passkey-verificatie (optioneel)</h2>
          <UserMfaToggle enabled={user.mfaEnabled} hasPasskey={passkeys.length > 0} />
          <h3 className="pt-2 text-sm font-medium">Passkeys</h3>
          <PasskeyManager credentials={passkeys} mfaEnabled={user.mfaEnabled} />
        </div>
      )}

      <div className="glass-card space-y-3">
        <h2 className="font-semibold">Actieve sessies</h2>
        <SessionList sessions={sessions} currentSessionId={currentSession?.sessionId ?? ""} />
      </div>
    </div>
  );
}
