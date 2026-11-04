import { useState } from "react";
import type { AppointAuthority, ChurchFunctionCode, ManagedUser, Role } from "@shared/api-types";
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

type Draft = { name: string; email: string; churchFunction: string; churchFunctionCode: ChurchFunctionCode; role: Role; isRingManager: boolean; active: boolean; appointAuthority: AppointAuthority };
const EMPTY: Draft = { name: "", email: "", churchFunction: "", churchFunctionCode: "ONBEKEND", role: "HOGERAAD", isRingManager: false, active: true, appointAuthority: "NONE" };

/** Gestructureerde kerkelijke functies en bij welke Ringtools-rollen ze passen (de server dwingt dit af). */
export const CHURCH_FUNCTIONS: { value: ChurchFunctionCode; label: string; roles: Role[] | null }[] = [
  { value: "ONBEKEND", label: "Nog niet vastgelegd (geen bevoegdheden)", roles: null },
  { value: "RINGPRESIDENT", label: "Ringpresident", roles: ["RINGPRESIDIUM"] },
  { value: "EERSTE_RAADGEVER", label: "Eerste raadgever ringpresidium", roles: ["RINGPRESIDIUM"] },
  { value: "TWEEDE_RAADGEVER", label: "Tweede raadgever ringpresidium", roles: ["RINGPRESIDIUM"] },
  { value: "RINGSECRETARIS", label: "Ringsecretaris", roles: ["RINGSECRETARIS"] },
  { value: "RINGADMINISTRATEUR", label: "Ringadministrateur", roles: ["RINGADMINISTRATEUR"] },
  { value: "HOGERAADSLID", label: "Hogeraadslid", roles: ["HOGERAAD"] },
  { value: "ANDERS", label: "Andere functie (zie omschrijving)", roles: null },
];
export const functionLabel = (c: ChurchFunctionCode | undefined) => CHURCH_FUNCTIONS.find((f) => f.value === c)?.label ?? "Nog niet vastgelegd";

