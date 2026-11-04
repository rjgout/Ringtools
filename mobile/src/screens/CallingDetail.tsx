import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { ApiRequestError } from "../lib/api";
import { ErrorState, Spinner } from "../components/ui";

export function CallingDetail() {
  const { id = "" } = useParams();
  const { api, ring, selectRing } = useAuth();
  const activeRingId = ring?.id;
  const navigate = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api.calling(id), [id]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Het voorstel hoort bij een bepaalde ring: de server bepaalt dat, de app volgt (bijv. na een e-maillink).
  // Bewust in een effect (niet tijdens het renderen) en alleen als de ring daadwerkelijk anders is.
  const ringId = data?.ring.id;
  useEffect(() => {
    if (ringId && ringId !== activeRingId) void selectRing(ringId);
  }, [ringId, activeRingId, selectRing]);

  async function vote(support: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      await api.vote(id, support);
      await reload();
      setMessage(support ? "Je ondersteuning is vastgelegd." : "Je reactie is vastgelegd.");
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => navigate(-1)}>
        ‹ Terug
      </button>
      {loading && !data && <Spinner />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && (
        <>
          <div>
            <h1>{data.personName}</h1>
            <span className="muted">{data.functionTitle} · {data.ring.name}</span>
            <div><span className="badge ok">{data.phase}</span></div>
          </div>
          {data.rounds.map((r) => (
            <section key={r.stage} className="glass card stack" aria-label={r.title}>
              <div className="row between"><strong>{r.title}</strong><span className="badge">{r.state === "open" ? "Open" : r.state === "paused" ? "Gepauzeerd" : r.state === "done" ? "Afgerond" : "Nog niet gestart"}</span></div>
              {r.canRespond && (
                <>
                  <span className="muted">{r.myResponse === null ? "Ondersteun je dit voorstel?" : r.myResponse ? "Je ondersteunt dit voorstel." : "Je ondersteunt dit voorstel niet."}</span>
                  <div className="row">
                    <button className="btn btn-success" disabled={busy} onClick={() => vote(true)}>Ondersteunen</button>
                    <button className="btn btn-danger" disabled={busy} onClick={() => vote(false)}>Niet ondersteunen</button>
                  </div>
                </>
              )}
              {data.me.isStaff && r.participants.map((p) => (
                <div key={p.userId} className="row between">
                  <span>{p.name}</span>
                  <span className={`badge ${p.support === true ? "ok" : p.support === false ? "bad" : ""}`}>{p.support === true ? "Ondersteunt" : p.support === false ? "Niet" : "Nog niet"}</span>
                </div>
              ))}
            </section>
          ))}
          {message && <div role="status" className="glass panel">{message}</div>}
        </>
      )}
    </div>
  );
}
