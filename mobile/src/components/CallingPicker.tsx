import { useEffect, useRef, useState } from "react";
import type { CatalogCalling, CatalogResult } from "@shared/api-types";
import { useAuth } from "../lib/auth";
import { ApiRequestError } from "../lib/api";

export type PickedCalling = { code: string; source: "STANDAARD" | "EIGEN"; name: string; category: string; customConfirmed: boolean };

/**
 * Zoeken en selecteren uit de Nederlandse roepingencatalogus (standaardroepingen + eigen roepingen van deze ring).
 * Roepingen die buiten Ringtools lopen (bijv. ringpresident, patriarch) zijn niet te kiezen. Een eigen roeping vereist
 * een expliciete bevestiging dat de bevoegde leiding de procedure heeft gecontroleerd. Onder het resultaat staat "Eigen roeping toevoegen".
 */
export function CallingPicker({ ringId, value, onChange, canAddCustom = true }: { ringId: string; value: PickedCalling | null; onChange: (v: PickedCalling | null) => void; canAddCustom?: boolean }) {
  const { api } = useAuth();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [result, setResult] = useState<CatalogResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await api.catalog(ringId, q, category);
        if (id === seq.current) { setResult(res); setError(null); }
      } catch (err) {
        if (id === seq.current) setError(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
      }
    }, 200);
    return () => clearTimeout(t);
  }, [api, ringId, q, category]);

  const pick = (c: CatalogCalling) => {
    if (!c.ringtoolsProcess) return;
    onChange({ code: c.code, source: c.source, name: c.name, category: c.category, customConfirmed: false });
    // De organisatie wordt automatisch voorgesteld op basis van de gekozen roeping.
    setCategory(c.category);
  };

  async function addCustom(e: React.FormEvent) {
    e.preventDefault();
    try {
      const created = await api.createCustomCalling(ringId, { name: newName, category: newCategory });
      onChange({ code: created.id, source: "EIGEN", name: newName.trim(), category: newCategory.trim(), customConfirmed: false });
      setAdding(false);
      setNewName("");
      setQ(newName);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
    }
  }

  const selected = value ? result?.callings.find((c) => c.code === value.code) : null;
  return (
    <div className="stack">
      <div>
        <label htmlFor="cp-cat">Organisatie</label>
        <select id="cp-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Alle organisaties</option>
          {(result?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div><label htmlFor="cp-q">Roeping zoeken</label><input id="cp-q" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" /></div>
      {value && (
        <div className="glass panel" role="status">
          <strong>Gekozen: {value.name}</strong> <span className="muted">· {value.category}</span>
          {selected?.warning && <div className="muted">{selected.warning}</div>}
          {selected?.reviewNotes.length ? <div className="muted">Let op: een of meer regels staan nog ter controle bij de beheerder.</div> : null}
          {value.source === "EIGEN" && (
            <label className="row"><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={value.customConfirmed} onChange={(e) => onChange({ ...value, customConfirmed: e.target.checked })} /> De bevoegde leiding heeft de procedure voor deze eigen roeping gecontroleerd</label>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => onChange(null)}>Andere roeping kiezen</button>
        </div>
      )}
      <div className="stack" role="listbox" aria-label="Roepingen" style={{ maxHeight: 260, overflowY: "auto" }}>
        {result?.callings.map((c) => (
          <button type="button" key={`${c.source}-${c.code}`} role="option" aria-selected={value?.code === c.code} className="glass panel" disabled={!c.ringtoolsProcess} onClick={() => pick(c)}>
            <div className="row between">
              <div className="grow" style={{ textAlign: "left" }}>
                <strong>{c.name}</strong>
                <div className="muted">{c.category}{c.source === "EIGEN" ? " · eigen roeping" : ""}{!c.ringtoolsProcess ? " · buiten Ringtools" : ""}</div>
              </div>
            </div>
          </button>
        ))}
        {result && result.callings.length === 0 && <span className="muted">Geen roeping gevonden.</span>}
      </div>
      {canAddCustom && !adding && <button type="button" className="btn btn-ghost" onClick={() => { setAdding(true); setNewName(q); setNewCategory(category); }}>Eigen roeping toevoegen</button>}
      {adding && (
        <form className="glass card stack" aria-label="Eigen roeping toevoegen" onSubmit={addCustom}>
          <div><label htmlFor="cp-new-name">Naam van de roeping</label><input id="cp-new-name" value={newName} onChange={(e) => setNewName(e.target.value)} required minLength={2} /></div>
          <div><label htmlFor="cp-new-cat">Categorie</label><input id="cp-new-cat" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} required /></div>
          <span className="muted">Een eigen roeping is alleen zichtbaar binnen deze ring en krijgt geen automatische bevoegdheden.</span>
          <div className="row"><button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>Annuleren</button><button className="btn btn-primary">Toevoegen</button></div>
        </form>
      )}
      {error && <div className="error" role="alert">{error}</div>}
    </div>
  );
}
