"use client";

import { useActionState, useState, useTransition } from "react";
import { createPairingCodeAction, revokeTrustedDeviceAction, disableDeviceLoginAction, type PairingResult, type RevokeResult } from "@/lib/actions/trustedDevices.actions";

type Device = { id: string; label: string; platform: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null; loginEnabledAt?: string | null };

const fmt = (iso: string) => new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });

/** Vertrouwde toestellen (E2.3, vlag TRUSTED_DEVICES_ENABLED): koppelcode aanmaken en toestellen intrekken. Een toestel is geen aparte inlogmethode. */
export function TrustedDevicesPanel({ devices, mfaEnabled }: { devices: Device[]; mfaEnabled: boolean }) {
  const [pairing, setPairing] = useState<PairingResult | null>(null);
  const [pending, start] = useTransition();
  const [revokeState, revokeAction, revoking] = useActionState<RevokeResult | null, FormData>(revokeTrustedDeviceAction, null);
  const [disableState, disableAction, disabling] = useActionState<RevokeResult | null, FormData>(disableDeviceLoginAction, null);
  const active = devices.filter((d) => !d.revokedAt);

  return (
    <div className="space-y-3" data-testid="trusted-devices">
      <p className="text-xs text-[var(--text-muted)]">
        Koppel je telefoon aan je account met een eenmalige code. Een gekoppeld toestel is <strong>geen</strong> vervanging van je passkey of authenticator-app en geeft op zichzelf geen toegang.
      </p>
      {active.length === 0 ? (
        <p className="text-sm">Geen gekoppelde toestellen.</p>
      ) : (
        <ul className="space-y-2">
          {active.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 rounded-xl bg-black/5 p-3 text-sm dark:bg-white/5">
              <span>
                <strong>{d.label}</strong> <span className="text-[var(--text-muted)]">· {d.platform === "IOS" ? "iPhone" : "Android"} · gekoppeld op {fmt(d.createdAt)}</span>
              </span>
              {d.loginEnabledAt && (
                <form action={disableAction}>
                  <input type="hidden" name="deviceId" value={d.id} />
                  <span className="text-xs text-[var(--text-muted)]">Wachtwoordloos inloggen: aan · </span>
                  <button type="submit" disabled={disabling} className="btn-ghost !min-h-[32px] !px-3 text-xs">Uitzetten</button>
                </form>
              )}
              <form action={revokeAction}>
                <input type="hidden" name="deviceId" value={d.id} />
                <button type="submit" disabled={revoking} className="btn-ghost !min-h-[32px] !px-3 text-xs">
                  Intrekken
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {disableState?.message && <p className={`text-xs ${disableState.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{disableState.message}</p>}
      {revokeState?.message && <p className={`text-xs ${revokeState.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{revokeState.message}</p>}
      {mfaEnabled ? (
        <button
          type="button"
          className="btn-ghost"
          disabled={pending}
          onClick={() => start(async () => setPairing(await createPairingCodeAction()))}
        >
          {pending ? "Bezig…" : "Nieuw toestel koppelen"}
        </button>
      ) : (
        <p className="text-xs text-[var(--text-muted)]">Schakel eerst verificatie in om een toestel te kunnen koppelen.</p>
      )}
      {pairing?.code && (
        <div className="rounded-xl border border-black/10 p-3 dark:border-white/10" role="status">
          <p className="text-xs text-[var(--text-muted)]">{pairing.message}</p>
          <p className="font-mono text-2xl tracking-widest" data-testid="pairing-code">{pairing.code}</p>
        </div>
      )}
      {pairing && !pairing.ok && <p className="text-xs text-[var(--danger)]">{pairing.message}</p>}
    </div>
  );
}
