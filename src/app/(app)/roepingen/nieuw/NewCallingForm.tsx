"use client";

import { useActionState } from "react";
import { createCallingAction, type ActionResult } from "@/lib/actions/calling.actions";
import { ROLE_LABELS } from "@/lib/format";
import type { Role } from "@prisma/client";

const initialState: ActionResult = { ok: false, message: "" };

export function NewCallingForm({ users }: { users: { id: string; name: string; role: Role }[] }) {
  const [state, action, pending] = useActionState(createCallingAction, initialState);

  return (
    <form action={action} className="glass-card space-y-5">
      <div>
        <label className="label" htmlFor="personName">
          Naam van de persoon
        </label>
        <input id="personName" name="personName" required className="input" placeholder="Jan Jansen" />
      </div>
      <div>
        <label className="label" htmlFor="functionTitle">
          Roeping / functie
        </label>
        <input id="functionTitle" name="functionTitle" required className="input" placeholder="Hogeraadslid" />
      </div>

      <p className="text-sm font-medium text-[var(--text-muted)]">
        Verantwoordelijken (optioneel, mag ook later worden toegewezen)
      </p>

      <AssigneeSelect name="roepenAssigneeId" label="Verantwoordelijke voor het roepen" users={users} />
      <AssigneeSelect name="ondersteunenAssigneeId" label="Verantwoordelijke voor het ondersteunen" users={users} />
      <AssigneeSelect name="aanstellenAssigneeId" label="Verantwoordelijke voor het aanstellen" users={users} />

      {state.message && <p className="text-sm text-[var(--danger)]">{state.message}</p>}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "Even geduld…" : "Voorstel indienen"}
      </button>
    </form>
  );
}

function AssigneeSelect({
  name,
  label,
  users,
}: {
  name: string;
  label: string;
  users: { id: string; name: string; role: Role }[];
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      <select id={name} name={name} className="input" defaultValue="">
        <option value="">Nog niet toewijzen</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} ({ROLE_LABELS[u.role]})
          </option>
        ))}
      </select>
    </div>
  );
}
