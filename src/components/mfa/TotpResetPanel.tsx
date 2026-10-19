"use client";

import { useActionState, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  startTotpReenrollmentAction,
  confirmTotpReenrollmentAction,
  regenerateRecoveryCodesAction,
  type TotpEnrollResult,
  type TotpEnrollmentView,
} from "@/lib/actions/mfa.actions";
import { RecoveryCodesReveal } from "./RecoveryCodesReveal";

const initialState: TotpEnrollResult = { ok: false, message: "" };

export function TotpResetPanel({ unusedRecoveryCodes }: { unusedRecoveryCodes: number }) {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<TotpEnrollmentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regenerated, setRegenerated] = useState<string[] | null>(null);
  const [state, action, pending] = useActionState(confirmTotpReenrollmentAction, initialState);

  async function startReset() {
    setError(null);
    try {
      setEnrollment(await startTotpReenrollmentAction());
    } catch {
      setError("Kon TOTP-instelling niet starten. Probeer het opnieuw.");
    }
  }

  async function regenerate() {
    setError(null);
    const result = await regenerateRecoveryCodesAction();
    if (!result.ok || !result.recoveryCodes) {
      setError(result.message);
      return;
    }
    setRegenerated(result.recoveryCodes);
  }

  if (state.ok && state.recoveryCodes) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-[var(--success)]">TOTP is opnieuw ingesteld.</p>
        <RecoveryCodesReveal codes={state.recoveryCodes} />
        <button
          type="button"
          className="btn-primary w-full"
          onClick={() => {
            setEnrollment(null);
            router.refresh();
          }}
        >
          Klaar
        </button>
      </div>
    );
  }

  if (regenerated) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-[var(--success)]">Nieuwe herstelcodes gegenereerd. De vorige codes werken niet meer.</p>
        <RecoveryCodesReveal codes={regenerated} />
        <button type="button" className="btn-primary w-full" onClick={() => setRegenerated(null)}>
          Klaar
        </button>
      </div>
    );
  }

  if (enrollment) {
    return (
      <form action={action} className="space-y-4">
        <div className="flex justify-center">
          <Image src={enrollment.qrDataUrl} alt="QR-code voor tweefactorauthenticatie" width={200} height={200} className="rounded-2xl bg-white p-2" unoptimized />
        </div>
        <details className="text-sm text-[var(--text-muted)]">
          <summary className="cursor-pointer select-none">Kan je niet scannen? Voer de code handmatig in</summary>
          <p className="mt-2 break-all rounded-xl bg-black/5 p-3 font-mono text-xs dark:bg-white/5">{enrollment.secret}</p>
        </details>
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          autoFocus
          className="input otp-input"
          placeholder="000000"
        />
        <button type="submit" disabled={pending} className="btn-primary w-full">
          {pending ? "Even geduld…" : "Bevestigen"}
        </button>
        {state.message && <p className="text-center text-sm text-[var(--danger)]">{state.message}</p>}
        <button type="button" onClick={() => setEnrollment(null)} className="w-full text-center text-sm text-[var(--text-muted)] underline">
          Annuleren
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--text-muted)]">{unusedRecoveryCodes} ongebruikte herstelcode(s) over.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={startReset} className="btn-ghost flex-1 !min-h-[40px] text-sm">
          TOTP opnieuw instellen
        </button>
        <button type="button" onClick={regenerate} className="btn-ghost flex-1 !min-h-[40px] text-sm">
          Nieuwe herstelcodes genereren
        </button>
      </div>
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
    </div>
  );
}
