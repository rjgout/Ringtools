"use client";

import { useActionState } from "react";
import { enableUserMfaAction, disableUserMfaAction, type ActionResult } from "@/lib/actions/mfa.actions";

const initialState: ActionResult = { ok: false, message: "" };

export function UserMfaToggle({ enabled, hasPasskey }: { enabled: boolean; hasPasskey: boolean }) {
  const [state, action, pending] = useActionState(
    async () => (enabled ? disableUserMfaAction() : enableUserMfaAction()),
    initialState
  );

  return (
    <div className="space-y-2">
      <p className="text-sm">
        Passkey-verificatie is <strong>{enabled ? "ingeschakeld" : "uitgeschakeld"}</strong>.{" "}
        <span className="text-[var(--text-muted)]">
          {enabled
            ? "Na de inloglink bevestig je met je passkey (Face ID, Touch ID of schermcode)."
            : "Je logt in met alleen de inloglink uit je e-mail. Schakel verificatie in voor extra beveiliging."}
        </span>
      </p>
      <form action={action}>
        <button type="submit" disabled={pending || (!enabled && !hasPasskey)} className={enabled ? "btn-ghost text-sm" : "btn-primary text-sm"}>
          {pending ? "Even geduld…" : enabled ? "Verificatie uitschakelen" : "Verificatie inschakelen"}
        </button>
      </form>
      {!enabled && !hasPasskey && (
        <p className="text-xs text-[var(--text-muted)]">Registreer hieronder eerst een passkey om verificatie in te kunnen schakelen.</p>
      )}
      {state.message && <p className={`text-sm ${state.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{state.message}</p>}
    </div>
  );
}
