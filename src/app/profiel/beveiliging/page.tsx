import { requireUser, getCurrentSession } from "@/lib/session";
import { listSessionsForUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isTotpConfirmed } from "@/lib/mfa";
import { TotpResetPanel } from "@/components/mfa/TotpResetPanel";
import { UserMfaToggle } from "@/components/mfa/UserMfaToggle";
import { totpAllowedForUser } from "@/lib/mfaMethods";
import { UserTotpPanel } from "@/components/mfa/UserTotpPanel";
import { PasskeyManager } from "@/components/mfa/PasskeyManager";
import { SessionList } from "@/components/mfa/SessionList";

export default async function BeveiligingPage() {
  const user = await requireUser();
  const currentSession = await getCurrentSession();

  const sessions = await listSessionsForUser(user.id);
  const totpOn = totpAllowedForUser(user.role);
  const totpConfigured = totpOn && (await isTotpConfirmed(user.id));
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
          {user.role === "ADMIN" ? "Tweefactorauthenticatie is verplicht voor het beheerdersaccount." : totpOn ? "Extra verificatie met een passkey of authenticator-app is optioneel." : "Extra verificatie met een passkey is optioneel."}
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
          <h2 className="font-semibold">{totpOn ? "Verificatie (optioneel)" : "Passkey-verificatie (optioneel)"}</h2>
          <ul className="space-y-1 rounded-xl bg-black/5 p-3 text-sm dark:bg-white/5" data-testid="methods-overview" aria-label="Ingestelde verificatiemethoden">
            <li>
              Passkey: <strong>{passkeys.length > 0 ? `${passkeys.length} geregistreerd` : "niet ingesteld"}</strong>
              {passkeys.length > 0 && <span className="text-[var(--text-muted)]"> · aanbevolen, beschermt tegen phishing</span>}
            </li>
            {totpOn && (
              <li>
                Authenticator-app: <strong>{totpConfigured ? "ingesteld" : "niet ingesteld"}</strong>
              </li>
            )}
          </ul>
          <UserMfaToggle enabled={user.mfaEnabled} hasMethod={passkeys.length > 0 || totpConfigured} totpEnabled={totpOn} />
          <h3 className="pt-2 text-sm font-medium">Passkeys</h3>
          <PasskeyManager credentials={passkeys} mfaEnabled={user.mfaEnabled} />
          {totpOn && (
            <>
              <h3 className="pt-2 text-sm font-medium">Authenticator-app</h3>
              <UserTotpPanel
                configured={totpConfigured}
                canRemove={!user.mfaEnabled || passkeys.length > 0}
                unusedRecoveryCodes={totpConfigured ? await prisma.recoveryCode.count({ where: { userId: user.id, usedAt: null } }) : 0}
                suggestPasskey={totpConfigured && passkeys.length === 0}
              />
            </>
          )}
        </div>
      )}

      <div className="glass-card space-y-3">
        <h2 className="font-semibold">Actieve sessies</h2>
        <SessionList sessions={sessions} currentSessionId={currentSession?.sessionId ?? ""} />
      </div>
    </div>
  );
}
