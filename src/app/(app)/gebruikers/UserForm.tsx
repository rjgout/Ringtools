"use client";

import { useActionState } from "react";
import { addMemberAction, updateMemberAction, type ActionResult } from "@/lib/actions/user.actions";
import { ROLE_LABELS } from "@/lib/format";
import type { Role } from "@prisma/client";

const initialState: ActionResult = { ok: false, message: "" };
const ASSIGNABLE: Role[] = ["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR", "HOGERAAD"];

function Message({ state }: { state: ActionResult }) {
  if (!state.message) return null;
  return <p className={`text-sm ${state.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{state.message}</p>;
}

/**
 * Gebruiker aan een ring toevoegen. `existingUsers` (alleen voor de webmin)
 * laat ook een bestaand account aan deze ring koppelen; een ringbeheerder
 * kan alleen nieuwe gebruikers aanmaken.
 */
export function AddMemberForm({
  ringId,
  existingUsers,
}: {
  ringId: string;
  existingUsers?: { id: string; name: string; email: string }[];
}) {
  const [state, action, pending] = useActionState(addMemberAction, initialState);
  return (
    <form action={action} className="glass-card space-y-4" data-testid="create-user-form">
      <h2 className="font-semibold">Gebruiker toevoegen</h2>
      <input type="hidden" name="ringId" value={ringId} />

      {existingUsers && existingUsers.length > 0 && (
        <div>
          <label className="label" htmlFor={`existing-${ringId}`}>
            Bestaande gebruiker koppelen (optioneel)
          </label>
          <select id={`existing-${ringId}`} name="existingUserId" defaultValue="" className="input">
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
        <input name="name" placeholder="Naam (nieuwe gebruiker)" className="input" />
        <input name="email" type="email" placeholder="E-mailadres (nieuwe gebruiker)" className="input" />
        <input name="churchFunction" required placeholder="Kerkelijke functie" className="input" />
        <select name="role" required defaultValue="HOGERAAD" className="input" aria-label="Rol binnen Ringtools">
          {ASSIGNABLE.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isRingManager" className="h-4 w-4" />
        Ringbeheerder (verantwoordelijk voor gebruikersbeheer in deze ring)
      </label>
      <Message state={state} />
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Even geduld…" : "Gebruiker toevoegen"}
      </button>
    </form>
  );
}

export function EditMemberForm({
  membership,
  canEditProfile,
}: {
  membership: {
    id: string;
    name: string;
    email: string;
    role: Role;
    churchFunction: string;
    isRingManager: boolean;
    active: boolean;
  };
  /** Naam/e-mail zijn alleen te wijzigen als de persoon in geen enkele andere ring zit (of door de webmin). */
  canEditProfile: boolean;
}) {
  const [state, action, pending] = useActionState(updateMemberAction, initialState);
  return (
    <form action={action} className="space-y-3 border-t border-black/5 pt-4 dark:border-white/5">
      <input type="hidden" name="membershipId" value={membership.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        {canEditProfile ? (
          <>
            <input name="name" defaultValue={membership.name} required placeholder="Naam" className="input" />
            <input name="email" type="email" defaultValue={membership.email} required placeholder="E-mailadres" className="input" />
          </>
        ) : (
          <p className="text-xs text-[var(--text-muted)] sm:col-span-2">
            {membership.name} ({membership.email}) is ook lid van een andere ring; naam en e-mailadres kan alleen de
            systeembeheerder wijzigen.
          </p>
        )}
        <input name="churchFunction" defaultValue={membership.churchFunction} required placeholder="Kerkelijke functie" className="input" />
        <select name="role" defaultValue={membership.role} className="input" aria-label="Rol binnen Ringtools">
          {ASSIGNABLE.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isRingManager" defaultChecked={membership.isRingManager} className="h-4 w-4" />
        Ringbeheerder
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={membership.active} className="h-4 w-4" />
        Actief in deze ring
      </label>
      <Message state={state} />
      <button type="submit" disabled={pending} className="btn-ghost !min-h-[38px] text-sm">
        {pending ? "Even geduld…" : "Opslaan"}
      </button>
    </form>
  );
}
