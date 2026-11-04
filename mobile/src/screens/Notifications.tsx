import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { ErrorState, Spinner } from "../components/ui";

export function Notifications({ onChanged }: { onChanged: () => void }) {
  const { api, ring } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api.notifications(ring!.id), [ring?.id]);

  async function readAll() {
    await api.markNotificationsRead(ring!.id);
    await reload();
    onChanged();
  }

  return (
    <div className="stack">
      <div className="row between">
        <h1>Meldingen</h1>
        {data && data.unreadCount > 0 && <button className="btn btn-ghost" onClick={readAll}>Alles gelezen</button>}
      </div>
      {loading && !data && <Spinner />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data?.notifications.length === 0 && <p className="muted">Geen meldingen.</p>}
      {data?.notifications.map((n) => {
        const body = (
          <>
            <strong>{n.title}</strong>
            <div className="muted">{n.message}</div>
          </>
        );
        return n.callingId ? (
          <Link key={n.id} to={`/roepingen/${n.callingId}`} className="glass panel" style={n.readAt ? { opacity: 0.7 } : undefined}>{body}</Link>
        ) : (
          <div key={n.id} className="glass panel">{body}</div>
        );
      })}
    </div>
  );
}
