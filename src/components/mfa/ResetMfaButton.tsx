"use client";

import { useActionState } from "react";
import { resetUserMfaAction, type ActionResult } from "@/lib/actions/mfa.actions";

const initialState: ActionResult = { ok: false, message: "" };

/** Noodprocedure (alleen webmin): wist alle verificatiemethoden en sessies van een gebruiker. Vraagt identiteitsbevestiging en het e-mailadres. */
export function ResetMfaButton({ userId, userName, email }: { userId: string; userName: string; email: string }) {
  const [state, action, pending] = useActionState(resetUserMfaAction, initialState);

  return (
    <details className="mt-2">
      <summary className="cursor-pointer select-none text-xs text-[var(--text-muted)]">Verificatie resetten (noodprocedure)</summary>
      <form action={action} className="mt-2 space-y-2">
        <p className="text-xs text-[var(--text-muted)]">
          Wist alle passkeys, de authenticator-app, herstelcodes en actieve sessies van {userName}. De gebruiker krijgt hierover een e-mail en stelt bij de
          volgende inlog opnieuw een methode in.
        </p>
        <input type="hidden" name="userId" value={userId} />
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" name="identityChecked" value="yes" required className="mt-0.5" />
          <span>Ik heb de identiteit van deze gebruiker buiten Ringtools gecontroleerd.</span>
        </label>
        <div>
          <label className="label text-xs" htmlFor={`reset-email-${userId}`}>
            Typ ter bevestiging het e-mailadres ({email})
          </label>
          <input id={`reset-email-${userId}`} name="confirmEmail" type="email" required autoComplete="off" className="input" />
        </div>
        <button type="submit" disabled={pending} className="btn-ghost !min-h-[32px] !px-3 text-xs">
          {pending ? "Bezig…" : "Verificatie resetten"}
        </button>
        {state.message && <p className={`text-xs ${state.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{state.message}</p>}
      </form>
    </details>
  );
}
