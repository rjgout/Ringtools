import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { DraftView } from "@shared/api-types";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { ApiRequestError } from "../lib/api";
import { ErrorState, PageHead, Spinner } from "../components/ui";
import { ActionMenu, MENU_ICONS } from "../components/Menu";
import { useConfirm } from "../components/Dialog";
import { CallingPicker, type PickedCalling } from "../components/CallingPicker";

type TaskKey = "roepen" | "ondersteunen" | "aanstellen";

/**
 * Nieuw voorstel in vijf stappen: naam (handmatig) → wijk/gemeente → roeping (catalogus of eigen) → verantwoordelijken controleren → concept opslaan of indienen.
 * Alles wordt als concept op de server bewaard (onvolledig mag); indienen valideert op de server opnieuw en is idempotent.
 * Er is geen koppeling met een ledenregister of LCR: de naam wordt altijd ingevoerd.
 */
export function NewCalling() {
  const { id: draftIdParam } = useParams();
  const { api, ring } = useAuth();
  const navigate = useNavigate();
  const [draftId, setDraftId] = useState<string | null>(draftIdParam ?? null);
  const [personName, setPersonName] = useState("");
  const [unitId, setUnitId] = useState("");
  const [picked, setPicked] = useState<PickedCalling | null>(null);
  const [assignees, setAssignees] = useState<Record<TaskKey, string>>({ roepen: "", ondersteunen: "", aanstellen: "" });
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
    }).catch((err) => setMessage(err instanceof ApiRequestError ? err.message : "Het concept kon niet worden geladen."));
  }, [api, draftIdParam]);

  const payload = useCallback(() => ({
    personName: personName.trim() || null,
    unitId: unitId || null,
    functionSource: picked?.source ?? null,
    functionCode: picked?.code ?? null,
    procedureConfirmed: picked?.customConfirmed ?? false,
    roepenAssigneeId: assignees.roepen || null, ondersteunenAssigneeId: assignees.ondersteunen || null, aanstellenAssigneeId: assignees.aanstellen || null,
  }), [personName, unitId, picked, assignees]);

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
  // Secretaris en administrateur voeren in maar begeleiden de steunverlening niet: zij staan niet in die lijst.
  const supportCandidates = (members.data?.members ?? []).filter((m) => m.role !== "RINGSECRETARIS" && m.role !== "RINGADMINISTRATEUR");
  // De voorgestelde persoon wordt direct ingevuld, zolang er nog niets is gekozen; een eigen keuze wordt nooit overschreven.
  const touched = useRef<Record<TaskKey, boolean>>({ roepen: false, ondersteunen: false, aanstellen: false });
  useEffect(() => {
    if (!sug) return;
    setAssignees((a) => {
      const next = { ...a };
      let changed = false;
      for (const t of ["roepen", "ondersteunen", "aanstellen"] as TaskKey[]) {
        const s = sug[t];
        if (t === "ondersteunen" && s && !supportCandidates.some((m) => m.id === s.userId)) continue;
        if (s && !a[t] && !touched.current[t]) { next[t] = s.userId; changed = true; }
      }
      return changed ? next : a;
    });
  }, [sug, members.data]); // eslint-disable-line react-hooks/exhaustive-deps
  function applySuggestion(task: TaskKey) {
    const s = sug?.[task];
    if (s) { touched.current[task] = false; setAssignees((a) => ({ ...a, [task]: s.userId })); }
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
  const confirm = useConfirm();
  const discard = async () => {
    const ok = await confirm({ title: "Concept verwijderen?", message: "Dit concept wordt definitief verwijderd. Er is nog niets ingediend of verstuurd.", detail: "Deze actie kan niet ongedaan worden gemaakt.", confirmLabel: "Verwijderen", danger: true });
    if (ok) await run(async () => { if (draftId) await api.deleteDraft(draftId); navigate("/voorstellen", { replace: true }); });
  };

  const taskSelect = (task: TaskKey, label: string, restricted: boolean) => {
    const eligible = task === "roepen" ? sug?.eligible.roepen : task === "aanstellen" ? sug?.eligible.aanstellen : undefined;
    const options = restricted ? (eligible ?? []).map((u) => ({ id: u.id, name: u.name })) : supportCandidates.map((m) => ({ id: m.id, name: m.name }));
    const note = task === "roepen" || task === "aanstellen" ? sug?.notes[task] : null;
    return (
      <div key={task}>
        <label htmlFor={`as-${task}`}>{label}</label>
        <select id={`as-${task}`} value={assignees[task]} onChange={(e) => { touched.current[task] = true; setAssignees((a) => ({ ...a, [task]: e.target.value })); }}>
          <option value="">Nog niet toegewezen</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        {sug?.[task] && assignees[task] !== sug[task]!.userId && (
          <button type="button" className="btn btn-ghost mt-2" onClick={() => applySuggestion(task)}>Voorgesteld: {sug[task]!.name}</button>
        )}
        {note && <span className="muted" role="note">{note}</span>}
      </div>
    );
  };

  const noUnits = !!units.data && units.data.units.filter((u) => u.active).length === 0;
  const needsConfirmation = !!picked?.requiresConfirmation;
  const ready = personName.trim().length >= 2 && !!picked && (!needsConfirmation || picked.customConfirmed) && !!unitId;

  return (
    <form className="stack" onSubmit={submit}>
      <PageHead
        title={draftId ? "Concept voorstel" : "Nieuw voorstel"}
        subtitle={ring?.name}
        action={draftId ? <ActionMenu label="Acties voor dit concept" disabled={busy} items={[{ id: "delete", label: "Concept verwijderen…", icon: MENU_ICONS.trash, danger: true, onSelect: () => void discard() }]} /> : undefined}
      />
      {(units.loading || members.loading) && !units.data && <Spinner />}
      {units.error && <ErrorState error={units.error} onRetry={units.reload} />}
      {members.error && <ErrorState error={members.error} onRetry={members.reload} />}
      <div className="glass card stack">
        <strong>1. Naam van de persoon</strong>
        <div><label htmlFor="person">Naam</label><input id="person" value={personName} onChange={(e) => setPersonName(e.target.value)} minLength={2} maxLength={200} autoComplete="off" /></div>
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
        {noUnits && <div className="error" role="alert">Er zijn nog geen wijken of gemeenten ingevoerd. Vraag de ringbeheerder dit eerst te doen.</div>}
      </div>
      <div className="glass card stack">
        <strong>3. Roeping</strong>
        <CallingPicker ringId={ring!.id} value={picked} onChange={setPicked} />
      </div>
      <div className="glass card stack">
        <strong>4. Verantwoordelijken</strong>
        {taskSelect("roepen", "Wie roept de persoon?", true)}
        {taskSelect("ondersteunen", "Wie begeleidt de steunverlening?", false)}
        {taskSelect("aanstellen", "Wie stelt de persoon aan?", true)}
      </div>
      {message && <div role="alert" className="glass panel error">{message}</div>}
      <div className="row">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={saveDraft}>Concept opslaan</button>
        <button className="btn btn-primary" type="submit" disabled={busy || !ready}>{busy ? "Bezig…" : "Voorstel indienen"}</button>
      </div>
    </form>
  );
}
