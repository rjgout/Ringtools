import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { CallingLink, ErrorState, OntheffingLink, Spinner } from "../components/ui";

export function Home() {
  const { api, ring } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api.dashboard(ring!.id), [ring?.id]);
  // Ontheffingen staan niet meer als knop in het overzicht: alleen wat jouw actie vraagt verschijnt hier als rij.
  const needAction = (data?.ontheffingen?.needsMyVote ?? 0) + (data?.ontheffingen?.needsReview ?? 0) > 0;
  const actionable = useLoad(() => (needAction ? api.ontheffingen(ring!.id) : Promise.resolve(null)), [ring?.id, needAction]);
  const ontheffingenToDo = (actionable.data?.ontheffingen ?? []).filter((o) => o.needsMyVote || o.needsReview);

  return (
    <div className="stack">
      <div>
        <h1>{ring?.name}</h1>
        <span className="muted">{ring?.churchFunction}</span>
      </div>
      {loading && !data && <Spinner />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && (
        <>
          <h2>Wacht op jouw reactie</h2>
          {data.pendingSupport.length === 0 && ontheffingenToDo.length === 0 && <p className="empty" role="status">Er staat niets voor je klaar.</p>}
          {data.pendingSupport.map((c) => (
            <CallingLink key={c.id} id={c.id} name={c.personName} title={c.functionTitle} status={c.phase} mine />
          ))}
          {ontheffingenToDo.map((o) => <OntheffingLink key={o.id} o={o} />)}
          {data.isStaff && data.counts && (
            <>
              <h2>Stand van zaken</h2>
              <div className="glass panel row between">
                <span>Presidium</span><strong>{data.counts.presidium}</strong>
              </div>
              <div className="glass panel row between">
                <span>Hoge raad</span><strong>{data.counts.hogeraad}</strong>
              </div>
              {data.counts.awaitingRelease > 0 && (
                <div className="glass panel row between">
                  <span>Presidium akkoord – wacht op vrijgave</span><strong>{data.counts.awaitingRelease}</strong>
                </div>
              )}
              <div className="glass panel row between">
                <span>Gepauzeerd</span><strong>{data.counts.paused}</strong>
              </div>
              <div className="glass panel row between">
                <span>Klaar om te verwerken</span><strong>{data.counts.readyToProcess}</strong>
              </div>
              {data.attention.length > 0 && <h2>Aandachtspunten</h2>}
              {data.attention.map((c) => (
                <CallingLink key={c.id} id={c.id} name={c.personName} title={c.functionTitle} status={c.phase} />
              ))}
            </>
          )}
          {data.myTasks.length > 0 && <h2>Jouw taken</h2>}
          {data.myTasks.map((c) => (
            <CallingLink key={c.id} id={c.id} name={c.personName} title={c.tasks.join(", ")} status={c.phase} />
          ))}
        </>
      )}
    </div>
  );
}
