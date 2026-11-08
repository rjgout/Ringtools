import { useEffect, useRef, useState } from "react";
import type { CatalogCalling, CatalogResult } from "@shared/api-types";
import { useAuth } from "../lib/auth";
import { ApiRequestError } from "../lib/api";

export type PickedCalling = { code: string; source: "STANDAARD" | "EIGEN"; name: string; category: string; customConfirmed: boolean; requiresConfirmation: boolean };

const keyOf = (c: { source: string; code: string }) => `${c.source}:${c.code}`;

/**
 * Kiezen uit de Nederlandse roepingencatalogus (standaardroepingen + eigen roepingen van deze ring) met twee keuzelijsten:
 * organisatie en roeping. Roepingen die buiten Ringtools lopen (bijv. ringpresident, patriarch) zijn niet te kiezen. Een eigen of
 * niet-geverifieerde roeping vereist een expliciete bevestiging dat de bevoegde leiding de procedure heeft gecontroleerd.
 */
export function CallingPicker({ ringId, value, onChange, canAddCustom = true }: { ringId: string; value: PickedCalling | null; onChange: (v: PickedCalling | null) => void; canAddCustom?: boolean }) {
  const { api } = useAuth();
  const [category, setCategory] = useState("");
  const [result, setResult] = useState<CatalogResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    api.catalog(ringId, "", category)
      .then((res) => { if (id === seq.current) { setResult(res); setError(null); } })
      .catch((err) => { if (id === seq.current) setError(err instanceof ApiRequestError ? err.message : "Er ging iets mis."); });
  }, [api, ringId, category]);

  // Een al gekozen roeping (bijv. uit een concept) bepaalt de getoonde organisatie.
  useEffect(() => {
    if (value && !category) setCategory(value.category);
  }, [value, category]);

  const callings = result?.callings ?? [];
  const selected = value ? callings.find((c) => c.code === value.code && c.source === value.source) ?? null : null;

  const pick = (k: string) => {
    if (!k) { onChange(null); return; }
    const c = callings.find((x) => keyOf(x) === k);
    if (!c || !c.ringtoolsProcess) return;
    onChange({ code: c.code, source: c.source, name: c.name, category: c.category, customConfirmed: false, requiresConfirmation: c.requiresProcedureConfirmation });
    setCategory(c.category); // de organisatie volgt de gekozen roeping
  };

  async function addCustom(e: React.FormEvent) {
    e.preventDefault();
    try {
      const created = await api.createCustomCalling(ringId, { name: newName, category: newCategory });
      onChange({ code: created.id, source: "EIGEN", name: newName.trim(), category: newCategory.trim(), customConfirmed: false, requiresConfirmation: true });
      setAdding(false);
      setNewName("");
      setCategory(newCategory.trim());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
    }
  }

  return (
    <div className="stack">
      <div>
        <label htmlFor="cp-cat">Organisatie</label>
        <select id="cp-cat" value={category} onChange={(e) => { setCategory(e.target.value); if (value && value.category !== e.target.value) onChange(null); }}>
          <option value="">Alle organisaties</option>
          {(result?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="cp-calling">Roeping</label>
        <select id="cp-calling" value={value ? keyOf(value) : ""} onChange={(e) => pick(e.target.value)}>
          <option value="">Kies…</option>
          {callings.map((c: CatalogCalling) => (
            <option key={keyOf(c)} value={keyOf(c)} disabled={!c.ringtoolsProcess}>
              {c.name}{c.source === "EIGEN" ? " (eigen roeping)" : ""}{!c.ringtoolsProcess ? " (buiten Ringtools)" : ""}
            </option>
          ))}
        </select>
      </div>
      {value && (selected?.warning || selected?.ruleStatus === "TE_BEOORDELEN" || value.requiresConfirmation) && (
        <div className="stack" role="status">
          {selected?.warning && <div className="muted">{selected.warning}</div>}
          {selected?.ruleStatus === "TE_BEOORDELEN" && <div className="muted" role="note">Menselijke controle nodig: de regels voor deze roeping zijn niet geverifieerd.</div>}
          {value.requiresConfirmation && (
            <label className="row"><input type="checkbox" checked={value.customConfirmed} onChange={(e) => onChange({ ...value, customConfirmed: e.target.checked })} /> De bevoegde leiding heeft de procedure gecontroleerd{value.source === "EIGEN" ? " (eigen roeping)" : ""}</label>
          )}
        </div>
      )}
      {canAddCustom && !adding && <button type="button" className="btn btn-ghost" onClick={() => { setAdding(true); setNewCategory(category); }}>Eigen roeping toevoegen</button>}
      {adding && (
        <form className="glass card stack" aria-label="Eigen roeping toevoegen" onSubmit={addCustom}>
          <div><label htmlFor="cp-new-name">Naam van de roeping</label><input id="cp-new-name" value={newName} onChange={(e) => setNewName(e.target.value)} required minLength={2} /></div>
          <div><label htmlFor="cp-new-cat">Categorie</label><input id="cp-new-cat" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} required /></div>
          <div className="row"><button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>Annuleren</button><button className="btn btn-primary">Toevoegen</button></div>
        </form>
      )}
      {error && <div className="error" role="alert">{error}</div>}
    </div>
  );
}
