import { useState } from "react";
import type { CatalogResult, UnitInfo } from "@shared/api-types";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { ApiRequestError } from "../lib/api";
import { ErrorState, Spinner } from "../components/ui";

/** Ringinrichting: voortgang, wijken en gemeenten (met hogeraadskoppeling) en eigen roepingen. Voor ringbeheerder en webmin. */
export function RingSetup({ ringId }: { ringId: string }) {
  return (
    <div className="stack">
      <SetupChecklist ringId={ringId} />
      <UnitsManager ringId={ringId} />
      <CustomCallings ringId={ringId} />
    </div>
  );
}

function SetupChecklist({ ringId }: { ringId: string }) {
  const { api } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api.ringSetup(ringId), [ringId]);
  return (
    <section className="glass card stack" aria-label="Ringinrichting">
      <h2>Ringinrichting</h2>
      {loading && !data && <Spinner />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data?.steps.map((s) => (
        <div key={s.key} className="row between">
          <div className="grow"><span>{s.done ? "✓" : "○"} {s.label}</span>{s.detail && <div className="muted">{s.detail}</div>}</div>
          <span className={`badge ${s.done ? "ok" : ""}`}>{s.done ? "Klaar" : "Open"}</span>
        </div>
      ))}
      {data?.complete && <span className="badge ok">Alle stappen zijn afgerond</span>}
    </section>
  );
}

function personLabel(p: { name: string } | null) {
  return p ? p.name : "Niemand";
}

function UnitsManager({ ringId }: { ringId: string }) {
  const { api } = useAuth();
  const units = useLoad(() => api.units(ringId), [ringId]);
  const members = useLoad(() => api.ringUsers(ringId), [ringId]);
  const [kind, setKind] = useState<"WIJK" | "GEMEENTE">("WIJK");
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const hogeraad = (members.data?.users ?? []).filter((u) => u.role === "HOGERAAD" && u.active);
  const everyone = (members.data?.users ?? []).filter((u) => u.active);

  async function run(fn: () => Promise<unknown>) {
    setMessage(null);
    try {
      await fn();
      await units.reload();
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
    }
  }

  return (
    <section className="glass card stack" aria-label="Wijken en gemeenten">
      <h2>Wijken en gemeenten</h2>
      <span className="muted">De koppeling aan een hogeraadslid wordt gebruikt om bij een nieuwe roeping automatisch het betrokken hogeraadslid voor te stellen. Ze bepaalt nooit wie in de hoge raad mag ondersteunen.</span>
      {units.loading && !units.data && <Spinner />}
      {units.error && <ErrorState error={units.error} onRetry={units.reload} />}
      {units.data?.units.map((u) => (
        <UnitRow key={u.id} unit={u} hogeraad={hogeraad} everyone={everyone}
          onChange={(input) => run(() => api.updateUnit(u.id, input))} />
      ))}
      <form className="stack" aria-label="Wijk of gemeente toevoegen" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api.createUnit(ringId, { kind, name }); setName(""); }); }}>
        <div className="row">
          <button type="button" className={`btn ${kind === "WIJK" ? "btn-primary" : "btn-ghost"}`} onClick={() => setKind("WIJK")}>Wijk</button>
          <button type="button" className={`btn ${kind === "GEMEENTE" ? "btn-primary" : "btn-ghost"}`} onClick={() => setKind("GEMEENTE")}>Gemeente</button>
        </div>
        <div><label htmlFor="unit-name">Naam</label><input id="unit-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} /></div>
        <button className="btn btn-primary">Toevoegen</button>
      </form>
      {message && <div className="error" role="alert">{message}</div>}
    </section>
  );
}

