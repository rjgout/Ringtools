import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { ErrorState, Spinner } from "../components/ui";

const STAFF = ["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR"];

/**
 * Lijst met ontheffingen. Wat hier staat volgt uit dezelfde zichtbaarheidsregel als op de server: ringstaf ziet de dossiers (en eigen concepten),
 * een hogeraadslid alleen de dossiers waarvoor een ronde voor hem openstaat. Een betrokkene ziet zijn eigen dossier nooit.
 */
export function Ontheffingen() {
  const { api, ring } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api.ontheffingen(ring!.id), [ring?.id]);
  const staff = STAFF.includes(ring?.role ?? "");

  return (
    <div className="stack">
      <div className="row between">
        <h1>Ontheffingen</h1>
        {staff && <Link to="/ontheffingen/nieuw" className="btn btn-primary">Nieuwe ontheffing</Link>}
      </div>
      <span className="muted">Vertrouwelijk. Meldingen bevatten bewust geen namen of functies.</span>
      {loading && !data && <Spinner />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data?.ontheffingen.length === 0 && <p className="muted">Er staan geen ontheffingen voor je klaar.</p>}
      {data?.ontheffingen.map((o) => (
        <Link key={o.id} to={o.status === "CONCEPT" ? `/ontheffingen/concept/${o.id}` : `/ontheffingen/${o.id}`} className="glass panel">
          <div className="row between">
            <div className="grow">
              <strong>{o.personName ?? "(nog geen naam)"}</strong>
              <div className="muted">{o.functionName ?? "Nog geen roeping gekozen"}{o.unitName ? ` · ${o.unitName}` : ""}{o.joint ? " · gezamenlijk" : ""}</div>
              <div className="muted">{o.statusLabel}</div>
            </div>
            {o.needsMyVote && <span className="dot" aria-label="Wacht op jouw reactie">!</span>}
            {o.needsReview && <span className="dot" aria-label="Beoordeling nodig">?</span>}
          </div>
        </Link>
      ))}
    </div>
  );
}
