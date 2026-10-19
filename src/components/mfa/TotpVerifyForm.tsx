"use client";

import { useActionState, useState } from "react";
import { verifyTotpLoginAction, useRecoveryCodeLoginAction, type ActionResult } from "@/lib/actions/mfa.actions";

const initialState: ActionResult = { ok: false, message: "" };

export function TotpVerifyForm({ redirectTo }: { redirectTo: string }) {
  const [mode, setMode] = useState<"code" | "recovery">("code");
  const [codeState, codeAction, codePending] = useActionState(verifyTotpLoginAction, initialState);
  const [recoveryState, recoveryAction, recoveryPending] = useActionState(useRecoveryCodeLoginAction, initialState);

  if (mode === "recovery") {
    return (
      <form action={recoveryAction} className="space-y-5">
        <div>
          <h2 className="font-semibold">Herstelcode gebruiken</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Vul één van je eenmalige herstelcodes in.</p>
        </div>
        <div>
          <label className="label" htmlFor="recovery-code">
            Herstelcode
          </label>
          <input id="recovery-code" name="code" required autoFocus className="input font-mono" placeholder="XXXXX-XXXXX" />
        </div>
        <input type="hidden" name="redirect" value={redirectTo} />
        <button type="submit" disabled={recoveryPending} className="btn-primary w-full">
          {recoveryPending ? "Even geduld…" : "Inloggen met herstelcode"}
        </button>
        {recoveryState.message && <p className="text-center text-sm text-[var(--danger)]">{recoveryState.message}</p>}
        <button type="button" onClick={() => setMode("code")} className="w-full text-center text-sm text-[var(--text-muted)] underline">
          Terug naar authenticatorcode
        </button>
      </form>
    );
  }

  return (
    <form action={codeAction} className="space-y-5">
      <div>
        <h2 className="font-semibold">Bevestig met je authenticator-app</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Vul de 6-cijferige code uit je authenticator-app in.</p>
      </div>
      <div>
        <label className="label" htmlFor="code">
          Code
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
      <button type="submit" disabled={codePending} className="btn-primary w-full">
        {codePending ? "Even geduld…" : "Inloggen"}
      </button>
      {codeState.message && <p className="text-center text-sm text-[var(--danger)]">{codeState.message}</p>}
      <button type="button" onClick={() => setMode("recovery")} className="w-full text-center text-sm text-[var(--text-muted)] underline">
        Ik heb geen toegang tot mijn authenticator
      </button>
    </form>
  );
}
