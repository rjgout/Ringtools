"use client";

import { useActionState, useState } from "react";
import { removePasskeyAction, type ActionResult } from "@/lib/actions/mfa.actions";
import { formatDateTime } from "@/lib/format";
import { PasskeyEnrollPanel } from "./PasskeyEnrollPanel";

const initialState: ActionResult = { ok: false, message: "" };

type Credential = { id: string; deviceLabel: string | null; createdAt: Date; lastUsedAt: Date | null };

function PasskeyRow({ credential, canRemove }: { credential: Credential; canRemove: boolean }) {
  const [state, action, pending] = useActionState(removePasskeyAction, initialState);

  return (
    <li className="space-y-1 rounded-xl bg-black/5 p-3 text-sm dark:bg-white/5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium">{credential.deviceLabel || "Onbekend apparaat"}</div>
          <div className="text-xs text-[var(--text-muted)]">
            Geregistreerd op {formatDateTime(credential.createdAt)}
            {credential.lastUsedAt && <> · laatst gebruikt {formatDateTime(credential.lastUsedAt)}</>}
          </div>
        </div>
        {canRemove && (
          <form action={action}>
            <input type="hidden" name="credentialId" value={credential.id} />
            <button type="submit" disabled={pending} className="btn-ghost !min-h-[32px] !px-3 text-xs">
              {pending ? "…" : "Verwijderen"}
            </button>
          </form>
        )}
      </div>
      {state.message && <p className={state.ok ? "text-xs text-[var(--success)]" : "text-xs text-[var(--danger)]"}>{state.message}</p>}
    </li>
  );
}

export function PasskeyManager({ credentials, mfaEnabled = true }: { credentials: Credential[]; mfaEnabled?: boolean }) {
  const [adding, setAdding] = useState(false);
  // Bij ingeschakelde verificatie is de laatste passkey nodig om in te loggen.
  const canRemove = credentials.length > 1 || !mfaEnabled;

  return (
    <div className="space-y-3">
      {credentials.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">Nog geen passkeys geregistreerd.</p>
      ) : (
        <ul className="space-y-2">
          {credentials.map((c) => (
            <PasskeyRow key={c.id} credential={c} canRemove={canRemove} />
          ))}
        </ul>
      )}
      {!canRemove && credentials.length === 1 && mfaEnabled && (
        <p className="text-xs text-[var(--text-muted)]">
          Dit is je enige passkey; registreer eerst een nieuwe voordat je deze kunt verwijderen.
        </p>
      )}

      {adding ? (
        <PasskeyEnrollPanel redirectTo="/profiel/beveiliging" onDone={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="btn-ghost w-full !min-h-[40px] text-sm">
          Passkey toevoegen
        </button>
      )}
    </div>
  );
}
