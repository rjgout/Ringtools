import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { CallingLink, ErrorState, Spinner } from "../components/ui";

export function Callings() {
  const { api, ring } = useAuth();
  const isStaff = ring && ["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR"].includes(ring.role);
  const { data, error, loading, reload } = useLoad(() => api.callings(ring!.id), [ring?.id]);
  return (
    <div className="stack">
      <h1>Voorstellen</h1>
      {isStaff && <Link to="/voorstellen/nieuw" className="btn btn-primary">Nieuw voorstel</Link>}
      {loading && !data && <Spinner />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data?.callings.length === 0 && <p className="muted">Er zijn geen voorstellen.</p>}
      {data?.callings.map((c) => (
        <CallingLink key={c.id} id={c.id} name={c.personName} title={c.functionTitle} status={c.phase} mine={c.needsMyResponse} />
      ))}
    </div>
  );
}
