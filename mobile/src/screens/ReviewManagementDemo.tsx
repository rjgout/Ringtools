import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { ErrorState, Spinner, StatusLabel } from "../components/ui";
const roles: Record<string, string> = { RINGPRESIDIUM: "Ringpresidium", HOGERAAD: "Hoge raad", RINGSECRETARIS: "Ringsecretaris" };
export function ReviewManagementDemo() {
  const { me, ring, api } = useAuth();
  const permitted = !!me?.user.reviewAccount && ring?.role === "RINGSECRETARIS";
  const { data, loading, error, reload } = useLoad(() => permitted && ring ? api.reviewManagement(ring.id) : Promise.resolve(null), [permitted, ring?.id]);
  if (!permitted) return <p>Deze demonstratie is alleen beschikbaar voor Apple Review 3.</p>;
  return <div className="stack"><h1>Gebruikersbeheer – demo</h1>
    <p>Bekijk de gebruikersrollen en inrichting van de fictieve demoring. Deze demonstratie is alleen-lezen: uitnodigen, rollen wijzigen en ringbeheerrechten toekennen zijn hier niet beschikbaar. Je krijgt geen ringbeheerrechten.</p>
    {loading && <Spinner />}{error && <ErrorState error={error} onRetry={reload} />}
    {data && <><h2>{data.ringName}</h2>{data.users.map(u => <section className="glass card stack" key={u.name}><strong>{u.name}</strong><span>{roles[u.role] ?? u.role}</span><span className="muted">{u.churchFunction}</span><StatusLabel tone={u.active ? "ok" : "neutral"}>{u.active ? "Actief" : "Ingetrokken"}</StatusLabel></section>)}
      <h2>Inrichting</h2>{data.units.map(u => <div className="glass panel" key={`${u.kind}:${u.name}`}>{u.name} · {u.kind === "WIJK" ? "Wijk" : "Gemeente"}</div>)}
      <p className="muted">In gewone ringen beheert een bevoegde ringbeheerder de gebruikers en uitnodigingen. Deze afgeschermde demo toont alleen fictieve inrichting; wijzigingen aan reviewaccounts lopen via het beveiligde systeembeheer.</p>
    </>}
  </div>;
}
