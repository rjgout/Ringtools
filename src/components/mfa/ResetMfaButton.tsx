"use client";

import { useActionState } from "react";
import { resetUserMfaAction, type ActionResult } from "@/lib/actions/mfa.actions";

const initialState: ActionResult = { ok: false, message: "" };

export function ResetMfaButton({ userId, userName }: { userId: string; userName: string }) {
  const [state, action, pending] = useActionState(resetUserMfaAction, initialState);

  return (
    <form
      action={action}
      className="mt-2"
      onSubmit={(e) => {
        if (!confirm(`MFA van ${userName} resetten? Alle actieve sessies en passkeys worden ingetrokken; de gebruiker moet opnieuw een passkey registreren.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" disabled={pending} className="btn-ghost !min-h-[32px] !px-3 text-xs">
        {pending ? "Bezig…" : "MFA resetten"}
      </button>
      {state.message && (
        <p className={`mt-1 text-xs ${state.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{state.message}</p>
      )}
    </form>
  );
}
