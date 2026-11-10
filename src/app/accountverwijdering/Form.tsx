"use client";
import { useActionState } from "react";
import { deletionAction } from "./actions";
export function DeletionForm({ signedIn }: { signedIn: boolean }) {
  const [state, action, pending] = useActionState(deletionAction, null);
  return <form action={action} className="space-y-3">
    {!signedIn && <><label className="block">E-mailadres van je account<input name="email" type="email" autoComplete="email" required className="input w-full" /></label><label className="block">Bevestigingscode (leeg laten om eerst een code aan te vragen)<input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} className="input w-full" /></label></>}
    <label className="flex gap-3"><input type="checkbox" name="confirm" required /><span>Ik wil mijn volledige account in alle ringen verwijderen. Ik begrijp dat alle toegang en toestelsleutels vervallen en dat open verantwoordelijkheid eerst wordt overgedragen.</span></label>
    <button className="btn btn-primary" disabled={pending}>{pending ? "Even geduld…" : signedIn ? "Accountverwijdering aanvragen" : "Code aanvragen / verzoek bevestigen"}</button>
    {state && <p role="status">{state.message}</p>}
  </form>;
}
