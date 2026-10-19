"use client";

import { useActionState } from "react";
import { reverifyTotpAction, type ActionResult } from "@/lib/actions/mfa.actions";

const initialState: ActionResult = { ok: false, message: "" };

export function ReverifyTotpForm({ redirectTo }: { redirectTo: string }) {
  const [state, action, pending] = useActionState(reverifyTotpAction, initialState);

  return (
    <form action={action} className="space-y-5">
      <div>
        <label className="label" htmlFor="code">
          Authenticatorcode
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
