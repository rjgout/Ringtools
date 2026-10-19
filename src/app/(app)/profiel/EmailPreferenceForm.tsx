"use client";

import { useActionState } from "react";
import { updateEmailPreferenceAction, type ActionResult } from "@/lib/actions/push.actions";

const initialState: ActionResult = { ok: false, message: "" };

export function EmailPreferenceForm({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState(updateEmailPreferenceAction, initialState);

  return (
    <form action={action} className="glass-card space-y-3">
      <h2 className="font-semibold">E-mailmeldingen</h2>
      <p className="text-sm text-[var(--text-muted)]">
        Stemuitnodigingen, taaktoewijzingen en herinneringen per e-mail. Je inloglink (magic link) blijft altijd per
        e-mail verstuurd, ook als dit uitstaat.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="emailNotificationsEnabled" defaultChecked={enabled} className="h-4 w-4" />
        E-mailmeldingen voor de workflow ontvangen
      </label>
      {state.message && <p className="text-sm text-[var(--text-muted)]">{state.message}</p>}
      <button type="submit" disabled={pending} className="btn-ghost !min-h-[38px] text-sm">
        {pending ? "Opslaan…" : "Opslaan"}
      </button>
    </form>
  );
}
