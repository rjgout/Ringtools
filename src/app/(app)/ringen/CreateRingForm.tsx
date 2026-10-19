"use client";

import { useActionState } from "react";
import { createRingAction, renameRingAction, type ActionResult } from "@/lib/actions/ring.actions";
import { ROLE_LABELS } from "@/lib/format";
import type { Role } from "@prisma/client";

const initialState: ActionResult = { ok: false, message: "" };
const ASSIGNABLE: Role[] = ["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR", "HOGERAAD"];

export function CreateRingForm({ existingUsers }: { existingUsers: { id: string; name: string; email: string }[] }) {
  const [state, action, pending] = useActionState(createRingAction, initialState);
  return (
    <form action={action} className="glass-card space-y-4" data-testid="create-ring-form">
      <h2 className="font-semibold">Nieuwe ring aanmaken</h2>
      <div>
        <label className="label" htmlFor="ring-name">
          Naam van de ring
        </label>
        <input id="ring-name" name="name" required className="input" placeholder="Ring Voorbeeld" />
      </div>

      <div className="space-y-3 rounded-2xl bg-black/5 p-4 dark:bg-white/5">
        <p className="text-sm font-medium">Eerste gebruiker en ringbeheerder</p>
        <p className="text-xs text-[var(--text-muted)]">
          Deze gebruiker wordt verantwoordelijk voor het gebruikersbeheer van de ring. Een ring heeft altijd minstens één
          actieve ringbeheerder.
        </p>
        {existingUsers.length > 0 && (
          <div>
            <label className="label" htmlFor="ring-existing-user">
              Bestaande gebruiker selecteren (optioneel)
            </label>
            <select id="ring-existing-user" name="existingUserId" defaultValue="" className="input">
              <option value="">— Nieuwe gebruiker aanmaken —</option>
              {existingUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <input name="userName" placeholder="Naam (nieuwe gebruiker)" className="input" />
          <input name="userEmail" type="email" placeholder="E-mailadres (nieuwe gebruiker)" className="input" />
          <input name="churchFunction" required placeholder="Kerkelijke functie" className="input" />
          <select name="role" defaultValue="RINGSECRETARIS" className="input" aria-label="Rol binnen Ringtools">
            {ASSIGNABLE.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          De kerkelijke functie geeft geen rechten. De rol bepaalt de taken in Ringtools; een ringbeheerder die secretaris of
          administrateur is, neemt niet deel aan ondersteuningsrondes.
        </p>
      </div>

      {state.message && <p className={`text-sm ${state.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{state.message}</p>}
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Even geduld…" : "Ring aanmaken"}
      </button>
    </form>
  );
}

export function RenameRingForm({ ringId, name }: { ringId: string; name: string }) {
  const [state, action, pending] = useActionState(renameRingAction, initialState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="ringId" value={ringId} />
      <div className="min-w-[12rem] flex-1">
        <label className="label" htmlFor="ring-rename">
          Naam van de ring
        </label>
        <input id="ring-rename" name="name" defaultValue={name} required className="input" />
      </div>
      <button type="submit" disabled={pending} className="btn-ghost !min-h-[48px] text-sm">
        {pending ? "…" : "Naam opslaan"}
      </button>
      {state.message && (
        <p className={`w-full text-sm ${state.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{state.message}</p>
      )}
    </form>
  );
}
