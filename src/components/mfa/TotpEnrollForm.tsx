"use client";

import { useActionState } from "react";
import Image from "next/image";
import { confirmTotpEnrollmentLoginAction, finalizeAwaitingMfaEnrollmentAction, type TotpEnrollResult } from "@/lib/actions/mfa.actions";
import { RecoveryCodesReveal } from "./RecoveryCodesReveal";

const initialState: TotpEnrollResult = { ok: false, message: "" };

export function TotpEnrollForm({ qrDataUrl, secret, redirectTo }: { qrDataUrl: string; secret: string; redirectTo: string }) {
  const [state, action, pending] = useActionState(confirmTotpEnrollmentLoginAction, initialState);

  if (state.ok && state.recoveryCodes) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="font-semibold">TOTP is ingesteld</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Bewaar je herstelcodes voordat je verdergaat.</p>
        </div>
        <RecoveryCodesReveal codes={state.recoveryCodes} />
        <form action={finalizeAwaitingMfaEnrollmentAction}>
          <input type="hidden" name="redirect" value={redirectTo} />
          <button type="submit" className="btn-primary w-full">
            Ik heb mijn herstelcodes opgeslagen, ga verder
          </button>
        </form>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <div>
        <h2 className="font-semibold">Stel tweefactorauthenticatie in</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Scan deze QR-code met een authenticator-app (bv. Google Authenticator, Microsoft Authenticator of 1Password) en
          bevestig daarna met een code.
        </p>
      </div>

      <div className="flex justify-center">
        <Image src={qrDataUrl} alt="QR-code voor tweefactorauthenticatie" width={220} height={220} className="rounded-2xl bg-white p-2" unoptimized />
      </div>

      <details className="text-sm text-[var(--text-muted)]">
        <summary className="cursor-pointer select-none">Kan je niet scannen? Voer de code handmatig in</summary>
        <p className="mt-2 break-all rounded-xl bg-black/5 p-3 font-mono text-xs dark:bg-white/5">{secret}</p>
      </details>

      <div>
        <label className="label" htmlFor="code">
          Bevestigingscode
        </label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          autoFocus
          className="input otp-input"
          placeholder="000000"
        />
      </div>

      <input type="hidden" name="redirect" value={redirectTo} />
      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "Even geduld…" : "Bevestigen"}
      </button>
      {state.message && <p className="text-center text-sm text-[var(--danger)]">{state.message}</p>}
    </form>
  );
}
