import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { CallingLink, ErrorState, Spinner } from "../components/ui";

export function Callings() {
  const { api, ring } = useAuth();
  const isStaff = ring && ["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR"].includes(ring.role);
  const { data, error, loading, reload } = useLoad(() => api.callings(ring!.id), [ring?.id]);
  const drafts = useLoad(() => (isStaff ? api.drafts(ring!.id) : Promise.resolve({ drafts: [] })), [ring?.id]);
  return (
    <div className="stack">
      <h1>Voorstellen</h1>
      {isStaff && <Link to="/voorstellen/nieuw" className="btn btn-primary">Nieuw voorstel</Link>}
      {drafts.data && drafts.data.drafts.length > 0 && (
        <section className="stack" aria-label="Concepten">
          <h2>Concepten</h2>
          {drafts.data.drafts.map((d) => (
            <Link key={d.id} to={`/voorstellen/concept/${d.id}`} className="glass panel">
              <div className="row between"><div className="grow"><strong>{d.personName || "Naam nog niet ingevuld"}</strong><div className="muted">{d.unitName ?? "Wijk/gemeente nog niet gekozen"}</div></div><span className="badge">Concept</span></div>
            </Link>
          ))}
        </section>
      )}
      {loading && !data && <Spinner />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data?.callings.length === 0 && <p className="muted">Er zijn geen voorstellen.</p>}
      {data?.callings.map((c) => (
        <CallingLink key={c.id} id={c.id} name={c.personName} title={c.functionTitle} status={c.phase} mine={c.needsMyResponse} />
      ))}
    </div>
  );
}
