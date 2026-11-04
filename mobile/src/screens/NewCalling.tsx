import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { ApiRequestError } from "../lib/api";
import { ErrorState, Spinner } from "../components/ui";

type Key = "roepenAssigneeId" | "ondersteunenAssigneeId" | "aanstellenAssigneeId";
const TASKS: { key: Key; label: string }[] = [
  { key: "roepenAssigneeId", label: "Roepen" },
  { key: "ondersteunenAssigneeId", label: "Ondersteunen (bekendmaken)" },
  { key: "aanstellenAssigneeId", label: "Aanstellen" },
];

/** Nieuw roepingsvoorstel in de actieve ring. De server controleert bevoegdheid en ringlidmaatschap. */
export function NewCalling() {
  const { api, ring } = useAuth();
  const navigate = useNavigate();
  const members = useLoad(() => api.ringMembers(ring!.id), [ring?.id]);
  const [personName, setPersonName] = useState("");
  const [functionTitle, setFunctionTitle] = useState("");
  const [assignees, setAssignees] = useState<Record<Key, string>>({ roepenAssigneeId: "", ondersteunenAssigneeId: "", aanstellenAssigneeId: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const created = await api.createCalling(ring!.id, {
        personName,
        functionTitle,
        roepenAssigneeId: assignees.roepenAssigneeId || null,
        ondersteunenAssigneeId: assignees.ondersteunenAssigneeId || null,
        aanstellenAssigneeId: assignees.aanstellenAssigneeId || null,
      });
      navigate(`/roepingen/${created.id}`, { replace: true });
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => navigate(-1)}>‹ Terug</button>
      <h1>Nieuw voorstel</h1>
      <span className="muted">Ring: {ring?.name}</span>
      {members.loading && !members.data && <Spinner />}
      {members.error && <ErrorState error={members.error} onRetry={members.reload} />}
      {members.data && (
        <div className="glass card stack">
          <div><label htmlFor="person">Naam van de persoon</label><input id="person" value={personName} onChange={(e) => setPersonName(e.target.value)} required minLength={2} maxLength={200} /></div>
          <div><label htmlFor="func">Roeping / functie</label><input id="func" value={functionTitle} onChange={(e) => setFunctionTitle(e.target.value)} required minLength={2} maxLength={200} /></div>
          {TASKS.map((t) => (
            <div key={t.key}>
              <label htmlFor={t.key}>Verantwoordelijke voor {t.label.toLowerCase()} (optioneel)</label>
              <select id={t.key} value={assignees[t.key]} onChange={(e) => setAssignees((a) => ({ ...a, [t.key]: e.target.value }))}>
                <option value="">Nog niet toegewezen</option>
                {members.data?.members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.churchFunction ? ` – ${m.churchFunction}` : ""}</option>)}
              </select>
            </div>
          ))}
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Bezig…" : "Voorstel indienen"}</button>
        </div>
      )}
      {message && <div role="alert" className="glass panel">{message}</div>}
    </form>
  );
}
