"use client";

import { useActionState } from "react";
import { createUserAction, updateUserAction, type ActionResult } from "@/lib/actions/user.actions";
import { ROLE_LABELS } from "@/lib/format";
import type { Role } from "@prisma/client";

const initialState: ActionResult = { ok: false, message: "" };
const ASSIGNABLE: Role[] = ["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR", "HOGERAAD"];

export function CreateUserForm() {
  const [state, action, pending] = useActionState(createUserAction, initialState);
  return (
    <form action={action} className="glass-card space-y-4" data-testid="create-user-form">
      <h2 className="font-semibold">Nieuwe gebruiker</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <input name="name" required placeholder="Naam" className="input" />
        <input name="email" type="email" required placeholder="E-mailadres" className="input" />
        <select name="role" required defaultValue="HOGERAAD" className="input">
          {ASSIGNABLE.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      {state.message && <p className={`text-sm ${state.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{state.message}</p>}
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Even geduld…" : "Gebruiker aanmaken"}
      </button>
    </form>
  );
}

export function EditUserForm({ user }: { user: { id: string; name: string; email: string; role: Role; active: boolean } }) {
  const [state, action, pending] = useActionState(updateUserAction, initialState);
  return (
    <form action={action} className="space-y-3 border-t border-black/5 pt-4 dark:border-white/5">
      <input type="hidden" name="id" value={user.id} />
      <div className="grid gap-3 sm:grid-cols-3">
        <input name="name" defaultValue={user.name} required placeholder="Naam" className="input" />
        <input name="email" type="email" defaultValue={user.email} required placeholder="E-mailadres" className="input" />
        <select name="role" defaultValue={user.role} className="input">
          {ASSIGNABLE.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={user.active} className="h-4 w-4" />
        Actief (kan inloggen)
      </label>
      {state.message && <p className={`text-sm ${state.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{state.message}</p>}
      <button type="submit" disabled={pending} className="btn-ghost !min-h-[38px] text-sm">
        {pending ? "Even geduld…" : "Opslaan"}
      </button>
    </form>
  );
}