/** Machtigingen zijn alleen waar het handboek een "aangewezen" persoon vraagt, en alleen bij de passende functie. De ringpresident heeft er geen nodig. */
const authoritiesFor = (fn: ChurchFunctionCode): { value: AppointAuthority; label: string }[] => [
  { value: "NONE", label: "Geen machtiging" },
  ...(fn === "EERSTE_RAADGEVER" || fn === "TWEEDE_RAADGEVER" ? [{ value: "AANGEWEZEN_RAADGEVER" as const, label: "Aangewezen raadgever (machtiging)" }] : []),
  ...(fn === "HOGERAADSLID" ? [{ value: "AANGEWEZEN_HOGERAADSLID" as const, label: "Aangewezen hogeraadslid (machtiging)" }] : []),
];
const AUTHORITY_LABELS: Record<AppointAuthority, string> = { NONE: "", RINGPRESIDENT: "", AANGEWEZEN_RAADGEVER: "Aangewezen raadgever", AANGEWEZEN_HOGERAADSLID: "Aangewezen hogeraadslid" };

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
    setDraft(target === "new" ? EMPTY : { name: target.name, email: target.email, churchFunction: target.churchFunction, churchFunctionCode: target.churchFunctionCode ?? "ONBEKEND", role: target.role, isRingManager: target.isRingManager, active: target.active, appointAuthority: target.appointAuthority ?? "NONE" });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || busy) return;
    setBusy(true);
    setMessage(null);
    // Omschrijving is vrije tekst (geen bevoegdheid); zonder omschrijving gebruiken we de naam van de gekozen functie.
    const description = draft.churchFunction.trim() || (draft.churchFunctionCode === "ONBEKEND" ? "Functie nog niet vastgelegd" : functionLabel(draft.churchFunctionCode));
    const authority = authoritiesFor(draft.churchFunctionCode).some((a) => a.value === draft.appointAuthority) ? draft.appointAuthority : "NONE";
    try {
      if (editing === "new") {
        await run(() => api.addRingUser(ringId, { name: draft.name, email: draft.email, churchFunction: description, churchFunctionCode: draft.churchFunctionCode, role: draft.role, isRingManager: draft.isRingManager, appointAuthority: authority }));
      } else {
        await run(() => api.updateRingUser(editing.membershipId, { churchFunction: description, churchFunctionCode: draft.churchFunctionCode, role: draft.role, isRingManager: draft.isRingManager, active: draft.active, appointAuthority: authority, name: draft.name, email: draft.email }));
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
              <div className="muted">{functionLabel(u.churchFunctionCode)}{u.churchFunction && u.churchFunctionCode === "ANDERS" ? ` – ${u.churchFunction}` : ""} · Rol: {ROLES.find((r) => r.value === u.role)?.label}</div>
              {u.churchFunctionCode === "ONBEKEND" && (u.role === "RINGPRESIDIUM" || u.role === "HOGERAAD") && <div className="muted">Kerkelijke functie nog vast te leggen</div>}
            </div>
            <div className="stack" style={{ alignItems: "flex-end" }}>
              {u.isRingManager && <span className="badge ok">Ringbeheerder</span>}
              {u.appointAuthority && AUTHORITY_LABELS[u.appointAuthority] && <span className="badge">{AUTHORITY_LABELS[u.appointAuthority]}</span>}
              {!u.activated && <span className="badge">Nog niet ingelogd</span>}
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
          <div>
            <label htmlFor="u-role">Ringtools-rol (toegang)</label>
            <select id="u-role" value={draft.role} onChange={(e) => {
              const role = e.target.value as Role;
              const fits = CHURCH_FUNCTIONS.find((f) => f.value === draft.churchFunctionCode)?.roles?.includes(role) ?? true;
              setDraft({ ...draft, role, churchFunctionCode: fits ? draft.churchFunctionCode : "ONBEKEND", appointAuthority: fits ? draft.appointAuthority : "NONE" });
            }}>
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <span className="muted">De rol regelt alleen toegang en gebruikersbeheer. Een rol geeft nooit kerkelijke bevoegdheid.</span>
          </div>
          <div>
            <label htmlFor="u-fcode">Kerkelijke functie</label>
            <select id="u-fcode" value={draft.churchFunctionCode} onChange={(e) => {
              const churchFunctionCode = e.target.value as ChurchFunctionCode;
              setDraft({ ...draft, churchFunctionCode, appointAuthority: authoritiesFor(churchFunctionCode).some((a) => a.value === draft.appointAuthority) ? draft.appointAuthority : "NONE" });
            }}>
              {CHURCH_FUNCTIONS.filter((f) => f.roles === null || f.roles.includes(draft.role)).map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <span className="muted">De functie bepaalt welke bevoegdheden volgens de handboekprocedure mogelijk zijn. Bij &lsquo;Nog niet vastgelegd&rsquo; heeft iemand geen enkele bevoegdheid.</span>
          </div>
          <div><label htmlFor="u-func">Omschrijving (optioneel)</label><input id="u-func" value={draft.churchFunction} onChange={(e) => setDraft({ ...draft, churchFunction: e.target.value })} maxLength={200} /><span className="muted">Vrije tekst ter informatie; bepaalt nooit een bevoegdheid.</span></div>
          <div>
            <label htmlFor="u-auth">Machtiging</label>
            <select id="u-auth" value={authoritiesFor(draft.churchFunctionCode).some((a) => a.value === draft.appointAuthority) ? draft.appointAuthority : "NONE"} onChange={(e) => setDraft({ ...draft, appointAuthority: e.target.value as AppointAuthority })}>
              {authoritiesFor(draft.churchFunctionCode).map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            <span className="muted">{draft.churchFunctionCode === "RINGPRESIDENT" ? "De ringpresident is op grond van zijn functie bevoegd; een aparte machtiging is niet nodig." : "Alleen een expliciet vastgelegde machtiging maakt een aangewezen raadgever of hogeraadslid bevoegd om te roepen of aan te stellen."}</span>
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
