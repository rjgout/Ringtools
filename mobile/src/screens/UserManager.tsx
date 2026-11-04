import { useState } from "react";
import type { ManagedUser, Role } from "@shared/api-types";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { ApiRequestError } from "../lib/api";
import { useReauth } from "../components/Reauth";
import { ErrorState, Spinner } from "../components/ui";

const ROLES: { value: Role; label: string }[] = [
  { value: "RINGPRESIDIUM", label: "Ringpresidium" },
  { value: "RINGSECRETARIS", label: "Ringsecretaris" },
  { value: "RINGADMINISTRATEUR", label: "Ringadministrateur" },
  { value: "HOGERAAD", label: "Hoge raad" },
];

type Draft = { name: string; email: string; churchFunction: string; role: Role; isRingManager: boolean; active: boolean };
const EMPTY: Draft = { name: "", email: "", churchFunction: "", role: "HOGERAAD", isRingManager: false, active: true };

/**
 * Gebruikersbeheer voor één ring (ringbeheerder: eigen ring; webmin: elke ring). Alle regels — eigen ring,
 * minstens één actieve ringbeheerder, kerkelijke functie ≠ rechten — worden door de server afgedwongen.
 */
export function UserManager({ ringId }: { ringId: string }) {
  const { api } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api.ringUsers(ringId), [ringId]);
  const { run, dialog } = useReauth();
  const [editing, setEditing] = useState<ManagedUser | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function open(target: ManagedUser | "new") {
    setEditing(target);
    setMessage(null);
    setDraft(target === "new" ? EMPTY : { name: target.name, email: target.email, churchFunction: target.churchFunction, role: target.role, isRingManager: target.isRingManager, active: target.active });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      if (editing === "new") {
        await run(() => api.addRingUser(ringId, { name: draft.name, email: draft.email, churchFunction: draft.churchFunction, role: draft.role, isRingManager: draft.isRingManager }));
      } else {
        await run(() => api.updateRingUser(editing.membershipId, { churchFunction: draft.churchFunction, role: draft.role, isRingManager: draft.isRingManager, active: draft.active, name: draft.name, email: draft.email }));
      }
      setEditing(null);
      await reload();
    } catch (err) {
      setMessage(err instanceof ApiRequestError && err.code !== "cancelled" ? err.message : err instanceof ApiRequestError ? null : "Er ging iets mis.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {dialog}
      <div className="row between"><h2>Gebruikers</h2><button className="btn btn-primary" onClick={() => open("new")}>Toevoegen</button></div>
      {loading && !data && <Spinner />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data?.users.map((u) => (
        <button key={u.membershipId} className="glass panel" onClick={() => open(u)} aria-label={`Wijzig ${u.name}`}>
          <div className="row between">
            <div className="grow" style={{ textAlign: "left" }}>
              <strong>{u.name}</strong>
              <div className="muted">{u.churchFunction || "Geen functie"} · {ROLES.find((r) => r.value === u.role)?.label}</div>
            </div>
            <div className="stack" style={{ alignItems: "flex-end" }}>
              {u.isRingManager && <span className="badge ok">Ringbeheerder</span>}
              {!u.active && <span className="badge bad">Inactief</span>}
            </div>
          </div>
        </button>
      ))}

      {editing && (
        <form className="glass card stack" onSubmit={save} aria-label={editing === "new" ? "Gebruiker toevoegen" : "Gebruiker wijzigen"}>
          <strong>{editing === "new" ? "Gebruiker toevoegen" : "Gebruiker wijzigen"}</strong>
          <div><label htmlFor="u-name">Naam</label><input id="u-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required minLength={2} /></div>
          <div><label htmlFor="u-email">E-mailadres</label><input id="u-email" type="email" autoCapitalize="none" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} required /></div>
          <div><label htmlFor="u-func">Kerkelijke functie</label><input id="u-func" value={draft.churchFunction} onChange={(e) => setDraft({ ...draft, churchFunction: e.target.value })} required minLength={2} /></div>
          <div>
            <label htmlFor="u-role">Ringtools-rol</label>
            <select id="u-role" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}>
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <span className="muted">De kerkelijke functie geeft nooit automatisch rechten; alleen de rol bepaalt wat iemand mag.</span>
          </div>
          <label className="row"><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={draft.isRingManager} onChange={(e) => setDraft({ ...draft, isRingManager: e.target.checked })} /> Ringbeheerder (beheert de gebruikers van deze ring)</label>
          {editing !== "new" && <label className="row"><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Actief in deze ring</label>}
          {message && <div className="error" role="alert">{message}</div>}
          <div className="row">
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Annuleren</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? "Bezig…" : "Opslaan"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
