import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { CallingLink, ErrorState, ListItem, OntheffingLink, PageHead, Spinner } from "../components/ui";

const STAFF = ["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR"];

/**
 * Voorstellen én ontheffingen in één lijst; elke rij laat zien welk van de twee het is. Wat je ziet volgt uit dezelfde zichtbaarheidsregels
 * als op de server. Ringstaf ziet beide knoppen (nieuw voorstel, nieuwe ontheffing).
 */
export function Callings() {
  const { api, ring } = useAuth();
  const isStaff = !!ring && STAFF.includes(ring.role);
  const { data, error, loading, reload } = useLoad(() => api.callings(ring!.id), [ring?.id]);
  const drafts = useLoad(() => (isStaff ? api.drafts(ring!.id) : Promise.resolve({ drafts: [] })), [ring?.id]);
  const ontheffingen = useLoad(() => api.ontheffingen(ring!.id), [ring?.id]);
  const others = ontheffingen.data?.ontheffingen ?? [];
  const concepts = others.filter((o) => o.status === "CONCEPT");
  const dossiers = others.filter((o) => o.status !== "CONCEPT");
  const callings = data?.callings ?? [];
  // Wat jouw reactie nodig heeft staat bovenaan.
  const needsMe = (c: { needsMyResponse?: boolean }) => !!c.needsMyResponse;
  const empty = !!data && !loading && callings.length === 0 && dossiers.length === 0 && concepts.length === 0 && (drafts.data?.drafts.length ?? 0) === 0;

  return (
    <div className="stack">
      <PageHead title="Voorstellen" subtitle={ring?.name} />
      {isStaff && (
        <div className="row">
          <Link to="/voorstellen/nieuw" className="btn btn-primary" style={{ flex: 1 }}>Nieuw voorstel</Link>
          <Link to="/ontheffingen/nieuw" className="btn btn-ghost" style={{ flex: 1 }}>Nieuwe ontheffing</Link>
        </div>
      )}
      {((drafts.data?.drafts.length ?? 0) > 0 || concepts.length > 0) && (
        <section className="stack" aria-label="Concepten">
          <h2>Concepten</h2>
          {drafts.data?.drafts.map((d) => (
            <ListItem key={d.id} to={`/voorstellen/concept/${d.id}`} name={d.personName || "Naam nog niet ingevuld"} kind="Voorstel" subtitle={d.unitName ?? "Wijk/gemeente nog niet gekozen"} status="Concept" tone="neutral" />
          ))}
          {concepts.map((o) => <OntheffingLink key={o.id} o={o} />)}
        </section>
      )}
      {loading && !data && <Spinner />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {empty && <p className="muted">Er zijn geen voorstellen of ontheffingen.</p>}
      {callings.filter(needsMe).map((c) => <CallingLink key={c.id} id={c.id} name={c.personName} title={c.functionTitle} status={c.phase} mine />)}
      {dossiers.filter((o) => o.needsMyVote || o.needsReview).map((o) => <OntheffingLink key={o.id} o={o} />)}
      {callings.filter((c) => !needsMe(c)).map((c) => <CallingLink key={c.id} id={c.id} name={c.personName} title={c.functionTitle} status={c.phase} />)}
      {dossiers.filter((o) => !o.needsMyVote && !o.needsReview).map((o) => <OntheffingLink key={o.id} o={o} />)}
    </div>
  );
}
