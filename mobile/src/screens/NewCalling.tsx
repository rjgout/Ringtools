import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { DraftView } from "@shared/api-types";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { ApiRequestError } from "../lib/api";
import { ErrorState, Spinner } from "../components/ui";
import { CallingPicker, type PickedCalling } from "../components/CallingPicker";

type TaskKey = "roepen" | "ondersteunen" | "aanstellen";

/**
 * Nieuw voorstel in vijf stappen: naam (handmatig) → wijk/gemeente → roeping (catalogus of eigen) → verantwoordelijken controleren → concept opslaan of indienen.
 * Alles wordt als concept op de server bewaard (onvolledig mag); indienen valideert op de server opnieuw en is idempotent.
 * Er is geen koppeling met een ledenregister of LCR: de naam wordt altijd ingevoerd.
 */
const SOURCE_LABEL: Record<string, string> = {
  UNIT_STANDAARD: "standaard van de wijk/gemeente",
  UNIT_VERANTWOORDELIJKE: "verantwoordelijk hogeraadslid van de wijk/gemeente",
  FUNCTIE_RINGPRESIDENT: "ringpresident",
  FUNCTIE_ENIGE_BEVOEGDE: "enige bevoegde persoon",
};

export function NewCalling() {
  const { id: draftIdParam } = useParams();
  const { api, ring } = useAuth();
  const navigate = useNavigate();
  const [draftId, setDraftId] = useState<string | null>(draftIdParam ?? null);
  const [personName, setPersonName] = useState("");
  const [unitId, setUnitId] = useState("");
  const [picked, setPicked] = useState<PickedCalling | null>(null);
  const [assignees, setAssignees] = useState<Record<TaskKey, string>>({ roepen: "", ondersteunen: "", aanstellen: "" });
  const [external, setExternal] = useState<{ roepen: string; aanstellen: string }>({ roepen: "", aanstellen: "" });
  const [view, setView] = useState<DraftView | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submitting = useRef(false); // voorkomt dubbel tikken
  const units = useLoad(() => api.units(ring!.id), [ring?.id]);
  const members = useLoad(() => api.ringMembers(ring!.id), [ring?.id]);
  const loaded = useRef(false);

  // Bestaand concept laden (alleen bij het openen).
  useEffect(() => {
    if (!draftIdParam || loaded.current) return;
    loaded.current = true;
    api.draft(draftIdParam).then((v) => {
      setView(v);
      setPersonName(v.draft.personName ?? "");
      setUnitId(v.draft.unitId ?? "");
      if (v.draft.functionCode && (v.draft.functionSource === "STANDAARD" || v.draft.functionSource === "EIGEN") && v.procedure) {
        setPicked({ code: v.procedure.code, source: v.procedure.source, name: v.procedure.name, category: v.procedure.category, customConfirmed: v.draft.procedureConfirmed, requiresConfirmation: v.procedure.requiresConfirmation });
      }
      setAssignees({ roepen: v.draft.roepenAssigneeId ?? "", ondersteunen: v.draft.ondersteunenAssigneeId ?? "", aanstellen: v.draft.aanstellenAssigneeId ?? "" });
      setExternal({ roepen: v.draft.roepenExternalName ?? "", aanstellen: v.draft.aanstellenExternalName ?? "" });
    }).catch((err) => setMessage(err instanceof ApiRequestError ? err.message : "Het concept kon niet worden geladen."));
  }, [api, draftIdParam]);

  const payload = useCallback(() => ({
    personName: personName.trim() || null,
    unitId: unitId || null,
    functionSource: picked?.source ?? null,
    functionCode: picked?.code ?? null,
    procedureConfirmed: picked?.customConfirmed ?? false,
    roepenAssigneeId: assignees.roepen || null, ondersteunenAssigneeId: assignees.ondersteunen || null, aanstellenAssigneeId: assignees.aanstellen || null,
    roepenExternalName: external.roepen.trim() || null, aanstellenExternalName: external.aanstellen.trim() || null,
  }), [personName, unitId, picked, assignees, external]);

  async function save(): Promise<string> {
    const body = payload();
    if (draftId) {
      await api.updateDraft(draftId, body);
      return draftId;
    }
    const created = await api.createDraft(ring!.id, body);
    setDraftId(created.id);
    return created.id;
  }

  // Voorgestelde verantwoordelijken uit de wijk-/gemeentekoppeling, alleen voor zover bevoegd; de gebruiker kan altijd wijzigen.
  useEffect(() => {
    if (!picked && !unitId) return;
    let cancelled = false;
    api.suggestions(ring!.id, unitId || null, picked?.source ?? null, picked?.code ?? null).then((r) => { if (!cancelled) setView((v) => (r.suggestions ? ({ ...(v ?? ({} as DraftView)), suggestions: r.suggestions } as DraftView) : v)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [api, ring, unitId, picked?.code, picked?.source]); // eslint-disable-line react-hooks/exhaustive-deps

  const sug = view?.suggestions ?? null;
  function applySuggestion(task: TaskKey) {
    const s = sug?.[task];
    if (s) setAssignees((a) => ({ ...a, [task]: s.userId }));
  }

  async function run(fn: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const saveDraft = () => run(async () => { await save(); navigate("/voorstellen", { replace: true }); });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const id = await save();
      const res = await api.submitDraft(id); // idempotent: bij herhaling dezelfde uitkomst
      navigate(`/roepingen/${res.id}`, { replace: true });
    });
  };
  const discard = () => run(async () => { if (draftId) await api.deleteDraft(draftId); navigate("/voorstellen", { replace: true }); });

  const taskSelect = (task: TaskKey, label: string, restricted: boolean) => {
    const eligible = task === "roepen" ? sug?.eligible.roepen : task === "aanstellen" ? sug?.eligible.aanstellen : undefined;
    const options = restricted ? (eligible ?? []).map((u) => ({ id: u.id, name: u.basis ? `${u.name} – ${u.basis}` : u.name })) : (members.data?.members ?? []).map((m) => ({ id: m.id, name: m.name }));
    const note = task === "roepen" || task === "aanstellen" ? sug?.notes[task] : null;
    return (
      <div key={task} className="stack">
        <label htmlFor={`as-${task}`}>{label}</label>
        <select id={`as-${task}`} value={assignees[task]} onChange={(e) => setAssignees((a) => ({ ...a, [task]: e.target.value }))}>
          <option value="">Nog niet toegewezen</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        {sug?.[task] && assignees[task] !== sug[task]!.userId && (
          <button type="button" className="btn btn-ghost" onClick={() => applySuggestion(task)}>
            Voorstel overnemen: {sug[task]!.name} ({SOURCE_LABEL[sug[task]!.source]}{sug[task]!.basis ? `; ${sug[task]!.basis}` : ""})
          </button>
        )}
        {note && <span className="muted" role="note">{note}</span>}
        {restricted && (
          <div>
            <label htmlFor={`ex-${task}`}>Of: externe uitvoerder zonder Ringtools-account (handmatig)</label>
            <input id={`ex-${task}`} value={external[task as "roepen" | "aanstellen"]} maxLength={120} onChange={(e) => setExternal((x) => ({ ...x, [task]: e.target.value }))} />
            <span className="muted">Alleen voor een bevoegde persoon buiten deze ring of zonder Ringtools-account. Een lid van deze ring kies je hierboven; alleen bevoegde leden (kerkelijke functie en zo nodig machtiging) staan in de lijst.</span>
          </div>
        )}
      </div>
    );
  };

  const noUnits = !!units.data && units.data.units.filter((u) => u.active).length === 0;
  const needsConfirmation = !!picked?.requiresConfirmation;
  const ready = personName.trim().length >= 2 && !!picked && (!needsConfirmation || picked.customConfirmed) && !!unitId;

  return (
    <form className="stack" onSubmit={submit}>
      <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => navigate(-1)}>‹ Terug</button>
      <h1>{draftId ? "Concept voorstel" : "Nieuw voorstel"}</h1>
      <span className="muted">Ring: {ring?.name}. Een concept is alleen zichtbaar voor ringstaf en verstuurt niets.</span>
      {(units.loading || members.loading) && !units.data && <Spinner />}
      {units.error && <ErrorState error={units.error} onRetry={units.reload} />}
      {members.error && <ErrorState error={members.error} onRetry={members.reload} />}
      <div className="glass card stack">
        <strong>1. Naam van de persoon</strong>
        <div><label htmlFor="person">Naam (handmatig invoeren)</label><input id="person" value={personName} onChange={(e) => setPersonName(e.target.value)} minLength={2} maxLength={200} autoComplete="off" /></div>
      </div>
      <div className="glass card stack">
        <strong>2. Wijk of gemeente van herkomst</strong>
        <div>
          <label htmlFor="unit">Wijk of gemeente</label>
          <select id="unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">Kies…</option>
            {(units.data?.units ?? []).filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.kind === "WIJK" ? "Wijk" : "Gemeente"} {u.name}</option>)}
          </select>
        </div>
        {noUnits && <div className="error" role="alert">De ringinrichting is nog niet compleet: er zijn geen wijken of gemeenten ingevoerd. Je kunt het concept opslaan, maar pas indienen nadat de ringbeheerder deze heeft ingevoerd.</div>}
      </div>
      <div className="glass card stack">
        <strong>3. Roeping</strong>
        <CallingPicker ringId={ring!.id} value={picked} onChange={setPicked} />
      </div>
      <div className="glass card stack">
        <strong>4. Verantwoordelijken controleren</strong>
        <span className="muted">Roepen en aanstellen kunnen alleen door bevoegde leden worden toegewezen: de kerkelijke functie bepaalt wat mogelijk is en een aangewezen raadgever of hogeraadslid heeft daarnaast een expliciete machtiging nodig. Een wijkkoppeling is geen machtiging. De steunverlening in de kerkvergadering en de interne ondersteuning door presidium en hoge raad zijn aparte stappen.</span>
        {taskSelect("roepen", "Wie roept de persoon?", true)}
        {taskSelect("ondersteunen", "Wie begeleidt de steunverlening?", false)}
        {taskSelect("aanstellen", "Wie stelt de persoon aan?", true)}
      </div>
      {message && <div role="alert" className="glass panel error">{message}</div>}
      <div className="row">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={saveDraft}>Concept opslaan</button>
        <button className="btn btn-primary" type="submit" disabled={busy || !ready}>{busy ? "Bezig…" : "Voorstel indienen"}</button>
      </div>
      {draftId && <button type="button" className="btn btn-ghost" disabled={busy} onClick={discard}>Concept verwijderen</button>}
    </form>
  );
}