function UnitRow({ unit, hogeraad, everyone, onChange }: {
  unit: UnitInfo;
  hogeraad: { userId: string; name: string }[];
  everyone: { userId: string; name: string }[];
  onChange: (input: Record<string, unknown>) => void;
}) {
  const select = (label: string, current: string, options: { userId: string; name: string }[], key: string, emptyLabel: string) => (
    <div>
      <label htmlFor={`${unit.id}-${key}`}>{label}</label>
      <select id={`${unit.id}-${key}`} value={current} disabled={!unit.active} onChange={(e) => onChange({ [key]: e.target.value || null })}>
        <option value="">{emptyLabel}</option>
        {options.map((o) => <option key={o.userId} value={o.userId}>{o.name}</option>)}
      </select>
    </div>
  );
  return (
    <div className="glass panel stack">
      <div className="row between">
        <strong>{unit.kind === "WIJK" ? "Wijk" : "Gemeente"} {unit.name}</strong>
        <span className={`badge ${!unit.active ? "bad" : unit.responsibleStatus === "OK" ? "ok" : ""}`}>
          {!unit.active ? "Inactief" : unit.responsibleStatus === "OK" ? personLabel(unit.responsible) : unit.responsibleStatus === "VACANT" ? "Vacature" : "Verantwoordelijke niet meer actief"}
        </span>
      </div>
      {unit.active && (
        <>
          {select("Verantwoordelijk hogeraadslid", unit.responsible?.id ?? "", hogeraad, "responsibleUserId", "Vacature (nog niemand)")}
          {select("Standaard: roepen", unit.defaults.roepen?.id ?? "", everyone, "defaultRoepenUserId", "Geen standaard")}
          {select("Standaard: ondersteunen", unit.defaults.ondersteunen?.id ?? "", everyone, "defaultOndersteunenUserId", "Geen standaard")}
          {select("Standaard: aanstellen", unit.defaults.aanstellen?.id ?? "", everyone, "defaultAanstellenUserId", "Geen standaard")}
        </>
      )}
      <button className="btn btn-ghost" onClick={() => onChange({ active: !unit.active })}>{unit.active ? "Deactiveren" : "Heractiveren"}</button>
    </div>
  );
}

function CustomCallings({ ringId }: { ringId: string }) {
  const { api } = useAuth();
  const list = useLoad(() => api.customCallings(ringId), [ringId]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function loadCategories() {
    if (categories.length === 0) {
      try {
        const res: CatalogResult = await api.catalog(ringId, "zzzz-geen-treffer");
        setCategories(res.categories);
      } catch {
        /* categorie blijft vrij invulbaar */
      }
    }
  }
  async function run(fn: () => Promise<unknown>) {
    setMessage(null);
    try {
      await fn();
      await list.reload();
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
    }
  }

  return (
    <section className="glass card stack" aria-label="Eigen roepingen">
      <h2>Eigen roepingen</h2>
      <span className="muted">Alleen zichtbaar binnen deze ring. Er worden geen bevoegdheden of bijzondere kerkelijke procedures aan gekoppeld; bij gebruik bevestigt de bevoegde leiding dat de procedure is gecontroleerd.</span>
      {list.data?.callings.map((c) => (
        <div key={c.id} className="row between">
          <span className="grow">{c.name} <span className="muted">· {c.category}</span></span>
          <button className="btn btn-ghost" onClick={() => run(() => api.updateCustomCalling(c.id, { active: !c.active }))}>{c.active ? "Deactiveren" : "Activeren"}</button>
        </div>
      ))}
      <form className="stack" aria-label="Eigen roeping toevoegen" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api.createCustomCalling(ringId, { name, category }); setName(""); }); }}>
        <div><label htmlFor="cc-name">Naam van de roeping</label><input id="cc-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} /></div>
        <div>
          <label htmlFor="cc-cat">Categorie</label>
          <input id="cc-cat" list="cc-cats" value={category} onFocus={() => void loadCategories()} onChange={(e) => setCategory(e.target.value)} required />
          <datalist id="cc-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <button className="btn btn-primary">Eigen roeping toevoegen</button>
      </form>
      {message && <div className="error" role="alert">{message}</div>}
    </section>
  );
}
